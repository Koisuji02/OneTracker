/**
 * Android's back button, for things that are not pages.
 *
 * App.tsx's handler maps back to `nav(-1)`. That is right for pages and
 * wrong for a full-screen overlay (the month recap): the page underneath
 * would navigate away while the overlay stayed on top. An overlay registers
 * here while it is open, and the newest one gets the back press instead.
 */
import { useEffect, useRef } from 'react'

const stack: Array<() => void> = []

/** While `active`, the Android back button calls `onBack` instead of navigating. */
export function useBackInterceptor(active: boolean, onBack: () => void): void {
  const ref = useRef(onBack)
  ref.current = onBack
  useEffect(() => {
    if (!active) return
    const handler = () => ref.current()
    stack.push(handler)
    return () => {
      const i = stack.lastIndexOf(handler)
      if (i >= 0) stack.splice(i, 1)
    }
  }, [active])
}

/** For the back-button handler: true when an overlay took the press. */
export function consumeBack(): boolean {
  const top = stack[stack.length - 1]
  if (!top) return false
  top()
  return true
}
