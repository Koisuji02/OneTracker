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
import { hasKey, type KeyService } from '../keys'
import { getSettings } from '../settings'
import { gatewayHeaders, gatewayUrl } from './gateway'
import { fetchTimeout } from './http'
import { verifyKey } from './keys'

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

/** A keyed provider, probed with the user's own key (api/keys.ts). */
function keyed(service: KeyService, label: string, roleKey: string, values: string[]): Promise<ProviderHealth> {
  return probe(service, label, roleKey, async () => {
    if (!hasKey(service)) return { state: 'nokey' }
    const state = await verifyKey(service, values)
    return { state: state === 'ok' ? 'ok' : state === 'badkey' ? 'badkey' : 'down' }
  })
}

export function checkProviders(): Promise<ProviderHealth[]> {
  const s = getSettings()

  return Promise.all([
    // the gateway first: when it's up, everything below is proxied through it,
    // so its state explains the others
    probe('gateway', 'Gateway', 'health.roleGateway', async () => {
      const base = gatewayUrl()
      if (!base) return { state: 'nokey' }
      const res = await fetchTimeout(`${base}/health`, { headers: gatewayHeaders() }, TIMEOUT)
      if (!res.ok) return fromStatus(res)
      // provider keys are the user's own now: the Worker only proxies
      return { state: 'ok' }
    }),

    keyed('tmdb', 'TMDB', 'health.roleTmdb', [s.tmdbKey]),

    keyed('igdb', 'IGDB', 'health.roleIgdb', [s.igdbClientId, s.igdbClientSecret]),

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

    probe('openlibrary', 'Open Library', 'health.roleOpenLibrary', async () => {
      const res = await fetchTimeout(
        'https://openlibrary.org/search.json?q=dune&limit=1&fields=key',
        {},
        TIMEOUT,
      )
      return fromStatus(res)
    }),

    keyed('omdb', 'OMDb', 'health.roleOmdb', [s.omdbKey]),

    keyed('comicvine', 'Comic Vine', 'health.roleComicVine', [s.comicvineKey]),
  ])
}
