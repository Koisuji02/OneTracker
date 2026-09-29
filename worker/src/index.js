/**
 * OneTracker API gateway (Cloudflare Worker).
 *
 * WHY this exists:
 * 1. Some providers are blocked at the network level for some users (Italian
 *    ISPs DNS-block MangaDex). The app can't fix DNS from a WebView, but it CAN
 *    talk to one host it always reaches — this Worker — which fetches upstream
 *    from Cloudflare's network instead.
 * 2. API keys stop shipping inside the APK: they live in Worker secrets and are
 *    injected here, server side.
 * 3. IGDB (the database Stash uses) needs a server-to-server OAuth token and
 *    sends no CORS headers, so it's only usable behind a proxy like this.
 *
 * Routes
 *   GET  /health                      → which secrets are configured, which keys are resting
 *   ANY  /p/{provider}/{path...}      → proxied provider call, key injected
 *   GET  /img/{provider}/{path...}    → proxied image host (blocked CDNs)
 *   POST /igdb/{endpoint}             → IGDB with a managed Twitch token
 *   POST /hltb/search                 → HowLongToBeat game lengths
 *   POST /google/token                → OAuth code/refresh → Drive access token
 *
 * Free tier: 100k requests/day, and the CPU cost here is negligible (pure I/O).
 * How it stays up with nobody watching — key pools, stale answers — is edge.js.
 */

import { cached, classify, KEYED, keysOf, POLICY, restingKeys, withKeys } from './edge.js'

const JSON_PROVIDERS = {
  // provider → { base, auth(url, key, headers) } — `key` is the ONE key picked
  // for this attempt out of the provider's pool (edge.js), '' when none is set
  tmdb: {
    base: 'https://api.themoviedb.org/3',
    auth(url, key, headers) {
      if (!key) return
      // v4 read tokens go in the header, legacy v3 keys in the query string
      if (key.startsWith('ey')) headers.set('Authorization', `Bearer ${key}`)
      else url.searchParams.set('api_key', key)
    },
  },
  rawg: {
    base: 'https://api.rawg.io/api',
    auth(url, key) {
      if (key) url.searchParams.set('key', key)
    },
  },
  omdb: {
    base: 'https://www.omdbapi.com',
    auth(url, key) {
      if (key) url.searchParams.set('apikey', key)
    },
  },
  comicvine: {
    base: 'https://comicvine.gamespot.com/api',
    auth(url, key) {
      if (key) url.searchParams.set('api_key', key)
      // through the proxy we can finally use plain JSON instead of JSONP
      url.searchParams.set('format', 'json')
    },
  },
  mangadex: { base: 'https://api.mangadex.org' },
  jikan: { base: 'https://api.jikan.moe/v4' },
  anilist: { base: 'https://graphql.anilist.co' },
  openlibrary: { base: 'https://openlibrary.org' },
}

/** Image/CDN hosts that some networks block. */
const IMAGE_PROVIDERS = {
  mangadex: 'https://uploads.mangadex.org',
  tmdb: 'https://image.tmdb.org',
  igdb: 'https://images.igdb.com',
}

const isSearch = (pathname, body = '') =>
  /\/search|\/games\?|q=|query=|title=/i.test(pathname) || /^\s*search\s+"/i.test(body)

/** Stable cache key: POST bodies (IGDB/AniList queries) are folded into the URL. */
async function cacheKeyFor(request, url, body) {
  if (!body) return new Request(url.toString(), { method: 'GET' })
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(body))
  const hex = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
  const keyUrl = new URL(url.toString())
  keyUrl.searchParams.set('__body', hex.slice(0, 32))
  return new Request(keyUrl.toString(), { method: 'GET' })
}

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type,Authorization,X-OT-Token',
  'Access-Control-Max-Age': '86400',
}

const json = (body, status = 200, extra = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS, ...extra },
  })

/**
 * Every key of a provider is resting. 503 so the edge cache falls back to a
 * stale copy when it has one (cached() never stores a non-ok answer), and
 * `X-OT-Reason` so the app can tell "quota" from "provider down".
 */
const quota = (provider) =>
  json({ error: 'quota', provider, hint: 'every key is resting; add one to the pool' }, 503, { 'X-OT-Reason': 'quota' })

/** Copy an upstream response through, adding CORS. */
function passThrough(res) {
  const headers = new Headers(res.headers)
  for (const [k, v] of Object.entries(CORS)) headers.set(k, v)
  // upstream may vary by auth we stripped; don't let a shared cache confuse it
  headers.delete('set-cookie')
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers })
}

// ------------------------------------------------------------------ IGDB

/**
 * Twitch app tokens, one per client id, cached in the isolate until shortly
 * before they expire. `IGDB_CLIENT_ID` / `IGDB_CLIENT_SECRET` are pools too
 * (comma-separated, paired by position): IGDB allows 4 requests a second per
 * client, so a second client doubles the burst ceiling.
 */
const igdbTokens = new Map()

async function igdbAccessToken(clientId, secret) {
  const have = igdbTokens.get(clientId)
  if (have && Date.now() < have.exp - 60_000) return have.value
  const url = new URL('https://id.twitch.tv/oauth2/token')
  url.searchParams.set('client_id', clientId)
  url.searchParams.set('client_secret', secret)
  url.searchParams.set('grant_type', 'client_credentials')
  const res = await fetch(url, { method: 'POST' })
  if (!res.ok) throw new Error(`igdb-token-${res.status}`)
  const data = await res.json()
  igdbTokens.set(clientId, { value: data.access_token, exp: Date.now() + (data.expires_in ?? 3600) * 1000 })
  return data.access_token
}

async function handleIgdb(body, env, endpoint, cache, origin) {
  const ids = keysOf(env, 'IGDB_CLIENT_ID')
  const secrets = keysOf(env, 'IGDB_CLIENT_SECRET')
  if (ids.length === 0 || secrets.length !== ids.length) throw new Error('igdb-not-configured')
  const r = await withKeys({
    cache,
    origin,
    provider: 'igdb',
    keys: ids,
    attempt: async (clientId, i) => {
      const token = await igdbAccessToken(clientId, secrets[i])
      const res = await fetch(`https://api.igdb.com/v4/${endpoint}`, {
        method: 'POST',
        headers: {
          'Client-ID': clientId,
          Authorization: `Bearer ${token}`,
          Accept: 'application/json',
          'Content-Type': 'text/plain',
        },
        body,
      })
      const c = await classify('igdb', res)
      // a refused token is re-minted on the next attempt, not kept
      if (c.reason === 'token') igdbTokens.delete(clientId)
      return c
    },
  })
  return r.outcome === 'quota' ? quota('igdb') : passThrough(r.res)
}

// ---------------------------------------------------------------- Google

/**
 * Google OAuth token exchange — what makes the Drive backup work in the
 * background FOREVER, instead of for the hour an access token lasts.
 *
 * The app signs in with the plugin in `offline` mode, which yields a
 * `serverAuthCode` instead of an access token. Exchanging that code for a
 * REFRESH token needs the web client's secret, which must never ship inside an
 * APK — so it lives here, and this route is the only thing that ever sees it.
 *
 * Three operations, all on the same endpoint:
 * - `{ code }`          → first exchange: access token + refresh token
 * - `{ refresh_token }` → a new access token, silently, at any later time
 * - `{ revoke }`        → hand the refresh token back to Google (disconnect)
 *
 * Responses are NEVER cached: they are credentials, and one is single-use.
 */
async function handleGoogleToken(body, env) {
  let payload = {}
  try {
    payload = JSON.parse(body || '{}')
  } catch {
    return json({ error: 'bad-json' }, 400)
  }
  const secret = env.GOOGLE_CLIENT_SECRET
  const clientId = env.GOOGLE_CLIENT_ID || payload.client_id
  if (!secret || !clientId) return json({ error: 'google-not-configured' }, 501)

  if (payload.revoke) {
    // best-effort: a token already dead answers 400, which is fine by us
    await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(payload.revoke)}`, {
      method: 'POST',
    }).catch(() => {})
    return json({ ok: true })
  }

  const form = new URLSearchParams()
  form.set('client_id', clientId)
  form.set('client_secret', secret)
  if (payload.code) {
    form.set('code', payload.code)
    form.set('grant_type', 'authorization_code')
    // codes minted by requestOfflineAccess() on Android belong to the WEB
    // client but have no redirect: Google's own backend-server flow sends the
    // parameter empty rather than omitting it
    form.set('redirect_uri', '')
  } else if (payload.refresh_token) {
    form.set('refresh_token', payload.refresh_token)
    form.set('grant_type', 'refresh_token')
  } else {
    return json({ error: 'code-or-refresh-token-required' }, 400)
  }

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: form.toString(),
  })
  const data = await res.json().catch(() => ({ error: 'google-token-unparsable' }))
  // pass Google's own error through: `invalid_grant` is what tells the app the
  // refresh token was revoked and the account must be reconnected
  return json(data, res.ok ? 200 : res.status)
}

// ------------------------------------------------------------------ HLTB

/**
 * HowLongToBeat — the game-length source ("how long does it take to beat").
 *
 * It has no public API and no CORS headers, so it can only work from here. The
 * site's own search is guarded: a GET to `/api/search/site/init` hands out a
 * short-lived `token` plus a one-shot `hpKey`/`hpVal` pair, and the search POST
 * must echo all three (the key/value also inside the JSON body). The token is
 * bound to the caller's IP **and User-Agent**, so both requests must go out
 * with the exact same UA — and a token is never reused across requests here,
 * because the two hops can leave Cloudflare from different egress IPs.
 *
 * Everything is best-effort by design: a shape change upstream must degrade to
 * "no length data", never break game pages (the app falls back to IGDB).
 */
const HLTB_ORIGIN = 'https://howlongtobeat.com'
const HLTB_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36',
  Referer: `${HLTB_ORIGIN}/`,
  Origin: HLTB_ORIGIN,
  'Accept-Language': 'en-US,en;q=0.9',
}

async function hltbInit() {
  const res = await fetch(`${HLTB_ORIGIN}/api/search/site/init?t=${Date.now()}`, {
    headers: { ...HLTB_HEADERS, Accept: 'application/json' },
  })
  if (!res.ok) throw new Error(`hltb-init-${res.status}`)
  return res.json()
}

/** The site's own search payload, trimmed to "no filters, most popular first". */
function hltbBody(terms, sec) {
  const any = { mode: 'include', values: [] }
  const body = {
    searchType: 'games',
    searchTerms: terms,
    searchPage: 1,
    size: 20,
    searchOptions: {
      games: {
        userId: 0,
        platform: any,
        sortCategory: 'popular',
        rangeCategory: 'main',
        rangeTime: { min: null, max: null },
        gameplay: { perspective: any, flow: any, genre: any, difficulty: '' },
        year: any,
        modifier: '',
      },
      users: { sortCategory: 'postcount' },
      lists: { sortCategory: 'follows' },
      filter: '',
      sort: 0,
      randomizer: 0,
    },
    useCache: true,
  }
  if (sec?.hpKey) body[sec.hpKey] = sec.hpVal
  return body
}

function hltbSearch(terms, sec) {
  return fetch(`${HLTB_ORIGIN}/api/search/site`, {
    method: 'POST',
    headers: {
      ...HLTB_HEADERS,
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'x-auth-token': sec?.token ?? '',
      'x-hp-key': sec?.hpKey ?? '',
      'x-hp-val': sec?.hpVal ?? '',
    },
    body: JSON.stringify(hltbBody(terms, sec)),
  })
}

/**
 * Times come back in SECONDS. Only what the app matches on and displays is
 * forwarded — the raw row carries ~35 fields (images, forum counts, review
 * scores) that would triple the payload for nothing.
 */
async function handleHltb(query) {
  const terms = String(query ?? '')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 12)
  if (terms.length === 0) return json({ data: [] })

  let sec = await hltbInit()
  let res = await hltbSearch(terms, sec)
  // the guard token expires fast (and is IP-bound): one fresh retry, like the
  // site's own client does on a 403
  if (res.status === 401 || res.status === 403) {
    sec = await hltbInit()
    res = await hltbSearch(terms, sec)
  }
  if (!res.ok) return json({ error: `hltb-${res.status}` }, 502)
  const data = await res.json()
  return json({
    data: (data?.data ?? []).slice(0, 20).map((g) => ({
      id: g.game_id,
      name: g.game_name ?? '',
      alias: g.game_alias ?? '',
      year: g.release_world || null,
      type: g.game_type ?? 'game',
      // seconds: main story · main + extras · completionist · all styles
      main: g.comp_main || 0,
      plus: g.comp_plus || 0,
      full: g.comp_100 || 0,
      all: g.comp_all || 0,
      /** multiplayer-only titles have no completion time, just invested hours */
      coop: g.invested_co || 0,
      versus: g.invested_mp || 0,
      /** submissions behind the numbers — the popularity/confidence signal */
      samples: g.count_comp || 0,
    })),
  })
}

// ---------------------------------------------------------------- health

/**
 * The operator's dashboard, one JSON. `configured` is what the app's Settings
 * screen reads; `pools` and `advice` are for whoever runs the gateway — the
 * one line that says "add a key" before users notice anything.
 *
 * Deliberately only booleans and counts: this used to report the LENGTH of
 * every secret, a free hint about its shape to anyone holding the app token
 * (which ships inside the APK).
 */
async function health(env, request, cache, origin) {
  const pools = {}
  for (const [provider, secret] of Object.entries({ ...KEYED, igdb: 'IGDB_CLIENT_ID' })) {
    const n = keysOf(env, secret).length
    pools[provider] = { keys: n, resting: await restingKeys(cache, origin, provider, n) }
  }
  const advice = []
  for (const [provider, p] of Object.entries(pools)) {
    if (p.keys === 0 || p.resting.length === 0) continue
    const why = [...new Set(p.resting.map((r) => r.reason))].join(', ')
    const secret = provider === 'igdb' ? 'IGDB_CLIENT_ID + IGDB_CLIENT_SECRET' : KEYED[provider]
    advice.push(
      p.resting.length >= p.keys
        ? `${provider}: every key is resting (${why}) — add one: wrangler secret put ${secret}, comma-separated`
        : `${provider}: ${p.resting.length}/${p.keys} keys resting (${why})`,
    )
  }
  return json({
    ok: true,
    configured: {
      tmdb: pools.tmdb.keys > 0,
      rawg: pools.rawg.keys > 0,
      omdb: pools.omdb.keys > 0,
      comicvine: pools.comicvine.keys > 0,
      igdb: pools.igdb.keys > 0 && keysOf(env, 'IGDB_CLIENT_SECRET').length === pools.igdb.keys,
      // with this on, the app can hold a Google REFRESH token and back
      // up to Drive in the background indefinitely
      google: !!(env.GOOGLE_CLIENT_SECRET && env.GOOGLE_CLIENT_ID),
      appToken: !!env.APP_TOKEN,
      // abuse shield: both must be true for it to do anything
      rateLimit: !!(env.RL_API && env.RL_HEAVY),
      clientIp: !!request.headers.get('CF-Connecting-IP'),
    },
    // per datacenter: each colo learns on its own which keys are spent
    pools,
    cache: { policy: 'stale-while-revalidate + stale-if-error', keepDays: 30, colo: request.cf?.colo ?? null },
    advice,
  })
}

/**
 * Per-IP rate limit. Returns true when the request may proceed.
 *
 * The binding is optional on purpose: a deployment without it (or a plan that
 * doesn't offer it) must keep working rather than fail closed — this is a
 * shield against abuse, not an auth check.
 */
async function withinLimit(limiter, ip) {
  if (!limiter || !ip) return true
  try {
    const { success } = await limiter.limit({ key: ip })
    return success
  } catch {
    return true // never let the shield take the gateway down
  }
}

// ------------------------------------------------------------- entrypoint

export default {
  async fetch(request, env, ctx) {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS })

    const url = new URL(request.url)
    const [, section, provider, ...rest] = url.pathname.split('/')
    const cache = caches.default

    // health stays reachable so the app can always diagnose itself
    if (section !== 'health' && url.pathname !== '/health') {
      const ip = request.headers.get('CF-Connecting-IP')
      const heavy = section === 'hltb'
      const ok = await withinLimit(heavy ? env.RL_HEAVY : env.RL_API, ip)
      if (!ok) return json({ error: 'rate-limited' }, 429)
    }

    // optional shared token: keeps casual strangers from using this as an open
    // proxy. It ships in the app, so treat it as friction, not as security —
    // the real win is that PROVIDER keys never leave the Worker.
    if (env.APP_TOKEN) {
      const given = request.headers.get('X-OT-Token') ?? url.searchParams.get('t')
      if (given !== env.APP_TOKEN) return json({ error: 'unauthorized' }, 401)
    }

    try {
      if (url.pathname === '/health' || section === 'health') {
        return await health(env, request, cache, url.origin)
      }

      if (section === 'google' && provider === 'token') {
        return await handleGoogleToken(await request.text(), env)
      }

      if (section === 'hltb') {
        const body = request.method === 'POST' ? await request.text() : ''
        let query = url.searchParams.get('q') ?? ''
        if (body) {
          try {
            query = JSON.parse(body).query ?? query
          } catch {
            query = body.trim()
          }
        }
        const key = await cacheKeyFor(request, url, `hltb:${query}`)
        return await cached(cache, ctx, key, POLICY.static, () => handleHltb(query))
      }

      if (section === 'igdb') {
        const body = await request.text()
        const key = await cacheKeyFor(request, url, body)
        const policy = isSearch(url.pathname, body) ? POLICY.search : POLICY.detail
        return await cached(cache, ctx, key, policy, () => handleIgdb(body, env, provider ?? 'games', cache, url.origin))
      }

      if (section === 'img') {
        const base = IMAGE_PROVIDERS[provider]
        if (!base) return json({ error: 'unknown image provider' }, 404)
        const target = `${base}/${rest.join('/')}${url.search}`
        // `cf.cacheTtl` keeps the upstream image at the edge as well: the 200th
        // person opening the same manga costs MangaDex nothing
        const res = await fetch(target, {
          headers: { Accept: 'image/*' },
          cf: { cacheEverything: true, cacheTtl: 604800 },
        })
        const headers = new Headers(res.headers)
        for (const [k, v] of Object.entries(CORS)) headers.set(k, v)
        // images are immutable; let the browser and the edge keep them
        headers.set('Cache-Control', 'public, max-age=604800')
        return new Response(res.body, { status: res.status, headers })
      }

      if (section === 'p') {
        const cfg = JSON_PROVIDERS[provider]
        if (!cfg) return json({ error: 'unknown provider' }, 404)
        const body = request.method === 'POST' ? await request.text() : ''
        const target = new URL(`${cfg.base}${rest.length ? `/${rest.join('/')}` : ''}`)
        for (const [k, v] of url.searchParams) if (k !== 't') target.searchParams.set(k, v)
        const headers = new Headers()
        const ct = request.headers.get('Content-Type')
        if (ct) headers.set('Content-Type', ct)
        headers.set('Accept', 'application/json')
        // a descriptive UA keeps politeness-checking APIs (Open Library) happy
        headers.set('User-Agent', 'OneTracker/1.0 (personal media tracker)')

        const key = await cacheKeyFor(request, url, body)
        const policy = isSearch(url.pathname + url.search, body)
          ? POLICY.search
          : provider === 'omdb'
            ? POLICY.static
            : POLICY.detail
        const keys = KEYED[provider] ? keysOf(env, KEYED[provider]) : []
        return await cached(cache, ctx, key, policy, async () => {
          const r = await withKeys({
            cache,
            origin: url.origin,
            provider,
            keys,
            attempt: async (apiKey) => {
              const t = new URL(target.toString())
              const h = new Headers(headers)
              cfg.auth?.(t, apiKey, h)
              const res = await fetch(t.toString(), { method: request.method, headers: h, body: body || undefined })
              return classify(provider, res)
            },
          })
          return r.outcome === 'quota' ? quota(provider) : passThrough(r.res)
        })
      }

      return json({ error: 'not found', routes: ['/health', '/p/{provider}/…', '/img/{provider}/…', '/igdb/{endpoint}'] }, 404)
    } catch (e) {
      return json({ error: String(e?.message ?? e) }, 502)
    }
  },
}
