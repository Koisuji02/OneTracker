/**
 * First-visit tutorials ("tours").
 *
 * The first time the user reaches a screen, a short walk-through points at its
 * parts one at a time: driver.js dims the page around the element and shows a
 * popover next to it. Each tour runs once — finished, closed or skipped, it is
 * marked seen — and Settings → Guida replays any of them (HelpPage).
 *
 * Pages mark what a step points at with `data-tour="…"` and call
 * `useTour(id, ready)` once their data has loaded. A step whose element isn't on
 * screen (an empty library, a section turned off) is dropped, or shown as a
 * centred card when it has a `fallback` text instead.
 */
import { driver, type Driver, type DriveStep } from 'driver.js'
import 'driver.js/dist/driver.css'
import { Capacitor } from '@capacitor/core'
import { useEffect, useRef, useState } from 'react'
import { useBackInterceptor } from './back'
import { translate } from './i18n'
import { getSettings, updateSettings, useSettings, type Settings } from './settings'

export type TourId = 'series' | 'movies' | 'books' | 'games' | 'search' | 'account' | 'settings' | 'detail'

interface TourStep {
  /** `data-tour` value of the element; none = a centred card */
  anchor?: string
  /** i18n base: `tour.<id>.<text>.title` / `.body` */
  text: string
  /** text for a centred card when the anchor isn't on screen */
  fallback?: string
  side?: 'top' | 'bottom' | 'left' | 'right'
  /** extra condition (platform, sections turned on) */
  when?: (s: Settings) => boolean
}

const android = () => Capacitor.getPlatform() === 'android'

export const TOURS: Record<TourId, TourStep[]> = {
  series: [
    { anchor: 'nav', text: 'nav', side: 'top' },
    { anchor: 'nav-search', text: 'search', side: 'top' },
    { anchor: 'continue', text: 'continue' },
    { anchor: 'planned', text: 'planned' },
    { anchor: 'waiting', text: 'waiting' },
    { anchor: 'view', text: 'view', side: 'bottom' },
  ],
  movies: [
    { anchor: 'continue', text: 'continue' },
    { anchor: 'planned', text: 'planned' },
    { anchor: 'waiting', text: 'waiting' },
    { text: 'rewatch' },
  ],
  books: [
    { anchor: 'continue', text: 'continue' },
    { anchor: 'planned', text: 'planned' },
    { anchor: 'comicvine', text: 'comics', fallback: 'comicsSettings' },
  ],
  games: [
    { anchor: 'continue', text: 'continue' },
    { anchor: 'planned', text: 'planned' },
    { anchor: 'waiting', text: 'waiting' },
    { text: 'hltb' },
  ],
  search: [
    { anchor: 'search-input', text: 'input', side: 'bottom' },
    { text: 'add' },
  ],
  account: [
    { anchor: 'profile', text: 'profile', side: 'bottom' },
    { anchor: 'watch-time', text: 'time' },
    { anchor: 'history', text: 'history' },
    { anchor: 'favorites', text: 'favorites' },
    { anchor: 'lists', text: 'lists' },
    { anchor: 'catalog', text: 'catalog' },
    { anchor: 'collections', text: 'collections' },
    { anchor: 'settings-link', text: 'settings', side: 'bottom' },
  ],
  settings: [
    { anchor: 'theme', text: 'theme' },
    { anchor: 'layout', text: 'layout' },
    { anchor: 'sections', text: 'sections' },
    { anchor: 'keys', text: 'keys' },
    { anchor: 'google', text: 'google' },
    { anchor: 'widget', text: 'widget', when: android },
    { anchor: 'help', text: 'help' },
  ],
  detail: [
    { anchor: 'detail-main', text: 'main' },
    { anchor: 'detail-icons', text: 'icons' },
    { anchor: 'detail-ratings', text: 'ratings' },
    { anchor: 'detail-units', text: 'units', side: 'top' },
    { text: 'layout' },
  ],
}

/**
 * The visible element for an anchor: the nav exists twice (bar and rail, one
 * hidden), and a wrapper whose content rendered nothing has no size.
 */
function pick(anchor: string): Element | undefined {
  return Array.from(document.querySelectorAll(`[data-tour="${anchor}"]`)).find((el) => {
    const r = el.getBoundingClientRect()
    return r.width > 0 && r.height > 0
  })
}

/**
 * Something modal is up — the recap (a real dialog) or one of the bottom
 * sheets and the gallery (full-screen `fixed inset-0 z-50` layers): a tour must
 * not cover it.
 */
function overlayOpen(): boolean {
  return document.querySelector('[role="dialog"], [aria-modal="true"], .fixed.inset-0.z-50') != null
}

function buildSteps(id: TourId, s: Settings): DriveStep[] {
  const t = (key: string) => translate(s.language, key)
  const steps: DriveStep[] = []
  for (const step of TOURS[id]) {
    if (step.when && !step.when(s)) continue
    const el = step.anchor ? pick(step.anchor) : undefined
    if (step.anchor && !el && !step.fallback) continue
    const text = el || !step.fallback ? step.text : step.fallback
    steps.push({
      element: el,
      popover: {
        title: t(`tour.${id}.${text}.title`),
        description: t(`tour.${id}.${text}.body`),
        side: step.side,
        align: 'center',
      },
    })
  }
  return steps
}

/** Turn the tours off from inside one (the link in the first popover). */
function addTurnOff(d: Driver, footer: HTMLElement, label: string): void {
  const off = document.createElement('button')
  off.type = 'button'
  off.className = 'ot-tour-off'
  off.textContent = label
  off.addEventListener('click', () => {
    updateSettings({ toursOff: true })
    d.destroy()
  })
  footer.prepend(off)
}

function start(id: TourId, onEnd: () => void): Driver | null {
  const s = getSettings()
  const steps = buildSteps(id, s)
  if (steps.length === 0) return null
  const t = (key: string) => translate(s.language, key)
  // the search field autofocuses: the keyboard would hide half the screen
  ;(document.activeElement as HTMLElement | null)?.blur?.()
  const d = driver({
    steps,
    showProgress: steps.length > 1,
    progressText: '{{current}} / {{total}}',
    nextBtnText: t('tour.next'),
    prevBtnText: t('tour.back'),
    doneBtnText: t('tour.done'),
    showButtons: ['next', 'previous', 'close'],
    // a tap outside moves on, like the coach marks of most phone apps
    overlayClickBehavior: 'nextStep',
    disableActiveInteraction: true,
    overlayColor: '#000',
    overlayOpacity: 0.72,
    stagePadding: 6,
    stageRadius: 6,
    popoverClass: 'ot-tour',
    popoverOffset: 12,
    onPopoverRender: (popover, { state }) => {
      if (state.activeIndex === 0) addTurnOff(d, popover.footer, t('tour.off'))
    },
    onDestroyed: () => {
      const seen = getSettings().seenTours
      if (!seen.includes(id)) updateSettings({ seenTours: [...seen, id] })
      onEnd()
    },
  })
  d.drive()
  return d
}

/**
 * Run the `id` tour the first time this screen is shown, once `ready` (its data
 * loaded). Waits for any open overlay to go away first; Android back closes it.
 */
export function useTour(id: TourId, ready: boolean): void {
  const { seenTours, toursOff } = useSettings()
  const due = ready && !toursOff && !seenTours.includes(id)
  const [open, setOpen] = useState(false)
  const ref = useRef<Driver | null>(null)
  useBackInterceptor(open, () => ref.current?.destroy())

  useEffect(() => {
    if (!due) return
    let timer = 0
    let tries = 0
    const attempt = () => {
      // the page settles first (lazy images, the recap opening by itself);
      // give up after ~30 s of overlays so a tour never fires at a random time
      if (overlayOpen()) {
        if (++tries < 50) timer = window.setTimeout(attempt, 600)
        return
      }
      ref.current = start(id, () => {
        ref.current = null
        setOpen(false)
      })
      setOpen(ref.current != null)
    }
    timer = window.setTimeout(attempt, 500)
    return () => {
      clearTimeout(timer)
      // leaving the screen mid-tour: close it (it counts as seen)
      if (ref.current?.isActive()) ref.current.destroy()
    }
  }, [due, id])
}

/** Replay one tour (Help page): it shows again on the next visit to its screen. */
export function replayTour(id: TourId): void {
  const s = getSettings()
  updateSettings({ toursOff: false, seenTours: s.seenTours.filter((x) => x !== id) })
}

/** Replay every tour (Help page). */
export function replayAllTours(): void {
  updateSettings({ toursOff: false, seenTours: [] })
}
