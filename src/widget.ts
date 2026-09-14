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
  lastActivity,
  logGamePlaythrough,
  markRewatchUnit,
  markUpTo,
  seasonsOf,
  setSingleStatus,
  totalEpisodesOf,
  unitActivity,
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

/**
 * All units still below the active rewatch grade (mirrors computeNextRewatch).
 * `label` names a unit the way its tab does — S01E05 for series, "Cap. 5" for
 * manga — so a re-read round reads like the chapters next to it.
 */
function rewatchSteps(
  item: LibraryItem,
  episodes: WatchedEpisode[],
  label: (season: number, episode: number) => string = seasonEpisodeLabel,
): WidgetStep[] {
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
        sub: `${label(s.number, e)} · x${grade}`,
        mark: `rw:${s.number}:${e}:${grade}`,
      })
    }
  }
  return steps
}

/** Row label of a single in progress — with the round when it's a rewatch. */
function inProgress(item: LibraryItem): string {
  const g = item.watchCount ?? 1
  return g >= 2 ? `In corso | x${g}` : 'In corso'
}

/** Chapter label for manga rewatch steps (chapters are season-1 episodes). */
const chapterLabel = (_season: number, episode: number) => `Cap. ${episode}`

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
  // card2 + line draw the rows (a filled card with a real border reads as a
  // separate, tappable item — plain `card` on an AMOLED theme is invisible),
  // ink2 draws the un-ticked check so it looks pressable and not already done
  const { surface, card, card2, line, ink, ink2, ink3, accent } = th.vars
  return { surface, card, card2, line, ink, ink2, ink3, accent }
}

/** Recompute the continue list and push it (+theme) to the native widget. */
export async function syncWidget(): Promise<void> {
  if (!Capacitor.isNativePlatform()) return
  try {
    const [items, eps] = await Promise.all([db.items.toArray(), db.episodes.toArray()])
    const watchedKeys = new Set(eps.map((e) => e.id))
    const counts = new Map<string, number>()
    const epsByItem = new Map<string, WatchedEpisode[]>()
    for (const e of eps) {
      counts.set(e.itemId, (counts.get(e.itemId) ?? 0) + 1)
      const l = epsByItem.get(e.itemId)
      if (l) l.push(e)
      else epsByItem.set(e.itemId, [e])
    }
    const activity = unitActivity(eps)

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
      // same ordering key as the app's Continue lists: the last mark of any
      // kind (episode, chapter, rewatch, single) floats the item to the top
      const order = lastActivity(item, activity)
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
      } else if (item.mediaType === 'manga' && item.status === 'completed') {
        // a finished manga with an open re-read round, like series rewatches
        const steps = rewatchSteps(item, epsByItem.get(item.id) ?? [], chapterLabel)
        if (steps.length > 0)
          push(item, 'books', steps[0].sub, order, steps[0].mark, steps.slice(1))
      } else if (item.mediaType === 'book' && item.status === 'watching') {
        push(item, 'books', inProgress(item), order, 'single')
      } else if (item.mediaType === 'movie' && item.status === 'watching') {
        push(item, 'movies', inProgress(item), order, 'single')
      } else if (item.mediaType === 'game' && item.status === 'watching') {
        push(item, 'games', inProgress(item), order, 'single')
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
        // a game's hours are a per-run choice the home screen can't offer, so a
        // widget ✓ records the run at the how-long-to-beat time (the default)
        if (item.mediaType === 'game') await logGamePlaythrough(item.id, null)
        else await setSingleStatus(item.id, 'completed')
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
