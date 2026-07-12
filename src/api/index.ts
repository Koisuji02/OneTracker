/**
 * Provider dispatcher — the only entry point pages use to talk to external
 * databases. Given (provider, mediaType, providerId) it routes to the right
 * API module; getEpisodes() adds a 7-day IndexedDB cache on top.
 *
 * Providers: TMDB (tv/movies) · AniList (anime/manga) · MangaDex (chapter
 * counts) · Open Library (books) · RAWG (games) · Comic Vine (comics) ·
 * OMDb + Jikan (external ratings).
 */
import { getCachedEpisodes, putCachedEpisodes } from '../db'
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

export function getDetails(
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

/**
 * Episode list for one season, cached in IndexedDB for 7 days.
 * TMDB has real per-episode data. AniList anime titles come from Jikan/MAL
 * (per-season malId), manga chapter titles from MangaDex — all best-effort,
 * falling back to numbered "Episode N" / "Ch. N" units.
 */
export async function getEpisodes(item: MediaBase, season: number): Promise<EpisodeInfo[]> {
  const cached = await getCachedEpisodes(item.id, season)
  // generated lists cached before title support (all-untitled) get one retry
  const cacheOk =
    cached && cached.length > 0 && (item.provider === 'tmdb' || cached.some((e) => e.title))
  if (cacheOk) return cached

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
