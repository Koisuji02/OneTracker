/**
 * AniList (graphql.anilist.co, keyless) — the reference database for anime
 * and manga.
 *
 * AniList models every anime season as a SEPARATE media entry (Fire Force,
 * Fire Force 2, …), linked through PREQUEL/SEQUEL relations. OneTracker
 * aggregates the whole chain into ONE library item with real seasons:
 *   1. from the opened entry, walk PREQUEL links up to the first season (root)
 *   2. from the root, walk SEQUEL links down, one season per TV/ONA entry
 * The item id is always `anilist:<rootId>` so any season the user opens from
 * search resolves to the same library entry.
 *
 * For ongoing manga, chapter counts come from MangaDex (see mangadex.ts).
 */
import type { MediaDetails, SearchResult, Season } from '../types'
import { mangadexFind, mangadexLatest } from './mangadex'
import { anilistRating, malRating } from './ratings'

const API = 'https://graphql.anilist.co'

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/**
 * GraphQL client with 429 backoff: AniList rate-limits aggressively
 * (~30 req/min) and season-chain walks fire several queries in a row.
 */
async function gql(
  query: string,
  variables: Record<string, unknown>,
  attempt = 0,
): Promise<any> {
  const res = await fetch(API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ query, variables }),
  })
  if (res.status === 429 && attempt < 4) {
    const retryAfter = Number(res.headers.get('retry-after'))
    await sleep(Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : (attempt + 1) * 1500)
    return gql(query, variables, attempt + 1)
  }
  if (!res.ok) throw new Error(`AniList error ${res.status}`)
  const json = await res.json()
  if (json.errors?.length) throw new Error(json.errors[0].message)
  return json.data
}

function stripHtml(s: string | null | undefined): string | null {
  if (!s) return null
  return s
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .trim()
}

function pickTitle(t: { english?: string | null; romaji?: string | null } | null | undefined): string {
  return t?.english || t?.romaji || 'Unknown'
}

// ------------------------------------------------------------------ search

const SEARCH_QUERY = `
query ($q: String, $type: MediaType) {
  Page(perPage: 14) {
    media(search: $q, type: $type, sort: SEARCH_MATCH) {
      id
      title { romaji english }
      coverImage { large }
      startDate { year }
    }
  }
}`

/** Raw search results, memoized 60s — shared by the Manga row and the
 *  Comics cross-filter so the same query costs one AniList request. */
const searchCache = new Map<string, { at: number; media: any[] }>()

async function searchMedia(q: string, type: 'ANIME' | 'MANGA'): Promise<any[]> {
  const cacheKey = `${type}:${q.trim().toLowerCase()}`
  const hit = searchCache.get(cacheKey)
  if (hit && Date.now() - hit.at < 60_000) return hit.media
  const data = await gql(SEARCH_QUERY, { q, type })
  const media = data.Page.media as any[]
  searchCache.set(cacheKey, { at: Date.now(), media })
  if (searchCache.size > 30) searchCache.delete(searchCache.keys().next().value as string)
  return media
}

async function search(q: string, type: 'ANIME' | 'MANGA'): Promise<SearchResult[]> {
  const media = await searchMedia(q, type)
  return media.map((m) => ({
    provider: 'anilist' as const,
    providerId: String(m.id),
    mediaType: type === 'ANIME' ? ('anime' as const) : ('manga' as const),
    title: pickTitle(m.title),
    year: m.startDate?.year ?? null,
    poster: m.coverImage?.large ?? null,
  }))
}

function normalizeTitle(t: string): string {
  return t
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

/** Normalized titles (romaji + english) of manga matching a query —
 *  used to keep manga out of the Comics search row. */
export async function mangaTitleKeys(q: string): Promise<Set<string>> {
  try {
    const media = await searchMedia(q, 'MANGA')
    const keys = new Set<string>()
    for (const m of media) {
      for (const t of [m.title?.romaji, m.title?.english]) {
        if (t) keys.add(normalizeTitle(t))
      }
    }
    return keys
  } catch {
    return new Set()
  }
}

export { normalizeTitle }

export function searchAnime(q: string): Promise<SearchResult[]> {
  return search(q, 'ANIME')
}

export function searchManga(q: string): Promise<SearchResult[]> {
  return search(q, 'MANGA')
}

// -------------------------------------------------- anime season-chain walk

/** Lightweight node used to walk the PREQUEL/SEQUEL chain. */
interface ChainNode {
  id: number
  idMal: number | null
  format: string | null
  status: string | null
  episodes: number | null
  duration: number | null
  title: { romaji?: string | null; english?: string | null } | null
  nextAiringEpisode: { episode: number; airingAt: number } | null
  relations: any
}

const NODE_QUERY = `
query ($id: Int) {
  Media(id: $id, type: ANIME) {
    id
    idMal
    format
    status
    episodes
    duration
    title { romaji english }
    nextAiringEpisode { episode airingAt }
    relations { edges { relationType node { id type format } } }
  }
}`

/** Only these formats count as "a season" of the same show. */
const SEASON_FORMATS = new Set(['TV', 'ONA', 'TV_SHORT'])

const nodeCache = new Map<number, ChainNode>()

async function fetchNode(id: number): Promise<ChainNode> {
  const cached = nodeCache.get(id)
  if (cached) return cached
  const data = await gql(NODE_QUERY, { id })
  const node = data.Media as ChainNode
  nodeCache.set(id, node)
  return node
}

/**
 * A related entry counts as "a season" only if it looks like one: TV-like
 * format AND either still airing/announced or at least 4 episodes. This
 * rejects one-shot specials that AniList links as PREQUEL/SEQUEL (e.g.
 * "MONSTERS" — a 1-episode ONA marked as prequel of One Piece).
 */
function isSeasonNode(n: ChainNode): boolean {
  if (!SEASON_FORMATS.has(n.format ?? '')) return false
  if (n.status === 'RELEASING' || n.status === 'NOT_YET_RELEASED') return true
  return (n.episodes ?? 0) >= 4
}

/** First valid season among the PREQUEL/SEQUEL edges of a node. */
async function relatedSeason(
  node: ChainNode,
  type: 'PREQUEL' | 'SEQUEL',
  visited: Set<number>,
): Promise<ChainNode | null> {
  const candidates = ((node.relations?.edges ?? []) as any[])
    .filter(
      (e) =>
        e.relationType === type &&
        e.node?.type === 'ANIME' &&
        SEASON_FORMATS.has(e.node?.format),
    )
    .map((e) => e.node.id as number)
  for (const id of candidates) {
    if (visited.has(id)) continue
    const candidate = await fetchNode(id)
    if (isSeasonNode(candidate)) return candidate
  }
  return null
}

/** Walk PREQUEL links up to season 1. */
async function resolveRoot(id: number): Promise<ChainNode> {
  let cur = await fetchNode(id)
  const visited = new Set([cur.id])
  for (let hop = 0; hop < 20; hop++) {
    const prev = await relatedSeason(cur, 'PREQUEL', visited)
    if (!prev) break
    visited.add(prev.id)
    cur = prev
  }
  return cur
}

/** Walk SEQUEL links down from the root, building the season chain. */
async function buildChain(root: ChainNode): Promise<ChainNode[]> {
  const chain: ChainNode[] = [root]
  const visited = new Set([root.id])
  let cur = root
  for (let hop = 0; hop < 20; hop++) {
    const next = await relatedSeason(cur, 'SEQUEL', visited)
    if (!next) break
    visited.add(next.id)
    cur = next
    chain.push(cur)
  }
  return chain
}

/** Episodes released so far for one chain node (aired count while airing). */
function airedEpisodesOf(node: ChainNode): number {
  return node.episodes ?? (node.nextAiringEpisode ? node.nextAiringEpisode.episode - 1 : 0)
}

// ----------------------------------------------------------------- details

const FULL_QUERY = `
query ($id: Int, $type: MediaType) {
  Media(id: $id, type: $type) {
    id
    title { romaji english }
    coverImage { extraLarge large }
    bannerImage
    description(asHtml: false)
    startDate { year }
    episodes
    duration
    chapters
    genres
    status
    averageScore
    idMal
    nextAiringEpisode { episode airingAt }
    characters(sort: ROLE, perPage: 12) {
      edges {
        role
        node { name { full } image { large } }
      }
    }
  }
}`

function mapCharacters(m: any) {
  return ((m.characters?.edges ?? []) as any[]).map((e) => ({
    name: e.node?.name?.full ?? '',
    role: e.role === 'MAIN' ? 'Main' : 'Supporting',
    photo: e.node?.image?.large ?? null,
  }))
}

async function animeDetails(id: string): Promise<MediaDetails> {
  const entry = await fetchNode(Number(id))

  // movies/specials stay standalone — only TV-like entries get aggregated
  const isSeries = SEASON_FORMATS.has(entry.format ?? '')
  const root = isSeries ? await resolveRoot(entry.id) : entry
  const chain = isSeries ? await buildChain(root) : [entry]

  const full = (await gql(FULL_QUERY, { id: root.id, type: 'ANIME' })).Media

  const seasons: Season[] = chain
    .map((n, i) => ({
      number: i + 1,
      name: pickTitle(n.title),
      episodeCount: airedEpisodesOf(n),
      poster: null,
      malId: n.idMal ?? null,
    }))
    .filter((s) => s.episodeCount > 0)

  const airing = chain.find((n) => n.nextAiringEpisode)
  const ongoing = chain.some((n) => n.status === 'RELEASING')

  return {
    id: `anilist:${root.id}`,
    provider: 'anilist',
    providerId: String(root.id),
    mediaType: 'anime',
    title: pickTitle(full.title),
    originalTitle: full.title?.romaji ?? null,
    overview: stripHtml(full.description),
    poster: full.coverImage?.extraLarge ?? full.coverImage?.large ?? null,
    backdrop: full.bannerImage ?? null,
    year: full.startDate?.year ?? null,
    genres: (full.genres ?? []) as string[],
    totalEpisodes: seasons.reduce((a, s) => a + s.episodeCount, 0) || airedEpisodesOf(entry) || null,
    episodeRuntime: full.duration ?? chain.find((n) => n.duration)?.duration ?? null,
    seasons,
    ongoing,
    nextReleaseDate: airing?.nextAiringEpisode
      ? new Date(airing.nextAiringEpisode.airingAt * 1000).toISOString()
      : null,
    cast: mapCharacters(full),
    airStatus: full.status ?? null,
    externalRatings: [
      ...anilistRating(full.averageScore),
      ...(await malRating(full.idMal, 'anime')),
    ],
  }
}

async function mangaDetails(id: string): Promise<MediaDetails> {
  const m = (await gql(FULL_QUERY, { id: Number(id), type: 'MANGA' })).Media
  const ongoing = m.status === 'RELEASING'

  // MangaDex enrichment: id (chapter titles) always; released-chapter count
  // and latest date only when the work is still releasing.
  const mangadexId = await mangadexFind(id, m.title?.romaji ?? m.title?.english ?? '')
  let chapters: number | null = m.chapters ?? null
  let lastReleaseDate: string | null = null
  if (ongoing && mangadexId) {
    const md = await mangadexLatest(mangadexId)
    if (md) {
      chapters = Math.max(md.latestChapter, chapters ?? 0)
      lastReleaseDate = md.latestChapterDate
    }
  }

  return {
    id: `anilist:${id}`,
    provider: 'anilist',
    providerId: id,
    mediaType: 'manga',
    title: pickTitle(m.title),
    originalTitle: m.title?.romaji ?? null,
    overview: stripHtml(m.description),
    poster: m.coverImage?.extraLarge ?? m.coverImage?.large ?? null,
    backdrop: m.bannerImage ?? null,
    year: m.startDate?.year ?? null,
    genres: (m.genres ?? []) as string[],
    totalEpisodes: chapters,
    pages: chapters,
    seasons: [],
    ongoing,
    lastReleaseDate,
    mangadexId,
    cast: mapCharacters(m),
    airStatus: m.status ?? null,
    externalRatings: [
      ...anilistRating(m.averageScore),
      ...(await malRating(m.idMal, 'manga')),
    ],
  }
}

export function anilistDetails(id: string, type: 'ANIME' | 'MANGA'): Promise<MediaDetails> {
  return type === 'ANIME' ? animeDetails(id) : mangaDetails(id)
}
