/**
 * Offline artwork.
 *
 * Everything the app knows about a tracked title already survives without a
 * network (items, progress, details cache, episode cache) — the covers did
 * not, because an `<img>` pointing at image.tmdb.org is just a request that
 * fails when there's no data. So the FIRST time a library cover is displayed
 * its bytes are stored in IndexedDB, and from then on it is served from there:
 * no network, no flicker, identical offline and online.
 *
 * Deliberately narrow, because storage is the user's:
 * - only images marked `persist` are stored — the covers of items in the
 *   library (watched, watching, planned) and the art of a detail page the user
 *   actually opened. Search results, cast photos and galleries are browsing,
 *   not library, and stay online-only.
 * - the cached copy REPLACES the network fetch (it is not a second download):
 *   the store pass reuses the HTTP-cached bytes the `<img>` just loaded, and
 *   every later render reads IndexedDB instead of the network.
 * - a hard budget with LRU eviction (see MAX_BYTES) caps the whole thing, and
 *   dropping an item from the library drops its artwork with it.
 */
import { db } from './db'
import { isOnline } from './net'

/** Total artwork budget. Roughly 1.5k posters — far more than any real library. */
const MAX_BYTES = 48 * 1024 * 1024
/** Skip anything absurd for a cover (a mis-sized backdrop, an HTML error page). */
const MAX_ENTRY_BYTES = 3 * 1024 * 1024
/** LRU timestamps are only worth a write once a day. */
const TOUCH_INTERVAL = 24 * 60 * 60 * 1000

/**
 * remote URL → blob: URL, so a cover resolves once per session, not per mount.
 * Each entry pins its blob in memory, so the map is capped and the oldest
 * handles are released first — scrolling a huge library must not grow forever.
 */
const objectUrls = new Map<string, string>()
const MAX_LIVE_URLS = 600

function remember(url: string, objectUrl: string): void {
  objectUrls.set(url, objectUrl)
  while (objectUrls.size > MAX_LIVE_URLS) {
    const oldest = objectUrls.keys().next()
    if (oldest.done) break
    const handle = objectUrls.get(oldest.value)
    objectUrls.delete(oldest.value)
    if (handle) URL.revokeObjectURL(handle)
  }
}
/** URLs whose bytes are being downloaded right now (never twice at once). */
const storing = new Set<string>()
/** URLs already looked up and known NOT to be cached (avoids repeat lookups). */
const misses = new Set<string>()

/** Object URL for an already-resolved image, when we have one in memory. */
export function cachedObjectUrl(url: string): string | undefined {
  return objectUrls.get(url)
}

/**
 * The src to actually render for `url`:
 * - a blob: URL when the bytes are cached (works offline, no request)
 * - `url` itself otherwise — and, when `persist` is set and we're online, the
 *   bytes are picked up in the background so the NEXT time works offline.
 */
export async function resolveImage(url: string, persist: boolean): Promise<string> {
  const memo = objectUrls.get(url)
  if (memo) return memo
  if (!misses.has(url)) {
    try {
      const row = await db.images.get(url)
      if (row?.blob) {
        const obj = URL.createObjectURL(row.blob)
        remember(url, obj)
        void touch(url)
        return obj
      }
    } catch {
      // IndexedDB unavailable (private mode, quota) — fall back to the network
    }
    misses.add(url)
  }
  if (persist && isOnline()) void store(url)
  return url
}

/** Refresh an entry's LRU stamp, at most once a day per image. */
async function touch(url: string): Promise<void> {
  try {
    const meta = await db.imageMeta.get(url)
    const now = Date.now()
    if (meta && now - meta.usedAt > TOUCH_INTERVAL) {
      await db.imageMeta.update(url, { usedAt: now })
    }
  } catch {
    // best-effort bookkeeping
  }
}

/**
 * Download and store one image. Failures are silent and non-fatal: a CDN
 * without CORS headers simply stays online-only, exactly as before.
 */
async function store(url: string): Promise<void> {
  if (storing.has(url) || !/^https?:/i.test(url)) return
  storing.add(url)
  try {
    // force-cache: the <img> has just loaded these bytes, so this normally
    // resolves from the HTTP cache and costs no extra traffic
    const res = await fetch(url, { mode: 'cors', cache: 'force-cache' })
    if (!res.ok) return
    const blob = await res.blob()
    if (blob.size === 0 || blob.size > MAX_ENTRY_BYTES) return
    if (!blob.type.startsWith('image/')) return
    const now = Date.now()
    await db.images.put({ url, blob })
    await db.imageMeta.put({ url, size: blob.size, fetchedAt: now, usedAt: now })
    misses.delete(url)
    scheduleEviction()
  } catch {
    // offline, CORS-blocked or quota-exceeded — nothing to do
  } finally {
    storing.delete(url)
  }
}

/** Drop cached bytes (item removed from the library, eviction, manual clear). */
export async function forget(urls: Array<string | null | undefined>): Promise<void> {
  const keys = urls.filter((u): u is string => !!u)
  if (keys.length === 0) return
  try {
    await db.images.bulkDelete(keys)
    await db.imageMeta.bulkDelete(keys)
  } catch {
    // best-effort
  }
  for (const k of keys) {
    const obj = objectUrls.get(k)
    if (obj) {
      URL.revokeObjectURL(obj)
      objectUrls.delete(k)
    }
    misses.add(k)
  }
}

let evictionTimer: ReturnType<typeof setTimeout> | null = null

/** Coalesce the eviction pass: one sweep after a burst of stores, not one each. */
function scheduleEviction(): void {
  if (evictionTimer) return
  evictionTimer = setTimeout(() => {
    evictionTimer = null
    void evict()
  }, 10_000)
}

/**
 * Drop the least recently shown images until the cache is back under budget.
 * Reads `imageMeta` only — no blob ever enters memory here.
 */
export async function evict(): Promise<void> {
  try {
    const meta = await db.imageMeta.orderBy('usedAt').toArray()
    let total = meta.reduce((a, m) => a + m.size, 0)
    if (total <= MAX_BYTES) return
    const doomed: string[] = []
    for (const m of meta) {
      if (total <= MAX_BYTES) break
      doomed.push(m.url)
      total -= m.size
    }
    await forget(doomed)
  } catch {
    // best-effort
  }
}

/** Wipe every cached image (Settings → clear data). */
export async function clearImageCache(): Promise<void> {
  try {
    const keys = await db.imageMeta.toCollection().primaryKeys()
    await forget(keys)
  } catch {
    // best-effort
  }
}
