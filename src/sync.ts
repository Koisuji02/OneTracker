/**
 * Catching up after being offline (and keeping the library honest while online).
 *
 * Two things go stale when the app can't reach the network — or simply when the
 * user doesn't open a detail page for a while:
 * - the METADATA snapshot: a new episode airs, a new chapter drops, a release
 *   date is announced. Until something refetches, the item keeps sitting in
 *   "Waiting" with nothing new to watch, which is the single most visible way
 *   the app can be wrong.
 * - the BACKUP on Drive: progress marked offline only reaches the cloud once
 *   there's a connection again.
 *
 * So this module runs a small, bounded pass: pick the items that can actually
 * have changed, let the details cache decide whether a real request is needed
 * (getDetails is stale-while-revalidate, 6h), and merge the result into the
 * stored snapshot with the usual conservative rules. Nothing here ever blocks
 * the UI and every failure is silent — it's an opportunistic refresh, not a
 * feature the user waits on.
 */
import { getDetails } from './api'
import { db, refreshItemMetadata } from './db'
import { syncDrive } from './drive'
import { isOnline } from './net'
import type { LibraryItem } from './types'

/** Don't run the pass more often than this (a reconnect forces it anyway). */
const MIN_INTERVAL = 30 * 60 * 1000
/** Provider calls are rate-limited: refresh a handful of items, not the library. */
const MAX_ITEMS = 20
/** Extra slots for filling in missing game lengths (a one-off per title). */
const MAX_GAMES = 12
/**
 * One-off backfills keyed on the details-cache version a provider's payload
 * gained something at: once an item is refetched its cache entry is current,
 * so it's never asked again — even when the new data turned out empty.
 * - MangaDex v5: the target readership (Shounen, Seinen…) among the tags
 * - IGDB v6: key art as backdrop (not a logo), DLC/expansion link to the base game
 * - TMDB anime v7: the readership keyword, which the old first-8 cap dropped
 */
const BACKFILLS: Array<{ provider: string; mediaType?: string; v: number; max: number }> = [
  { provider: 'mangadex', v: 5, max: 8 },
  { provider: 'igdb', v: 6, max: 10 },
  { provider: 'tmdb', mediaType: 'anime', v: 7, max: 15 },
]
const CONCURRENCY = 3

let lastRun = 0
let running = false

/**
 * Items whose metadata can plausibly have changed since it was stored:
 * a work that is still releasing, or one whose announced date has arrived.
 * Everything finished (or archived) is immutable for our purposes and is
 * never refetched — that's what keeps this pass cheap.
 */
function dueForRefresh(items: LibraryItem[]): LibraryItem[] {
  const now = Date.now()
  const passed = (iso?: string | null) => !!iso && Date.parse(iso) <= now
  const due = items.filter((i) => {
    if (i.archived || i.status === 'completed') return false
    if (i.status === 'planned') return passed(i.releaseDate)
    return !!i.ongoing || passed(i.nextReleaseDate)
  })
  // most urgent first: something is expected to be out RIGHT NOW, then the
  // titles the user touched most recently
  const expecting = (i: LibraryItem) =>
    passed(i.nextReleaseDate) || passed(i.releaseDate) ? 0 : 1
  return due
    .sort(
      (a, b) =>
        expecting(a) - expecting(b) ||
        (b.lastReadAt ?? b.addedAt) - (a.lastReadAt ?? a.addedAt),
    )
    .slice(0, MAX_ITEMS)
}

/**
 * Games whose stored snapshot is behind the app: no how-long-to-beat length,
 * or artwork requested at the old low-res IGDB size.
 *
 * Neither can arrive on its own — `dueForRefresh` deliberately skips finished
 * items, so a game completed before those landed would keep contributing
 * nothing to the stats (and stay soft in the grid) until the user happened to
 * reopen its page. One bounded batch per pass heals the backlog for good: both
 * marks disappear as soon as the item is refreshed.
 */
const staleGame = (i: LibraryItem) =>
  i.timeToBeat == null || !!i.poster?.includes('/t_cover_big/')

function staleGames(items: LibraryItem[]): LibraryItem[] {
  return items
    .filter((i) => i.mediaType === 'game' && !i.archived && staleGame(i))
    // the ones that already count towards the stats first, then by recency
    .sort(
      (a, b) =>
        (a.status === 'planned' ? 1 : 0) - (b.status === 'planned' ? 1 : 0) ||
        (b.completedAt ?? b.lastReadAt ?? b.addedAt) - (a.completedAt ?? a.lastReadAt ?? a.addedAt),
    )
    .slice(0, MAX_GAMES)
}

/**
 * Library items whose provider payload predates a `BACKFILLS` entry.
 *
 * Same reasoning as `staleGames`: a finished or planned item is never due for
 * a refresh, so without this an old manga's "Manga | Shōnen" medals would stay
 * dark, and an old game would keep a logo as its backdrop, until the user
 * happened to reopen its page.
 */
async function staleCached(items: LibraryItem[]): Promise<LibraryItem[]> {
  const out: LibraryItem[] = []
  for (const { provider, mediaType, v, max } of BACKFILLS) {
    const own = items.filter(
      (i) => i.provider === provider && (!mediaType || i.mediaType === mediaType) && !i.archived,
    )
    if (own.length === 0) continue
    const cached = await db.detailsCache.bulkGet(own.map((i) => i.id))
    out.push(
      ...own
        .filter((_, k) => (cached[k]?.v ?? 1) < v)
        .sort((a, b) => (b.lastReadAt ?? b.addedAt) - (a.lastReadAt ?? a.addedAt))
        .slice(0, max),
    )
  }
  return out
}

/** Refresh one item's snapshot; the SWR cache decides if a request happens. */
async function refreshOne(item: LibraryItem): Promise<void> {
  try {
    const details = await getDetails(
      item.provider,
      item.mediaType,
      item.providerId,
      // background revalidation landed with genuinely fresh data
      (fresh) => {
        refreshItemMetadata(fresh).catch(() => {})
      },
    )
    await refreshItemMetadata(details)
  } catch {
    // provider down, rate-limited or still offline — try again next pass
  }
}

/** Run `work` over `items` a few at a time (providers dislike bursts). */
async function pooled<T>(items: T[], work: (item: T) => Promise<void>): Promise<void> {
  let next = 0
  const runners = Array.from({ length: Math.min(CONCURRENCY, items.length) }, async () => {
    while (next < items.length) {
      await work(items[next++])
    }
  })
  await Promise.all(runners)
}

/**
 * One catch-up pass: refresh what can have changed, then push the backup if a
 * Drive token is already in memory (this never triggers a sign-in).
 * `force` skips the interval guard — used when the connection just came back.
 */
export async function syncLibrary(force = false): Promise<void> {
  if (running || !isOnline()) return
  if (!force && Date.now() - lastRun < MIN_INTERVAL) return
  running = true
  lastRun = Date.now()
  try {
    const items = await db.items.toArray()
    const due = dueForRefresh(items)
    const queued = new Set(due.map((i) => i.id))
    const extra = [...staleGames(items), ...(await staleCached(items))].filter((i) => {
      if (queued.has(i.id)) return false
      queued.add(i.id) // a stale game can be on both lists: refresh it once
      return true
    })
    await pooled([...due, ...extra], refreshOne)
    // pull anything the other device wrote, merge, push back. Silent: it never
    // opens a sign-in sheet, so this stays a background pass
    await syncDrive(false)
  } catch {
    // nothing here is worth bothering the user with
  } finally {
    running = false
  }
}
