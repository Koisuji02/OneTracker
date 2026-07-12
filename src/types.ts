export type MediaType = 'tv' | 'anime' | 'movie' | 'book' | 'manga' | 'game'
export type Provider = 'tmdb' | 'anilist' | 'openlibrary' | 'rawg' | 'comicvine'
export type ItemStatus = 'planned' | 'watching' | 'completed'

/** A critic/community score fetched from an external source (IMDb, MAL, …). */
export interface ExternalRating {
  /** stable identifier, drives the banner style (imdb, rt, metacritic, mal, anilist, openlibrary, rawg) */
  source: string
  label: string
  score: string
}

export interface Season {
  number: number
  name?: string
  episodeCount: number
  poster?: string | null
  /** AniList season chains: MyAnimeList id of this season (for episode titles) */
  malId?: number | null
}

export interface EpisodeInfo {
  season: number
  episode: number
  title?: string | null
  runtime?: number | null // minutes
  airDate?: string | null
  overview?: string | null
  still?: string | null
}

export interface CastMember {
  name: string
  role?: string | null
  photo?: string | null
}

/** Shared metadata shape for anything coming from a provider. */
export interface MediaBase {
  /** `${provider}:${providerId}` */
  id: string
  provider: Provider
  providerId: string
  mediaType: MediaType
  title: string
  originalTitle?: string | null
  overview?: string | null
  poster?: string | null
  backdrop?: string | null
  year?: number | null
  genres?: string[]
  // episodic (tv / anime)
  totalEpisodes?: number | null
  episodeRuntime?: number | null // avg minutes per episode
  seasons?: Season[]
  // single media
  runtime?: number | null // movie minutes
  pages?: number | null // book pages / manga chapters
  playtime?: number | null // game avg hours (from provider)
  authors?: string[]
  /** still airing / releasing new chapters */
  ongoing?: boolean | null
  /** tv/anime: air date of the next scheduled episode (ISO) */
  nextReleaseDate?: string | null
  /** manga: publish date of the latest released chapter (ISO) */
  lastReleaseDate?: string | null
  /** manga: MangaDex id, used for chapter titles */
  mangadexId?: string | null
  /** games: RAWG parent-platform slugs (pc, playstation, xbox, nintendo…) */
  platforms?: string[]
}

export interface MediaDetails extends MediaBase {
  cast?: CastMember[]
  airStatus?: string | null
  externalRatings?: ExternalRating[]
}

export interface LibraryItem extends MediaBase {
  status: ItemStatus
  favorite: boolean
  addedAt: number
  completedAt?: number | null
  /** legacy (pre-v3): manga chapters counter — now stored as episode rows */
  chaptersRead?: number
  lastReadAt?: number | null
  /** games: personal hours played (overrides provider playtime in stats) */
  myPlaytime?: number | null
  /** personal 0–10 rating, one decimal (null/undefined = not rated) */
  rating?: number | null
  /** movies/books/games: how many times consumed (1 = watched once, 2 = one rewatch…) */
  watchCount?: number
}

/**
 * One watched unit: a TV/anime episode or a manga/comic chapter
 * (chapters are stored as season 1 episodes).
 */
export interface WatchedEpisode {
  /** `${itemId}:${season}:${episode}` */
  id: string
  itemId: string
  season: number
  episode: number
  watchedAt: number
  runtime?: number | null
  /** times watched: 1 = seen once, 2 = rewatched once (x2)… */
  count?: number
}

/** A user-created named list of library items, with a display color. */
export interface WatchList {
  id: string
  name: string
  color: string
  itemIds: string[]
  createdAt: number
  /** last content change — the profile preview shows the most recent list */
  updatedAt?: number
}

export interface SearchResult {
  provider: Provider
  providerId: string
  mediaType: MediaType
  title: string
  year?: number | null
  poster?: string | null
}

export interface EpisodeCacheEntry {
  /** `${itemId}:${season}` */
  id: string
  itemId: string
  season: number
  episodes: EpisodeInfo[]
  fetchedAt: number
}
