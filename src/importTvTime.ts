/**
 * TV Time importers. Two zip formats are auto-detected:
 *
 * 1. PLUGIN export (community "tvtime export" tool): tvtime-series-*.json +
 *    tvtime-movies-*.json — the richest source: TVDB ids for shows, IMDb ids
 *    for movies, per-episode watched_at and rewatch counts, favorites.
 * 2. Official GDPR export: CSVs. Shows come from followed_tv_show.csv (TVDB
 *    ids) plus every watch event in tracking-prod-records-v2.csv (one row
 *    per watch/rewatch with season/episode numbers); movies come from the
 *    `follow` rows of tracking-prod-records.csv (name + release year, no
 *    external id → resolved by title search).
 *
 * Shows resolve TVDB→TMDB via /find; episode rows merge into the existing
 * library keeping the highest rewatch count, so re-importing is idempotent.
 */
import { strFromU8, unzipSync } from 'fflate'
import { findByExternalId, movieDetails, searchMovieId, tvDetails } from './api/tmdb'
import { addToLibrary, db, defaultEpisodeRuntime, epKey, recomputeStatus } from './db'
import type { WatchedEpisode } from './types'

export interface TvTimeImportResult {
  shows: number
  episodes: number
  movies: number
  skipped: string[]
}

export type ImportProgress = { done: number; total: number; label: string }
type OnProgress = (p: ImportProgress) => void

// ------------------------------------------------------------- CSV parsing

/** Minimal RFC-4180 CSV parser (quotes, escaped quotes, embedded commas/newlines). */
function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let inQuotes = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"'
          i++
        } else {
          inQuotes = false
        }
      } else {
        field += c
      }
    } else if (c === '"') {
      inQuotes = true
    } else if (c === ',') {
      row.push(field)
      field = ''
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++
      row.push(field)
      field = ''
      if (row.length > 1 || row[0] !== '') rows.push(row)
      row = []
    } else {
      field += c
    }
  }
  if (field !== '' || row.length > 0) {
    row.push(field)
    if (row.length > 1 || row[0] !== '') rows.push(row)
  }
  return rows
}

/** CSV rows → objects keyed by the header row. */
function csvObjects(text: string): Array<Record<string, string>> {
  const rows = parseCsv(text)
  if (rows.length < 2) return []
  const header = rows[0]
  return rows.slice(1).map((r) => {
    const o: Record<string, string> = {}
    header.forEach((h, i) => {
      o[h] = r[i] ?? ''
    })
    return o
  })
}

// --------------------------------------------------------------- helpers

interface EpMark {
  /**
   * 1-based ABSOLUTE episode index across the whole show, in broadcast order.
   * TV Time (TVDB) and TMDB slice a show into DIFFERENT seasons — e.g. One
   * Piece: TVDB season 1 = 8 episodes vs TMDB "East Blue" = 61 — so copying
   * TV Time's (season, episode) straight onto the TMDB item lands watched
   * episodes on the wrong, or nonexistent, slots (that was the import bug:
   * East Blue showed 8/61 instead of 61/61, and out-of-range episodes became
   * phantom rows that pushed the count past 100%). The absolute index is the
   * stable bridge: it gets re-sliced onto TMDB's own seasons at import time.
   */
  abs: number
  count: number
  at: number
  runtime: number | null
}

/** Re-slice an absolute episode index onto the target's real season layout. */
function absToSeasonEpisode(
  abs: number,
  seasons: Array<{ number: number; episodeCount: number }>,
): { season: number; episode: number } | null {
  if (seasons.length === 0) return { season: 1, episode: abs }
  let acc = 0
  for (const s of seasons) {
    if (abs <= acc + s.episodeCount) return { season: s.number, episode: abs - acc }
    acc += s.episodeCount
  }
  return null // beyond the episodes TMDB knows → dropped, never a phantom row
}

/** Resolve one TVDB show, add it and (re)build its watched episodes. */
async function importShow(
  tvdbId: string | number,
  marks: EpMark[],
  favorite: boolean,
  result: TvTimeImportResult,
): Promise<void> {
  const { tvId } = await findByExternalId(tvdbId, 'tvdb_id')
  if (!tvId) throw new Error('not on TMDB')
  const details = await tvDetails(tvId, true) // bulk: skip AniList/MAL scores
  const item = await addToLibrary(details)
  if (favorite && !item.favorite) await db.items.update(item.id, { favorite: true })

  const seasons = (details.seasons ?? [])
    .filter((s) => s.number > 0)
    .sort((a, b) => a.number - b.number)
    .map((s) => ({ number: s.number, episodeCount: s.episodeCount }))

  // map each absolute index onto TMDB's seasons; dedupe by slot (keep max count)
  const byKey = new Map<string, WatchedEpisode>()
  for (const m of marks) {
    const pos = absToSeasonEpisode(m.abs, seasons)
    if (!pos) continue
    const id = epKey(item.id, pos.season, pos.episode)
    const prev = byKey.get(id)
    byKey.set(id, {
      id,
      itemId: item.id,
      season: pos.season,
      episode: pos.episode,
      watchedAt: prev ? Math.min(prev.watchedAt, m.at) : m.at,
      runtime: m.runtime ?? details.episodeRuntime ?? defaultEpisodeRuntime('tv'),
      count: Math.max(prev?.count ?? 1, m.count),
    })
  }

  // TV Time is authoritative for a show's history: REPLACE the item's rows
  // (not additive), so re-importing is idempotent AND clears rows misplaced by
  // an earlier buggy import — this is what cures the "131% watched" totals.
  const rows = [...byKey.values()]
  await db.transaction('rw', db.episodes, async () => {
    await db.episodes.where('itemId').equals(item.id).delete()
    if (rows.length > 0) await db.episodes.bulkPut(rows)
  })
  result.episodes += rows.length
  await recomputeStatus(item.id)
  result.shows++
}

/** Resolve one movie (by IMDb id or title+year), add it and mark it. */
async function importMovie(
  m: {
    imdb?: string | null
    title: string
    year?: number | null
    watched: boolean
    watchedAt?: number
    rewatchCount?: number
    favorite?: boolean
  },
  result: TvTimeImportResult,
): Promise<void> {
  let movieId: string | null = null
  if (m.imdb) movieId = (await findByExternalId(m.imdb, 'imdb_id')).movieId
  if (!movieId) movieId = await searchMovieId(m.title, m.year)
  if (!movieId) throw new Error('not on TMDB')
  const details = await movieDetails(movieId)
  const item = await addToLibrary(details)
  const patch: Partial<import('./types').LibraryItem> = {}
  if (m.favorite && !item.favorite) patch.favorite = true
  if (m.watched && item.status !== 'completed') {
    patch.status = 'completed'
    patch.completedAt = m.watchedAt ?? Date.now()
    patch.watchCount = Math.max(1, (m.rewatchCount ?? 0) + 1)
  }
  if (Object.keys(patch).length > 0) await db.items.update(item.id, patch)
  result.movies++
}

// ---------------------------------------------------------- plugin format

async function importPlugin(
  seriesJson: string,
  moviesJson: string | null,
  onProgress: OnProgress,
): Promise<TvTimeImportResult> {
  const result: TvTimeImportResult = { shows: 0, episodes: 0, movies: 0, skipped: [] }
  const series = JSON.parse(seriesJson) as any[]
  const movies = moviesJson ? (JSON.parse(moviesJson) as any[]) : []
  const total = series.length + movies.length
  let done = 0

  for (const show of series) {
    onProgress({ done, total, label: show.title ?? '…' })
    try {
      if (!show.id?.tvdb) throw new Error('no tvdb id')
      // walk every episode in broadcast order to assign a stable absolute
      // index (watched or not), pushing a mark only for the watched ones
      const marks: EpMark[] = []
      let abs = 0
      const seasons = ((show.seasons ?? []) as any[])
        .filter((s) => !s.is_specials && s.number !== 0)
        .sort((a, b) => a.number - b.number)
      for (const season of seasons) {
        const eps = ((season.episodes ?? []) as any[])
          .filter((e) => !e.special)
          .sort((a, b) => (a.number ?? 0) - (b.number ?? 0))
        for (const ep of eps) {
          abs++
          if (!ep.is_watched) continue
          marks.push({
            abs,
            count: Math.max(1, ep.watched_count ?? (ep.rewatch_count ?? 0) + 1),
            at: Date.parse(ep.watched_at ?? '') || Date.now(),
            runtime: null,
          })
        }
      }
      await importShow(show.id.tvdb, marks, !!show.is_favorite, result)
    } catch {
      result.skipped.push(show.title ?? 'unknown show')
    }
    done++
  }

  for (const m of movies) {
    onProgress({ done, total, label: m.title ?? '…' })
    try {
      await importMovie(
        {
          imdb: m.id?.imdb ?? null,
          title: m.title,
          year: m.year ?? null,
          watched: !!m.is_watched,
          watchedAt: Date.parse(m.watched_at ?? '') || undefined,
          rewatchCount: m.rewatch_count ?? 0,
          favorite: !!m.is_favorite,
        },
        result,
      )
    } catch {
      result.skipped.push(m.title ?? 'unknown movie')
    }
    done++
  }
  onProgress({ done, total, label: '' })
  return result
}

// ------------------------------------------------------------ GDPR format

async function importGdpr(
  v2Csv: string,
  followedCsv: string | null,
  v1Csv: string | null,
  onProgress: OnProgress,
): Promise<TvTimeImportResult> {
  const result: TvTimeImportResult = { shows: 0, episodes: 0, movies: 0, skipped: [] }

  // shows: followed list + every show that has watch events. Watch events are
  // kept RAW (per TV Time season/episode); they become absolute indices only
  // after we know each season's size (below), so the import can re-slice them
  // onto TMDB's seasons exactly like the plugin path does.
  interface RawEvent {
    season: number
    episode: number
    count: number
    at: number
    runtime: number | null
  }
  const shows = new Map<string, { name: string; events: Map<string, RawEvent> }>()
  for (const row of followedCsv ? csvObjects(followedCsv) : []) {
    if (row.tv_show_id) {
      shows.set(row.tv_show_id, { name: row.tv_show_name || row.tv_show_id, events: new Map() })
    }
  }
  for (const row of csvObjects(v2Csv)) {
    const sid = row.s_id
    const season = Number(row.season_number || row.s_no)
    const episode = Number(row.episode_number || row.ep_no)
    if (!sid || !row.series_name || !Number.isFinite(season) || !Number.isFinite(episode)) continue
    if (season <= 0) continue // specials
    let entry = shows.get(sid)
    if (!entry) {
      entry = { name: row.series_name, events: new Map() }
      shows.set(sid, entry)
    }
    const key = `${season}:${episode}`
    const prev = entry.events.get(key)
    const at = Date.parse(row.created_at ?? '') || Date.now()
    const runtimeSec = Number(row.runtime)
    if (prev) {
      prev.count += 1 // each extra row for the same episode is a rewatch
      prev.at = Math.min(prev.at, at)
    } else {
      entry.events.set(key, {
        season,
        episode,
        count: 1,
        at,
        runtime: Number.isFinite(runtimeSec) && runtimeSec > 0 ? Math.round(runtimeSec / 60) : null,
      })
    }
  }

  /**
   * GDPR exports list only WATCHED events, not the full season sizes, so take
   * each season's highest watched episode as its size. Absolute offsets then
   * depend only on EARLIER seasons — accurate for shows watched in order (the
   * normal case); a fully-skipped middle season is the only lossy edge case.
   */
  const gdprMarks = (events: Map<string, RawEvent>): EpMark[] => {
    const all = [...events.values()]
    const seasonSize = new Map<number, number>()
    for (const e of all) seasonSize.set(e.season, Math.max(seasonSize.get(e.season) ?? 0, e.episode))
    const offsetOf = (season: number) => {
      let acc = 0
      for (const [s, size] of seasonSize) if (s < season) acc += size
      return acc
    }
    return all.map((e) => ({ abs: offsetOf(e.season) + e.episode, count: e.count, at: e.at, runtime: e.runtime }))
  }

  // movies: `follow` rows of the v1 records + the watched-uuid list
  const movies: Array<{ title: string; year: number | null; uuid: string }> = []
  const watchedUuids = new Set<string>()
  if (v1Csv) {
    for (const row of csvObjects(v1Csv)) {
      if (row['type-uuid-n'] === 'count-watch-movie' && row.watches) {
        for (const uuid of row.watches.match(/[0-9a-f]{8}-[0-9a-f-]{27,}/gi) ?? []) {
          watchedUuids.add(uuid)
        }
      }
      if (row.type === 'follow' && row.entity_type === 'movie' && row.movie_name) {
        const year = Number(String(row.release_date ?? '').slice(0, 4))
        movies.push({
          title: row.movie_name,
          year: Number.isFinite(year) && year > 1800 ? year : null,
          uuid: row.uuid ?? '',
        })
      }
    }
  }

  const total = shows.size + movies.length
  let done = 0
  for (const [tvdbId, show] of shows) {
    onProgress({ done, total, label: show.name })
    try {
      await importShow(tvdbId, gdprMarks(show.events), false, result)
    } catch {
      result.skipped.push(show.name)
    }
    done++
  }
  for (const m of movies) {
    onProgress({ done, total, label: m.title })
    try {
      await importMovie(
        { title: m.title, year: m.year, watched: watchedUuids.has(m.uuid) },
        result,
      )
    } catch {
      result.skipped.push(m.title)
    }
    done++
  }
  onProgress({ done, total, label: '' })
  return result
}

// ----------------------------------------------------------------- entry

export async function importTvTimeZip(
  file: File,
  onProgress: OnProgress,
): Promise<TvTimeImportResult> {
  const files = unzipSync(new Uint8Array(await file.arrayBuffer()))
  const names = Object.keys(files)
  const read = (re: RegExp): string | null => {
    const n = names.find((x) => re.test(x))
    return n ? strFromU8(files[n]) : null
  }

  const pluginSeries = read(/tvtime-series-[^/]*\.json$/)
  if (pluginSeries) {
    return importPlugin(pluginSeries, read(/tvtime-movies-[^/]*\.json$/), onProgress)
  }
  const gdprV2 = read(/tracking-prod-records-v2\.csv$/)
  if (gdprV2) {
    return importGdpr(
      gdprV2,
      read(/followed_tv_show\.csv$/),
      read(/tracking-prod-records\.csv$/),
      onProgress,
    )
  }
  throw new Error('unrecognized-format')
}
