export type MediaType = 'tv' | 'anime' | 'movie' | 'book' | 'manga' | 'game'
export type Provider =
  | 'tmdb'
  | 'anilist'
  | 'mangadex'
  | 'openlibrary'
  | 'rawg'
  | 'comicvine'
  /** games via the API gateway (better data than rawg) */
  | 'igdb'
export type ItemStatus = 'planned' | 'watching' | 'completed'

/** A critic/community score fetched from an external source (IMDb, MAL, …). */
export interface ExternalRating {
  /** stable identifier, drives the banner style (imdb, rt, metacritic, mal, anilist, openlibrary, rawg) */
  source: string
  label: string
  score: string
}

/**
 * How long a game takes, in HOURS — the three HowLongToBeat styles plus where
 * the numbers came from. The stats build on this, so it travels with the item
 * (see `LibraryItem.myPlaytime` for the personal override).
 */
/**
 * One FINISHED playthrough of a game, with the time counted for that run.
 *
 * `hours: null` means "count the how-long-to-beat time", so the run keeps
 * following HLTB if the numbers are refreshed; a number is what the user typed
 * for THAT run. One entry per run is what makes removing a replay able to
 * remove exactly its own time.
 */
export interface GamePlaythrough {
  hours: number | null
  /** when the run was recorded (ms) */
  at: number
}

export interface GameLength {
  /** main story */
  main?: number | null
  /** main story + extras */
  plus?: number | null
  /** completionist (100%) */
  full?: number | null
  /** hltb = HowLongToBeat · igdb = IGDB time-to-beat · rawg = RAWG average */
  source: 'hltb' | 'igdb' | 'rawg'
  /** how many players submitted times (confidence signal, HLTB/IGDB) */
  samples?: number | null
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
  /** games: the length used everywhere (hours) — `timeToBeat`'s main story */
  playtime?: number | null
  /** games: full "how long to beat" breakdown behind `playtime` */
  timeToBeat?: GameLength | null
  authors?: string[]
  /** still airing / releasing new chapters */
  ongoing?: boolean | null
  /** tv/anime: air date of the next scheduled episode (ISO) */
  nextReleaseDate?: string | null
  /** tv/anime: last episode that actually aired — units past it are locked */
  lastAired?: { season: number; episode: number } | null
  /** manga: publish date of the latest released chapter (ISO) */
  lastReleaseDate?: string | null
  /** movies/games/tv: release date (ISO) — used to park unreleased items in "Waiting" and lock marking */
  releaseDate?: string | null
  /** manga: MangaDex id, used for chapter titles */
  mangadexId?: string | null
  /** games: RAWG parent-platform slugs (pc, playstation, xbox, nintendo…) */
  platforms?: string[]
  /** descriptive tags beyond genres (RAWG tags, TMDB keywords, MangaDex themes) */
  tags?: string[]
  /** up to 5 stills/screenshots/volume covers shown in the detail gallery */
  screenshots?: string[]
}

export interface MediaDetails extends MediaBase {
  cast?: CastMember[]
  airStatus?: string | null
  externalRatings?: ExternalRating[]
}

export interface LibraryItem extends MediaBase {
  status: ItemStatus
  favorite: boolean
  /** tucked away in the Archive: hidden from the 4 media tabs and the catalog */
  archived?: boolean
  /** marked as personally owned (key badge); orthogonal flag, its own catalog box */
  owned?: boolean
  addedAt: number
  completedAt?: number | null
  /** legacy (pre-v3): manga chapters counter — now stored as episode rows */
  chaptersRead?: number
  lastReadAt?: number | null
  /**
   * games: one entry per finished playthrough — the SOURCE OF TRUTH for both
   * the time counted and `watchCount`, which is derived from it. Always written
   * as an array (an empty one = never finished), see db.gamePlaythroughs.
   */
  playthroughs?: GamePlaythrough[]
  /**
   * @deprecated games: one manual total for the whole game. Replaced by
   * `playthroughs` in db v8; only still read to migrate old rows and backups.
   */
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
