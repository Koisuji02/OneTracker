// node --test worker/test — no Worker runtime needed: everything in edge.js
// takes the cache as a parameter, and Node 22 has Request/Response/Headers.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { cached, classify, clock as edgeClock, keysOf, POLICY, restingKeys, withKeys } from '../src/edge.js'

/** Just enough of the Cache API: keyed by URL, honours max-age. */
class FakeCache {
  store = new Map()
  async match(req) {
    const e = this.store.get(req.url)
    if (!e) return undefined
    if (edgeClock.now() >= e.expires) {
      this.store.delete(req.url)
      return undefined
    }
    return e.res.clone()
  }
  async put(req, res) {
    const m = /max-age=(\d+)/.exec(res.headers.get('Cache-Control') ?? '')
    this.store.set(req.url, { res, expires: edgeClock.now() + Number(m?.[1] ?? 0) * 1000 })
  }
}

const ctx = () => {
  const pending = []
  return { waitUntil: (p) => pending.push(p), settle: () => Promise.all(pending) }
}
const key = (u = 'https://gw.test/p/omdb/?i=tt1') => new Request(u, { method: 'GET' })
const ok = (body) => new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } })
const origin = 'https://gw.test'

/** Freeze and move edge.js's clock. */
function clock() {
  const real = edgeClock.now
  let now = real()
  edgeClock.now = () => now
  return { tick: (s) => (now += s * 1000), restore: () => (edgeClock.now = real) }
}

test('keysOf: comma list, trimmed, empty when unset', () => {
  assert.deepEqual(keysOf({ K: ' a , b,,c ' }, 'K'), ['a', 'b', 'c'])
  assert.deepEqual(keysOf({}, 'K'), [])
  assert.deepEqual(keysOf({ K: 'solo' }, 'K'), ['solo'])
})

test('classify: OMDb hides quota and dead keys inside a 200', async () => {
  const limit = await classify('omdb', ok({ Response: 'False', Error: 'Request limit reached!' }))
  assert.equal(limit.reason, 'quota')
  assert.equal((await limit.res.json()).Error, 'Request limit reached!', 'body still forwarded')
  assert.equal((await classify('omdb', ok({ Response: 'False', Error: 'Invalid API key!' }))).reason, 'badkey')
  assert.equal((await classify('omdb', ok({ Response: 'False', Error: 'Movie not found!' }))).reason, '', 'a miss is not a spent key')
  assert.equal((await classify('omdb', ok({ Response: 'True', Title: 'Dune' }))).reason, '')
})

test('classify: Comic Vine 420 and status_code 100; plain 429/401 for keyed providers only', async () => {
  assert.equal((await classify('comicvine', new Response('', { status: 420 }))).reason, 'quota')
  assert.equal((await classify('comicvine', ok({ error: 'Invalid API Key', status_code: 100, results: [] }))).reason, 'badkey')
  assert.equal((await classify('comicvine', ok({ error: 'OK', status_code: 1, results: [] }))).reason, '')
  assert.equal((await classify('tmdb', new Response('', { status: 429 }))).reason, 'rate-limited')
  assert.equal((await classify('rawg', new Response('', { status: 401 }))).reason, 'rejected')
  assert.equal((await classify('mangadex', new Response('', { status: 429 }))).reason, '', 'keyless: nothing to rest')
  const igdb = await classify('igdb', new Response('', { status: 429 }))
  assert.equal(igdb.reason, 'rate-limited')
  assert.equal(igdb.cooldown, 2)
})

test('withKeys: a spent key is rested and the next one is tried; a resting key is skipped', async () => {
  const cache = new FakeCache()
  const random = Math.random
  Math.random = () => 0 // start from key 0 so the walk is predictable
  const calls = []
  const attempt = async (k) => {
    calls.push(k)
    return k === 'dead' ? { res: new Response('', { status: 401 }), reason: 'rejected' } : { res: ok({ k }), reason: '' }
  }
  const keys = ['dead', 'dead', 'live']
  const r1 = await withKeys({ cache, origin, provider: 'rawg', keys, attempt })
  assert.equal(r1.outcome, 'ok')
  assert.equal(r1.index, 2)
  assert.ok(calls.includes('live'))
  const resting = await restingKeys(cache, origin, 'rawg', 3)
  assert.deepEqual(resting.map((r) => r.index), [0, 1])
  assert.equal(resting[0].reason, 'rejected')

  calls.length = 0
  const r2 = await withKeys({ cache, origin, provider: 'rawg', keys, attempt })
  assert.equal(r2.outcome, 'ok')
  assert.deepEqual(calls, ['live'], 'resting keys never reach the provider')
  Math.random = random
})

test('withKeys: every key spent → quota, and no upstream call while they rest', async () => {
  const cache = new FakeCache()
  let calls = 0
  const attempt = async () => {
    calls++
    return { res: ok({ Response: 'False', Error: 'Request limit reached!' }), reason: 'quota' }
  }
  const keys = ['a', 'b']
  const r1 = await withKeys({ cache, origin, provider: 'omdb', keys, attempt })
  assert.equal(r1.outcome, 'quota')
  assert.equal(calls, 2, 'each key tried once')
  const r2 = await withKeys({ cache, origin, provider: 'omdb', keys, attempt })
  assert.equal(r2.outcome, 'quota')
  assert.equal(calls, 2, 'nothing sent upstream while both rest')
  assert.equal(r2.res, null)
})

test('withKeys: keyless provider runs once, never marks', async () => {
  const cache = new FakeCache()
  const r = await withKeys({ cache, origin, provider: 'mangadex', keys: [], attempt: async () => ({ res: new Response('', { status: 429 }), reason: '' }) })
  assert.equal(r.outcome, 'ok')
  assert.equal(cache.store.size, 0)
})

test('cached: MISS then HIT while fresh', async () => {
  const cache = new FakeCache()
  const c = ctx()
  let produced = 0
  const produce = async () => (produced++, ok({ n: produced }))
  const a = await cached(cache, c, key(), POLICY.detail, produce)
  assert.equal(a.headers.get('X-OT-Cache'), 'MISS')
  assert.deepEqual(await a.json(), { n: 1 })
  await c.settle()
  const b = await cached(cache, c, key(), POLICY.detail, produce)
  assert.equal(b.headers.get('X-OT-Cache'), 'HIT')
  assert.deepEqual(await b.json(), { n: 1 })
  assert.equal(produced, 1)
})

test('cached: errors are never stored', async () => {
  const cache = new FakeCache()
  const c = ctx()
  const a = await cached(cache, c, key(), POLICY.detail, async () => new Response('nope', { status: 502 }))
  assert.equal(a.status, 502)
  await c.settle()
  assert.equal(cache.store.size, 0)
})

test('cached: search/static serve STALE at once and refresh once in the background', async () => {
  const t = clock()
  try {
    const cache = new FakeCache()
    const c = ctx()
    let produced = 0
    // the refresh is a network call in real life: hold it open until the test
    // has made its second stale request, or it lands before we can look
    let release
    const gate = new Promise((r) => (release = r))
    const produce = async () => {
      produced++
      if (produced > 1) await gate
      return ok({ n: produced })
    }
    await cached(cache, c, key(), POLICY.search, produce)
    await c.settle()
    t.tick(POLICY.search.fresh + 1)
    const s1 = await cached(cache, c, key(), POLICY.search, produce)
    assert.equal(s1.headers.get('X-OT-Cache'), 'STALE')
    assert.deepEqual(await s1.json(), { n: 1 }, 'old copy, instantly')
    const s2 = await cached(cache, c, key(), POLICY.search, produce)
    assert.equal(s2.headers.get('X-OT-Cache'), 'STALE')
    release()
    await c.settle()
    assert.equal(produced, 2, 'two stale hits, ONE refresh (lock)')
    const h = await cached(cache, c, key(), POLICY.search, produce)
    assert.equal(h.headers.get('X-OT-Cache'), 'HIT')
    assert.deepEqual(await h.json(), { n: 2 }, 'refreshed copy')
  } finally {
    t.restore()
  }
})

test('cached: a detail past its freshness goes upstream and waits, falling back to the stale copy on failure', async () => {
  const t = clock()
  try {
    const cache = new FakeCache()
    const c = ctx()
    await cached(cache, c, key(), POLICY.detail, async () => ok({ v: 'old' }))
    await c.settle()
    t.tick(POLICY.detail.fresh + 1)
    const fresh = await cached(cache, c, key(), POLICY.detail, async () => ok({ v: 'new' }))
    assert.equal(fresh.headers.get('X-OT-Cache'), 'MISS', 'blocking refresh, never a stale detail')
    assert.deepEqual(await fresh.json(), { v: 'new' })
    await c.settle()
    t.tick(POLICY.detail.fresh + 1)
    const down = await cached(cache, c, key(), POLICY.detail, async () => new Response('', { status: 503 }))
    assert.equal(down.headers.get('X-OT-Cache'), 'STALE-ERROR')
    assert.deepEqual(await down.json(), { v: 'new' })
    const thrown = await cached(cache, c, key(), POLICY.detail, async () => {
      throw new Error('network')
    })
    assert.equal(thrown.headers.get('X-OT-Cache'), 'STALE-ERROR')
  } finally {
    t.restore()
  }
})

test('cached: the stale copy outlives freshness by KEEP, not forever', async () => {
  const t = clock()
  try {
    const cache = new FakeCache()
    const c = ctx()
    await cached(cache, c, key(), POLICY.static, async () => ok({ v: 1 }))
    await c.settle()
    t.tick(POLICY.static.fresh + 31 * 24 * 3600)
    const r = await cached(cache, c, key(), POLICY.static, async () => new Response('', { status: 503 }))
    assert.equal(r.status, 503)
    assert.equal(r.headers.get('X-OT-Cache'), 'MISS')
  } finally {
    t.restore()
  }
})
