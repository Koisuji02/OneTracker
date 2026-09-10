/**
 * fetch with a hard timeout. A throttled/hung provider must never leave a
 * pending promise forever (it deadlocked manga detail pages when MangaDex
 * kept connections open): after `ms` the request aborts and the caller's
 * normal error handling (fallbacks, cached copies) kicks in.
 *
 * This is also the ONE place where provider URLs get rewritten onto the
 * optional API gateway (see api/gateway.ts), so every provider module benefits
 * without knowing the gateway exists.
 */
import { gatewayHeaders, proxyApi } from './gateway'

export function fetchTimeout(url: string, init?: RequestInit, ms = 10000): Promise<Response> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), ms)
  const target = proxyApi(url)
  const headers =
    target === url ? init?.headers : { ...(init?.headers as Record<string, string>), ...gatewayHeaders() }
  return fetch(target, { ...init, headers, signal: ctrl.signal }).finally(() => clearTimeout(timer))
}
