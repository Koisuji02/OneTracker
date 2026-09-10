import { fetchTimeout } from './http'
import { getSettings } from '../settings'
import type { CastMember, EpisodeInfo, MediaDetails, SearchResult } from '../types'
import { animeRatingsByTitle } from './anilist'
import { ApiKeyMissingError } from './errors'
import { gatewayEnabled } from './gateway'
import { omdbRatings } from './ratings'
import { CJK_RE, looseTitleKey, normalizeTitle } from './titleMatch'

const API = 'https://api.themoviedb.org/3'
const IMG = 'https://image.tmdb.org/t/p/'

export function tmdbImg(path: string | null | undefined, size = 'w342'): string | null {
  return path ? `${IMG}${size}${path}` : null
}

async function tmdbFetch(path: string, params: Record<string, string> = {}): Promise<any> {
  const key = getSettings().tmdbKey.trim()
  // with the gateway on, the key lives in the Worker — none is needed here
  if (!key && !gatewayEnabled()) throw new ApiKeyMissingError('tmdb')
  const url = new URL(API + path)
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)
  // a caller can pin the language (search rows force en-US for readable titles);
  // otherwise follow the UI language (localized overviews on detail pages)
  if (!params.language) {
    url.searchParams.set('language', getSettings().language === 'it' ? 'it-IT' : 'en-US')
  }
  const init: RequestInit = {}
  // v4 read access token vs v3 api key
  if (key.startsWith('ey')) init.headers = { Authorization: `Bearer ${key}` }
  else if (key) url.searchParams.set('api_key', key)
  const res = await fetchTimeout(url.toString(), init)
  if (!res.ok) throw new Error(`TMDB error ${res.status}`)
  return res.json()
}

function yearOf(date: string | null | undefined): number | null {
  if (!date) return null
  const y = Number(date.slice(0, 4))
  return Number.isFinite(y) ? y : null
}

/**
 * ONE `/search/tv` request feeds both the TV and the Anime rows: results are
 * memoized 60s and split client-side. Anime = Animation genre + east-asian
 * original language; everything else (western animation included: Arcane,
 * Castlevania, Avatar…) stays in the TV row. Every result appears in exactly
 * one row, with the same tmdb id the TV Time importer produces — no more
 * cross-provider duplicates, no AniList in the hot search path.
 */
const tvSearchCache = new Map<string, { at: number; results: any[] }>()

async function searchTvRaw(query: string): Promise<any[]> {
  const cacheKey = query.trim().toLowerCase()
  const hit = tvSearchCache.get(cacheKey)
  if (hit && Date.now() - hit.at < 60_000) return hit.results
  // en-US titles so anime/donghua show a readable English (or romaji) name
  // instead of raw Japanese/Chinese script
  const data = await tmdbFetch('/search/tv', { query, include_adult: 'false', language: 'en-US' })
  const results = (data.results ?? []) as any[]
  tvSearchCache.set(cacheKey, { at: Date.now(), results })
  if (tvSearchCache.size > 30) tvSearchCache.delete(tvSearchCache.keys().next().value as string)
  return results
}

const isAnimeResult = (r: any) =>
  Array.isArray(r.genre_ids) &&
  r.genre_ids.includes(16) &&
  ['ja', 'zh', 'ko'].includes(r.original_language)

function toTvResult(r: any, mediaType: 'tv' | 'anime'): SearchResult {
  return {
    provider: 'tmdb' as const,
    providerId: String(r.id),
    mediaType,
    title: r.name,
    year: yearOf(r.first_air_date),
    poster: tmdbImg(r.poster_path),
  }
}

export async function searchTv(query: string): Promise<SearchResult[]> {
  const results = await searchTvRaw(query)
  return results.filter((r) => !isAnimeResult(r)).slice(0, 14).map((r) => toTvResult(r, 'tv'))
}

export async function searchAnimeTmdb(query: string): Promise<SearchResult[]> {
  const results = await searchTvRaw(query)
  return results.filter(isAnimeResult).slice(0, 14).map((r) => toTvResult(r, 'anime'))
}

/**
 * BOTH live-action TV and anime from ONE TMDB search, each result tagged with
 * its own mediaType, in TMDB's relevance order — feeds the merged "Shows" row
 * so a show appears exactly once with the same tmdb id the importer produces.
 */
export async function searchShowsTmdb(query: string): Promise<SearchResult[]> {
  const results = await searchTvRaw(query)
  return results.slice(0, 20).map((r) => toTvResult(r, isAnimeResult(r) ? 'anime' : 'tv'))
}

/**
 * Normalized titles (localized + original) of ALL TMDB results for a query —
 * used to dedupe the AniList niche-title supplement, so a show TMDB already
 * lists (in either row: "Scott Pilgrim Takes Off" classifies as western TV)
 * never appears twice. Free: reads the same memoized search the rows ran.
 */
export async function tmdbTvTitleKeys(query: string): Promise<Set<string>> {
  const keys = new Set<string>()
  try {
    for (const r of await searchTvRaw(query)) {
      for (const t of [r.name, r.original_name] as (string | undefined)[]) {
        if (!t) continue
        const norm = normalizeTitle(t)
        if (norm.length > 1) keys.add(norm)
        // native-script key: matches AniList's `native` title for anime
        const loose = looseTitleKey(t)
        if (loose.length > 1) keys.add(loose)
      }
    }
  } catch {
    // key missing / TMDB down — supplement simply skips deduping
  }
  return keys
}

export async function searchMovies(query: string): Promise<SearchResult[]> {
  const data = await tmdbFetch('/search/movie', { query, include_adult: 'false', language: 'en-US' })
  return (data.results as any[]).slice(0, 14).map((r) => ({
    provider: 'tmdb' as const,
    providerId: String(r.id),
    mediaType: 'movie' as const,
    title: r.title,
    year: yearOf(r.release_date),
    poster: tmdbImg(r.poster_path),
  }))
}

function mapCast(credits: any): CastMember[] {
  const cast = (credits?.cast ?? []) as any[]
  return cast.slice(0, 15).map((c) => ({
    name: c.name,
    role: c.character ?? null,
    photo: tmdbImg(c.profile_path, 'w185'),
  }))
}

/**
 * When the requested UI language has no translation, TMDB falls back to the
 * ORIGINAL title/overview — raw Japanese/Chinese/Korean script for most anime
 * (search rows don't hit this: they force en-US). Prefer the localized text,
 * but swap in the English translation when what came back is CJK (title) or
 * empty (overview), so detail pages and the library always stay readable.
 * Requires `translations` in append_to_response.
 */
function readableText(d: any, kind: 'name' | 'title'): { title: string; overview: string | null } {
  const localized = (d[kind] as string | undefined) ?? ''
  const en = ((d.translations?.translations ?? []) as any[]).find(
    (t) => t.iso_639_1 === 'en',
  )?.data
  const enTitle = (en?.[kind] as string | undefined) ?? ''
  const title =
    (localized && !CJK_RE.test(localized) && localized) ||
    (enTitle && !CJK_RE.test(enTitle) && enTitle) ||
    localized ||
    enTitle ||
    ((d[`original_${kind}`] as string | undefined) ?? 'Unknown')
  const overview =
    ((d.overview as string | undefined) || (en?.overview as string | undefined)) ?? null
  return { title, overview }
}

/**
 * The poster the en-US search rows show: prefer the EN (or language-neutral)
 * art over the localized/original-language one, so the cover never swaps when
 * a result is added from search — one asset end to end, browser-cache warm.
 * Requires `images` in append_to_response with include_image_language=en,null.
 */
/**
 * Up to 5 stills for the detail gallery, taken from the `images` payload we
 * already fetch for the poster — zero extra requests. The hero backdrop is
 * skipped so the gallery doesn't repeat the art shown at the top of the page.
 */
function galleryOf(d: any): string[] {
  return ((d.images?.backdrops ?? []) as any[])
    .filter((b) => b.file_path && b.file_path !== d.backdrop_path)
    .map((b) => tmdbImg(b.file_path, 'w780'))
    .filter((u): u is string => !!u)
    .slice(0, 5)
}

/** TMDB keywords as descriptive tags (movies: `keywords.keywords`, tv: `.results`). */
function keywordsOf(d: any): string[] {
  return ((d.keywords?.keywords ?? d.keywords?.results ?? []) as any[])
    .map((k) => k.name as string)
    .filter(Boolean)
    .slice(0, 8)
}

function enPoster(d: any): string | null {
  const posters = (d.images?.posters ?? []) as any[]
  const file =
    posters.find((p) => p.iso_639_1 === 'en')?.file_path ??
    (posters[0]?.file_path as string | undefined)
  return tmdbImg(file ?? d.poster_path)
}

export async function tvDetails(id: string, skipAnimeScores = false): Promise<MediaDetails> {
  const d = await tmdbFetch(`/tv/${id}`, {
    append_to_response: 'credits,external_ids,translations,images,keywords',
    include_image_language: 'en,null',
  })
  const seasons = ((d.seasons ?? []) as any[])
    .filter((s) => s.season_number > 0)
    .map((s) => ({
      number: s.season_number,
      name: s.name as string,
      episodeCount: s.episode_count as number,
      poster: tmdbImg(s.poster_path),
    }))
  // anime auto-detection (genre id — language-independent): classifies the
  // library tab correctly for search results AND TV Time imports alike
  const isAnime =
    ((d.genres ?? []) as any[]).some((g) => g.id === 16) &&
    ['ja', 'zh', 'ko'].includes(d.original_language)
  const { title, overview } = readableText(d, 'name')
  return {
    id: `tmdb:${id}`,
    provider: 'tmdb',
    providerId: id,
    mediaType: isAnime ? 'anime' : 'tv',
    title,
    originalTitle: d.original_name ?? null,
    overview,
    poster: enPoster(d),
    backdrop: tmdbImg(d.backdrop_path, 'w1280'),
    year: yearOf(d.first_air_date),
    genres: ((d.genres ?? []) as any[]).map((g) => g.name),
    tags: keywordsOf(d),
    screenshots: galleryOf(d),
    totalEpisodes: seasons.reduce((a, s) => a + s.episodeCount, 0) || d.number_of_episodes || null,
    episodeRuntime: (d.episode_run_time?.[0] as number | undefined) ?? null,
    seasons,
    ongoing: (d.in_production as boolean | undefined) ?? null,
    nextReleaseDate: (d.next_episode_to_air?.air_date as string | undefined) ?? null,
    releaseDate: (d.first_air_date as string | undefined) || null,
    lastAired: d.last_episode_to_air
      ? {
          season: d.last_episode_to_air.season_number as number,
          episode: d.last_episode_to_air.episode_number as number,
        }
      : null,
    cast: mapCast(d.credits),
    airStatus: d.status ?? null,
    // anime also get the AniList/MAL community scores — skipped during bulk
    // imports (AniList throttles at ~30 req/min; scores arrive with the first
    // detail-page SWR refresh instead)
    externalRatings: [
      ...(await omdbRatings(d.external_ids?.imdb_id)),
      ...(isAnime && !skipAnimeScores ? await animeRatingsByTitle(d.original_name || d.name) : []),
    ],
  }
}

export async function movieDetails(id: string): Promise<MediaDetails> {
  const d = await tmdbFetch(`/movie/${id}`, {
    append_to_response: 'credits,translations,images,keywords',
    include_image_language: 'en,null',
  })
  const externalRatings = await omdbRatings(d.imdb_id)
  const { title, overview } = readableText(d, 'title')
  return {
    id: `tmdb:${id}`,
    provider: 'tmdb',
    providerId: id,
    mediaType: 'movie',
    title,
    originalTitle: d.original_title ?? null,
    overview,
    poster: enPoster(d),
    backdrop: tmdbImg(d.backdrop_path, 'w1280'),
    year: yearOf(d.release_date),
    genres: ((d.genres ?? []) as any[]).map((g) => g.name),
    tags: keywordsOf(d),
    screenshots: galleryOf(d),
    runtime: (d.runtime as number | undefined) ?? null,
    releaseDate: (d.release_date as string | undefined) || null,
    cast: mapCast(d.credits),
    airStatus: d.status ?? null,
    externalRatings,
  }
}

/** Resolve a TVDB / IMDb id to TMDB ids (used by the TV Time importer). */
export async function findByExternalId(
  externalId: string | number,
  source: 'tvdb_id' | 'imdb_id',
): Promise<{ tvId: string | null; movieId: string | null }> {
  const d = await tmdbFetch(`/find/${externalId}`, { external_source: source })
  return {
    tvId: d.tv_results?.[0]?.id != null ? String(d.tv_results[0].id) : null,
    movieId: d.movie_results?.[0]?.id != null ? String(d.movie_results[0].id) : null,
  }
}

/** Best-effort movie id by title (+year) for exports without external ids. */
export async function searchMovieId(title: string, year?: number | null): Promise<string | null> {
  const params: Record<string, string> = { query: title, include_adult: 'false' }
  if (year) params.primary_release_year = String(year)
  const d = await tmdbFetch('/search/movie', params)
  let id = d.results?.[0]?.id
  if (id == null && year) {
    // year mismatch in the export — retry without it
    const d2 = await tmdbFetch('/search/movie', { query: title, include_adult: 'false' })
    id = d2.results?.[0]?.id
  }
  return id != null ? String(id) : null
}

export async function seasonEpisodes(tvId: string, season: number): Promise<EpisodeInfo[]> {
  let d = await tmdbFetch(`/tv/${tvId}/season/${season}`)
  // same untranslated-fallback problem as details: when the UI language has
  // no episode translations, TMDB hands back native-script names — if most of
  // the season reads as CJK, refetch the readable en-US names instead
  const eps = (d.episodes ?? []) as any[]
  const cjkCount = eps.filter((e) => CJK_RE.test((e.name as string) ?? '')).length
  if (eps.length > 0 && cjkCount > eps.length / 2) {
    try {
      d = await tmdbFetch(`/tv/${tvId}/season/${season}`, { language: 'en-US' })
    } catch {
      // keep the localized payload
    }
  }
  return ((d.episodes ?? []) as any[]).map((e) => ({
    season,
    episode: e.episode_number as number,
    title: (e.name as string) || null,
    runtime: (e.runtime as number | undefined) ?? null,
    airDate: (e.air_date as string | undefined) ?? null,
    overview: (e.overview as string | undefined) || null,
    still: tmdbImg(e.still_path, 'w300'),
  }))
}
