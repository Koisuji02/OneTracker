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
 *   GET  /health                      → which secrets are configured
 *   ANY  /p/{provider}/{path...}      → proxied provider call, key injected
 *   GET  /img/{provider}/{path...}    → proxied image host (blocked CDNs)
 *   POST /igdb/{endpoint}             → IGDB with a managed Twitch token
 *
 * Free tier: 100k requests/day, and the CPU cost here is negligible (pure I/O).
 */

const JSON_PROVIDERS = {
  // provider → { base, auth(url, env, headers) }
  tmdb: {
    base: 'https://api.themoviedb.org/3',
    auth(url, env, headers) {
      const key = env.TMDB_KEY
      if (!key) return
      // v4 read tokens go in the header, legacy v3 keys in the query string
      if (key.startsWith('ey')) headers.set('Authorization', `Bearer ${key}`)
      else url.searchParams.set('api_key', key)
    },
  },
  rawg: {
    base: 'https://api.rawg.io/api',
    auth(url, env) {
      if (env.RAWG_KEY) url.searchParams.set('key', env.RAWG_KEY)
    },
  },
  omdb: {
    base: 'https://www.omdbapi.com',
    auth(url, env) {
      if (env.OMDB_KEY) url.searchParams.set('apikey', env.OMDB_KEY)
    },
  },
  comicvine: {
    base: 'https://comicvine.gamespot.com/api',
    auth(url, env) {
      if (env.COMICVINE_KEY) url.searchParams.set('api_key', env.COMICVINE_KEY)
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

/**
 * Edge cache. 100 people looking up the same popular titles should not cost 100
 * upstream calls: OMDb allows 1000/day and Comic Vine 200/hour, so caching is
 * what makes a shared instance viable at all. Cloudflare's Cache API is free.
 *
 * Searches move fast (new titles, typos while typing) → short TTL.
 * Details are stable → long TTL. Errors are never cached.
 */
const TTL_SEARCH = 60 * 60 // 1 h
const TTL_DETAIL = 24 * 60 * 60 // 24 h

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

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS },
  })

/**
 * Serve from the edge cache when possible, otherwise run `produce()` and store
 * a copy. Only successful responses are cached; `X-OT-Cache` says HIT or MISS
 * so a cache problem is visible from the client.
 */
async function cached(ctx, key, ttl, produce) {
  const cache = caches.default
  const hit = await cache.match(key)
  if (hit) {
    const headers = new Headers(hit.headers)
    headers.set('X-OT-Cache', 'HIT')
    return new Response(hit.body, { status: hit.status, headers })
  }
  const res = await produce()
  if (res.ok && ttl > 0) {
    const store = new Response(res.clone().body, res)
    store.headers.set('Cache-Control', `public, max-age=${ttl}`)
    ctx.waitUntil(cache.put(key, store))
  }
  const headers = new Headers(res.headers)
  headers.set('X-OT-Cache', 'MISS')
  return new Response(res.body, { status: res.status, headers })
}

/** Copy an upstream response through, adding CORS. */
function passThrough(res) {
  const headers = new Headers(res.headers)
  for (const [k, v] of Object.entries(CORS)) headers.set(k, v)
  // upstream may vary by auth we stripped; don't let a shared cache confuse it
  headers.delete('set-cookie')
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers })
}

// ------------------------------------------------------------------ IGDB

/** Twitch app token, cached in the isolate until shortly before it expires. */
let igdbToken = null

async function igdbAccessToken(env) {
  if (igdbToken && Date.now() < igdbToken.exp - 60_000) return igdbToken.value
  if (!env.IGDB_CLIENT_ID || !env.IGDB_CLIENT_SECRET) throw new Error('igdb-not-configured')
  const url = new URL('https://id.twitch.tv/oauth2/token')
  url.searchParams.set('client_id', env.IGDB_CLIENT_ID)
  url.searchParams.set('client_secret', env.IGDB_CLIENT_SECRET)
  url.searchParams.set('grant_type', 'client_credentials')
  const res = await fetch(url, { method: 'POST' })
  if (!res.ok) throw new Error(`igdb-token-${res.status}`)
  const data = await res.json()
  igdbToken = {
    value: data.access_token,
    exp: Date.now() + (data.expires_in ?? 3600) * 1000,
  }
  return igdbToken.value
}

async function handleIgdb(body, env, endpoint) {
  const token = await igdbAccessToken(env)
  const res = await fetch(`https://api.igdb.com/v4/${endpoint}`, {
    method: 'POST',
    headers: {
      'Client-ID': env.IGDB_CLIENT_ID,
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
      'Content-Type': 'text/plain',
    },
    body,
  })
  return passThrough(res)
}

// ------------------------------------------------------------- entrypoint

export default {
  async fetch(request, env, ctx) {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS })

    const url = new URL(request.url)
    const [, section, provider, ...rest] = url.pathname.split('/')

    // optional shared token: keeps casual strangers from using this as an open
    // proxy. It ships in the app, so treat it as friction, not as security —
    // the real win is that PROVIDER keys never leave the Worker.
    if (env.APP_TOKEN) {
      const given = request.headers.get('X-OT-Token') ?? url.searchParams.get('t')
      if (given !== env.APP_TOKEN) return json({ error: 'unauthorized' }, 401)
    }

    try {
      if (url.pathname === '/health' || section === 'health') {
        return json({
          ok: true,
          configured: {
            tmdb: !!env.TMDB_KEY,
            rawg: !!env.RAWG_KEY,
            omdb: !!env.OMDB_KEY,
            comicvine: !!env.COMICVINE_KEY,
            igdb: !!(env.IGDB_CLIENT_ID && env.IGDB_CLIENT_SECRET),
            appToken: !!env.APP_TOKEN,
          },
          // Deliberately only booleans. This used to also report the LENGTH of
          // every string binding, which is a free hint about the shape of each
          // secret to anyone who has the app token (and the app token ships
          // inside the APK). "Configured or not" is all the Settings screen
          // needs to diagnose a provider.
        })
      }

      if (section === 'igdb') {
        const body = await request.text()
        const key = await cacheKeyFor(request, url, body)
        return await cached(ctx, key, isSearch(url.pathname, body) ? TTL_SEARCH : TTL_DETAIL, () =>
          handleIgdb(body, env, provider ?? 'games'),
        )
      }

      if (section === 'img') {
        const base = IMAGE_PROVIDERS[provider]
        if (!base) return json({ error: 'unknown image provider' }, 404)
        const target = `${base}/${rest.join('/')}${url.search}`
        const res = await fetch(target, { headers: { Accept: 'image/*' } })
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
        cfg.auth?.(target, env, headers)

        const key = await cacheKeyFor(request, url, body)
        return await cached(ctx, key, isSearch(url.pathname + url.search, body) ? TTL_SEARCH : TTL_DETAIL, async () =>
          passThrough(
            await fetch(target.toString(), {
              method: request.method,
              headers,
              body: body || undefined,
            }),
          ),
        )
      }

      return json({ error: 'not found', routes: ['/health', '/p/{provider}/…', '/img/{provider}/…', '/igdb/{endpoint}'] }, 404)
    } catch (e) {
      return json({ error: String(e?.message ?? e) }, 502)
    }
  },
}
