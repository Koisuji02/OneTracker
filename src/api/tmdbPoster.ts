/**
 * Minimal TMDB tv-poster lookup by title, used to give ANIME the classic
 * database poster (with the show's logo) instead of AniList's clean artwork.
 * Lives in its own module (no anilist import) to avoid a circular dependency:
 * tmdb.ts imports anilist.ts for the anime cross-filter.
 */
import { fetchTimeout } from './http'
import { getSettings } from '../settings'

export async function tmdbTvPosterByTitle(
  title: string,
  year?: number | null,
): Promise<{ poster: string | null; backdrop: string | null } | null> {
  const key = getSettings().tmdbKey.trim()
  if (!key) return null
  try {
    const isV4 = key.startsWith('ey')
    const url = new URL('https://api.themoviedb.org/3/search/tv')
    url.searchParams.set('query', title)
    url.searchParams.set('include_adult', 'false')
    if (!isV4) url.searchParams.set('api_key', key)
    const res = await fetchTimeout(
      url.toString(),
      isV4 ? { headers: { Authorization: `Bearer ${key}` } } : undefined,
    )
    if (!res.ok) return null
    const d = await res.json()
    const results = (d.results ?? []) as any[]
    // prefer a result whose first-air year matches (±1) to avoid wrong shows
    const match =
      (year
        ? results.find((r) => {
            const y = Number(String(r.first_air_date ?? '').slice(0, 4))
            return Number.isFinite(y) && Math.abs(y - year) <= 1
          })
        : null) ?? results[0]
    if (!match?.poster_path) return null
    return {
      poster: `https://image.tmdb.org/t/p/w342${match.poster_path}`,
      backdrop: match.backdrop_path
        ? `https://image.tmdb.org/t/p/w1280${match.backdrop_path}`
        : null,
    }
  } catch {
    return null
  }
}
