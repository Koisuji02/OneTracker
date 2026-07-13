/**
 * fetch with a hard timeout. A throttled/hung provider must never leave a
 * pending promise forever (it deadlocked manga detail pages when MangaDex
 * kept connections open): after `ms` the request aborts and the caller's
 * normal error handling (fallbacks, cached copies) kicks in.
 */
export function fetchTimeout(
  url: string,
  init?: RequestInit,
  ms = 10000,
): Promise<Response> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), ms)
  return fetch(url, { ...init, signal: ctrl.signal }).finally(() => clearTimeout(timer))
}
