/**
 * Provider dispatcher — the only entry point pages use to talk to external
 * databases. Given (provider, mediaType, providerId) it routes to the right
 * API module; getEpisodes() adds a 7-day IndexedDB cache on top.
 *
 * Providers: TMDB (tv/movies) · AniList (anime/manga) · MangaDex (chapter
 * counts) · Open Library (books) · RAWG (games) · Comic Vine (comics) ·
 * OMDb + Jikan (external ratings).
 */
import { db, getCachedEpisodes, putCachedEpisodes } from '../db'
import type { EpisodeInfo, MediaBase, MediaDetails, MediaType, Provider } from '../types'
import { anilistDetails } from './anilist'
import { comicDetails, comicvineIssueTitles } from './comicvine'
import { jikanEpisodeTitles } from './jikan'
import { mangadexChapterTitles } from './mangadex'
import { bookDetails } from './openlibrary'
import { gameDetails } from './rawg'
import { movieDetails, seasonEpisodes, tvDetails } from './tmdb'

export { ApiKeyMissingError } from './errors'
export { searchAnime, searchManga } from './anilist'
export { searchComics } from './comicvine'
export { searchBooks } from './openlibrary'
export { searchGames } from './rawg'
export { searchMovies, searchTv } from './tmdb'

function fetchDetails(
  provider: Provider,
  mediaType: MediaType,
  providerId: string,
): Promise<MediaDetails> {
  switch (provider) {
    case 'tmdb':
      return mediaType === 'movie' ? movieDetails(providerId) : tvDetails(providerId)
    case 'anilist':
      return anilistDetails(providerId, mediaType === 'anime' ? 'ANIME' : 'MANGA')
    case 'openlibrary':
      return bookDetails(providerId)
    case 'rawg':
      return gameDetails(providerId)
    case 'comicvine':
      return comicDetails(providerId)
  }
}

/** Cache older than this triggers a QUIET background revalidation. */
const REVALIDATE_TTL = 1000 * 60 * 60 * 6 // 6h

/**
 * Stale-while-revalidate details lookup:
 * - a cached entry is ALWAYS served instantly (zero wait, zero requests)
 * - when it's older than 6h, a background refetch runs and `onUpdate`
 *   delivers the fresh data (new episodes/chapters appear live) — these
 *   APIs expose no Last-Modified/ETag, so SWR is the conditional-probe
 *   equivalent: at most one refresh per title per 6h window
 * - on a cache miss the fetch is synchronous; failures fall back to any
 *   cached copy, so a rate-limited provider can't blank a detail page.
 */
export async function getDetails(
  provider: Provider,
  mediaType: MediaType,
  providerId: string,
  onUpdate?: (fresh: MediaDetails) => void,
): Promise<MediaDetails> {
  const cacheId = `${provider}:${providerId}`
  const cached = await db.detailsCache.get(cacheId)

  const revalidate = async (): Promise<MediaDetails> => {
    const details = await fetchDetails(provider, mediaType, providerId)
    const now = Date.now()
    await db.detailsCache.put({ id: details.id, details, fetchedAt: now })
    if (details.id !== cacheId) {
      // anime season-chains resolve to the root id: alias the requested id
      // too, so reopening from search doesn't re-walk the whole chain
      await db.detailsCache.put({ id: cacheId, details, fetchedAt: now })
    }
    return details
  }

  if (cached) {
    if (Date.now() - cached.fetchedAt > REVALIDATE_TTL) {
      revalidate()
        .then((fresh) => onUpdate?.(fresh))
        .catch(() => {})
    }
    return cached.details
  }
  return revalidate()
}

/**
 * Episode list for one season, cached in IndexedDB for 7 days.
 * TMDB has real per-episode data. AniList anime titles come from Jikan/MAL
 * (per-season malId), manga chapter titles from MangaDex — all best-effort,
 * falling back to numbered "Episode N" / "Ch. N" units.
 */
/** Untitled cached lists get ONE title-fetch retry per session, not per open. */
const titleRetryDone = new Set<string>()

export async function getEpisodes(item: MediaBase, season: number): Promise<EpisodeInfo[]> {
  const cacheKey = `${item.id}:${season}`
  const cached = await getCachedEpisodes(item.id, season)
  const cacheOk =
    cached &&
    cached.length > 0 &&
    (item.provider === 'tmdb' || cached.some((e) => e.title) || titleRetryDone.has(cacheKey))
  if (cacheOk) return cached
  titleRetryDone.add(cacheKey)

  let episodes: EpisodeInfo[] = []
  if (item.provider === 'tmdb') {
    episodes = await seasonEpisodes(item.providerId, season)
  } else {
    const s = item.seasons?.find((x) => x.number === season)
    const count = s?.episodeCount ?? item.totalEpisodes ?? 0
    let titles = new Map<number, string>()
    if (item.mediaType === 'anime' && s?.malId) {
      titles = await jikanEpisodeTitles(s.malId, count)
    } else if (item.mediaType === 'manga' && item.provider === 'comicvine') {
      titles = await comicvineIssueTitles(item.providerId, count)
    } else if (item.mediaType === 'manga' && item.mangadexId) {
      titles = await mangadexChapterTitles(item.mangadexId)
    }
    episodes = Array.from({ length: count }, (_, i) => ({
      season,
      episode: i + 1,
      title: titles.get(i + 1) ?? null,
      runtime: item.episodeRuntime ?? null,
    }))
  }
  if (episodes.length > 0) await putCachedEpisodes(item.id, season, episodes)
  return episodes ?? []
}
