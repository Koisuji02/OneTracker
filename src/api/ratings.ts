/**
 * External critic/community ratings, shown as small banners on detail pages.
 * All lookups are best-effort: any failure returns [] and the UI simply
 * doesn't render the banner.
 *
 * Sources per media type:
 * - movies & TV  → OMDb (IMDb rating + Rotten Tomatoes + Metacritic), needs a free key
 * - anime & manga → AniList averageScore + MyAnimeList via Jikan (both keyless)
 * - books        → Open Library community rating (keyless)
 * - games        → Metacritic + RAWG rating (already in the RAWG payload)
 */
import { getSettings } from '../settings'
import type { ExternalRating } from '../types'

/** OMDb (omdbapi.com) by IMDb id — returns IMDb / Rotten Tomatoes / Metacritic. */
export async function omdbRatings(imdbId: string | null | undefined): Promise<ExternalRating[]> {
  const key = getSettings().omdbKey.trim()
  if (!key || !imdbId) return []
  try {
    const res = await fetch(`https://www.omdbapi.com/?apikey=${key}&i=${imdbId}`)
    if (!res.ok) return []
    const d = await res.json()
    const out: ExternalRating[] = []
    if (d.imdbRating && d.imdbRating !== 'N/A') {
      out.push({ source: 'imdb', label: 'IMDb', score: d.imdbRating })
    }
    const rt = ((d.Ratings ?? []) as any[]).find((r) => r.Source === 'Rotten Tomatoes')
    if (rt?.Value) out.push({ source: 'rt', label: 'Rotten Tomatoes', score: rt.Value })
    if (out.length < 2 && d.Metascore && d.Metascore !== 'N/A') {
      out.push({ source: 'metacritic', label: 'Metacritic', score: d.Metascore })
    }
    return out
  } catch {
    return []
  }
}

/** MyAnimeList score via the keyless Jikan API. */
export async function malRating(
  malId: number | null | undefined,
  kind: 'anime' | 'manga',
): Promise<ExternalRating[]> {
  if (!malId) return []
  try {
    const res = await fetch(`https://api.jikan.moe/v4/${kind}/${malId}`)
    if (!res.ok) return []
    const d = await res.json()
    const score = d.data?.score
    return score ? [{ source: 'mal', label: 'MyAnimeList', score: String(score) }] : []
  } catch {
    return []
  }
}

export function anilistRating(averageScore: number | null | undefined): ExternalRating[] {
  return averageScore
    ? [{ source: 'anilist', label: 'AniList', score: `${averageScore}%` }]
    : []
}

/** Open Library community rating for a work. */
export async function openLibraryRating(workId: string): Promise<ExternalRating[]> {
  try {
    const res = await fetch(`https://openlibrary.org/works/${workId}/ratings.json`)
    if (!res.ok) return []
    const d = await res.json()
    const avg = d.summary?.average
    return avg
      ? [{ source: 'openlibrary', label: 'Open Library', score: `${avg.toFixed(1)}/5` }]
      : []
  } catch {
    return []
  }
}

export function rawgRatings(metacritic: number | null, rawgScore: number | null): ExternalRating[] {
  const out: ExternalRating[] = []
  if (metacritic) out.push({ source: 'metacritic', label: 'Metacritic', score: String(metacritic) })
  if (rawgScore) out.push({ source: 'rawg', label: 'RAWG', score: `${rawgScore}/5` })
  return out
}
