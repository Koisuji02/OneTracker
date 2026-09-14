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
import { buildBackup } from './backup'
import { db, refreshItemMetadata } from './db'
import { resumeGoogleSession, saveToDrive } from './drive'
import { isOnline } from './net'
import type { LibraryItem } from './types'

/** Don't run the pass more often than this (a reconnect forces it anyway). */
const MIN_INTERVAL = 30 * 60 * 1000
/** Provider calls are rate-limited: refresh a handful of items, not the library. */
const MAX_ITEMS = 20
/** Extra slots for filling in missing game lengths (a one-off per title). */
const MAX_GAMES = 12
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
    await pooled([...due, ...staleGames(items).filter((g) => !queued.has(g.id))], refreshOne)
    // resumes the Drive session silently when one can be resumed; it never
    // opens a sign-in sheet, so this stays a background pass
    if (await resumeGoogleSession()) {
      try {
        await saveToDrive(await buildBackup(), false)
      } catch {
        // silent best-effort, exactly like the periodic auto-sync
      }
    }
  } catch {
    // nothing here is worth bothering the user with
  } finally {
    running = false
  }
}
