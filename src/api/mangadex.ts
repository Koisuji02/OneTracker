/**
 * MangaDex (api.mangadex.org, keyless, no practical rate limit) — the manga
 * source: search (it matches localized alt-titles, so Italian queries work),
 * full details, released-chapter counts + dates, chapter titles, community
 * rating. AniList/MAL scores are grafted on via `attributes.links.al`.
 * Legacy `anilist:` manga items keep using it for chapter counts/titles too.
 */
const API = 'https://api.mangadex.org'
const COVERS = 'https://uploads.mangadex.org/covers'

import type { MediaDetails, SearchResult } from '../types'
import { mangaRatingsByAnilistId } from './anilist'
import { fetchTimeout } from './http'
import { normalizeTitle } from './titleMatch'

// ------------------------------------------------------------------ search

/** Raw search results, memoized 60s — shared by the Manga row and the
 *  manga cross-filters of the Books and Comics rows. */
const searchCache = new Map<string, { at: number; data: any[] }>()

async function mdSearch(query: string): Promise<any[]> {
  const cacheKey = query.trim().toLowerCase()
  const hit = searchCache.get(cacheKey)
  if (hit && Date.now() - hit.at < 60_000) return hit.data
  const url = new URL(`${API}/manga`)
  url.searchParams.set('title', query)
  url.searchParams.set('limit', '14')
  url.searchParams.append('includes[]', 'cover_art')
  url.searchParams.append('order[relevance]', 'desc')
  for (const cr of ['safe', 'suggestive', 'erotica']) url.searchParams.append('contentRating[]', cr)
  const res = await fetchTimeout(url.toString())
  if (!res.ok) throw new Error(`MangaDex error ${res.status}`)
  const data = ((await res.json()).data ?? []) as any[]
  searchCache.set(cacheKey, { at: Date.now(), data })
  if (searchCache.size > 30) searchCache.delete(searchCache.keys().next().value as string)
  return data
}

function coverOf(m: any, size: 256 | 512): string | null {
  const file = ((m.relationships ?? []) as any[]).find((r) => r.type === 'cover_art')
    ?.attributes?.fileName
  return file ? `${COVERS}/${m.id}/${file}.${size}.jpg` : null
}

function titleOf(m: any): string {
  const t = m.attributes?.title ?? {}
  return (
    t.en ??
    (Object.values(t)[0] as string | undefined) ??
    (((m.attributes?.altTitles ?? []) as any[]).map((a) => a.en).find(Boolean) as
      | string
      | undefined) ??
    'Unknown'
  )
}

export async function searchManga(query: string): Promise<SearchResult[]> {
  const data = await mdSearch(query)
  return data.map((m) => ({
    provider: 'mangadex' as const,
    providerId: String(m.id),
    mediaType: 'manga' as const,
    title: titleOf(m),
    year: (m.attributes?.year as number | null) ?? null,
    poster: coverOf(m, 256),
  }))
}

/**
 * Normalized titles + alt-titles (ALL languages, Italian editions included)
 * of the manga results for a query — keeps manga out of the Books and Comics
 * rows. Costs nothing extra: same memoized search the Manga row runs.
 */
export async function mangadexTitleKeys(query: string): Promise<Set<string>> {
  const keys = new Set<string>()
  try {
    for (const m of await mdSearch(query)) {
      for (const t of Object.values(m.attributes?.title ?? {})) keys.add(normalizeTitle(t as string))
      for (const alt of (m.attributes?.altTitles ?? []) as any[]) {
        for (const t of Object.values(alt)) keys.add(normalizeTitle(t as string))
      }
    }
  } catch {
    // best-effort: rows fall back to their own subject/publisher filters
  }
  return keys
}

// ----------------------------------------------------------------- details

/** MangaDex community rating (bayesian) as a ratings banner entry. */
async function mangadexRating(id: string) {
  try {
    const res = await fetchTimeout(`${API}/statistics/manga/${id}`)
    if (!res.ok) return []
    const stats = (await res.json()).statistics?.[id]
    const score = stats?.rating?.bayesian as number | undefined
    return score ? [{ source: 'mangadex', label: 'MangaDex', score: score.toFixed(2) }] : []
  } catch {
    return []
  }
}

export async function mangadexDetails(id: string): Promise<MediaDetails> {
  const url = new URL(`${API}/manga/${id}`)
  for (const inc of ['cover_art', 'author', 'artist']) url.searchParams.append('includes[]', inc)
  const res = await fetchTimeout(url.toString())
  if (!res.ok) throw new Error(`MangaDex error ${res.status}`)
  const m = (await res.json()).data
  const a = m.attributes ?? {}
  const ongoing = a.status === 'ongoing'

  // chapter count: finished works have `lastChapter`; ongoing ones (and gaps)
  // use the highest released chapter from the feed
  let chapters = Math.floor(Number.parseFloat(a.lastChapter)) || null
  let lastReleaseDate: string | null = null
  const latest = await mangadexLatest(id)
  if (latest) {
    chapters = Math.max(latest.latestChapter, chapters ?? 0)
    if (ongoing) lastReleaseDate = latest.latestChapterDate
  }

  const authors = Array.from(
    new Set(
      ((m.relationships ?? []) as any[])
        .filter((r) => r.type === 'author' || r.type === 'artist')
        .map((r) => r.attributes?.name as string | undefined)
        .filter(Boolean) as string[],
    ),
  ).slice(0, 3)

  return {
    id: `mangadex:${id}`,
    provider: 'mangadex',
    providerId: id,
    mediaType: 'manga',
    title: titleOf(m),
    originalTitle:
      (((a.altTitles ?? []) as any[]).map((x) => x.ja ?? x['ja-ro']).find(Boolean) as
        | string
        | undefined) ?? null,
    overview: (a.description?.it as string | undefined) || (a.description?.en as string | undefined) || null,
    poster: coverOf(m, 512),
    backdrop: null,
    year: (a.year as number | null) ?? null,
    genres: ((a.tags ?? []) as any[])
      .filter((t) => t.attributes?.group === 'genre')
      .map((t) => t.attributes?.name?.en as string)
      .filter(Boolean)
      .slice(0, 6),
    totalEpisodes: chapters,
    pages: chapters,
    seasons: [],
    ongoing,
    lastReleaseDate,
    authors,
    mangadexId: id,
    externalRatings: [
      ...(await mangadexRating(id)),
      ...(await mangaRatingsByAnilistId(a.links?.al as string | undefined)),
    ],
  }
}
/** Find the MangaDex id for an AniList manga (null when not found). */
export async function mangadexFind(anilistId: string, title: string): Promise<string | null> {
  try {
    const mu = new URL(`${API}/manga`)
    mu.searchParams.set('title', title)
    mu.searchParams.set('limit', '5')
    const res = await fetchTimeout(mu.toString())
    if (!res.ok) return null
    const data = await res.json()
    const list = (data.data ?? []) as any[]
    const lowerTitle = title.trim().toLowerCase()
    const found =
      list.find((d) => d.attributes?.links?.al === anilistId) ??
      list.find((d) => {
        const titles = [
          d.attributes?.title?.en,
          ...Object.values(d.attributes?.title ?? {}),
        ].filter(Boolean) as string[]
        return titles.some((x) => x.trim().toLowerCase() === lowerTitle)
      })
    return found?.id ?? null
  } catch {
    return null
  }
}

export interface MangaDexLatest {
  latestChapter: number
  latestChapterDate: string | null
}

/** Highest released chapter number and its publish date. */
export async function mangadexLatest(mangadexId: string): Promise<MangaDexLatest | null> {
  try {
    const cu = new URL(`${API}/chapter`)
    cu.searchParams.set('manga', mangadexId)
    cu.searchParams.append('order[chapter]', 'desc')
    cu.searchParams.set('limit', '10')
    const res = await fetchTimeout(cu.toString())
    if (!res.ok) return null
    const data = await res.json()
    for (const ch of (data.data ?? []) as any[]) {
      const n = Number.parseFloat(ch.attributes?.chapter)
      if (Number.isFinite(n) && n > 0) {
        return {
          latestChapter: Math.floor(n),
          latestChapterDate: ch.attributes?.readableAt ?? ch.attributes?.publishAt ?? null,
        }
      }
    }
    return null
  } catch {
    return null
  }
}

/**
 * Chapter titles by chapter number (English feed, first 500 chapters).
 * Untitled chapters simply stay out of the map — the UI falls back to "Ch. N".
 */
export async function mangadexChapterTitles(mangadexId: string): Promise<Map<number, string>> {
  const titles = new Map<number, string>()
  try {
    const fu = new URL(`${API}/manga/${mangadexId}/feed`)
    fu.searchParams.set('limit', '500')
    fu.searchParams.append('translatedLanguage[]', 'en')
    fu.searchParams.append('order[chapter]', 'asc')
    fu.searchParams.append('contentRating[]', 'safe')
    fu.searchParams.append('contentRating[]', 'suggestive')
    const res = await fetchTimeout(fu.toString())
    if (!res.ok) return titles
    const data = await res.json()
    for (const ch of (data.data ?? []) as any[]) {
      const n = Number.parseFloat(ch.attributes?.chapter)
      const title = (ch.attributes?.title as string | null)?.trim()
      if (Number.isFinite(n) && n > 0 && title && !titles.has(Math.floor(n))) {
        titles.set(Math.floor(n), title)
      }
    }
  } catch {
    // best-effort
  }
  return titles
}
