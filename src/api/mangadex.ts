/**
 * MangaDex (api.mangadex.org, keyless) — secondary source for manga:
 * - released-chapter count + latest chapter date for ongoing works
 *   (AniList doesn't know them until a manga is finished)
 * - real chapter titles for the chapter checklists (best-effort)
 * Entries are matched to AniList via `attributes.links.al`.
 */
const API = 'https://api.mangadex.org'

/** Find the MangaDex id for an AniList manga (null when not found). */
export async function mangadexFind(anilistId: string, title: string): Promise<string | null> {
  try {
    const mu = new URL(`${API}/manga`)
    mu.searchParams.set('title', title)
    mu.searchParams.set('limit', '5')
    const res = await fetch(mu.toString())
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
    const res = await fetch(cu.toString())
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
    const res = await fetch(fu.toString())
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
