/**
 * Connectivity state, in ONE place.
 *
 * OneTracker is a tracker first and a catalog browser second: without a network
 * the library, the progress and the cached artwork must keep working, and only
 * the parts that genuinely need a provider (search, uncached details, Drive)
 * are allowed to degrade. Everything that has to know whether we're online
 * reads it from here.
 *
 * `navigator.onLine` is the signal (it flips reliably in the Android WebView on
 * airplane mode / lost data). It says "there is a network", not "the internet
 * answers", so it's used to CHOOSE A MESSAGE and to skip pointless work — never
 * to block a request that might still succeed.
 */
import { useSyncExternalStore } from 'react'

export function isOnline(): boolean {
  return typeof navigator === 'undefined' || navigator.onLine !== false
}

function subscribe(listener: () => void): () => void {
  window.addEventListener('online', listener)
  window.addEventListener('offline', listener)
  return () => {
    window.removeEventListener('online', listener)
    window.removeEventListener('offline', listener)
  }
}

/** Live connectivity flag for components (re-renders on connect/disconnect). */
export function useOnline(): boolean {
  return useSyncExternalStore(subscribe, isOnline, () => true)
}

/**
 * Run `fn` every time the device comes back online. Returns an unsubscribe.
 * Used by the sync pass (refresh metadata + push the Drive backup).
 */
export function onReconnect(fn: () => void): () => void {
  window.addEventListener('online', fn)
  return () => window.removeEventListener('online', fn)
}
