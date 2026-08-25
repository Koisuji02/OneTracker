/**
 * Home-screen widget bridge (phase 1). Computes the "Continue" list exactly
 * like the app's home tabs (series/anime, manga, games — movies are single so
 * they have no continue state) plus the current theme colors, and pushes them
 * to the native widget through the OneWidget Capacitor plugin. No-op on web.
 */
import { Capacitor, registerPlugin } from '@capacitor/core'
import {
  db,
  epKey,
  isWaiting,
  markRewatchUnit,
  markUpTo,
  seasonsOf,
  setSingleStatus,
  totalEpisodesOf,
  unitAired,
} from './db'
import { getSettings } from './settings'
import { THEMES } from './themes'
import type { LibraryItem, WatchedEpisode } from './types'
import { seasonEpisodeLabel } from './util'

interface WidgetPlugin {
  update(opts: { data: string }): Promise<void>
  /** returns the ✓-taps queued while the app was closed, and clears them */
  drain(): Promise<{ actions: string[] }>
}
const OneWidget = registerPlugin<WidgetPlugin>('OneWidget')

type WidgetCategory = 'series' | 'movies' | 'books' | 'games'

/** One ✓-step: the label the row shows and the mark payload the tap queues. */
interface WidgetStep {
  sub: string
  mark: string
}

interface WidgetEntry {
  category: WidgetCategory
  title: string
  sub: string
  poster: string | null
  route: string
  order: number
  /** what the widget's ✓ button marks now: "ep:S:E" · "rw:S:E:G" · "single" · null */
  mark: string | null
  /** upcoming steps the widget shifts through natively on each ✓ tap */
  next: WidgetStep[]
}

/** Chapters offered past the known total when the released count is unknown. */
const MANGA_FALLBACK_STEPS = 100

/**
 * ALL remaining unwatched units in watch order, labelled like the app
 * ("S01E05"). Stops at the first unit that hasn't aired yet — the widget
 * must never offer a ✓ on locked content.
 */
function episodeSteps(item: LibraryItem, watchedKeys: Set<string>): WidgetStep[] {
  const steps: WidgetStep[] = []
  for (const s of seasonsOf(item)) {
    for (let e = 1; e <= s.episodeCount; e++) {
      if (!unitAired(item, s.number, e)) return steps
      if (watchedKeys.has(epKey(item.id, s.number, e))) continue
      steps.push({ sub: seasonEpisodeLabel(s.number, e), mark: `ep:${s.number}:${e}` })
    }
  }
  return steps
}

/** All units still below the active rewatch grade (mirrors computeNextRewatch). */
function rewatchSteps(item: LibraryItem, episodes: WatchedEpisode[]): WidgetStep[] {
  if (episodes.length === 0) return []
  const grade = Math.max(...episodes.map((e) => e.count ?? 1))
  if (grade < 2) return []
  const byKey = new Map(episodes.map((e) => [e.id, e]))
  const steps: WidgetStep[] = []
  for (const s of seasonsOf(item)) {
    for (let e = 1; e <= s.episodeCount; e++) {
      const row = byKey.get(epKey(item.id, s.number, e))
      if (row && (row.count ?? 1) >= grade) continue
      steps.push({
        sub: `${seasonEpisodeLabel(s.number, e)} · x${grade}`,
        mark: `rw:${s.number}:${e}:${grade}`,
      })
    }
  }
  return steps
}

/** All chapters up to the released total (bounded fallback when unknown). */
function mangaSteps(item: LibraryItem, readCount: number): WidgetStep[] {
  const total = totalEpisodesOf(item)
  const last = total ?? readCount + MANGA_FALLBACK_STEPS
  const steps: WidgetStep[] = []
  for (let n = readCount + 1; n <= last; n++) {
    steps.push({ sub: `Cap. ${n}`, mark: `ep:1:${n}` })
  }
  return steps
}

function themeVars() {
  const s = getSettings()
  const th = THEMES.find((t) => t.id === s.theme) ?? THEMES[0]
  const { surface, card, ink, ink3, accent } = th.vars
  return { surface, card, ink, ink3, accent }
}

/** Recompute the continue list and push it (+theme) to the native widget. */
export async function syncWidget(): Promise<void> {
  if (!Capacitor.isNativePlatform()) return
  try {
    const [items, eps] = await Promise.all([db.items.toArray(), db.episodes.toArray()])
    const watchedKeys = new Set(eps.map((e) => e.id))
    const counts = new Map<string, number>()
    const lastWatched = new Map<string, number>()
    const epsByItem = new Map<string, WatchedEpisode[]>()
    for (const e of eps) {
      counts.set(e.itemId, (counts.get(e.itemId) ?? 0) + 1)
      lastWatched.set(e.itemId, Math.max(lastWatched.get(e.itemId) ?? 0, e.watchedAt))
      const l = epsByItem.get(e.itemId)
      if (l) l.push(e)
      else epsByItem.set(e.itemId, [e])
    }

    const routeOf = (i: LibraryItem) => `/media/${i.provider}/${i.mediaType}/${i.providerId}`
    const entries: WidgetEntry[] = []

    const push = (
      item: LibraryItem,
      category: WidgetCategory,
      sub: string,
      order: number,
      mark: string | null,
      next: WidgetStep[] = [],
    ) =>
      entries.push({
        category,
        title: item.title,
        sub,
        poster: item.poster ?? null,
        route: routeOf(item),
        order,
        mark,
        next,
      })

    for (const item of items) {
      const order = lastWatched.get(item.id) ?? item.addedAt ?? 0
      const count = counts.get(item.id) ?? 0
      // only actionable "Continue" — Waiting and Archived items are excluded
      if (item.archived || isWaiting(item, watchedKeys)) continue

      if (item.mediaType === 'tv' || item.mediaType === 'anime') {
        if (item.status === 'watching') {
          const steps = episodeSteps(item, watchedKeys)
          if (steps.length > 0)
            push(item, 'series', steps[0].sub, order, steps[0].mark, steps.slice(1))
          else push(item, 'series', '▶', order, null)
        } else if (item.status === 'completed') {
          const steps = rewatchSteps(item, epsByItem.get(item.id) ?? [])
          if (steps.length > 0)
            push(item, 'series', steps[0].sub, order, steps[0].mark, steps.slice(1))
        }
      } else if (item.mediaType === 'manga' && item.status === 'watching') {
        const steps = mangaSteps(item, count)
        if (steps.length > 0)
          push(item, 'books', steps[0].sub, order, steps[0].mark, steps.slice(1))
        else push(item, 'books', `Cap. ${count + 1}`, order, `ep:1:${count + 1}`)
      } else if (item.mediaType === 'book' && item.status === 'watching') {
        push(item, 'books', 'In corso', order, 'single')
      } else if (item.mediaType === 'movie' && item.status === 'watching') {
        push(item, 'movies', 'In corso', order, 'single')
      } else if (item.mediaType === 'game' && item.status === 'watching') {
        push(item, 'games', 'In corso', order, 'single')
      }
    }

    entries.sort((a, b) => b.order - a.order)
    const payload = {
      theme: themeVars(),
      items: entries.slice(0, 50).map(({ order: _order, ...e }) => e),
    }
    await OneWidget.update({ data: JSON.stringify(payload) })
  } catch {
    // best-effort: also swallows the "not implemented" reject on web/older builds
  }
}

/**
 * Apply the ✓ taps the widget queued while the app wasn't running, then repush.
 * A queued action is `${route}##${mark}` (mark = "ep:S:E" | "rw:S:E:G" | "single").
 * Run on app launch/resume so widget marks reconcile into the library.
 */
export async function drainWidgetActions(): Promise<void> {
  if (!Capacitor.isNativePlatform()) return
  let actions: string[] = []
  try {
    actions = (await OneWidget.drain())?.actions ?? []
  } catch {
    return
  }
  if (actions.length === 0) return
  for (const a of actions) {
    try {
      const [route, mark] = a.split('##')
      const parts = route.split('/') // ['', 'media', provider, mediaType, providerId]
      const item = await db.items.get(`${parts[2]}:${parts[4]}`)
      if (!item || !mark) continue
      if (mark === 'single') {
        await setSingleStatus(item.id, 'completed')
      } else if (mark.startsWith('ep:')) {
        const [, s, e] = mark.split(':')
        await markUpTo(item, Number(s), Number(e))
      } else if (mark.startsWith('rw:')) {
        const [, s, e, g] = mark.split(':')
        await markRewatchUnit(item, Number(s), Number(e), Number(g))
      }
    } catch {
      // skip a malformed/failed action, keep applying the rest
    }
  }
  await syncWidget()
}
