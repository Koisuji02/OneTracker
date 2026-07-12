/**
 * SteamGridDB (steamgriddb.com, free API key) — vertical 600×900 box art
 * WITH the game's title/logo, for games on EVERY platform (it's an artwork
 * database keyed by game, not by store). Best-effort: any failure returns
 * null and the caller falls back to Steam CDN art or RAWG promo art.
 */
import { getSettings } from '../settings'

const API = 'https://www.steamgriddb.com/api/v2'

export async function steamGridCover(title: string): Promise<string | null> {
  const key = getSettings().steamgriddbKey.trim()
  if (!key) return null
  try {
    const headers = { Authorization: `Bearer ${key}` }
    const sres = await fetch(`${API}/search/autocomplete/${encodeURIComponent(title)}`, { headers })
    if (!sres.ok) return null
    const sdata = await sres.json()
    const gameId = sdata.data?.[0]?.id
    if (!gameId) return null
    const gres = await fetch(
      `${API}/grids/game/${gameId}?dimensions=600x900&types=static&limit=1`,
      { headers },
    )
    if (!gres.ok) return null
    const gdata = await gres.json()
    return (gdata.data?.[0]?.url as string | undefined) ?? null
  } catch {
    return null
  }
}
