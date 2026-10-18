/**
 * fetch with a hard timeout. A throttled/hung provider must never leave a
 * pending promise forever (it deadlocked manga detail pages when MangaDex
 * kept connections open): after `ms` the request aborts and the caller's
 * normal error handling (fallbacks, cached copies) kicks in.
 *
 * This is also the ONE place where provider URLs get rewritten onto the
 * optional API gateway (see api/gateway.ts), so every provider module benefits
 * without knowing the gateway exists. Modules build the DIRECT request, key
 * included; here the key moves into the `X-OT-Key` header (the gateway's
 * shared cache is keyed without it), and when the gateway can't help — its
 * free daily requests spent, an outage — the direct request goes out instead.
 */
import { gatewayHeaders, proxyApi } from './gateway'

/** URL parameters that carry a provider key (TMDB / Comic Vine, OMDb). */
const KEY_PARAMS = ['api_key', 'apikey']

/** Straight to `url`, never through the gateway (key checks use this). */
export function fetchDirect(url: string, init?: RequestInit, ms = 10000): Promise<Response> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), ms)
  return fetch(url, { ...init, signal: ctrl.signal }).finally(() => clearTimeout(timer))
}

export async function fetchTimeout(url: string, init?: RequestInit, ms = 10000): Promise<Response> {
  const target = proxyApi(url)
  if (target === url) return fetchDirect(url, init, ms)

  const via = new URL(target)
  const headers: Record<string, string> = { ...(init?.headers as Record<string, string>), ...gatewayHeaders() }
  let key = ''
  for (const p of KEY_PARAMS) {
    const v = via.searchParams.get(p)
    if (v) key = v
    via.searchParams.delete(p)
  }
  const auth = headers.Authorization
  if (auth?.startsWith('Bearer ')) {
    key = auth.slice(7)
    delete headers.Authorization
  }
  if (key) headers['X-OT-Key'] = key
  try {
    const res = await fetchDirect(via.toString(), { ...init, headers }, ms)
    if (res.status !== 429 && res.status < 500) return res
  } catch (e) {
    // a timeout means a slow answer, not a missing gateway: don't wait twice
    if (e instanceof DOMException && e.name === 'AbortError') throw e
    // the gateway is unreachable: the provider itself may not be
  }
  return fetchDirect(url, init, ms)
}
