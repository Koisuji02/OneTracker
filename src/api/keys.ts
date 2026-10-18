/**
 * Checks a user's key against its service, with ONE cheap call — what the key
 * guides run before saving, and what Settings → provider check reports. The
 * call goes to the service itself, never to the gateway's shared cache (which
 * would answer whatever the key).
 *
 * ok = the service accepted it · badkey = it refused it · down = no answer
 * (offline, the service or the gateway is down), so nothing can be said.
 */
import type { KeyService } from '../keys'
import { comicvinePing } from './comicvine'
import { gatewayHeaders, gatewayUrl, igdbCredentialHeaders } from './gateway'
import { fetchDirect } from './http'

export type KeyCheck = 'ok' | 'badkey' | 'down'

const TIMEOUT = 8000

const byStatus = (res: Response): KeyCheck =>
  res.ok ? 'ok' : res.status === 401 || res.status === 403 ? 'badkey' : 'down'

async function tmdb(key: string): Promise<KeyCheck> {
  // v4 read tokens go in the header, v3 keys in the query string
  const isToken = key.startsWith('ey')
  const url = `https://api.themoviedb.org/3/configuration${isToken ? '' : `?api_key=${encodeURIComponent(key)}`}`
  return byStatus(await fetchDirect(url, isToken ? { headers: { Authorization: `Bearer ${key}` } } : {}, TIMEOUT))
}

async function igdb(id: string, secret: string): Promise<KeyCheck> {
  const base = gatewayUrl()
  if (!base) return 'down'
  const res = await fetchDirect(
    `${base}/igdb/games`,
    {
      method: 'POST',
      // X-OT-Verify: the Worker asks Twitch instead of its cache
      headers: {
        'Content-Type': 'text/plain',
        'X-OT-Verify': '1',
        ...gatewayHeaders(),
        ...igdbCredentialHeaders(id, secret),
      },
      body: 'fields id; where id = 1942; limit 1;',
    },
    TIMEOUT,
  )
  return byStatus(res)
}

async function omdb(key: string): Promise<KeyCheck> {
  const res = await fetchDirect(`https://www.omdbapi.com/?apikey=${encodeURIComponent(key)}&i=tt0133093`, {}, TIMEOUT)
  if (!res.ok) return byStatus(res)
  // OMDb reports a bad key inside a 200 body
  const data = await res.json().catch(() => null)
  if (data?.Response === 'False') return /key/i.test(String(data.Error ?? '')) ? 'badkey' : 'down'
  return 'ok'
}

async function comicvine(key: string): Promise<KeyCheck> {
  const code = await comicvinePing(key)
  return code === 1 ? 'ok' : code === 100 || code === 102 ? 'badkey' : 'down'
}

/** `values` are the service's fields in order (IGDB: id, secret). */
export async function verifyKey(service: KeyService, values: string[]): Promise<KeyCheck> {
  const [a = '', b = ''] = values.map((v) => v.trim())
  try {
    if (service === 'tmdb') return await tmdb(a)
    if (service === 'igdb') return await igdb(a, b)
    if (service === 'omdb') return await omdb(a)
    return await comicvine(a)
  } catch {
    // JSONP (Comic Vine) can't tell a refused key from no network
    return 'down'
  }
}
