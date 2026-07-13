import { fetchTimeout } from './http'
import { getSettings } from '../settings'
import type { CastMember, EpisodeInfo, MediaDetails, SearchResult } from '../types'
import { animeTitleKeys, matchesTitleSet } from './anilist'
import { ApiKeyMissingError } from './errors'
import { omdbRatings } from './ratings'

const API = 'https://api.themoviedb.org/3'
const IMG = 'https://image.tmdb.org/t/p/'

export function tmdbImg(path: string | null | undefined, size = 'w342'): string | null {
  return path ? `${IMG}${size}${path}` : null
}

async function tmdbFetch(path: string, params: Record<string, string> = {}): Promise<any> {
  const key = getSettings().tmdbKey.trim()
  if (!key) throw new ApiKeyMissingError('tmdb')
  const url = new URL(API + path)
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)
  url.searchParams.set('language', getSettings().language === 'it' ? 'it-IT' : 'en-US')
  const init: RequestInit = {}
  // v4 read access token vs v3 api key
  if (key.startsWith('ey')) init.headers = { Authorization: `Bearer ${key}` }
  else url.searchParams.set('api_key', key)
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
 * Anime has its own tab, so animated results are dropped from the TV row when
 * they look like anime: east-asian original language OR a title matching an
 * AniList anime result for the same query (memoized — shared with the Anime
 * row, zero extra requests). The Animation-genre guard keeps live-action
 * adaptations (e.g. Netflix's One Piece) in the TV row.
 */
export async function searchTv(query: string): Promise<SearchResult[]> {
  const [data, animeTitles] = await Promise.all([
    tmdbFetch('/search/tv', { query, include_adult: 'false' }),
    animeTitleKeys(query),
  ])
  const isAnime = (r: any) =>
    Array.isArray(r.genre_ids) &&
    r.genre_ids.includes(16) &&
    (['ja', 'zh', 'ko'].includes(r.original_language) ||
      matchesTitleSet(r.name ?? '', animeTitles))
  return (data.results as any[])
    .filter((r) => !isAnime(r))
    .slice(0, 14)
    .map((r) => ({
    provider: 'tmdb' as const,
    providerId: String(r.id),
    mediaType: 'tv' as const,
    title: r.name,
    year: yearOf(r.first_air_date),
    poster: tmdbImg(r.poster_path),
  }))
}

export async function searchMovies(query: string): Promise<SearchResult[]> {
  const data = await tmdbFetch('/search/movie', { query, include_adult: 'false' })
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

export async function tvDetails(id: string): Promise<MediaDetails> {
  const d = await tmdbFetch(`/tv/${id}`, { append_to_response: 'credits,external_ids' })
  const seasons = ((d.seasons ?? []) as any[])
    .filter((s) => s.season_number > 0)
    .map((s) => ({
      number: s.season_number,
      name: s.name as string,
      episodeCount: s.episode_count as number,
      poster: tmdbImg(s.poster_path),
    }))
  return {
    id: `tmdb:${id}`,
    provider: 'tmdb',
    providerId: id,
    mediaType: 'tv',
    title: d.name,
    originalTitle: d.original_name ?? null,
    overview: d.overview || null,
    poster: tmdbImg(d.poster_path),
    backdrop: tmdbImg(d.backdrop_path, 'w1280'),
    year: yearOf(d.first_air_date),
    genres: ((d.genres ?? []) as any[]).map((g) => g.name),
    totalEpisodes: seasons.reduce((a, s) => a + s.episodeCount, 0) || d.number_of_episodes || null,
    episodeRuntime: (d.episode_run_time?.[0] as number | undefined) ?? null,
    seasons,
    ongoing: (d.in_production as boolean | undefined) ?? null,
    nextReleaseDate: (d.next_episode_to_air?.air_date as string | undefined) ?? null,
    cast: mapCast(d.credits),
    airStatus: d.status ?? null,
    externalRatings: await omdbRatings(d.external_ids?.imdb_id),
  }
}

export async function movieDetails(id: string): Promise<MediaDetails> {
  const d = await tmdbFetch(`/movie/${id}`, { append_to_response: 'credits' })
  const externalRatings = await omdbRatings(d.imdb_id)
  return {
    id: `tmdb:${id}`,
    provider: 'tmdb',
    providerId: id,
    mediaType: 'movie',
    title: d.title,
    originalTitle: d.original_title ?? null,
    overview: d.overview || null,
    poster: tmdbImg(d.poster_path),
    backdrop: tmdbImg(d.backdrop_path, 'w1280'),
    year: yearOf(d.release_date),
    genres: ((d.genres ?? []) as any[]).map((g) => g.name),
    runtime: (d.runtime as number | undefined) ?? null,
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
  const d = await tmdbFetch(`/tv/${tvId}/season/${season}`)
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
