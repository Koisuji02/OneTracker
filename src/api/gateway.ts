/**
 * Optional API gateway (see worker/README.md).
 *
 * When a gateway URL is configured every provider call is rewritten to go
 * through it, which buys three things with no user setup at all:
 * - hosts blocked by an ISP (MangaDex on Italian networks) become reachable,
 *   because the app only ever talks to the Worker;
 * - provider keys stop shipping inside the APK;
 * - IGDB becomes usable for game data.
 *
 * With no gateway configured every function here is a no-op and the app calls
 * providers directly, exactly as before — the app must never DEPEND on it.
 */
import { getSettings } from '../settings'
import { ApiKeyMissingError } from './errors'

/**
 * Hosts routed through the gateway: the keyed providers, whose answers the
 * Worker caches for EVERY user (a miss goes upstream with the user's own key
 * when the call carries one — see http.ts — or the Worker's built-in one for
 * TMDB), and MangaDex, which some ISPs block. IGDB goes through it too.
 *
 * AniList, Jikan and Open Library are deliberately NOT here: they're keyless and
 * reachable everywhere, and AniList actively 403s traffic coming from datacenter
 * IPs ("You have been manually blocked"), which is exactly what a Cloudflare
 * Worker looks like. Calling them directly is both more reliable and cheaper on
 * the Worker's request quota.
 */
const API_HOSTS: Record<string, string> = {
  'api.themoviedb.org': 'tmdb',
  'www.omdbapi.com': 'omdb',
  'comicvine.gamespot.com': 'comicvine',
  'api.mangadex.org': 'mangadex',
}

/**
 * Image hosts worth proxying: ONLY the ones that get blocked. Artwork is by far
 * the highest-volume traffic (dozens of images per screen), so routing
 * image.tmdb.org / images.igdb.com through the Worker would burn the free
 * request quota for no benefit — they're reachable everywhere.
 */
const IMAGE_HOSTS: Record<string, string> = {
  'uploads.mangadex.org': 'mangadex',
}

/** Base URL without trailing slash, or '' when the gateway is off. */
export function gatewayUrl(): string {
  return getSettings().gatewayUrl.trim().replace(/\/+$/, '')
}

export function gatewayToken(): string {
  return getSettings().gatewayToken.trim()
}

export function gatewayEnabled(): boolean {
  return gatewayUrl().length > 0
}

/** Header the Worker checks; empty object when no token is configured. */
export function gatewayHeaders(): Record<string, string> {
  const token = gatewayToken()
  return token ? { 'X-OT-Token': token } : {}
}

/**
 * The path prefixes each provider expects to keep. The Worker holds the base
 * URL, so `https://api.themoviedb.org/3/movie/1` must arrive as
 * `/p/tmdb/movie/1` — the version prefix belongs to the base, not the path.
 */
const STRIP_PREFIX: Record<string, RegExp> = {
  tmdb: /^\/3/,
  rawg: /^\/api/,
  jikan: /^\/v4/,
  comicvine: /^\/api/,
}

/**
 * Rewrite a provider API URL onto the gateway. Unknown hosts (Steam CDN,
 * Wikipedia, Google APIs…) are returned untouched: they're not blocked and
 * don't need keys.
 */
export function proxyApi(rawUrl: string): string {
  const base = gatewayUrl()
  if (!base) return rawUrl
  let u: URL
  try {
    u = new URL(rawUrl)
  } catch {
    return rawUrl
  }
  const provider = API_HOSTS[u.hostname]
  if (!provider) return rawUrl
  const path = u.pathname.replace(STRIP_PREFIX[provider] ?? /^$/, '')
  return `${base}/p/${provider}${path}${u.search}`
}

/**
 * Rewrite an image URL onto the gateway. `<img>` tags can't send headers, so
 * the token travels as a query parameter here (the Worker accepts both).
 */
export function proxyImage(rawUrl: string | null | undefined): string | null {
  if (!rawUrl) return rawUrl ?? null
  const base = gatewayUrl()
  if (!base) return rawUrl
  let u: URL
  try {
    u = new URL(rawUrl)
  } catch {
    return rawUrl
  }
  const provider = IMAGE_HOSTS[u.hostname]
  if (!provider) return rawUrl
  const token = gatewayToken()
  const sep = u.search ? '&' : '?'
  const suffix = token ? `${u.search}${sep}t=${encodeURIComponent(token)}` : u.search
  return `${base}/img/${provider}${u.pathname}${suffix}`
}

/** The user's Twitch app, as the headers the gateway's IGDB route reads. */
export function igdbCredentialHeaders(id: string, secret: string): Record<string, string> {
  return { 'X-IGDB-Client-Id': id.trim(), 'X-IGDB-Client-Secret': secret.trim() }
}

/**
 * POST an APIcalypse query to IGDB through the gateway. IGDB sends no CORS
 * headers and only takes an app token minted with a secret, so the Worker
 * mints it — with the app's own Twitch app, or the user's when they added one
 * (never stored) — and forwards the query; its cache is shared by everyone.
 */
export async function igdbQuery(endpoint: string, query: string): Promise<any[]> {
  const base = gatewayUrl()
  if (!base) throw new ApiKeyMissingError('igdb')
  const { igdbClientId, igdbClientSecret } = getSettings()
  const own = igdbClientId.trim() && igdbClientSecret.trim()
  const res = await fetch(`${base}/igdb/${endpoint}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'text/plain',
      ...gatewayHeaders(),
      ...(own ? igdbCredentialHeaders(igdbClientId, igdbClientSecret) : {}),
    },
    body: query,
  })
  if (!res.ok) throw new Error(`IGDB error ${res.status}`)
  return res.json()
}
