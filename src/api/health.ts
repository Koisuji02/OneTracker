/**
 * Provider health check for the Settings diagnostics panel.
 *
 * Every provider is probed with its cheapest real endpoint, in parallel, and
 * the failure is CLASSIFIED — the useful distinction being:
 * - `down`        the service answered, but with an error (their outage)
 * - `unreachable` the request never completed: no DNS/TLS/route. On a browser
 *                 this is indistinguishable from an ISP block, which is exactly
 *                 what happens to MangaDex on networks that filter it.
 * - `badkey`      the service rejected our credentials (401/403)
 * - `nokey`       nothing configured, so the feature is simply off
 */
import { comicvinePing } from './comicvine'
import { gatewayEnabled, gatewayHeaders, gatewayUrl } from './gateway'
import { fetchTimeout } from './http'
import { getSettings } from '../settings'

export type HealthState = 'ok' | 'down' | 'unreachable' | 'badkey' | 'nokey'

export interface ProviderHealth {
  id: string
  label: string
  /** i18n key describing what stops working when this provider is unavailable */
  roleKey: string
  state: HealthState
  ms: number
  /** extra hint (HTTP status, block advice) */
  detail?: string
}

const TIMEOUT = 12_000

/** Run one probe, timing it and mapping any failure onto a HealthState. */
async function probe(
  id: string,
  label: string,
  roleKey: string,
  run: () => Promise<{ state: HealthState; detail?: string }>,
): Promise<ProviderHealth> {
  const t0 = Date.now()
  try {
    const { state, detail } = await run()
    return { id, label, roleKey, state, ms: Date.now() - t0, detail }
  } catch (e) {
    const ms = Date.now() - t0
    // HOW it failed tells us WHO is at fault:
    // - hit our timeout → the host accepted the connection but never answered:
    //   their outage (RAWG behaves exactly like this when it's down)
    // - failed immediately → DNS/TLS never completed: the network is filtering
    //   the host (MangaDex on ISPs that block it)
    const aborted = e instanceof DOMException && e.name === 'AbortError'
    return {
      id,
      label,
      roleKey,
      state: aborted ? 'down' : 'unreachable',
      ms,
      detail: aborted ? 'timeout' : undefined,
    }
  }
}

/** 2xx → ok · 401/403 → badkey · anything else → down (their side). */
function fromStatus(res: Response): { state: HealthState; detail?: string } {
  if (res.ok) return { state: 'ok' }
  if (res.status === 401 || res.status === 403) return { state: 'badkey', detail: `HTTP ${res.status}` }
  return { state: 'down', detail: `HTTP ${res.status}` }
}

export function checkProviders(): Promise<ProviderHealth[]> {
  const s = getSettings()
  const gw = gatewayEnabled()

  return Promise.all([
    // the gateway first: when it's up, everything below is proxied through it,
    // so its state explains the others
    probe('gateway', 'Gateway', 'health.roleGateway', async () => {
      const base = gatewayUrl()
      if (!base) return { state: 'nokey' }
      const res = await fetchTimeout(`${base}/health`, { headers: gatewayHeaders() }, TIMEOUT)
      if (!res.ok) return fromStatus(res)
      // /health reports which secrets the Worker actually holds
      const data = await res.json().catch(() => null)
      const cfg = data?.configured ?? {}
      const missing = ['tmdb', 'rawg', 'omdb', 'comicvine', 'igdb'].filter((k) => !cfg[k])
      return {
        state: 'ok',
        detail: missing.length ? `secrets missing: ${missing.join(', ')}` : 'all secrets set',
      }
    }),

    probe('tmdb', 'TMDB', 'health.roleTmdb', async () => {
      const key = s.tmdbKey.trim()
      // the Worker injects the key when the gateway is on, so probe anyway
      if (!key && !gw) return { state: 'nokey' }
      // v4 read tokens go in the header, v3 keys in the query string
      const isToken = key.startsWith('ey')
      const url = `https://api.themoviedb.org/3/configuration${isToken ? '' : `?api_key=${key}`}`
      const res = await fetchTimeout(
        url,
        isToken ? { headers: { Authorization: `Bearer ${key}` } } : {},
        TIMEOUT,
      )
      return fromStatus(res)
    }),

    probe('anilist', 'AniList', 'health.roleAnilist', async () => {
      const res = await fetchTimeout(
        'https://graphql.anilist.co',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ query: '{Media(id:30656,type:MANGA){id}}' }),
        },
        TIMEOUT,
      )
      return fromStatus(res)
    }),

    probe('mangadex', 'MangaDex', 'health.roleMangadex', async () => {
      const res = await fetchTimeout('https://api.mangadex.org/ping', {}, TIMEOUT)
      return fromStatus(res)
    }),

    probe('jikan', 'Jikan / MAL', 'health.roleJikan', async () => {
      const res = await fetchTimeout('https://api.jikan.moe/v4/manga/656', {}, TIMEOUT)
      return fromStatus(res)
    }),

    probe('rawg', 'RAWG', 'health.roleRawg', async () => {
      const key = s.rawgKey.trim()
      if (!key && !gw) return { state: 'nokey' }
      const res = await fetchTimeout(
        `https://api.rawg.io/api/games/3498?key=${key}`,
        {},
        TIMEOUT,
      )
      return fromStatus(res)
    }),

    probe('openlibrary', 'Open Library', 'health.roleOpenLibrary', async () => {
      const res = await fetchTimeout(
        'https://openlibrary.org/search.json?q=dune&limit=1&fields=key',
        {},
        TIMEOUT,
      )
      return fromStatus(res)
    }),

    probe('omdb', 'OMDb', 'health.roleOmdb', async () => {
      const key = s.omdbKey.trim()
      if (!key && !gw) return { state: 'nokey' }
      const res = await fetchTimeout(
        `https://www.omdbapi.com/?apikey=${key}&i=tt0133093`,
        {},
        TIMEOUT,
      )
      if (!res.ok) return fromStatus(res)
      // OMDb reports auth failures inside a 200 body
      const data = await res.json().catch(() => null)
      if (data?.Response === 'False') {
        const err = String(data.Error ?? '')
        return /key/i.test(err) ? { state: 'badkey', detail: err } : { state: 'down', detail: err }
      }
      return { state: 'ok' }
    }),

    probe('comicvine', 'Comic Vine', 'health.roleComicVine', async () => {
      if (!s.comicvineKey.trim() && !gw) return { state: 'nokey' }
      // JSONP: no CORS, so a failure can't be told apart from a block
      const code = await comicvinePing()
      if (code === 1) return { state: 'ok' }
      return { state: code === 100 || code === 102 ? 'badkey' : 'down', detail: `status ${code}` }
    }),
  ])
}
