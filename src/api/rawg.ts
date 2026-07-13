import { getSettings } from '../settings'
import type { MediaDetails, SearchResult } from '../types'
import { ApiKeyMissingError } from './errors'
import { rawgRatings } from './ratings'
import { wikipediaBoxArt } from './wikipedia'

const API = 'https://api.rawg.io/api'

function key(): string {
  const k = getSettings().rawgKey.trim()
  if (!k) throw new ApiKeyMissingError('rawg')
  return k
}

export async function searchGames(query: string): Promise<SearchResult[]> {
  const url = new URL(`${API}/games`)
  url.searchParams.set('key', key())
  url.searchParams.set('search', query)
  url.searchParams.set('page_size', '14')
  const res = await fetch(url.toString())
  if (!res.ok) throw new Error(`RAWG error ${res.status}`)
  const data = await res.json()
  return ((data.results ?? []) as any[]).map((g) => ({
    provider: 'rawg' as const,
    providerId: String(g.id),
    mediaType: 'game' as const,
    title: g.name,
    year: g.released ? Number(String(g.released).slice(0, 4)) : null,
    poster: g.background_image ?? null,
  }))
}

/** Resolve an image URL by actually loading it (Steam CDN has no CORS, but <img> loads work). */
function imageExists(url: string): Promise<boolean> {
  return new Promise((resolve) => {
    const img = new Image()
    const timer = setTimeout(() => resolve(false), 6000)
    img.onload = () => {
      clearTimeout(timer)
      resolve(true)
    }
    img.onerror = () => {
      clearTimeout(timer)
      resolve(false)
    }
    img.src = url
  })
}

/**
 * RAWG's `background_image` is promo art without the title. When the game is
 * on Steam we can get the REAL vertical box art (with logo, like Stash shows)
 * from Steam's public CDN — keyless: parse the appid from the store URL.
 */
async function steamBoxArt(detail: any, id: string): Promise<string | null> {
  try {
    let steamUrl: string | null =
      ((detail.stores ?? []) as any[]).find(
        (s) => (s.store?.id === 1 || s.store?.slug === 'steam') && s.url,
      )?.url ?? null
    if (!steamUrl) {
      const su = new URL(`${API}/games/${id}/stores`)
      su.searchParams.set('key', key())
      const res = await fetch(su.toString())
      if (res.ok) {
        const data = await res.json()
        steamUrl =
          ((data.results ?? []) as any[]).find((s) => s.store_id === 1 && s.url)?.url ?? null
      }
    }
    const appId = steamUrl?.match(/\/app\/(\d+)/)?.[1]
    if (!appId) return null
    const cover = `https://cdn.cloudflare.steamstatic.com/steam/apps/${appId}/library_600x900_2x.jpg`
    return (await imageExists(cover)) ? cover : null
  } catch {
    return null
  }
}

export async function gameDetails(id: string): Promise<MediaDetails> {
  const url = new URL(`${API}/games/${id}`)
  url.searchParams.set('key', key())
  const res = await fetch(url.toString())
  if (!res.ok) throw new Error(`RAWG error ${res.status}`)
  const d = await res.json()
  // box art priority: Steam CDN vertical capsule (has the title/logo, only
  // for games on Steam with modern assets) → Wikipedia infobox box art
  // (any platform, keyless) → RAWG promo art
  const boxArt = (await steamBoxArt(d, id)) ?? (await wikipediaBoxArt(d.name))
  return {
    id: `rawg:${id}`,
    provider: 'rawg',
    providerId: id,
    mediaType: 'game',
    title: d.name,
    overview: d.description_raw || null,
    poster: boxArt ?? d.background_image ?? null,
    backdrop: d.background_image_additional ?? d.background_image ?? null,
    platforms: ((d.parent_platforms ?? []) as any[])
      .map((p) => p.platform?.slug as string)
      .filter(Boolean),
    year: d.released ? Number(String(d.released).slice(0, 4)) : null,
    genres: ((d.genres ?? []) as any[]).map((g) => g.name),
    playtime: (d.playtime as number | undefined) || null,
    authors: ((d.developers ?? []) as any[]).map((dev) => dev.name).slice(0, 3),
    externalRatings: rawgRatings(d.metacritic ?? null, d.rating ?? null),
  }
}
