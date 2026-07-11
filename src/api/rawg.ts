import { getSettings } from '../settings'
import type { MediaDetails, SearchResult } from '../types'
import { ApiKeyMissingError } from './errors'
import { rawgRatings } from './ratings'

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

export async function gameDetails(id: string): Promise<MediaDetails> {
  const url = new URL(`${API}/games/${id}`)
  url.searchParams.set('key', key())
  const res = await fetch(url.toString())
  if (!res.ok) throw new Error(`RAWG error ${res.status}`)
  const d = await res.json()
  return {
    id: `rawg:${id}`,
    provider: 'rawg',
    providerId: id,
    mediaType: 'game',
    title: d.name,
    overview: d.description_raw || null,
    poster: d.background_image ?? null,
    backdrop: d.background_image_additional ?? d.background_image ?? null,
    year: d.released ? Number(String(d.released).slice(0, 4)) : null,
    genres: ((d.genres ?? []) as any[]).map((g) => g.name),
    playtime: (d.playtime as number | undefined) || null,
    authors: ((d.developers ?? []) as any[]).map((dev) => dev.name).slice(0, 3),
    externalRatings: rawgRatings(d.metacritic ?? null, d.rating ?? null),
  }
}
