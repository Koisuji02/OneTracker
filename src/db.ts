/**
 * Local database (IndexedDB via Dexie) and every operation that mutates or
 * derives library state. This is the "service layer" of OneTracker: pages
 * never touch Dexie tables directly for writes — they call the functions
 * exported here (documented in docs/API.md).
 *
 * Data model in short:
 * - `items`     — one row per tracked media (id = `${provider}:${providerId}`)
 * - `episodes`  — one row per watched unit (TV/anime episode or manga/comic
 *                 chapter, chapters live in season 1). `count` = times watched.
 * - `lists`     — user-created named lists of item ids.
 * - `episodeCache` — cached episode metadata per season (titles, runtimes).
 *
 * Status is always derived, never set by hand:
 *   0 units watched → planned · some → watching · all + work finished → completed.
 *   Ongoing works (still airing/releasing) never auto-complete.
 */
import Dexie, { type Table } from 'dexie'
import { forget } from './imageCache'
import type { SortMode } from './settings'
import type {
  EpisodeCacheEntry,
  EpisodeInfo,
  ItemStatus,
  LibraryItem,
  MediaBase,
  MediaDetails,
  MediaType,
  WatchList,
  WatchedEpisode,
} from './types'

/** Cached MediaDetails (metadata + cast + ratings) per provider id. */
export interface DetailsCacheEntry {
  id: string
  details: MediaDetails
  fetchedAt: number
  /** payload-shape version (see CACHE_V in api/index.ts); pre-v2 = absent */
  v?: number
}

/** Resolved cover URL shared between search rows and detail pages. */
export interface CoverCacheEntry {
  key: string
  url: string | null
  fetchedAt: number
}

/**
 * Downloaded artwork, kept so the library still LOOKS like the library with no
 * network. Bytes and bookkeeping live in two tables on purpose: the eviction
 * pass only ever reads `imageMeta` (a few numbers per row) and never has to
 * pull megabytes of blobs into memory just to find the oldest ones.
 */
export interface ImageBlobEntry {
  /** the remote URL, verbatim — it is the cache key everywhere */
  url: string
  blob: Blob
}

export interface ImageMetaEntry {
  url: string
  size: number
  fetchedAt: number
  /** last time it was shown — drives LRU eviction */
  usedAt: number
}

class OneTrackerDB extends Dexie {
  items!: Table<LibraryItem, string>
  episodes!: Table<WatchedEpisode, string>
  episodeCache!: Table<EpisodeCacheEntry, string>
  lists!: Table<WatchList, string>
  detailsCache!: Table<DetailsCacheEntry, string>
  covers!: Table<CoverCacheEntry, string>
  images!: Table<ImageBlobEntry, string>
  imageMeta!: Table<ImageMetaEntry, string>

  constructor() {
    super('onetracker')
    this.version(1).stores({
      items: 'id, mediaType, status, favorite, addedAt',
      episodes: 'id, itemId, watchedAt',
      episodeCache: 'id, itemId',
    })
    // v2: manga became its own mediaType with a chapter counter
    this.version(2).upgrade((tx) =>
      tx
        .table('items')
        .toCollection()
        .modify((item: LibraryItem) => {
          if (item.provider === 'anilist' && item.mediaType === 'book') {
            item.mediaType = 'manga'
            item.totalEpisodes = item.totalEpisodes ?? item.pages ?? null
            item.chaptersRead =
              item.chaptersRead ?? (item.status === 'completed' ? (item.totalEpisodes ?? 0) : 0)
          }
        }),
    )
    // v3: rewatch counts + user lists + manga chapters stored as episode rows
    this.version(3)
      .stores({
        items: 'id, mediaType, status, favorite, addedAt',
        episodes: 'id, itemId, watchedAt',
        episodeCache: 'id, itemId',
        lists: 'id, createdAt',
      })
      .upgrade(async (tx) => {
        await tx
          .table('episodes')
          .toCollection()
          .modify((e: WatchedEpisode) => {
            e.count = e.count ?? 1
          })
        // convert the legacy manga counter into real chapter rows
        const items = (await tx.table('items').toArray()) as LibraryItem[]
        const rows: WatchedEpisode[] = []
        for (const item of items) {
          if (item.mediaType === 'manga' && (item.chaptersRead ?? 0) > 0) {
            const at = item.lastReadAt ?? item.addedAt
            for (let c = 1; c <= item.chaptersRead!; c++) {
              rows.push({
                id: `${item.id}:1:${c}`,
                itemId: item.id,
                season: 1,
                episode: c,
                watchedAt: at,
                runtime: null,
                count: 1,
              })
            }
          }
          if (item.status === 'completed' && item.watchCount == null) {
            item.watchCount = 1
          }
        }
        if (rows.length > 0) await tx.table('episodes').bulkPut(rows)
        await tx.table('items').bulkPut(items)
      })
    // v4: details cache (metadata + ratings, stale-while-revalidate)
    this.version(4).stores({
      items: 'id, mediaType, status, favorite, addedAt',
      episodes: 'id, itemId, watchedAt',
      episodeCache: 'id, itemId',
      lists: 'id, createdAt',
      detailsCache: 'id',
    })
    // v5: shared cover cache (same artwork in search rows and detail pages)
    this.version(5).stores({
      items: 'id, mediaType, status, favorite, addedAt',
      episodes: 'id, itemId, watchedAt',
      episodeCache: 'id, itemId',
      lists: 'id, createdAt',
      detailsCache: 'id',
      covers: 'key',
    })
    // v6: purge phantom episode rows left by the absolute-numbering bug.
    // TMDB numbers long-running anime ABSOLUTELY inside seasons (Naruto
    // Shippuden S18 = eps 144–151) while the db keys units by their
    // 1..episodeCount season slot; the detail page used to write the raw
    // numbers, creating rows past the season length (and >100% progress).
    this.version(6)
      .stores({
        items: 'id, mediaType, status, favorite, addedAt',
        episodes: 'id, itemId, watchedAt',
        episodeCache: 'id, itemId',
        lists: 'id, createdAt',
        detailsCache: 'id',
        covers: 'key',
      })
      .upgrade(async (tx) => {
        const items = (await tx.table('items').toArray()) as LibraryItem[]
        for (const item of items) {
          if (item.mediaType !== 'tv' && item.mediaType !== 'anime') continue
          const counts = new Map(seasonsOf(item).map((s) => [s.number, s.episodeCount]))
          if (counts.size === 0) continue
          const rows = (await tx
            .table('episodes')
            .where('itemId')
            .equals(item.id)
            .toArray()) as WatchedEpisode[]
          const bad = rows.filter((r) => {
            const c = counts.get(r.season)
            return c == null || r.episode > c
          })
          if (bad.length === 0) continue
          await tx.table('episodes').bulkDelete(bad.map((r) => r.id))
          // re-derive status inline: recomputeStatus opens its own transaction
          const progress = rows.length - bad.length
          const total = totalEpisodesOf(item)
          const patch: Partial<LibraryItem> =
            progress === 0
              ? { status: 'planned', completedAt: null }
              : total != null && total > 0 && progress >= total && !item.ongoing
                ? { status: 'completed', completedAt: item.completedAt ?? Date.now() }
                : { status: 'watching', completedAt: null }
          await tx.table('items').update(item.id, patch)
        }
      })
    // v7: offline artwork (see imageCache.ts) — blobs and their LRU bookkeeping
    this.version(7).stores({
      items: 'id, mediaType, status, favorite, addedAt',
      episodes: 'id, itemId, watchedAt',
      episodeCache: 'id, itemId',
      lists: 'id, createdAt',
      detailsCache: 'id',
      covers: 'key',
      images: 'url',
      imageMeta: 'url, usedAt',
    })
  }
}

export const db = new OneTrackerDB()

// ---------------------------------------------------------------- helpers

export function epKey(itemId: string, season: number, episode: number): string {
  return `${itemId}:${season}:${episode}`
}

export function defaultEpisodeRuntime(type: MediaType): number {
  return type === 'anime' ? 24 : 40
}

/** Season-structured media (renders the seasons accordion). */
export function isEpisodic(type: MediaType): boolean {
  return type === 'tv' || type === 'anime'
}

/** Anything tracked unit-by-unit: episodes or chapters. */
export function hasUnits(type: MediaType): boolean {
  return type === 'tv' || type === 'anime' || type === 'manga'
}

/** Normalized season list used to walk units in watch order. */
export function seasonsOf(item: MediaBase): Array<{ number: number; episodeCount: number }> {
  if (item.seasons && item.seasons.length > 0) {
    return item.seasons
      .filter((s) => s.number > 0)
      .sort((a, b) => a.number - b.number)
      .map((s) => ({ number: s.number, episodeCount: s.episodeCount }))
  }
  if (item.totalEpisodes) return [{ number: 1, episodeCount: item.totalEpisodes }]
  return []
}

/**
 * Fields where a STORED value must survive a fresh fetch that came back empty.
 * Mirrors refreshItemMetadata's keepIfNullish: the DB snapshot is the source of
 * truth, a live fetch only ever enriches it.
 */
const KEEP_IF_NULLISH = [
  'poster',
  'backdrop',
  'overview',
  'episodeRuntime',
  'runtime',
  'pages',
  'playtime',
  'mangadexId',
  'lastReleaseDate',
  'releaseDate',
  'nextReleaseDate',
  'lastAired',
  'year',
  'ongoing',
] as const

/**
 * ONE view model for a detail page: fresh provider data on top of the stored
 * snapshot, never losing what the DB already knows. Without this a provider
 * hiccup (AniList has no chapter count for a hiatus manga, MangaDex blocked on
 * the network) blanks fields the user already relies on — e.g. chapters
 * vanishing from a manga the user has read 300 of.
 */
export function mergeMeta(
  details: MediaDetails | null,
  stored: LibraryItem | undefined,
): MediaDetails | null {
  if (!details) return (stored as MediaDetails | undefined) ?? null
  if (!stored) return details
  const out: MediaDetails = { ...details }
  for (const k of KEEP_IF_NULLISH) {
    if (out[k] == null && stored[k] != null) Object.assign(out, { [k]: stored[k] })
  }
  if (!out.seasons?.length && stored.seasons?.length) out.seasons = stored.seasons
  if (!out.genres?.length && stored.genres?.length) out.genres = stored.genres
  if (!out.tags?.length && stored.tags?.length) out.tags = stored.tags
  if (!out.screenshots?.length && stored.screenshots?.length) out.screenshots = stored.screenshots
  // unit totals never shrink: released chapter/episode counts only grow, so a
  // failed enrichment must not hide units the user already tracked
  if (stored.totalEpisodes != null) {
    out.totalEpisodes = Math.max(out.totalEpisodes ?? 0, stored.totalEpisodes)
  }
  return out
}

/** Comparable release instant: explicit date, else Jan 1 of the year, else −∞. */
function releaseTime(i: LibraryItem): number {
  if (i.releaseDate) {
    const t = Date.parse(i.releaseDate)
    if (!Number.isNaN(t)) return t
  }
  return i.year ? Date.UTC(i.year, 0, 1) : -Infinity
}

/**
 * Order a library grid (Favorites / Archived / Catalog):
 * - 'added'   — most recently added first (the classic default)
 * - 'rating'  — highest personal rating first; unrated sink to the bottom
 * - 'release' — newest release first; unknown dates sink to the bottom
 * Ties always fall back to add order, so the sort is stable and predictable.
 */
export function sortLibrary(items: LibraryItem[], mode: SortMode): LibraryItem[] {
  const copy = [...items]
  if (mode === 'rating') {
    return copy.sort((a, b) => (b.rating ?? -1) - (a.rating ?? -1) || b.addedAt - a.addedAt)
  }
  if (mode === 'release') {
    return copy.sort((a, b) => releaseTime(b) - releaseTime(a) || b.addedAt - a.addedAt)
  }
  return copy.sort((a, b) => b.addedAt - a.addedAt)
}

export function totalEpisodesOf(item: LibraryItem): number | null {
  if (item.seasons && item.seasons.length > 0) {
    return item.seasons.filter((s) => s.number > 0).reduce((a, s) => a + s.episodeCount, 0)
  }
  return item.totalEpisodes ?? null
}

/**
 * Whether a unit is already out and can be marked. False only when we
 * positively know it hasn't aired: an explicit future air date, a known
 * last-aired boundary it sits past, or a show that hasn't premiered at all.
 */
export function unitAired(
  item: MediaBase,
  season: number,
  episode: number,
  airDate?: string | null,
): boolean {
  const now = Date.now()
  if (airDate) return Date.parse(airDate) <= now
  if (item.releaseDate && Date.parse(item.releaseDate) > now) return false
  if (item.lastAired) {
    const la = item.lastAired
    return season < la.season || (season === la.season && episode <= la.episode)
  }
  return true
}

/** First unwatched unit in watch order (specials excluded), null when caught up. */
export function computeNextEpisode(
  item: LibraryItem,
  watchedKeys: Set<string>,
): { season: number; episode: number } | null {
  for (const s of seasonsOf(item)) {
    for (let e = 1; e <= s.episodeCount; e++) {
      if (!watchedKeys.has(epKey(item.id, s.number, e))) {
        return { season: s.number, episode: e }
      }
    }
  }
  return null
}

/** Caught up with everything released of an ongoing work. */
export function isCaughtUp(item: LibraryItem, watchedCount: number): boolean {
  const total = totalEpisodesOf(item)
  return !!item.ongoing && total != null && watchedCount >= total
}

/**
 * Active rewatch round of a completed work: the highest grade reached (g)
 * defines the round; the next unit to (re)watch is the first one still below
 * g. Returns null when no rewatch was started or the round is finished.
 */
export function computeNextRewatch(
  item: LibraryItem,
  episodes: WatchedEpisode[],
): { season: number; episode: number; grade: number; done: number } | null {
  if (episodes.length === 0) return null
  const grade = Math.max(...episodes.map((e) => e.count ?? 1))
  if (grade < 2) return null
  const byKey = new Map(episodes.map((e) => [e.id, e]))
  let done = 0
  let next: { season: number; episode: number } | null = null
  for (const s of seasonsOf(item)) {
    for (let e = 1; e <= s.episodeCount; e++) {
      const row = byKey.get(epKey(item.id, s.number, e))
      if (row && (row.count ?? 1) >= grade) done++
      else if (!next) next = { season: s.number, episode: e }
    }
  }
  return next ? { ...next, grade, done } : null
}

/**
 * Full-watchthrough grade per item, for the xN cover badge:
 * - unit-tracked media: the MINIMUM count across watched units (x2 only when
 *   every episode/chapter was seen at least twice — a finished round)
 * - movies/books/games: `watchCount` (games: replays)
 * Only grades ≥ 2 are returned.
 */
export function rewatchGrades(items: LibraryItem[], eps: WatchedEpisode[]): Map<string, number> {
  const minByItem = new Map<string, number>()
  for (const e of eps) {
    const c = e.count ?? 1
    const cur = minByItem.get(e.itemId)
    minByItem.set(e.itemId, cur == null ? c : Math.min(cur, c))
  }
  const grades = new Map<string, number>()
  for (const item of items) {
    const g = hasUnits(item.mediaType) ? (minByItem.get(item.id) ?? 1) : (item.watchCount ?? 1)
    if (g >= 2) grades.set(item.id, g)
  }
  return grades
}

/** Mark one unit at the given rewatch grade (the xN button on Continue cards). */
export async function markRewatchUnit(
  item: LibraryItem,
  season: number,
  episode: number,
  grade: number,
): Promise<void> {
  const key = epKey(item.id, season, episode)
  const row = await db.episodes.get(key)
  if (row) {
    await db.episodes.update(key, { count: Math.max(row.count ?? 1, grade), watchedAt: Date.now() })
  } else {
    await db.episodes.put({
      id: key,
      itemId: item.id,
      season,
      episode,
      watchedAt: Date.now(),
      runtime: item.episodeRuntime ?? defaultEpisodeRuntime(item.mediaType),
      count: grade,
    })
  }
}

// ------------------------------------------------------------ library CRUD

/** Add a media item to the library with `planned` status (no-op if present). */
export async function addToLibrary(details: MediaDetails): Promise<LibraryItem> {
  const existing = await db.items.get(details.id)
  if (existing) return existing
  const { cast: _cast, airStatus: _s, externalRatings: _r, ...base } = details
  const item: LibraryItem = {
    ...base,
    status: 'planned',
    favorite: false,
    addedAt: Date.now(),
    completedAt: null,
  }
  await db.items.put(item)
  return item
}

/** Remove an item and every trace of it (progress, caches, list references). */
export async function removeFromLibrary(id: string): Promise<void> {
  const gone = await db.items.get(id)
  await db.transaction('rw', db.items, db.episodes, db.episodeCache, db.lists, async () => {
    await db.items.delete(id)
    await db.episodes.where('itemId').equals(id).delete()
    await db.episodeCache.where('itemId').equals(id).delete()
    const lists = await db.lists.toArray()
    for (const l of lists) {
      if (l.itemIds.includes(id)) {
        await db.lists.update(l.id, { itemIds: l.itemIds.filter((x) => x !== id) })
      }
    }
  })
  // its offline artwork is dead weight the moment the item is gone
  await forget([gone?.poster, gone?.backdrop])
}

export async function toggleFavorite(id: string): Promise<void> {
  const item = await db.items.get(id)
  if (!item) return
  await db.items.update(id, { favorite: !item.favorite })
}

/**
 * Archive/unarchive: an orthogonal flag, so un-archiving drops the item right
 * back where its status puts it (Continue / Start / Completed).
 */
export async function toggleArchived(id: string): Promise<void> {
  const item = await db.items.get(id)
  if (!item) return
  await db.items.update(id, { archived: !item.archived })
}

/**
 * Mark/unmark an item as personally owned. Orthogonal to status/archive: owned
 * items stay exactly where they are, they just also appear in the "Owned" box.
 */
export async function toggleOwned(id: string): Promise<void> {
  const item = await db.items.get(id)
  if (!item) return
  await db.items.update(id, { owned: !item.owned })
}

/** Personal 0–10 rating (one decimal); null removes it. */
export async function setRating(id: string, rating: number | null): Promise<void> {
  await db.items.update(id, {
    rating: rating == null ? null : Math.round(Math.min(10, Math.max(0, rating)) * 10) / 10,
  })
}

// -------------------------------------------------------------- status

/**
 * Re-derive planned/watching/completed from stored progress.
 * Ongoing works never auto-complete — they stay "watching" when caught up.
 *
 * `touch` stamps `lastReadAt` — true for a real interaction (a unit marked),
 * false for a background metadata refresh, which must NOT make an item look
 * freshly read: the Books tab orders "Continue" by that timestamp, and a sync
 * pass would otherwise reshuffle the whole list behind the user's back.
 */
export async function recomputeStatus(itemId: string, touch = true): Promise<void> {
  const item = await db.items.get(itemId)
  if (!item || !hasUnits(item.mediaType)) return
  const progress = await db.episodes.where('itemId').equals(itemId).count()
  const total = totalEpisodesOf(item)
  let status: ItemStatus = item.status
  let completedAt = item.completedAt ?? null
  if (progress === 0) {
    status = 'planned'
    completedAt = null
  } else if (total != null && total > 0 && progress >= total && !item.ongoing) {
    status = 'completed'
    completedAt = completedAt ?? Date.now()
  } else {
    status = 'watching'
    completedAt = null
  }
  await db.items.update(itemId, {
    status,
    completedAt,
    ...(touch ? { lastReadAt: Date.now() } : {}),
  })
}

/**
 * Refresh the stored metadata snapshot from freshly fetched details (new
 * episodes/chapters, ongoing flag, release dates, artwork…) and re-derive
 * status. Library state (favorite, rating, progress…) is untouched.
 *
 * The merge is CONSERVATIVE: a fetch where an enrichment source failed
 * (e.g. MangaDex rate-limited → chapters null) must never destroy good
 * stored data, so null/empty values don't overwrite existing ones and
 * manga chapter totals only grow.
 */
export async function refreshItemMetadata(details: MediaDetails): Promise<void> {
  const existing = await db.items.get(details.id)
  if (!existing) return
  const { cast: _cast, airStatus: _s, externalRatings: _r, id: _id, ...base } = details

  const patch: Partial<LibraryItem> = { ...base }
  const keepIfNullish = [
    'poster',
    'backdrop',
    'overview',
    'episodeRuntime',
    'runtime',
    'pages',
    'playtime',
    'mangadexId',
    'lastReleaseDate',
    'releaseDate',
    'lastAired',
    'year',
    'ongoing',
  ] as const
  for (const k of keepIfNullish) {
    if (patch[k] == null && existing[k] != null) delete patch[k]
  }
  if ((!patch.seasons || patch.seasons.length === 0) && existing.seasons?.length) {
    delete patch.seasons
  }
  if ((!patch.genres || patch.genres.length === 0) && existing.genres?.length) {
    delete patch.genres
  }
  if ((!patch.tags || patch.tags.length === 0) && existing.tags?.length) {
    delete patch.tags
  }
  if ((!patch.screenshots || patch.screenshots.length === 0) && existing.screenshots?.length) {
    delete patch.screenshots
  }
  if (patch.totalEpisodes == null && existing.totalEpisodes != null) {
    delete patch.totalEpisodes
  } else if (
    existing.mediaType === 'manga' &&
    patch.totalEpisodes != null &&
    existing.totalEpisodes != null
  ) {
    // released chapter counts only ever grow
    patch.totalEpisodes = Math.max(patch.totalEpisodes, existing.totalEpisodes)
  }

  // a refresh that brings nothing new must not write: an identical update
  // still wakes every live query watching the library, and this runs in the
  // background for a batch of items at a time (see sync.ts)
  const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null)
  for (const k of Object.keys(patch) as Array<keyof LibraryItem>) {
    if (same(patch[k], existing[k])) delete patch[k]
  }
  if (Object.keys(patch).length === 0) return

  await db.items.update(details.id, patch)
  await recomputeStatus(details.id, false)
}

// ------------------------------------------------------- watching units

/**
 * Mark a unit as watched, CASCADING backwards: checking episode 4 also marks
 * 1–3 (across earlier seasons too). Already-watched units are untouched.
 */
export async function markUpTo(
  item: LibraryItem,
  season: number,
  episode: number,
  runtime?: number | null,
): Promise<void> {
  let seasons = seasonsOf(item)
  if (seasons.length === 0) seasons = [{ number: 1, episodeCount: episode }]
  const existing = await db.episodes.where('itemId').equals(item.id).toArray()
  const have = new Set(existing.map((e) => e.id))
  const now = Date.now()
  const fallbackRuntime =
    item.mediaType === 'manga'
      ? null
      : (item.episodeRuntime ?? defaultEpisodeRuntime(item.mediaType))
  const rows: WatchedEpisode[] = []
  for (const s of seasons) {
    if (s.number > season) break
    const maxE = s.number === season ? Math.max(episode, 0) : s.episodeCount
    for (let e = 1; e <= maxE; e++) {
      const key = epKey(item.id, s.number, e)
      if (have.has(key)) continue
      rows.push({
        id: key,
        itemId: item.id,
        season: s.number,
        episode: e,
        watchedAt: now,
        runtime: s.number === season && e === episode ? (runtime ?? fallbackRuntime) : fallbackRuntime,
        count: 1,
      })
    }
  }
  if (rows.length > 0) await db.episodes.bulkPut(rows)
  await recomputeStatus(item.id)
}

/** Un-mark a single unit (no cascade — the user removed one check). */
export async function unmarkUnit(item: LibraryItem, season: number, episode: number): Promise<void> {
  await db.episodes.delete(epKey(item.id, season, episode))
  await recomputeStatus(item.id)
}

/**
 * Rewatch cascade: bump the clicked unit to grade g = its count + 1 and raise
 * every unit BEFORE it (watch order) that is still below g to exactly g.
 * Units already at ≥ g and units after the clicked one are untouched.
 */
export async function rewatchUpTo(item: LibraryItem, season: number, episode: number): Promise<void> {
  let seasons = seasonsOf(item)
  if (seasons.length === 0) seasons = [{ number: 1, episodeCount: episode }]
  const existing = await db.episodes.where('itemId').equals(item.id).toArray()
  const have = new Map(existing.map((e) => [e.id, e]))
  const clicked = have.get(epKey(item.id, season, episode))
  const grade = (clicked?.count ?? 1) + 1
  const now = Date.now()
  const fallbackRuntime =
    item.mediaType === 'manga'
      ? null
      : (item.episodeRuntime ?? defaultEpisodeRuntime(item.mediaType))
  const rows: WatchedEpisode[] = []
  for (const s of seasons) {
    if (s.number > season) break
    const maxE = s.number === season ? episode : s.episodeCount
    for (let e = 1; e <= maxE; e++) {
      const key = epKey(item.id, s.number, e)
      const row = have.get(key)
      if (!row) {
        rows.push({
          id: key,
          itemId: item.id,
          season: s.number,
          episode: e,
          watchedAt: now,
          runtime: fallbackRuntime,
          count: grade,
        })
      } else if ((row.count ?? 1) < grade) {
        rows.push({ ...row, count: grade, watchedAt: now })
      }
    }
  }
  if (rows.length > 0) await db.episodes.bulkPut(rows)
  await recomputeStatus(item.id)
}

/** Mark/unmark a contiguous chapter range (the "Mark all" button on 100-blocks). */
export async function setRangeWatched(
  item: LibraryItem,
  season: number,
  from: number,
  to: number,
  watched: boolean,
): Promise<void> {
  if (watched) {
    const existing = new Set(
      (await db.episodes.where('itemId').equals(item.id).toArray()).map((e) => e.id),
    )
    const now = Date.now()
    const rows: WatchedEpisode[] = []
    for (let e = from; e <= to; e++) {
      const key = epKey(item.id, season, e)
      if (existing.has(key)) continue
      rows.push({
        id: key,
        itemId: item.id,
        season,
        episode: e,
        watchedAt: now,
        runtime: item.mediaType === 'manga' ? null : (item.episodeRuntime ?? defaultEpisodeRuntime(item.mediaType)),
        count: 1,
      })
    }
    if (rows.length > 0) await db.episodes.bulkPut(rows)
  } else {
    const keys: string[] = []
    for (let e = from; e <= to; e++) keys.push(epKey(item.id, season, e))
    await db.episodes.bulkDelete(keys)
  }
  await recomputeStatus(item.id)
}

/**
 * Mark/unmark a whole season (used by the "Mark all" season button).
 * `episodes` carries the season SLOTS to mark — 1..episodeCount ordinals,
 * the db-wide unit convention — NOT the provider's display numbers (TMDB
 * numbers long-running anime absolutely across seasons).
 */
export async function setSeasonWatched(
  item: LibraryItem,
  season: number,
  episodes: Array<{ episode: number; runtime?: number | null }>,
  watched: boolean,
): Promise<void> {
  if (watched) {
    const now = Date.now()
    const existing = new Set(
      (await db.episodes.where('itemId').equals(item.id).toArray()).map((e) => e.id),
    )
    await db.episodes.bulkPut(
      episodes
        .filter((e) => !existing.has(epKey(item.id, season, e.episode)))
        .map((e) => ({
          id: epKey(item.id, season, e.episode),
          itemId: item.id,
          season,
          episode: e.episode,
          watchedAt: now,
          runtime: e.runtime ?? item.episodeRuntime ?? defaultEpisodeRuntime(item.mediaType),
          count: 1,
        })),
    )
  } else {
    await db.episodes
      .where('itemId')
      .equals(item.id)
      .and((e) => e.season === season)
      .delete()
  }
  await recomputeStatus(item.id)
}

// ----------------------------------------------------- single media (movie/book)

/** Mark a movie / book as consumed (or back to planned). */
export async function setSingleWatched(id: string, watched: boolean): Promise<void> {
  await db.items.update(id, {
    status: watched ? 'completed' : 'planned',
    completedAt: watched ? Date.now() : null,
    watchCount: watched ? 1 : undefined,
  })
}

/** One more full rewatch of a movie / book / game (x2, x3…). */
export async function rewatchSingle(id: string): Promise<void> {
  const item = await db.items.get(id)
  if (!item) return
  await db.items.update(id, { watchCount: (item.watchCount ?? 1) + 1 })
}

/**
 * Explicit 3-state for single media (movie / book / game): planned → watching
 * ("in progress": you started it, so it lives in Continue) → completed. The
 * middle state is what lets a movie sit in Continue like a series until you
 * actually finish it. Rewatches (x2, x3…) still go through rewatchSingle.
 */
export async function setSingleStatus(id: string, status: ItemStatus): Promise<void> {
  const item = await db.items.get(id)
  await db.items.update(id, {
    status,
    completedAt: status === 'completed' ? Date.now() : null,
    watchCount: status === 'completed' ? (item?.watchCount ?? 1) : undefined,
    lastReadAt: Date.now(),
  })
}

/** @deprecated use setSingleStatus — kept as an alias for existing callers. */
export const setGameStatus = setSingleStatus

/**
 * "Waiting" = an item with nothing to do right now, parked in its own section
 * so it never clutters the actionable Continue/Start lists:
 * - planned but unreleased (any media): premiere/release date still in the future
 * - series/anime/manga in progress: caught up on every AIRED unit. Either
 *   nothing new is out (ongoing work, every listed unit watched) OR the only
 *   units left are announced-but-unreleased — a next episode with a future air
 *   date (e.g. Bleach S02E41, dated next month, sitting past item.lastAired).
 *   Returns to Continue the instant a unit airs.
 * `watchedKeys` is the GLOBAL set of watched episode ids (epKey), as the pages
 * already build it; movies/games can pass an empty set.
 *
 * `airDateOf` is the precise answer when the caller has it: the air date of a
 * specific unit, straight from the cached episode list. Without it the decision
 * falls back to `item.lastAired`, the show-level "last episode that aired"
 * TMDB stamped whenever the snapshot was last refreshed — which LAGS. That lag
 * is what used to keep a series parked in Waiting for the whole day an episode
 * came out: the episode's own air date says "today", the stale boundary says
 * "not yet". The unit's own date always wins.
 */
export function isWaiting(
  item: LibraryItem,
  watchedKeys: Set<string>,
  airDateOf?: (season: number, episode: number) => string | null | undefined,
): boolean {
  const now = Date.now()
  if (item.status === 'planned') {
    return !!item.releaseDate && Date.parse(item.releaseDate) > now
  }
  if (item.status !== 'watching' || !hasUnits(item.mediaType)) return false
  const next = computeNextEpisode(item, watchedKeys)
  // caught up on every listed unit → waiting only while the work is ongoing;
  // otherwise the next unit exists but must have already aired to be actionable
  if (!next) return !!item.ongoing
  return !unitAired(item, next.season, next.episode, airDateOf?.(next.season, next.episode))
}

/** Games: personal hours played. */
export async function setMyPlaytime(id: string, hours: number | null): Promise<void> {
  await db.items.update(id, { myPlaytime: hours })
}

// ------------------------------------------------------------------ lists

const LIST_COLORS = [
  '#ffd60a',
  '#ff9f43',
  '#ff6b6b',
  '#f368e0',
  '#a78bfa',
  '#54a0ff',
  '#4cc9f0',
  '#52d17c',
]
export { LIST_COLORS }

export async function createList(name: string, color: string): Promise<WatchList> {
  const list: WatchList = {
    id: `list-${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
    name: name.trim(),
    color,
    itemIds: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  }
  await db.lists.put(list)
  return list
}

export async function deleteList(id: string): Promise<void> {
  await db.lists.delete(id)
}

export async function toggleListItem(listId: string, itemId: string): Promise<void> {
  const list = await db.lists.get(listId)
  if (!list) return
  const itemIds = list.itemIds.includes(itemId)
    ? list.itemIds.filter((x) => x !== itemId)
    : [...list.itemIds, itemId]
  await db.lists.update(listId, { itemIds, updatedAt: Date.now() })
}

// ------------------------------------------------------------------ stats

export interface Stats {
  /** everything combined, minutes (tv + anime + movies + games) */
  totalMin: number
  tvMin: number
  animeMin: number
  movieMin: number
  gameMin: number
  episodesWatched: number
  chaptersRead: number
  moviesWatched: number
  booksRead: number
  gamesPlayed: number
  gameHours: number
}

/**
 * Aggregate watch-time statistics. Rewatches count as extra time: a 40-min
 * episode at x3 contributes 120 minutes. Game time uses the personal playtime
 * when set, otherwise the provider's average, for every started game.
 */
export async function computeStats(): Promise<Stats> {
  const [items, episodes] = await Promise.all([db.items.toArray(), db.episodes.toArray()])
  const byId = new Map(items.map((i) => [i.id, i]))
  const stats: Stats = {
    totalMin: 0,
    tvMin: 0,
    animeMin: 0,
    movieMin: 0,
    gameMin: 0,
    episodesWatched: 0,
    chaptersRead: 0,
    moviesWatched: 0,
    booksRead: 0,
    gamesPlayed: 0,
    gameHours: 0,
  }
  for (const ep of episodes) {
    const item = byId.get(ep.itemId)
    if (!item) continue
    const times = ep.count ?? 1
    if (item.mediaType === 'manga') {
      stats.chaptersRead += times
      continue
    }
    if (item.mediaType !== 'tv' && item.mediaType !== 'anime') continue
    const min = (ep.runtime ?? item.episodeRuntime ?? defaultEpisodeRuntime(item.mediaType)) * times
    stats.episodesWatched++
    if (item.mediaType === 'anime') stats.animeMin += min
    else stats.tvMin += min
  }
  for (const item of items) {
    if (item.mediaType === 'game' && item.status !== 'planned') {
      // expected time until the user tracks their own hours
      const hours = (item.myPlaytime ?? item.playtime ?? 0) * (item.watchCount ?? 1)
      stats.gameHours += hours
      if (item.status === 'completed') stats.gamesPlayed++
      continue
    }
    if (item.status !== 'completed') continue
    if (item.mediaType === 'movie') {
      stats.moviesWatched++
      stats.movieMin += (item.runtime ?? 110) * (item.watchCount ?? 1)
    } else if (item.mediaType === 'book' || item.mediaType === 'manga') {
      stats.booksRead++
    }
  }
  stats.gameMin = Math.round(stats.gameHours * 60)
  stats.totalMin = stats.tvMin + stats.animeMin + stats.movieMin + stats.gameMin
  return stats
}

// ------------------------------------------------------- episode list cache

export async function putCachedEpisodes(
  itemId: string,
  season: number,
  episodes: EpisodeInfo[],
): Promise<void> {
  await db.episodeCache.put({ id: `${itemId}:${season}`, itemId, season, episodes, fetchedAt: Date.now() })
}
