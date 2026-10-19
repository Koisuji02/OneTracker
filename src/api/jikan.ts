/**
 * Jikan (api.jikan.moe, keyless MyAnimeList mirror) — real episode titles for
 * anime. Paginated 100 per page, rate-limited ~3 req/s, so pages are fetched
 * with a small delay and capped; anything beyond falls back to "Episode N".
 * Results are cached for 7 days in the episode cache (see api/index.ts).
 *
 * Jikan is a free community service and goes down now and then — whole hours
 * where every call just hangs. Everything it gives is extra (a MAL score,
 * episode titles, a fallback chapter count), and pages await it, so a dead
 * Jikan must not cost a page ten seconds per call: calls time out fast, and
 * after one failure Jikan is left alone for a while (`jikanFetch`).
 */
const API = 'https://api.jikan.moe/v4'

import { fetchTimeout } from './http'
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** A healthy Jikan answers in well under a second; past this it's down. */
const TIMEOUT = 4000
/** After a failure, no Jikan calls at all for this long. */
const PAUSE = 10 * 60 * 1000
let pausedUntil = 0

/**
 * Every Jikan call goes through here. A timeout, a network error or a 5xx
 * pauses Jikan for PAUSE: the pages built meanwhile simply go without its
 * extras (AniList's score is still there), and it comes back by itself.
 */
export async function jikanFetch(path: string): Promise<Response | null> {
  if (Date.now() < pausedUntil) return null
  try {
    const res = await fetchTimeout(`${API}${path}`, {}, TIMEOUT)
    if (res.status >= 500) pausedUntil = Date.now() + PAUSE
    return res
  } catch {
    pausedUntil = Date.now() + PAUSE
    return null
  }
}

/**
 * Published chapter count from MAL. Keyless fallback for manga where AniList
 * carries no count (`chapters` is only set on FINISHED works — Vagabond-style
 * hiatus titles have null) and MangaDex is unreachable (DNS-blocked on some
 * mobile networks).
 */
export async function jikanMangaChapters(malId: number | null | undefined): Promise<number | null> {
  if (!malId) return null
  try {
    const res = await jikanFetch(`/manga/${malId}`)
    if (!res?.ok) return null
    const c = (await res.json()).data?.chapters
    return typeof c === 'number' && c > 0 ? c : null
  } catch {
    return null
  }
}

export async function jikanEpisodeTitles(
  malId: number,
  count: number,
): Promise<Map<number, string>> {
  const titles = new Map<number, string>()
  try {
    const pages = Math.min(Math.ceil(Math.max(count, 1) / 100), 12)
    for (let p = 1; p <= pages; p++) {
      const res = await jikanFetch(`/anime/${malId}/episodes?page=${p}`)
      if (!res?.ok) break
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
