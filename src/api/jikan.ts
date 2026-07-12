/**
 * Jikan (api.jikan.moe, keyless MyAnimeList mirror) — real episode titles for
 * anime. Paginated 100 per page, rate-limited ~3 req/s, so pages are fetched
 * with a small delay and capped; anything beyond falls back to "Episode N".
 * Results are cached for 7 days in the episode cache (see api/index.ts).
 */
const API = 'https://api.jikan.moe/v4'

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

export async function jikanEpisodeTitles(
  malId: number,
  count: number,
): Promise<Map<number, string>> {
  const titles = new Map<number, string>()
  try {
    const pages = Math.min(Math.ceil(Math.max(count, 1) / 100), 12)
    for (let p = 1; p <= pages; p++) {
      const res = await fetch(`${API}/anime/${malId}/episodes?page=${p}`)
      if (!res.ok) break
      const d = await res.json()
      for (const ep of (d.data ?? []) as any[]) {
        if (ep.mal_id && ep.title) titles.set(ep.mal_id as number, ep.title as string)
      }
      if (!d.pagination?.has_next_page) break
      await sleep(350)
    }
  } catch {
    // best-effort
  }
  return titles
}
