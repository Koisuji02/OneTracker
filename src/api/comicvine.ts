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

export async function searchComics(query: string): Promise<SearchResult[]> {
  const url =
    `${API}/search/?api_key=${key()}&resources=volume&limit=14` +
    `&query=${encodeURIComponent(query)}&field_list=id,name,image,start_year,count_of_issues`
  const data = await jsonp(url)
  if (data.status_code !== 1) throw new Error(`Comic Vine error ${data.status_code}`)
  return ((data.results ?? []) as any[]).map((v) => ({
    provider: 'comicvine' as const,
    providerId: String(v.id),
    mediaType: 'manga' as const, // chapter-tracked, lives in the Books tab
    title: v.name,
    year: v.start_year ? Number(v.start_year) : null,
    poster: v.image?.medium_url ?? null,
  }))
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
