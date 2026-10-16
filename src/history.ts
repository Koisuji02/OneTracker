/**
 * The month-by-month history ("Cronologia") and the end-of-month recap.
 *
 * Nothing new is stored: every month is DERIVED from the timestamps the
 * library already keeps, the same way the profile's totals are — so the
 * history reaches back as far as the data does (a TV Time import keeps its
 * original dates), and un-marking something removes it from its month too.
 *
 * What dates a month, per media:
 * - episodes and chapters: the row's `watchedAt`
 * - movies and books: `completedAt`, i.e. when the viewing was closed
 * - games: every finished playthrough carries its own `at`, and a game being
 *   played shows up in EVERY month from the one it was started in (its
 *   `playStartedAt`, or the run's `startedAt`) to the one it was beaten in —
 *   like a series being watched, without counting any time until it's beaten
 * - a series or manga FINISHED in the month: `completedAt` (shown as a flag)
 *
 * The known limit, by construction: a unit or a film keeps only its LATEST
 * date. A rewatch moves the episode to the rewatch's month, and a film seen
 * three times shows up once, in the month of its last viewing. Games are the
 * exception — each run is dated, so each run lands in its own month.
 */
import { defaultEpisodeRuntime, gameBaseHours, gamePlaythroughs, hasUnits, playStart } from './db'
import type { Language } from './settings'
import type { LibraryItem, MediaType, WatchedEpisode } from './types'

/** The four media tabs; the history groups by these, like the profile does. */
export type HistoryKind = 'series' | 'movies' | 'books' | 'games'

export function kindOf(type: MediaType): HistoryKind {
  if (type === 'tv' || type === 'anime') return 'series'
  if (type === 'movie') return 'movies'
  if (type === 'game') return 'games'
  return 'books'
}

/** One title's activity inside one month. */
export interface HistoryEntry {
  item: LibraryItem
  kind: HistoryKind
  /** episodes or chapters marked in the month */
  units: number
  /** movie/book viewings closed, or game runs finished, in the month */
  finished: number
  /** a series/manga that reached `completed` in the month */
  completedHere: boolean
  /** a game being played during the month (started, not yet beaten in it) */
  playing: boolean
  /** minutes the month counts for this title (books have no time) */
  minutes: number
  /** most recent activity in the month (ms) */
  last: number
}

export interface MonthStats {
  /** series + movies + games, the same three the profile total adds up */
  totalMin: number
  seriesMin: number
  movieMin: number
  gameMin: number
  /** tv + anime episodes */
  episodes: number
  /** manga/comic chapters */
  chapters: number
  /** movie viewings closed */
  movies: number
  /** books finished + manga/comics completed */
  books: number
  /** game playthroughs finished */
  games: number
  /** games being played in the month and not beaten in it */
  playing: number
  /** days of the month with at least one thing marked */
  activeDays: number
}

export interface DayActivity {
  /** day of the month, 1-based */
  day: number
  minutes: number
  /** units + finished things, for days that are all chapters/books */
  things: number
}

export interface MonthHistory {
  ym: string
  entries: HistoryEntry[]
  stats: MonthStats
  /** only days with something on them */
  days: DayActivity[]
}

// ---------------------------------------------------------------- months

/** `2026-10` for any instant, in LOCAL time (a month is the user's month). */
export function monthKey(ts: number | Date): string {
  const d = typeof ts === 'number' ? new Date(ts) : ts
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

function parseYm(ym: string): { y: number; m: number } {
  const [y, m] = ym.split('-').map(Number)
  return { y, m: m - 1 }
}

/** Valid `YYYY-MM` (from a URL, say), else null. */
export function validYm(ym: string | null | undefined): string | null {
  if (!ym || !/^\d{4}-(0[1-9]|1[0-2])$/.test(ym)) return null
  return ym
}

/** [start, end) of a month, in ms. */
export function monthBounds(ym: string): [number, number] {
  const { y, m } = parseYm(ym)
  return [new Date(y, m, 1).getTime(), new Date(y, m + 1, 1).getTime()]
}

export function shiftMonth(ym: string, delta: number): string {
  const { y, m } = parseYm(ym)
  return monthKey(new Date(y, m + delta, 1))
}

/** "Ottobre 2026" / "October 2026" (the year only when asked). */
export function monthLabel(ym: string, lang: Language | null, withYear = true): string {
  const { y, m } = parseYm(ym)
  const s = new Date(y, m, 1).toLocaleDateString(lang === 'it' ? 'it-IT' : 'en-US', {
    month: 'long',
    ...(withYear ? { year: 'numeric' } : {}),
  })
  return s.charAt(0).toUpperCase() + s.slice(1)
}

export function dayLabel(ym: string, day: number, lang: Language | null): string {
  const { y, m } = parseYm(ym)
  return new Date(y, m, day).toLocaleDateString(lang === 'it' ? 'it-IT' : 'en-US', {
    day: 'numeric',
    month: 'long',
  })
}

/** The earliest month anything was marked in — where the ← arrow stops. */
export function firstMonth(items: LibraryItem[], eps: WatchedEpisode[], now = Date.now()): string {
  let first = now
  const seen = (ts: number | null | undefined) => {
    if (ts && ts > 0 && ts < first) first = ts
  }
  for (const e of eps) seen(e.watchedAt)
  for (const i of items) {
    seen(i.completedAt)
    if (i.mediaType !== 'game') continue
    for (const r of gamePlaythroughs(i)) {
      seen(r.at)
      seen(r.startedAt)
    }
    if (i.status === 'watching') seen(playStart(i))
  }
  return monthKey(first)
}

// ----------------------------------------------------------------- build

/**
 * Everything marked in one month. Entries are ordered by how much happened
 * (minutes, then units), so the biggest things of the month come first.
 */
export function monthHistory(items: LibraryItem[], eps: WatchedEpisode[], ym: string): MonthHistory {
  const [start, end] = monthBounds(ym)
  const inMonth = (ts: number | null | undefined): ts is number => !!ts && ts >= start && ts < end
  const byId = new Map(items.map((i) => [i.id, i]))
  const entries = new Map<string, HistoryEntry>()
  const days = new Map<number, DayActivity>()

  const entryOf = (item: LibraryItem): HistoryEntry => {
    let e = entries.get(item.id)
    if (!e) {
      e = {
        item,
        kind: kindOf(item.mediaType),
        units: 0,
        finished: 0,
        completedHere: false,
        playing: false,
        minutes: 0,
        last: 0,
      }
      entries.set(item.id, e)
    }
    return e
  }
  const onDay = (ts: number, minutes: number, things: number) => {
    const day = new Date(ts).getDate()
    const d = days.get(day) ?? { day, minutes: 0, things: 0 }
    d.minutes += minutes
    d.things += things
    days.set(day, d)
  }

  for (const ep of eps) {
    if (!inMonth(ep.watchedAt)) continue
    const item = byId.get(ep.itemId)
    if (!item) continue
    const e = entryOf(item)
    e.units++
    e.last = Math.max(e.last, ep.watchedAt)
    // ONE viewing in this month — the row's date is its latest watch
    const min =
      item.mediaType === 'manga' ? 0 : (ep.runtime ?? item.episodeRuntime ?? defaultEpisodeRuntime(item.mediaType))
    e.minutes += min
    onDay(ep.watchedAt, min, 1)
  }

  for (const item of items) {
    if (item.mediaType === 'game') {
      const base = gameBaseHours(item)
      for (const run of gamePlaythroughs(item)) {
        if (!inMonth(run.at)) continue
        const e = entryOf(item)
        const min = Math.round((run.hours ?? base) * 60)
        e.finished++
        e.minutes += min
        e.last = Math.max(e.last, run.at)
        // a run took weeks: its hours belong to the month, not to the day it
        // was closed (or that day would always be the "busiest", at 55 h)
        onDay(run.at, 0, 1)
      }
      // being played: from the month it was started up to (not including) the
      // month it was beaten in, or up to today while it is still being played
      const spans = gamePlaythroughs(item)
        .filter((r) => r.startedAt)
        .map((r) => ({ from: r.startedAt as number, beaten: r.at }))
      if (item.status === 'watching') spans.push({ from: playStart(item), beaten: Infinity })
      for (const { from, beaten } of spans) {
        if (from >= end || beaten < end) continue
        const e = entryOf(item)
        e.playing = true
        e.last = Math.max(e.last, Math.max(from, start))
        // starting a game is something done that day
        if (inMonth(from)) onDay(from, 0, 1)
      }
      continue
    }
    if (item.status !== 'completed' || !inMonth(item.completedAt)) continue
    const e = entryOf(item)
    e.last = Math.max(e.last, item.completedAt)
    if (hasUnits(item.mediaType)) {
      // the units are already counted above; this only flags the finish line
      e.completedHere = true
      continue
    }
    const min = item.mediaType === 'movie' ? (item.runtime ?? 110) : 0
    e.finished++
    e.minutes += min
    onDay(item.completedAt, min, 1)
  }

  const list = [...entries.values()].sort(
    (a, b) => b.minutes - a.minutes || b.units + b.finished - (a.units + a.finished) || b.last - a.last,
  )
  const stats: MonthStats = {
    totalMin: 0,
    seriesMin: 0,
    movieMin: 0,
    gameMin: 0,
    episodes: 0,
    chapters: 0,
    movies: 0,
    books: 0,
    games: 0,
    playing: 0,
    activeDays: days.size,
  }
  for (const e of list) {
    if (e.kind === 'series') {
      stats.seriesMin += e.minutes
      stats.episodes += e.units
    } else if (e.kind === 'movies') {
      stats.movieMin += e.minutes
      stats.movies += e.finished
    } else if (e.kind === 'games') {
      stats.gameMin += e.minutes
      stats.games += e.finished
      if (e.playing && e.finished === 0) stats.playing++
    } else {
      stats.chapters += e.units
      stats.books += e.finished + (e.completedHere ? 1 : 0)
    }
  }
  stats.totalMin = stats.seriesMin + stats.movieMin + stats.gameMin
  return { ym, entries: list, stats, days: [...days.values()].sort((a, b) => a.day - b.day) }
}

/**
 * "1 episodio" / "12 episodi": `key` is the plural i18n key, its singular
 * is the same key without the trailing s (history.episodes -> history.episode).
 */
export function counted(n: number, key: string, t: (k: string) => string): string {
  return `${n} ${noun(n, key, t)}`
}

/** Just the word, singular or plural — the label under a number tile. */
export function noun(n: number, key: string, t: (k: string) => string): string {
  return t(n === 1 ? key.replace(/s$/, '') : key)
}

/** Respect the profile's media switches (books/games can be turned off). */
export function visibleEntries(
  entries: HistoryEntry[],
  show: { showBooks: boolean; showGames: boolean },
): HistoryEntry[] {
  return entries.filter(
    (e) => (e.kind !== 'books' || show.showBooks) && (e.kind !== 'games' || show.showGames),
  )
}

// ---------------------------------------------------------------- recap

export interface MonthRecap {
  ym: string
  stats: MonthStats
  topSeries: HistoryEntry | null
  /** how many series beyond the top one */
  moreSeries: number
  movies: HistoryEntry[]
  topBook: HistoryEntry | null
  topGame: HistoryEntry | null
  busiest: DayActivity | null
  /** the genre most of the month's time went to, when one clearly leads */
  genre: string | null
  /** covers for the closing card, biggest first */
  covers: LibraryItem[]
}

/** The story the end-of-month screen tells, from the month's history. */
export function monthRecap(h: MonthHistory, show: { showBooks: boolean; showGames: boolean }): MonthRecap {
  const entries = visibleEntries(h.entries, show)
  const series = entries.filter((e) => e.kind === 'series')
  const books = entries.filter((e) => e.kind === 'books')
  const games = entries.filter((e) => e.kind === 'games')

  // genres weighted by time, books by units, so a binge outweighs a film
  const weight = new Map<string, number>()
  for (const e of entries) {
    const w = e.minutes || (e.units + e.finished) * 30
    for (const g of new Set(e.item.genres ?? [])) weight.set(g, (weight.get(g) ?? 0) + w)
  }
  const ranked = [...weight.entries()].sort((a, b) => b[1] - a[1])
  // only a CLEAR leader is worth a slide: ahead of the runner-up, and backed
  // by more than one title
  const leader = ranked[0]
  const backers = leader ? entries.filter((e) => e.item.genres?.includes(leader[0])).length : 0
  const genre = leader && backers >= 2 && (!ranked[1] || leader[1] > ranked[1][1]) ? leader[0] : null

  const busiest = h.days.reduce<DayActivity | null>(
    (best, d) => (!best || d.minutes > best.minutes || (d.minutes === best.minutes && d.things > best.things) ? d : best),
    null,
  )

  return {
    ym: h.ym,
    stats: {
      ...h.stats,
      // hidden media must not leak into the numbers either
      ...(show.showBooks ? {} : { chapters: 0, books: 0 }),
      ...(show.showGames ? {} : { games: 0, playing: 0, gameMin: 0, totalMin: h.stats.totalMin - h.stats.gameMin }),
    },
    topSeries: series[0] ?? null,
    moreSeries: Math.max(0, series.length - 1),
    movies: entries.filter((e) => e.kind === 'movies'),
    topBook: [...books].sort((a, b) => b.units + b.finished * 50 - (a.units + a.finished * 50))[0] ?? null,
    topGame: games[0] ?? null,
    // a single busy day is not a "busiest day"
    busiest: h.days.length >= 2 ? busiest : null,
    genre,
    covers: entries.filter((e) => e.item.poster).map((e) => e.item),
  }
}

// ------------------------------------------------- when the recap pops up

/**
 * The month whose recap is due right now, if any: on the LAST day of a month
 * that month itself, otherwise the month just ended — so a recap missed on
 * the 31st still shows at the next opening in the new month, and only then.
 */
export function recapCandidate(now = new Date()): string {
  const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1)
  return tomorrow.getMonth() !== now.getMonth() ? monthKey(now) : shiftMonth(monthKey(now), -1)
}

const SEEN_KEY = 'onetracker.recaps'

/** Per device, like the achievements' "already announced": months shown. */
export function recapSeen(ym: string): boolean {
  try {
    const seen = JSON.parse(localStorage.getItem(SEEN_KEY) ?? '[]') as string[]
    return Array.isArray(seen) && seen.includes(ym)
  } catch {
    return false
  }
}

export function markRecapSeen(ym: string): void {
  try {
    const seen = JSON.parse(localStorage.getItem(SEEN_KEY) ?? '[]') as string[]
    const next = [...new Set([...(Array.isArray(seen) ? seen : []), ym])].sort().slice(-24)
    localStorage.setItem(SEEN_KEY, JSON.stringify(next))
  } catch {
    // storage blocked: worst case the recap shows once more
  }
}
