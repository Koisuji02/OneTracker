/**
 * Comic Vine (comicvine.gamespot.com) — the reference database for western
 * comics. A "volume" is a comic run (e.g. Ultimate X-Men 2024) with a
 * `count_of_issues`, which OneTracker tracks chapter-by-chapter like manga.
 *
 * Calls carry the user's own key (settings.comicvineKey). Through the gateway
 * they get plain JSON from the Worker's shared cache; when it can't answer we
 * fall back to the API itself, which has no CORS headers but supports JSONP
 * (`format=jsonp`): a temporary <script> tag instead of fetch().
 */
import { getSettings } from '../settings'
import type { MediaDetails, SearchResult } from '../types'
import { ApiKeyMissingError } from './errors'
import { gatewayEnabled, gatewayHeaders, gatewayUrl } from './gateway'
import { fetchDirect, fetchTimeout } from './http'

const API = 'https://comicvine.gamespot.com/api'

function key(): string {
  const k = getSettings().comicvineKey.trim()
  if (!k) throw new ApiKeyMissingError('comicvine')
  return k
}

/** One Comic Vine call: the gateway's JSON first, JSONP straight to the API otherwise. */
async function cvFetch(url: string): Promise<any> {
  if (gatewayEnabled()) {
    try {
      // fetchTimeout rewrites the host onto the gateway, which appends format=json
      const res = await fetchTimeout(url)
      if (res.ok) return await res.json()
    } catch {
      // no gateway answer, and a direct fetch has no CORS: JSONP below
    }
  }
  return jsonp(url)
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

/**
 * Cheapest possible call, for the Settings diagnostics: returns Comic Vine's
 * `status_code` (1 = OK, 100/102 = bad/missing key). Throws when the script
 * never loads — which JSONP can't tell apart from a network block.
 */
/**
 * Comic Vine's own status code for a key: 1 = fine, 100 = invalid key.
 *
 * Comic Vine stopped honouring JSONP (it answers plain JSON whatever
 * `format=jsonp` says, so the <script> never calls back): the check goes
 * through the gateway, which talks JSON and — told `X-OT-Verify` — asks Comic
 * Vine itself instead of answering from its shared cache. A refused key comes
 * back as 401 there.
 */
export async function comicvinePing(apiKey: string = key()): Promise<number> {
  const base = gatewayUrl()
  if (base) {
    const res = await fetchDirect(
      `${base}/p/comicvine/search/?resources=volume&limit=1&query=batman&field_list=id`,
      { headers: { ...gatewayHeaders(), 'X-OT-Key': apiKey, 'X-OT-Verify': '1' } },
      8000,
    )
    if (res.status === 401) return 100
    if (!res.ok) return -1
    const data = await res.json().catch(() => null)
    return Number(data?.status_code ?? -1)
  }
  const data = await jsonp(
    `${API}/search/?api_key=${encodeURIComponent(apiKey)}&resources=volume&limit=1&query=batman&field_list=id`,
  )
  return Number(data?.status_code ?? -1)
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
 * Manga has its own tab (MangaDex) — keep the Comics row for western comics
 * with a two-layer filter:
 * 1. manga-focused publishers blacklist (incl. Italian/EU manga imprints)
 * 2. cross-check against MangaDex: a volume whose title matches a manga
 *    result for the same query is dropped. MangaDex alt-titles cover
 *    localized editions too; the response is memoized with the Manga row.
 */
const MANGA_PUBLISHERS =
  /shueisha|kodansha|shogakukan|kadokawa|\bviz\b|viz media|seven seas|yen press|tokyopop|vertical|square enix manga|j-novel|j-pop|planet manga|panini manga|star comics|carlsen|glenat|glénat|egmont manga|ivrea|norma editorial/i

/**
 * Comic Vine rate-limits hard (200 req/h per resource + a velocity guard),
 * and every keystroke-debounced query costs one call — memoize 60s so
 * retyping or reopening a search doesn't burn the budget into an error row.
 */
const comicSearchCache = new Map<string, { at: number; results: SearchResult[] }>()

export async function searchComics(query: string): Promise<SearchResult[]> {
  const cacheKey = query.trim().toLowerCase()
  const hit = comicSearchCache.get(cacheKey)
  if (hit && Date.now() - hit.at < 60_000) return hit.results
  const url =
    `${API}/search/?api_key=${key()}&resources=volume&limit=25` +
    `&query=${encodeURIComponent(query)}&field_list=id,name,image,start_year,count_of_issues,publisher`
  const data = await cvFetch(url)
  if (data.status_code !== 1) throw new Error(`Comic Vine error ${data.status_code}`)
  // manga-title filtering happens in searchReading (on the manga row's own
  // results) so no MangaDex call can gate the comics results
  const results = ((data.results ?? []) as any[])
    .filter((v) => !MANGA_PUBLISHERS.test(v.publisher?.name ?? ''))
    .slice(0, 14)
    .map((v) => ({
      provider: 'comicvine' as const,
      providerId: String(v.id),
      mediaType: 'manga' as const, // chapter-tracked, lives in the Books tab
      title: v.name,
      year: v.start_year ? Number(v.start_year) : null,
      poster: v.image?.medium_url ?? null,
    }))
  comicSearchCache.set(cacheKey, { at: Date.now(), results })
  if (comicSearchCache.size > 30)
    comicSearchCache.delete(comicSearchCache.keys().next().value as string)
  return results
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
      const data = await cvFetch(url)
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
  const data = await cvFetch(url)
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
