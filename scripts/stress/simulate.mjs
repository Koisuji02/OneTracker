// OneTracker load simulation — the whole app's network traffic, at any number
// of users, against the REAL gateway code (worker/src/index.js) with fake
// providers. Nothing leaves this machine: hammering the real TMDB / IGDB would
// burn their quotas and break their terms.
//
//   node scripts/stress/simulate.mjs                 every tier, steady state
//   node scripts/stress/simulate.mjs --tiers 1000,10000 --days 2
//   node scripts/stress/simulate.mjs --burst 5000    N users at once (an episode drop)
//   node scripts/stress/simulate.mjs --colos 3       users split over 3 edge caches
//   node scripts/stress/simulate.mjs --cache 20000   cap the edge cache (LRU entries)
//   node scripts/stress/simulate.mjs --arch direct   where each call goes:
//     current   everything keyed goes through the gateway (1.0.44)
//     direct    the phone calls TMDB / HLTB / OMDb / Comic Vine itself, MangaDex
//               too except where the ISP blocks it; the gateway keeps IGDB
//     snapshot  direct + a daily static snapshot of the popular games (their
//               pages and a search index), served as free static files
//     byok      no gateway at all: every user's own keys, IGDB included
//
// What one user does in a day comes from the app itself, measured in the
// browser with a fetch logger (docs/LOAD_TEST.md): which calls a search, each
// detail page and the background sync make, and which of them go through the
// gateway. Titles and queries follow a Zipf popularity curve (a few hits, a
// very long tail), sessions follow an Italian day (quiet nights, 21:00 peak).
//
// The fakes reproduce what matters: IGDB's 4 requests/second per Twitch app
// (429 above it), HowLongToBeat's two calls per lookup, OMDb/Comic Vine only
// for the users who added their own key. The Worker's per-IP rate limits run
// for real, on a virtual clock.
import worker from '../../worker/src/index.js'
import { clock } from '../../worker/src/edge.js'
import { mkdirSync, writeFileSync } from 'node:fs'

// ------------------------------------------------------------------ options
const arg = (name, def) => {
  const i = process.argv.indexOf(`--${name}`)
  return i > 0 ? process.argv[i + 1] : def
}
const TIERS = arg('tiers', '100,1000,2500,5000,10000,25000,50000').split(',').map(Number)
const DAYS = Number(arg('days', 2)) // the last one is reported: a warm cache
const COLOS = Number(arg('colos', 1))
const CACHE_CAP = Number(arg('cache', 0)) // 0 = unbounded
const BURST = Number(arg('burst', 0))
const SEED = Number(arg('seed', 7))
const ARCH = arg('arch', 'current')
const SNAPSHOT_GAMES = Number(arg('snapshot-games', 20_000)) // games in the static snapshot
const LOCAL_QUERIES = Number(arg('local-queries', 10_000)) // queries its search index answers
const BLOCKED = Number(arg('blocked', 0.15)) // users whose ISP blocks MangaDex

// ------------------------------------------------------- the measured app
// Calls per action THROUGH THE GATEWAY (the ones that cost Worker requests),
// measured on 1.0.43+ in the browser. Direct calls (AniList, Jikan, Open
// Library, Wikipedia) cost the Worker nothing and hit each user's own IP.
const FREE_WORKER_REQUESTS = 100_000 // Cloudflare Workers free plan, per day
const IGDB_RPS = 4

const DAY = {
  sessions: 3, // app opens a day
  searches: 2.5, // searches a day, each typed as ~1.4 queries (debounce)
  queriesPerSearch: 1.4,
  details: 6, // detail pages opened a day
  // media mix of the detail pages opened
  mix: { tv: 0.35, movie: 0.2, anime: 0.1, game: 0.15, manga: 0.15, book: 0.05 },
  // the library the background sync keeps fresh: items still airing/releasing
  watchingSeries: 4,
  readingManga: 1.5,
  ownComicVine: 0.1, // users who added a Comic Vine key (and search comics)
  ownOmdb: 0.15, // users who added an OMDb key
  igdbThin: 0.3, // searches whose popular query is thin → the fuzzy one too
}

// catalogue sizes the popularity curves are drawn over
const CATALOG = { tv: 60_000, movie: 200_000, anime: 12_000, game: 80_000, manga: 40_000, query: 40_000 }
const ZIPF_S = 1.0

// an Italian day: share of the day's sessions per hour
const HOURS = [2, 1, 0.6, 0.4, 0.4, 0.5, 1, 2, 3, 3, 3, 3, 4, 4, 3, 3, 3, 4, 5, 6, 8, 9, 8, 5]
const HOUR_SUM = HOURS.reduce((a, b) => a + b, 0)

// ------------------------------------------------------------------ random
let rngState = SEED
function rand() {
  // mulberry32: deterministic, so two runs compare
  rngState = (rngState + 0x6d2b79f5) | 0
  let t = Math.imul(rngState ^ (rngState >>> 15), 1 | rngState)
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}
const poisson = (l) => {
  let k = 0
  let p = Math.exp(-l)
  let s = p
  const u = rand()
  while (u > s && k < 50) {
    k++
    p *= l / k
    s += p
  }
  return k
}
function zipf(n) {
  const cdf = new Float64Array(n)
  let s = 0
  for (let i = 0; i < n; i++) cdf[i] = s += 1 / Math.pow(i + 1, ZIPF_S)
  for (let i = 0; i < n; i++) cdf[i] /= s
  return () => {
    const u = rand()
    let lo = 0
    let hi = n - 1
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if (cdf[mid] < u) lo = mid + 1
      else hi = mid
    }
    return lo + 1
  }
}
const pick = Object.fromEntries(Object.entries(CATALOG).map(([k, n]) => [k, zipf(n)]))
const hourOf = () => {
  let u = rand() * HOUR_SUM
  for (let h = 0; h < 24; h++) if ((u -= HOURS[h]) <= 0) return h
  return 23
}

// --------------------------------------------------------------- the fakes
class EdgeCache {
  constructor(cap) {
    this.cap = cap
    this.store = new Map()
  }
  async match(req) {
    const e = this.store.get(req.url)
    if (!e) return undefined
    if (clock.now() >= e.expires) {
      this.store.delete(req.url)
      return undefined
    }
    // LRU: a hit moves to the back of the line
    this.store.delete(req.url)
    this.store.set(req.url, e)
    return new Response(e.body, { status: e.status, headers: e.headers })
  }
  async put(req, res) {
    const m = /max-age=(\d+)/.exec(res.headers.get('Cache-Control') ?? '')
    const body = await res.text()
    this.store.delete(req.url)
    this.store.set(req.url, { body, status: res.status, headers: [...res.headers], expires: clock.now() + Number(m?.[1] ?? 0) * 1000 })
    if (this.cap && this.store.size > this.cap) this.store.delete(this.store.keys().next().value)
  }
}

/** Cloudflare's rate-limit binding: N per 60 s per key, on the virtual clock. */
const limiter = (limit) => {
  const windows = new Map()
  return {
    async limit({ key }) {
      const w = Math.floor(clock.now() / 60_000)
      const k = `${key}|${w}`
      const n = (windows.get(k) ?? 0) + 1
      windows.set(k, n)
      if (windows.size > 200_000) windows.clear()
      return { success: n <= limit }
    },
  }
}

const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'Content-Type': 'application/json' } })

let up // upstream counters, per provider, reset per run
let igdbSecond = { s: -1, n: 0 }
const upstream = async (input, init) => {
  const url = new URL(String(input?.url ?? input))
  const t = clock.now()
  const sec = Math.floor(t / 1000)
  const count = (p) => {
    up[p] = (up[p] ?? 0) + 1
    const peak = `${p}@${sec}`
    up.perSecond.set(peak, (up.perSecond.get(peak) ?? 0) + 1)
  }
  switch (url.host) {
    case 'id.twitch.tv':
      return json({ access_token: 'tok', expires_in: 5_000_000 })
    case 'api.igdb.com': {
      count('igdb')
      if (igdbSecond.s !== sec) igdbSecond = { s: sec, n: 0 }
      if (++igdbSecond.n > IGDB_RPS) {
        up.igdb429 = (up.igdb429 ?? 0) + 1
        return new Response('Too Many Requests', { status: 429 })
      }
      return json([{ id: 1, name: 'game' }])
    }
    case 'api.themoviedb.org':
      count('tmdb')
      return json({ id: 1, results: [] })
    case 'howlongtobeat.com':
      count('hltb')
      return url.pathname.endsWith('/init') ? json({ token: 't' }) : json({ data: [] })
    case 'api.mangadex.org':
      count('mangadex')
      return json({ result: 'ok', data: [] })
    case 'comicvine.gamespot.com':
      count('comicvine')
      return json({ status_code: 1, results: [] })
    case 'www.omdbapi.com':
      count('omdb')
      return json({ Response: 'True', imdbRating: '8.0' })
    default:
      throw new Error(`unexpected upstream ${url.host}`)
  }
}

// --------------------------------------------------------- one user's calls
const GW = 'https://gw.test'
const TOKEN = 'app-token'
/** One gateway request: [path, method, body, ownKey?] */
function callsFor(action, u) {
  const c = []
  const meta = {}
  const get = (p, key) => c.push([p, 'GET', '', key, meta])
  const post = (p, b, key) => c.push([p, 'POST', b, key, meta])
  switch (action) {
    case 'search': {
      meta.q = pick.query()
      const query = `q${meta.q}`
      get(`/p/tmdb/search/tv?query=${query}&include_adult=false&language=it-IT`)
      get(`/p/tmdb/search/movie?query=${query}&include_adult=false&language=it-IT`)
      post('/igdb/games', `fields name; where name ~ *"${query}"* & version_parent = null; sort total_rating_count desc; limit 14;`)
      if (rand() < DAY.igdbThin) post('/igdb/games', `search "${query}"; fields name; limit 14;`)
      get(`/p/mangadex/manga?title=${query}&limit=10`)
      if (u.cv) get(`/p/comicvine/search/?query=${query}&resources=volume`, u.cv)
      break
    }
    case 'tv': {
      const id = pick.tv()
      get(`/p/tmdb/tv/${id}?append_to_response=credits,external_ids&language=it-IT`)
      get(`/p/tmdb/tv/${id}/season/1?language=it-IT`)
      if (u.omdb) get(`/p/omdb/?i=tt${id}`, u.omdb)
      break
    }
    case 'movie': {
      const id = pick.movie()
      get(`/p/tmdb/movie/${id}?append_to_response=credits&language=it-IT`)
      if (u.omdb) get(`/p/omdb/?i=tt${id + 9_000_000}`, u.omdb)
      break
    }
    case 'anime':
      get(`/p/tmdb/tv/${100_000 + pick.anime()}?append_to_response=credits,external_ids&language=it-IT`)
      break
    case 'game': {
      const id = pick.game()
      meta.g = id
      post('/igdb/multiquery', `query games "game" { fields name; where id = ${id}; }; query game_time_to_beats "ttb" { fields normally; where game_id = ${id}; };`)
      post('/hltb/search', JSON.stringify({ query: `game ${id}` }))
      break
    }
    case 'manga': {
      const id = pick.manga()
      for (const p of ['manga', 'statistics/manga', 'cover', 'chapter', `manga/${id}/feed`]) get(`/p/mangadex/${p}?id=${id}`)
      break
    }
    case 'sync-tv':
      get(`/p/tmdb/tv/${u.series[Math.floor(rand() * u.series.length)]}?append_to_response=credits,external_ids&language=it-IT`)
      break
    case 'sync-manga': {
      const id = u.manga[Math.floor(rand() * u.manga.length)]
      get(`/p/mangadex/manga?id=${id}`)
      get(`/p/mangadex/statistics/manga?id=${id}`)
      break
    }
  }
  return c
}

/** The day's gateway requests of `n` users: [time ms, ip, path, method, body, key]. */
function dayOfTraffic(n, dayStart) {
  const ev = []
  const weighted = Object.entries(DAY.mix)
  for (let i = 0; i < n; i++) {
    const u = {
      ip: `10.${(i >> 16) & 255}.${(i >> 8) & 255}.${i & 255}`,
      colo: i % COLOS,
      blocked: rand() < BLOCKED,
      series: Array.from({ length: DAY.watchingSeries }, () => pick.tv()),
      manga: Array.from({ length: Math.max(1, Math.round(DAY.readingManga)) }, () => pick.manga()),
      cv: rand() < DAY.ownComicVine ? `cv-key-${i}` : '',
      omdb: rand() < DAY.ownOmdb ? `omdb-key-${i}` : '',
    }
    const sessions = Math.max(1, poisson(DAY.sessions))
    const times = Array.from({ length: sessions }, () => dayStart + hourOf() * 3_600_000 + Math.floor(rand() * 3_600_000)).sort((a, b) => a - b)
    const push = (t, action) => {
      for (const [path, method, body, key, meta] of callsFor(action, u)) {
        const where = routeOf(path, u, meta)
        if (where === 'gateway') ev.push([t, u, path, method, body, key])
        else tally[where][providerOf(path)] = (tally[where][providerOf(path)] ?? 0) + 1
      }
    }
    // background sync: a pass per session ≥ 30 min apart; an item asks the
    // network only when its device copy is older than 6 h
    let lastSync = -Infinity
    const synced = new Map()
    for (const t of times) {
      if (t - lastSync < 30 * 60_000) continue
      lastSync = t
      for (const id of u.series) {
        if (t - (synced.get(id) ?? -Infinity) < 6 * 3_600_000) continue
        synced.set(id, t)
        push(t + Math.floor(rand() * 4000), 'sync-tv')
      }
      for (const id of u.manga) {
        if (t - (synced.get(`m${id}`) ?? -Infinity) < 6 * 3_600_000) continue
        synced.set(`m${id}`, t)
        push(t + Math.floor(rand() * 4000), 'sync-manga')
      }
    }
    // searches and detail pages, spread over the sessions
    const at = () => times[Math.floor(rand() * times.length)] + Math.floor(rand() * 15 * 60_000)
    const searches = poisson(DAY.searches)
    for (let s = 0; s < searches; s++) {
      const t = at()
      const typed = rand() < DAY.queriesPerSearch - 1 ? 2 : 1
      for (let k = 0; k < typed; k++) push(t + k * 1200, 'search')
    }
    const details = poisson(DAY.details)
    for (let d = 0; d < details; d++) {
      let u2 = rand()
      let media = 'tv'
      for (const [m, w] of weighted) if ((u2 -= w) <= 0) { media = m; break }
      if (media !== 'book') push(at(), media) // books are Open Library, direct
    }
  }
  return ev.sort((a, b) => a[0] - b[0])
}

/** Which provider a gateway path belongs to. */
function providerOf(path) {
  if (path.startsWith('/igdb')) return 'igdb'
  if (path.startsWith('/hltb')) return 'hltb'
  return path.split('/')[2]
}

/** Where a call goes in the architecture under test: gateway, direct, static. */
function routeOf(path, u, meta) {
  const p = providerOf(path)
  if (ARCH === 'current') return 'gateway'
  if (ARCH === 'byok') return 'direct'
  if (p === 'mangadex') return u.blocked ? 'gateway' : 'direct'
  if (p !== 'igdb') return 'direct'
  if (ARCH === 'snapshot') {
    if (meta.g && meta.g <= SNAPSHOT_GAMES) return 'static'
    if (meta.q && meta.q <= LOCAL_QUERIES) return 'static'
  }
  return 'gateway'
}

/** Calls that never reach the gateway: made by each phone, or static files. */
let tally = { direct: {}, static: {} }

// -------------------------------------------------------------- the runner
async function runDay(events, caches, env, stats) {
  for (const [t, u, path, method, body, key] of events) {
    clock.now = () => t
    globalThis.caches = { default: caches[u.colo] }
    const headers = { 'X-OT-Token': TOKEN, 'CF-Connecting-IP': u.ip }
    if (key) headers['X-OT-Key'] = key
    if (method === 'POST') headers['Content-Type'] = 'text/plain'
    const pending = []
    const res = await worker.fetch(
      new Request(GW + path, { method, headers, body: method === 'POST' ? body : undefined }),
      env,
      { waitUntil: (p) => pending.push(p) },
    )
    await Promise.all(pending)
    const state = res.headers.get('X-OT-Cache') ?? 'NONE'
    const kind = path.startsWith('/igdb') ? 'igdb' : path.startsWith('/hltb') ? 'hltb' : path.split('/')[2]
    stats.requests++
    stats.byKind[kind] = (stats.byKind[kind] ?? 0) + 1
    stats.cache[state] = (stats.cache[state] ?? 0) + 1
    if (!res.ok) {
      stats.failed++
      stats.failedByKind[kind] = (stats.failedByKind[kind] ?? 0) + 1
    }
    const sec = Math.floor(t / 1000)
    stats.perSecond.set(sec, (stats.perSecond.get(sec) ?? 0) + 1)
  }
}

function peak(map, prefix) {
  let max = 0
  for (const [k, v] of map) if ((!prefix || k.startsWith(prefix)) && v > max) max = v
  return max
}

async function simulate(n, events = null) {
  rngState = SEED + n
  up = { perSecond: new Map() }
  const caches = Array.from({ length: COLOS }, () => new EdgeCache(CACHE_CAP))
  const env = {
    APP_TOKEN: TOKEN,
    TMDB_KEY: 'app-tmdb-key',
    IGDB_CLIENT_ID: 'app-twitch-id',
    IGDB_CLIENT_SECRET: 'app-twitch-secret',
    RL_API: limiter(120),
    RL_HEAVY: limiter(40),
  }
  let stats
  const days = events ? 1 : DAYS
  for (let d = 0; d < days; d++) {
    up = { perSecond: new Map() } // report the last (warm) day only
    tally = { direct: {}, static: {} }
    stats = { requests: 0, failed: 0, byKind: {}, failedByKind: {}, cache: {}, perSecond: new Map() }
    const ev = events ?? dayOfTraffic(n, Date.UTC(2026, 9, 20 + d))
    await runDay(ev, caches, env, stats)
  }
  const hits = (stats.cache.HIT ?? 0) + (stats.cache.STALE ?? 0)
  const sum = (o) => Object.values(o).reduce((a, b) => a + b, 0)
  const upstreamTotal = ['tmdb', 'igdb', 'hltb', 'mangadex', 'comicvine', 'omdb'].reduce((s, p) => s + (up[p] ?? 0), 0)
  return {
    arch: ARCH,
    users: n,
    direct: tally.direct,
    directPerUser: +(sum(tally.direct) / Math.max(1, n)).toFixed(1),
    staticRequests: sum(tally.static),
    workerRequests: stats.requests,
    perUser: +(stats.requests / Math.max(1, n)).toFixed(1),
    freePlanUse: +((stats.requests / FREE_WORKER_REQUESTS) * 100).toFixed(1),
    cacheHitPct: stats.requests ? +((hits / stats.requests) * 100).toFixed(1) : 0,
    peakWorkerRps: peak(stats.perSecond),
    upstream: {
      total: upstreamTotal,
      tmdb: up.tmdb ?? 0,
      igdb: up.igdb ?? 0,
      hltb: up.hltb ?? 0,
      mangadex: up.mangadex ?? 0,
      comicvine: up.comicvine ?? 0,
      omdb: up.omdb ?? 0,
    },
    peakRps: { tmdb: peak(up.perSecond, 'tmdb@'), igdb: peak(up.perSecond, 'igdb@'), hltb: peak(up.perSecond, 'hltb@') },
    igdb429: up.igdb429 ?? 0,
    failedPct: stats.requests ? +((stats.failed / stats.requests) * 100).toFixed(2) : 0,
    failedByKind: stats.failedByKind,
    byKind: stats.byKind,
  }
}

/** N users opening the app in the same 5 minutes (a big episode drop):
 *  each syncs, half search, everyone opens the new episode's series. */
/** Route a batch of calls: gateway ones become events, the rest are tallied. */
function addCalls(ev, t, u, calls) {
  for (const [path, method, body, key, meta] of calls) {
    const where = routeOf(path, u, meta)
    if (where === 'gateway') ev.push([t, u, path, method, body, key])
    else tally[where][providerOf(path)] = (tally[where][providerOf(path)] ?? 0) + 1
  }
}

function burstTraffic(n) {
  const ev = []
  const t0 = Date.UTC(2026, 9, 22, 19, 0, 0)
  const hot = pick.tv() // the one everyone opens
  for (let i = 0; i < n; i++) {
    const u = {
      ip: `10.${(i >> 16) & 255}.${(i >> 8) & 255}.${i & 255}`,
      colo: i % COLOS,
      series: [hot, ...Array.from({ length: DAY.watchingSeries - 1 }, () => pick.tv())],
      manga: [pick.manga()],
      cv: '',
      blocked: rand() < BLOCKED,
      omdb: rand() < DAY.ownOmdb ? `omdb-key-${i}` : '',
    }
    const t = t0 + Math.floor(rand() * 5 * 60_000)
    for (const a of ['sync-tv', 'sync-tv', 'sync-manga']) addCalls(ev, t, u, callsFor(a, u))
    addCalls(ev, t + 3000, u, [[`/p/tmdb/tv/${hot}?append_to_response=credits,external_ids&language=it-IT`, 'GET', '', '', {}], [`/p/tmdb/tv/${hot}/season/1?language=it-IT`, 'GET', '', '', {}]])
    if (rand() < 0.5) addCalls(ev, t + 8000, u, callsFor('search', u))
    if (rand() < 0.3) addCalls(ev, t + 12000, u, callsFor('game', u))
  }
  return ev.sort((a, b) => a[0] - b[0])
}

// ---------------------------------------------------------------------- go
globalThis.fetch = upstream
const results = []
const started = Date.now()
if (BURST) {
  const r = await simulate(BURST, burstTraffic(BURST))
  r.scenario = `burst: ${BURST} users in 5 minutes`
  results.push(r)
} else {
  for (const n of TIERS) {
    const r = await simulate(n)
    r.scenario = `${n} users/day`
    results.push(r)
    console.log(
      `[${ARCH}] ${String(n).padStart(7)} users | direct ${r.directPerUser}/user | static ${r.staticRequests} | worker ${String(r.workerRequests).padStart(8)}/day (${String(r.freePlanUse).padStart(5)}% of free) | cache hit ${r.cacheHitPct}% | ` +
        `upstream tmdb ${r.upstream.tmdb} igdb ${r.upstream.igdb} hltb ${r.upstream.hltb} | peak igdb ${r.peakRps.igdb}/s | igdb 429 ${r.igdb429} | failed ${r.failedPct}%`,
    )
  }
}
if (BURST) console.log(JSON.stringify(results[0], null, 1))
mkdirSync('builds/stress', { recursive: true })
const file = `builds/stress/${ARCH}-${BURST ? `burst-${BURST}` : 'tiers'}${COLOS > 1 ? `-colos${COLOS}` : ''}${CACHE_CAP ? `-cache${CACHE_CAP}` : ''}.json`
writeFileSync(file, JSON.stringify({ options: { TIERS, DAYS, COLOS, CACHE_CAP, BURST, DAY, CATALOG }, results }, null, 1))
console.log(`\n${((Date.now() - started) / 1000).toFixed(0)} s → ${file}`)
