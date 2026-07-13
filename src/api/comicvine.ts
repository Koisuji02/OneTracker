/**
 * Comic Vine (comicvine.gamespot.com) — the reference database for western
 * comics. A "volume" is a comic run (e.g. Ultimate X-Men 2024) with a
 * `count_of_issues`, which OneTracker tracks chapter-by-chapter like manga.
 *
 * The API has no CORS headers, but supports JSONP (`format=jsonp`), so we
 * load responses through a temporary <script> tag instead of fetch().
 */
import { getSettings } from '../settings'
import type { MediaDetails, SearchResult } from '../types'
import { mangaTitleKeys, matchesTitleSet } from './anilist'
import { ApiKeyMissingError } from './errors'

const API = 'https://comicvine.gamespot.com/api'

function key(): string {
  const k = getSettings().comicvineKey.trim()
  if (!k) throw new ApiKeyMissingError('comicvine')
  return k
}

/** Minimal JSONP client: injects a <script>, resolves via a global callback. */
function jsonp(url: string, timeoutMs = 12000): Promise<any> {
  return new Promise((resolve, reject) => {
    const cb = `__cv_cb_${Date.now()}_${Math.floor(Math.random() * 1e6)}`
    const script = document.createElement('script')
    const timer = setTimeout(() => {
      cleanup()
      reject(new Error('Comic Vine timeout'))
    }, timeoutMs)
    function cleanup() {
      clearTimeout(timer)
      delete (window as any)[cb]
      script.remove()
    }
    ;(window as any)[cb] = (data: any) => {
      cleanup()
      resolve(data)
    }
    script.src = `${url}&format=jsonp&json_callback=${cb}`
    script.onerror = () => {
      cleanup()
      reject(new Error('Comic Vine request failed'))
    }
    document.head.appendChild(script)
  })
}

function stripHtml(s: string | null | undefined): string | null {
  if (!s) return null
  return s
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/**
 * Manga has its own tab (AniList/MangaDex) — keep the Comics row for western
 * comics with a two-layer filter:
 * 1. manga-focused publishers blacklist (incl. Italian/EU manga imprints)
 * 2. cross-check against AniList: a volume whose title matches a manga
 *    result for the same query is dropped. The AniList response is memoized,
 *    so this costs nothing extra when the Manga row already searched it.
 */
const MANGA_PUBLISHERS =
  /shueisha|kodansha|shogakukan|kadokawa|\bviz\b|viz media|seven seas|yen press|tokyopop|vertical|square enix manga|j-novel|j-pop|planet manga|panini manga|star comics|carlsen|glenat|glénat|egmont manga|ivrea|norma editorial/i

export async function searchComics(query: string): Promise<SearchResult[]> {
  const url =
    `${API}/search/?api_key=${key()}&resources=volume&limit=25` +
    `&query=${encodeURIComponent(query)}&field_list=id,name,image,start_year,count_of_issues,publisher`
  const [data, mangaTitles] = await Promise.all([jsonp(url), mangaTitleKeys(query)])
  if (data.status_code !== 1) throw new Error(`Comic Vine error ${data.status_code}`)
  return ((data.results ?? []) as any[])
    .filter(
      (v) =>
        !MANGA_PUBLISHERS.test(v.publisher?.name ?? '') &&
        !matchesTitleSet(v.name ?? '', mangaTitles),
    )
    .slice(0, 14)
    .map((v) => ({
      provider: 'comicvine' as const,
      providerId: String(v.id),
      mediaType: 'manga' as const, // chapter-tracked, lives in the Books tab
      title: v.name,
      year: v.start_year ? Number(v.start_year) : null,
      poster: v.image?.medium_url ?? null,
    }))
}

/**
 * Real issue titles for a volume ("Chapter N" fallback when untitled).
 * Paginated 100 per request, capped at 500 issues.
 */
export async function comicvineIssueTitles(
  volumeId: string,
  count: number,
): Promise<Map<number, string>> {
  const titles = new Map<number, string>()
  try {
    const pages = Math.min(Math.ceil(Math.max(count, 1) / 100), 5)
    for (let p = 0; p < pages; p++) {
      const url =
        `${API}/issues/?api_key=${key()}&filter=volume:${volumeId}` +
        `&field_list=issue_number,name&sort=issue_number:asc&limit=100&offset=${p * 100}`
      const data = await jsonp(url)
      if (data.status_code !== 1) break
      const results = (data.results ?? []) as any[]
      for (const issue of results) {
        const n = Number.parseFloat(issue.issue_number)
        const name = (issue.name as string | null)?.trim()
        if (Number.isFinite(n) && n > 0 && name && !titles.has(Math.floor(n))) {
          titles.set(Math.floor(n), name)
        }
      }
      if (results.length < 100) break
    }
  } catch {
    // best-effort (including missing API key)
  }
  return titles
}

export async function comicDetails(id: string): Promise<MediaDetails> {
  const url =
    `${API}/volume/4050-${id}/?api_key=${key()}` +
    `&field_list=id,name,deck,description,image,start_year,count_of_issues,publisher`
  const data = await jsonp(url)
  if (data.status_code !== 1) throw new Error(`Comic Vine error ${data.status_code}`)
  const v = data.results
  const issues = (v.count_of_issues as number | undefined) ?? null
  return {
    id: `comicvine:${id}`,
    provider: 'comicvine',
    providerId: id,
    mediaType: 'manga',
    title: v.name,
    overview: stripHtml(v.description) ?? stripHtml(v.deck),
    poster: v.image?.medium_url ?? null,
    backdrop: v.image?.screen_large_url ?? null,
    year: v.start_year ? Number(v.start_year) : null,
    genres: [],
    totalEpisodes: issues,
    pages: issues,
    authors: v.publisher?.name ? [v.publisher.name] : [],
    // Comic Vine has no reliable "ongoing" flag; when new issues appear the
    // count grows on the next detail refresh and status re-derives itself.
    ongoing: null,
  }
}
