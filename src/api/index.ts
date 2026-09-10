/**
 * Provider dispatcher — the only entry point pages use to talk to external
 * databases. Given (provider, mediaType, providerId) it routes to the right
 * API module; getEpisodes() adds a 7-day IndexedDB cache on top.
 *
 * Providers: TMDB (tv/movies) · AniList (anime/manga) · MangaDex (chapter
 * counts) · Open Library (books) · RAWG (games) · Comic Vine (comics) ·
 * OMDb + Jikan (external ratings).
 */
import { db, putCachedEpisodes } from '../db'
import { isOnline } from '../net'
import type { EpisodeInfo, MediaBase, MediaDetails, MediaType, Provider, SearchResult } from '../types'
import {
  anilistDetails,
  anilistMangaTitleKeys,
  searchAnime as searchAnimeAnilist,
  searchAnimeExtras,
  searchManga as searchMangaAnilist,
} from './anilist'
import { comicDetails, comicvineIssueTitles, searchComics } from './comicvine'
import { ApiKeyMissingError } from './errors'
import { igdbAvailable, igdbDetails, searchGamesIgdb } from './igdb'
import { jikanEpisodeTitles } from './jikan'
import { mangadexChapterTitles, mangadexDetails, searchManga as searchMangaMangadex } from './mangadex'
import { bookDetails, searchBooks } from './openlibrary'
import { gameDetails, searchGames as searchGamesRawg } from './rawg'
import { CJK_RE, dedupeKey, looseTitleKey, matchesTitleSet, normalizeTitle } from './titleMatch'
import { movieDetails, searchShowsTmdb, seasonEpisodes, tmdbTvTitleKeys, tvDetails } from './tmdb'

export { ApiKeyMissingError } from './errors'
export { searchMovies } from './tmdb'

/**
 * Games come from IGDB when the API gateway is configured (richer data: real
 * box art, screenshots, themes) and from RAWG otherwise. RAWG stays the
 * fallback if an IGDB query fails, so the row never goes empty.
 */
export async function searchGames(query: string): Promise<SearchResult[]> {
  if (igdbAvailable()) {
    try {
      const r = await searchGamesIgdb(query)
      if (r.length > 0) return r
    } catch {
      // fall through to RAWG
    }
  }
  return searchGamesRawg(query)
}

/**
 * "Shows" row = live-action TV AND anime in ONE row. A single TMDB search
 * feeds it (each result tagged tv or anime, importer-compatible ids, titled
 * posters), then an AniList tail adds niche anime TMDB doesn't index (short
 * ONAs, donghua, announcements) — kept only when they don't already match a
 * TMDB result. Dedupe is separator-insensitive so "Hunter x Hunter" and
 * "HunterxHunter" collapse to one. Without a TMDB key it degrades to keyless
 * AniList anime.
 */
export async function searchShows(query: string): Promise<SearchResult[]> {
  let primary: SearchResult[] = []
  try {
    primary = await searchShowsTmdb(query)
  } catch (err) {
    if (!(err instanceof ApiKeyMissingError)) throw err
    return searchAnimeAnilist(query)
  }
  const extras = await searchAnimeExtras(query, await tmdbTvTitleKeys(query))

  // Dedupe within a media TYPE only, so a live-action show and its anime with
  // the same name (One Piece 2023 tv vs One Piece 1999 anime) BOTH survive —
  // and year-aware, so two DIFFERENT productions of the same type sharing a
  // title (Avatar TLA 2005 cartoon vs 2024 live action, both 'tv') survive too.
  const deduped = dedupeSameWork([...primary, ...extras], (r) => {
    const base = looseTitleKey(r.title)
    return base ? `${r.mediaType}:${base}` : ''
  })
  // Group same-title results together at their first (most-relevant) position,
  // and within a group show the ANIME first — it's the original work.
  const groupAt = new Map<string, number>()
  deduped.forEach((r, i) => {
    const base = looseTitleKey(r.title)
    if (base && !groupAt.has(base)) groupAt.set(base, i)
  })
  const typeRank = (t: string) => (t === 'anime' ? 0 : 1)
  return deduped
    .map((r, i) => ({ r, i, base: looseTitleKey(r.title) }))
    .sort((a, b) => {
      const ga = a.base ? groupAt.get(a.base)! : a.i
      const gb = b.base ? groupAt.get(b.base)! : b.i
      return ga - gb || typeRank(a.r.mediaType) - typeRank(b.r.mediaType) || a.i - b.i
    })
    .map((x) => x.r)
    .slice(0, 20)
}

/**
 * AniList is the manga SEARCH source: fast GraphQL, popularity-aware ranking
 * and covers on s4.anilist.co (reachable on networks that DNS-block MangaDex,
 * where covers went blank). MangaDex remains the fallback when AniList is
 * down/throttled, and stays the chapter/ratings enrichment at detail time.
 */
async function searchMangaResilient(query: string): Promise<SearchResult[]> {
  try {
    const r = await searchMangaAnilist(query)
    if (r.length > 0) return r
  } catch {
    // AniList down or 429-exhausted — fall through to MangaDex
  }
  try {
    return await searchMangaMangadex(query)
  } catch {
    return []
  }
}

/**
 * "Books" row = manga + western comics + books in ONE row, mirroring the
 * library's Books tab. Priority on conflicts is manga > comics > books: a work
 * that exists as a manga is never also shown as a comic run or a book edition,
 * and comics win over books. Every source is best-effort (a missing Comic Vine
 * key or a down provider just contributes nothing), and the dedupe strips
 * volume/tome tails so single volumes never appear next to the aggregated
 * series — chapters live inside the detail page, not as separate rows.
 * The manga-out-of-comics/books filtering happens HERE, on the manga row's
 * own results (plus the memoized AniList synonyms): no extra provider call
 * may gate the row — a hung MangaDex used to hold Libri hostage for 10s+.
 */
export async function searchReading(query: string): Promise<SearchResult[]> {
  const [mangaR, comicsR, booksR, synKeysR] = await Promise.allSettled([
    searchMangaResilient(query),
    searchComics(query),
    searchBooks(query),
    anilistMangaTitleKeys(query),
  ])
  const manga = mangaR.status === 'fulfilled' ? mangaR.value : []
  const mangaKeys = synKeysR.status === 'fulfilled' ? synKeysR.value : new Set<string>()
  for (const r of manga) mangaKeys.add(normalizeTitle(r.title))
  const dropManga = (r: SearchResult) => matchesTitleSet(r.title, mangaKeys)
  const comics = (comicsR.status === 'fulfilled' ? comicsR.value : []).filter((r) => !dropManga(r))
  const books = (booksR.status === 'fulfilled' ? booksR.value : []).filter((r) => !dropManga(r))
  return dedupeSameWork([...manga, ...comics, ...books], (r) => dedupeKey(r.title)).slice(0, 24)
}

/**
 * Keep the first result for each key ('' key = always kept) — UNLESS the years
 * disagree by more than one: same title + same key but far-apart years means
 * two different works (Urasawa's "Monster" vs a 2020s manhwa "Monster"), which
 * must both stay. A missing year on either side collapses (provider gaps).
 */
function dedupeSameWork(
  results: SearchResult[],
  keyOf: (r: SearchResult) => string,
): SearchResult[] {
  const seen = new Map<string, Array<number | null>>()
  const out: SearchResult[] = []
  for (const r of results) {
    const k = keyOf(r)
    if (k) {
      const years = seen.get(k)
      const y = r.year ?? null
      if (years?.some((prev) => prev == null || y == null || Math.abs(prev - y) <= 1)) continue
      if (years) years.push(y)
      else seen.set(k, [y])
    }
    out.push(r)
  }
  return out
}

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
    case 'mangadex':
      return mangadexDetails(providerId)
    case 'openlibrary':
      return bookDetails(providerId)
    case 'rawg':
      return gameDetails(providerId)
    case 'igdb':
      return igdbDetails(providerId)
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
/** Bump when cached payloads must be re-derived (v2: CJK-title EN fallback). */
const CACHE_V = 2

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
    await db.detailsCache.put({ id: details.id, details, fetchedAt: now, v: CACHE_V })
    if (details.id !== cacheId) {
      // anime season-chains resolve to the root id: alias the requested id
      // too, so reopening from search doesn't re-walk the whole chain
      await db.detailsCache.put({ id: cacheId, details, fetchedAt: now, v: CACHE_V })
    }
    return details
  }

  if (cached) {
    // entries cached before the CJK-title fix hold raw Japanese titles that
    // then leak into the library — refetch those NOW instead of after the
    // 6h SWR window (once: the rewrite stamps the current version)
    if ((cached.v ?? 1) < CACHE_V && CJK_RE.test(cached.details.title)) {
      try {
        return await revalidate()
      } catch {
        return cached.details
      }
    }
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
 * Episode list for one season, cached in IndexedDB.
 * TMDB has real per-episode data. AniList anime titles come from Jikan/MAL
 * (per-season malId), manga chapter titles from MangaDex — all best-effort,
 * falling back to numbered "Episode N" / "Ch. N" units.
 */
/** Untitled cached lists get ONE title-fetch retry per session, not per open. */
const titleRetryDone = new Set<string>()
/** Seasons being quietly revalidated right now (never twice at once). */
const revalidatingSeasons = new Set<string>()

/**
 * How long a cached season list is trusted without a second look.
 *
 * A finished work's episode list is immutable — refetching it is pure waste.
 * A work that is still AIRING grows: a new episode (and its air date) shows up
 * every week, and the app has to notice on its own, or a title stays in
 * "Waiting" until the user happens to open its detail page.
 */
const SEASON_TTL_ONGOING = 1000 * 60 * 60 * 12
const SEASON_TTL_DONE = 1000 * 60 * 60 * 24 * 7

async function fetchEpisodes(item: MediaBase, season: number): Promise<EpisodeInfo[]> {
  if (item.provider === 'tmdb') return seasonEpisodes(item.providerId, season)
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
  return Array.from({ length: count }, (_, i) => ({
    season,
    episode: i + 1,
    title: titles.get(i + 1) ?? null,
    runtime: item.episodeRuntime ?? null,
  }))
}

export async function getEpisodes(item: MediaBase, season: number): Promise<EpisodeInfo[]> {
  const cacheKey = `${item.id}:${season}`
  const entry = await db.episodeCache.get(cacheKey)
  const cached = entry?.episodes ?? null
  const cacheOk =
    cached &&
    cached.length > 0 &&
    (item.provider === 'tmdb' || cached.some((e) => e.title) || titleRetryDone.has(cacheKey))
  if (cacheOk) {
    // stale-while-revalidate: answer instantly from the cache, and when the
    // list is old enough for a still-running show, refresh it in the
    // background — the new episode then appears (and unlocks) by itself
    const ttl = item.ongoing ? SEASON_TTL_ONGOING : SEASON_TTL_DONE
    if (
      isOnline() &&
      !revalidatingSeasons.has(cacheKey) &&
      Date.now() - (entry?.fetchedAt ?? 0) > ttl
    ) {
      revalidatingSeasons.add(cacheKey)
      fetchEpisodes(item, season)
        .then((fresh) => {
          if (fresh.length > 0) return putCachedEpisodes(item.id, season, fresh)
        })
        .catch(() => {})
        .finally(() => revalidatingSeasons.delete(cacheKey))
    }
    return cached
  }
  titleRetryDone.add(cacheKey)

  const episodes = await fetchEpisodes(item, season)
  if (episodes.length > 0) await putCachedEpisodes(item.id, season, episodes)
  return episodes ?? []
}
