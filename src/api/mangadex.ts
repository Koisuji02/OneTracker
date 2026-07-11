// MangaDex is used as a secondary source for ongoing manga: AniList does not
// know how many chapters are out until a work is finished, MangaDex does.
const API = 'https://api.mangadex.org'

export interface MangaDexLatest {
  latestChapter: number
  latestChapterDate: string | null
}

/**
 * Look up a manga on MangaDex (matched via its AniList id when possible) and
 * return the highest released chapter number and its publish date.
 * Returns null on any failure — this data is a best-effort enrichment.
 */
export async function mangadexLatest(
  anilistId: string,
  title: string,
): Promise<MangaDexLatest | null> {
  try {
    const mu = new URL(`${API}/manga`)
    mu.searchParams.set('title', title)
    mu.searchParams.set('limit', '5')
    const mres = await fetch(mu.toString())
    if (!mres.ok) return null
    const mdata = await mres.json()
    const list = (mdata.data ?? []) as any[]
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
    if (!found) return null

    const cu = new URL(`${API}/chapter`)
    cu.searchParams.set('manga', found.id)
    cu.searchParams.append('order[chapter]', 'desc')
    cu.searchParams.set('limit', '10')
    const cres = await fetch(cu.toString())
    if (!cres.ok) return null
    const cdata = await cres.json()
    for (const ch of (cdata.data ?? []) as any[]) {
      const n = Number.parseFloat(ch.attributes?.chapter)
      if (Number.isFinite(n) && n > 0) {
        return {
          latestChapter: Math.floor(n),
          latestChapterDate:
            ch.attributes?.readableAt ?? ch.attributes?.publishAt ?? null,
        }
      }
    }
    return null
  } catch {
    return null
  }
}
