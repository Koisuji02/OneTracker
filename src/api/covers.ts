/**
 * Shared cover resolution: search rows and detail pages must show the SAME
 * artwork for the same title. Resolved URLs live in the `covers` IndexedDB
 * table (30-day TTL), so each title costs at most one lookup — whoever
 * resolves first (search or detail) wins and everyone reuses it.
 *
 * - anime → the classic TMDB poster (with logo), fallback AniList art
 * - games → titled box art (Steam/Wikipedia), fallback RAWG promo art
 */
import { db } from '../db'
import type { SearchResult } from '../types'
import { wikipediaBoxArt } from './wikipedia'

const COVER_TTL = 1000 * 60 * 60 * 24 * 30 // 30 days

export const animeCoverKey = (title: string) => `anime:${title.trim().toLowerCase()}`
export const gameCoverKey = (rawgId: string) => `game:${rawgId}`

/** Read-through cache: null results are cached too (no repeated lookups). */
export async function cachedCover(
  key: string,
  fetcher: () => Promise<string | null>,
): Promise<string | null> {
  const hit = await db.covers.get(key)
  if (hit && Date.now() - hit.fetchedAt < COVER_TTL) return hit.url
  try {
    const url = await fetcher()
    await db.covers.put({ key, url, fetchedAt: Date.now() })
    return url
  } catch {
    return hit?.url ?? null
  }
}

/** Store a cover resolved elsewhere (e.g. by a detail fetch). */
export async function rememberCover(key: string, url: string | null): Promise<void> {
  await db.covers.put({ key, url, fetchedAt: Date.now() })
}

/** Game search rows: swap RAWG promo art for cached/titled box art. */
export function enrichGameCovers(results: SearchResult[]): Promise<SearchResult[]> {
  return Promise.all(
    results.map(async (r) => {
      const url = await cachedCover(gameCoverKey(r.providerId), () => wikipediaBoxArt(r.title))
      return url ? { ...r, poster: url } : r
    }),
  )
}
