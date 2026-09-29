/**
 * What keeps the gateway up WITHOUT anyone watching it.
 *
 * Two mechanisms, both invisible to the app:
 *
 * 1. Key pools. A provider secret may hold several keys, comma-separated
 *    (`OMDB_KEY="k1,k2,k3"`). A request picks one at random; when the provider
 *    answers "this key is spent" (429, Comic Vine's 420, a 401/403, or OMDb's
 *    polite 200 with "Request limit reached!") that key is RESTED for a
 *    cooldown — a marker in the edge cache — and the request is retried with
 *    the next one. Quotas add up: three OMDb keys are 3,000 lookups a day, and
 *    adding a fourth is one `wrangler secret put`, no deploy, no app update.
 *
 * 2. Stale answers beat no answers. Successful responses are kept for 30 days
 *    past their freshness. A stale copy is served instantly while a refresh
 *    runs in the background (searches and static data), or as a fallback when
 *    the upstream fails or every key is resting (everything). A provider
 *    outage, a blocked HowLongToBeat or an exhausted quota degrades to
 *    "slightly old data" instead of an error, for anything anyone has asked
 *    for before.
 *
 * Both live in Cloudflare's Cache API, which is per-datacenter: each colo learns
 * on its own which keys are resting. That is fine — the cost of the lesson is
 * one wasted upstream call per key, per colo, per cooldown.
 *
 * Everything takes the cache as a parameter so it can be unit-tested in Node
 * (worker/test) — `caches.default` only exists inside a Worker.
 */

/** Providers whose secret is a key pool → the secret's name. */
export const KEYED = { tmdb: 'TMDB_KEY', rawg: 'RAWG_KEY', omdb: 'OMDB_KEY', comicvine: 'COMICVINE_KEY' }

/** `"a, b,,c"` → `['a','b','c']`; a missing secret is an empty pool. */
export function keysOf(env, name) {
  return String(env?.[name] ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
}

// ------------------------------------------------------------ freshness

/**
 * Searches move fast (new titles, typos while typing) → short. Details are
 * stable → a day. "Static" is for answers that do not change and whose
 * upstream we most want to spare: a game's how-long-to-beat time is a
 * years-old crowd average on an unofficial endpoint, and OMDb's critic scores
 * move glacially while its free key allows ~1,000 calls a DAY for every user
 * of this gateway put together.
 */
export const TTL_SEARCH = 60 * 60
export const TTL_DETAIL = 24 * 60 * 60
export const TTL_STATIC = 7 * 24 * 60 * 60
/** How long a copy stays around past its freshness, for fallbacks. */
export const KEEP = 30 * 24 * 60 * 60
/** At most one background refresh per key, per colo, per this many seconds. */
const REVALIDATE_LOCK = 30

/**
 * `swr` = serve the stale copy at once and refresh in the background.
 *
 * Details deliberately do NOT: an episode list must show a new episode the day
 * it airs, and the app then keeps that list for a week locally — a stale hit
 * would push the new episode a week out. Past its freshness a detail goes
 * upstream and waits; its stale copy is only for when the upstream fails.
 */
export const POLICY = {
  search: { fresh: TTL_SEARCH, swr: true },
  detail: { fresh: TTL_DETAIL, swr: false },
  static: { fresh: TTL_STATIC, swr: true },
}

const FRESH_HEADER = 'X-OT-Fresh-Until'

/** The only clock in this file — tests move it instead of patching Date. */
export const clock = { now: () => Date.now() }

/** Same response, with `X-OT-Cache` saying how it was served. */
function tag(res, state) {
  const headers = new Headers(res.headers)
  headers.set('X-OT-Cache', state)
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers })
}

function storable(res, policy) {
  const store = new Response(res.body, res)
  store.headers.set('Cache-Control', `public, max-age=${policy.fresh + KEEP}`)
  store.headers.set(FRESH_HEADER, String(clock.now() + policy.fresh * 1000))
  // Upstream caching headers must not survive: OMDb answers with `Vary: *`,
  // which makes a response permanently UNCACHEABLE — every rating lookup was
  // going upstream, on the provider with the tightest quota of the lot. The
  // cache key is one we build ourselves, so Vary is meaningless to us anyway.
  for (const h of ['Vary', 'Expires', 'Age', 'Pragma']) store.headers.delete(h)
  return store
}

function marker(seconds, headers = {}) {
  return new Response('', { headers: { 'Cache-Control': `max-age=${seconds}`, ...headers } })
}

function lockFor(key) {
  const u = key.url
  return new Request(`${u}${u.includes('?') ? '&' : '?'}__ot=revalidating`, { method: 'GET' })
}

/**
 * Serve from the edge when possible, otherwise run `produce()` and keep a copy.
 * Only successful responses are stored. `X-OT-Cache` on the way out:
 *   HIT          fresh copy
 *   STALE        past freshness, served anyway; a refresh is running behind it
 *   STALE-ERROR  upstream failed (or every key is resting); old answer served
 *   MISS         went upstream
 */
export async function cached(cache, ctx, key, policy, produce) {
  const hit = await cache.match(key)
  const fresh = hit && clock.now() < Number(hit.headers.get(FRESH_HEADER) || 0)
  if (hit && fresh) return tag(hit, 'HIT')
  if (hit && policy.swr) {
    ctx.waitUntil(revalidate(cache, key, policy, produce))
    return tag(hit, 'STALE')
  }
  let res
  try {
    res = await produce()
  } catch (e) {
    if (hit) return tag(hit, 'STALE-ERROR')
    throw e
  }
  if (res.ok) {
    ctx.waitUntil(cache.put(key, storable(res.clone(), policy)))
    return tag(res, 'MISS')
  }
  if (hit) return tag(hit, 'STALE-ERROR')
  return tag(res, 'MISS')
}

async function revalidate(cache, key, policy, produce) {
  const lock = lockFor(key)
  if (await cache.match(lock)) return
  await cache.put(lock, marker(REVALIDATE_LOCK))
  try {
    const res = await produce()
    if (res.ok) await cache.put(key, storable(res, policy))
  } catch {
    // the stale copy stays; the next stale hit after the lock expires tries again
  }
}

// ------------------------------------------------------------- key pools

/** Seconds a key rests, by what the provider said. */
const REST = {
  quota: 60 * 60, // a daily/monthly budget is gone; it may have reset in an hour
  'rate-limited': 60, // a burst limit: back shortly
  rejected: 60 * 60, // 401/403: a dead key, or a quota some providers report this way
  badkey: 24 * 60 * 60, // the provider says the key itself is invalid
  token: 5, // IGDB: the app token was refused, re-mint on the next try
}

const markerFor = (origin, provider, i) => new Request(`${origin}/__ot/resting/${provider}/${i}`, { method: 'GET' })

/** Which keys of a pool are resting in THIS datacenter, and why. */
export async function restingKeys(cache, origin, provider, n) {
  const marks = await Promise.all(
    Array.from({ length: n }, (_, i) => cache.match(markerFor(origin, provider, i))),
  )
  return marks.flatMap((m, index) =>
    m ? [{ index, reason: m.headers.get('X-OT-Reason') ?? 'spent', until: m.headers.get('X-OT-Until') ?? '' }] : [],
  )
}

/**
 * Read a provider's answer for "this key is spent". Returns the response to
 * forward (re-wrapped when the body had to be read) and a `reason` — '' when
 * the key is fine. `cooldown` overrides the default rest for that reason.
 *
 * Provider quirks, learned the hard way:
 * - OMDb reports BOTH a spent quota ("Request limit reached!") and a dead key
 *   ("Invalid API key!") as HTTP 200 with `Response: "False"` — the same shape
 *   as a perfectly normal "Movie not found!".
 * - Comic Vine rate-limits with HTTP 420 and reports an invalid key as a 200
 *   whose `status_code` is 100.
 * - IGDB allows 4 requests a second per Twitch client and answers 429 — a
 *   second client gets past that instantly, so the rest is two seconds.
 */
export async function classify(provider, res) {
  const s = res.status
  const keyed = provider in KEYED || provider === 'igdb'
  if (s === 429) {
    if (provider === 'igdb') return { res, reason: 'rate-limited', cooldown: 2 }
    return { res, reason: keyed ? (provider === 'comicvine' ? 'quota' : 'rate-limited') : '' }
  }
  if (s === 420 && provider === 'comicvine') return { res, reason: 'quota' }
  if (s === 401 && provider === 'igdb') return { res, reason: 'token' }
  if ((s === 401 || s === 403) && keyed) return { res, reason: 'rejected' }
  if (provider === 'omdb' && s === 200) {
    const text = await res.text()
    let err = ''
    try {
      err = String(JSON.parse(text)?.Error ?? '')
    } catch {
      err = ''
    }
    const reason = /limit/i.test(err) ? 'quota' : /api key/i.test(err) ? 'badkey' : ''
    return { res: new Response(text, res), reason }
  }
  if (provider === 'comicvine' && s === 200) {
    const text = await res.text()
    // `error`/`status_code` come before `results`, so the head is enough
    const bad = /"status_code":\s*100\b/.test(text.slice(0, 400))
    return { res: new Response(text, res), reason: bad ? 'badkey' : '' }
  }
  return { res, reason: '' }
}

/**
 * Run `attempt(key, index)` with the first key that is not resting, retrying
 * with the next one whenever the provider says the key is spent. Outcome:
 *   ok     a key worked (or the provider is keyless)
 *   quota  every key is resting — nothing was sent upstream if they already
 *          were, so a dead quota costs no more calls until the rest ends
 */
export async function withKeys({ cache, origin, provider, keys, attempt }) {
  if (keys.length === 0) {
    const r = await attempt('', 0)
    return { res: r.res, outcome: 'ok' }
  }
  const resting = new Set((await restingKeys(cache, origin, provider, keys.length)).map((r) => r.index))
  const start = Math.floor(Math.random() * keys.length)
  let last = null
  for (let step = 0; step < keys.length; step++) {
    const i = (start + step) % keys.length
    if (resting.has(i)) continue
    const r = await attempt(keys[i], i)
    if (!r.reason) return { res: r.res, index: i, outcome: 'ok' }
    const seconds = r.cooldown ?? REST[r.reason] ?? REST.quota
    await cache.put(
      markerFor(origin, provider, i),
      marker(seconds, { 'X-OT-Reason': r.reason, 'X-OT-Until': new Date(clock.now() + seconds * 1000).toISOString() }),
    )
    last = r
  }
  return { res: last?.res ?? null, outcome: 'quota' }
}
