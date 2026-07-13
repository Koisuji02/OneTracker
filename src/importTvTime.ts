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

/** Merge episode rows into the library, keeping the highest watch count. */
async function putEpisodesMerged(itemId: string, rows: WatchedEpisode[]): Promise<number> {
  if (rows.length === 0) return 0
  const existing = new Map(
    (await db.episodes.where('itemId').equals(itemId).toArray()).map((e) => [e.id, e]),
  )
  const merged = rows.map((r) => {
    const ex = existing.get(r.id)
    return ex
      ? { ...r, count: Math.max(ex.count ?? 1, r.count ?? 1), watchedAt: ex.watchedAt }
      : r
  })
  await db.episodes.bulkPut(merged)
  return merged.length
}

interface EpMark {
  season: number
  episode: number
  count: number
  at: number
  runtime: number | null
}

/** Resolve one TVDB show, add it and mark its episodes. */
async function importShow(
  tvdbId: string | number,
  marks: EpMark[],
  favorite: boolean,
  result: TvTimeImportResult,
): Promise<void> {
  const { tvId } = await findByExternalId(tvdbId, 'tvdb_id')
  if (!tvId) throw new Error('not on TMDB')
  const details = await tvDetails(tvId)
  const item = await addToLibrary(details)
  if (favorite && !item.favorite) await db.items.update(item.id, { favorite: true })
  const rows: WatchedEpisode[] = marks
    .filter((m) => m.season > 0)
    .map((m) => ({
      id: epKey(item.id, m.season, m.episode),
      itemId: item.id,
      season: m.season,
      episode: m.episode,
      watchedAt: m.at,
      runtime: m.runtime ?? details.episodeRuntime ?? defaultEpisodeRuntime('tv'),
      count: m.count,
    }))
  result.episodes += await putEpisodesMerged(item.id, rows)
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
      const marks: EpMark[] = []
      for (const season of show.seasons ?? []) {
        if (season.is_specials || season.number === 0) continue
        for (const ep of season.episodes ?? []) {
          if (!ep.is_watched || ep.special) continue
          marks.push({
            season: season.number,
            episode: ep.number,
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

  // shows: followed list + every show that has watch events
  const shows = new Map<string, { name: string; eps: Map<string, EpMark> }>()
  for (const row of followedCsv ? csvObjects(followedCsv) : []) {
    if (row.tv_show_id) {
      shows.set(row.tv_show_id, { name: row.tv_show_name || row.tv_show_id, eps: new Map() })
    }
  }
  for (const row of csvObjects(v2Csv)) {
    const sid = row.s_id
    const season = Number(row.season_number || row.s_no)
    const episode = Number(row.episode_number || row.ep_no)
    if (!sid || !row.series_name || !Number.isFinite(season) || !Number.isFinite(episode)) continue
    let entry = shows.get(sid)
    if (!entry) {
      entry = { name: row.series_name, eps: new Map() }
      shows.set(sid, entry)
    }
    const key = `${season}:${episode}`
    const prev = entry.eps.get(key)
    const at = Date.parse(row.created_at ?? '') || Date.now()
    const runtimeSec = Number(row.runtime)
    if (prev) {
      prev.count += 1 // each extra row for the same episode is a rewatch
      prev.at = Math.min(prev.at, at)
    } else {
      entry.eps.set(key, {
        season,
        episode,
        count: 1,
        at,
        runtime: Number.isFinite(runtimeSec) && runtimeSec > 0 ? Math.round(runtimeSec / 60) : null,
      })
    }
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
      await importShow(tvdbId, [...show.eps.values()], false, result)
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
