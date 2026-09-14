/**
 * HowLongToBeat — how long a game takes to beat, the number the time stats are
 * built on ("main story", "main + extras", "completionist").
 *
 * HLTB has no public API and no CORS headers, and its search is guarded by a
 * short-lived token bound to the caller's IP, so it can only be reached through
 * the API gateway (`/hltb/search`, see worker/README.md). Without a gateway
 * this module is a no-op and game lengths fall back to IGDB/RAWG.
 *
 * HLTB has no provider ids in common with IGDB or RAWG either, so the lookup is
 * a TITLE match: normalized name (or HLTB's own alias) plus the release year,
 * with the number of submitted times breaking ties. A wrong match here would
 * quietly corrupt the stats, so an unsure result is dropped rather than guessed.
 */
import type { GameLength } from '../types'
import { gatewayEnabled, gatewayHeaders, gatewayUrl } from './gateway'
import { normalizeTitle } from './titleMatch'

/** One trimmed row as the Worker forwards it (times in SECONDS). */
interface HltbRow {
  id: number
  name: string
  alias: string
  year: number | null
  type: string
  main: number
  plus: number
  full: number
  all: number
  coop: number
  versus: number
  samples: number
}

/**
 * Provider titles carry disambiguation cruft that HLTB's index doesn't have:
 * RAWG appends the release year ("God of War (2018)") and store fronts add
 * ™/®. Searching for those verbatim returns nothing at all, so both the query
 * and the match key are built from the cleaned title — the year check below is
 * what still keeps a remake apart from its original.
 */
function cleanTitle(title: string): string {
  const out = title
    .replace(/[™®©]/g, ' ')
    .replace(/\([^()]*\)/g, ' ')
    .replace(/\[[^\]]*\]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return out || title.trim()
}

/** Seconds → whole hours; 0/missing stays null so it never enters the stats. */
const hours = (sec: number): number | null => (sec > 0 ? Math.max(1, Math.round(sec / 3600)) : null)

/**
 * How well a row answers the query. Negative = not this game.
 * Exact normalized title (or alias) is what we really want; a partial match is
 * only accepted when the year agrees, which is what keeps "Elden Ring" from
 * matching "Elden Ring: Nightreign".
 */
function score(row: HltbRow, key: string, year: number | null): number {
  const names = [row.name, row.alias].filter(Boolean).map(normalizeTitle).filter(Boolean)
  if (names.length === 0) return -1
  const exact = names.includes(key)
  const partial = !exact && names.some((n) => n.includes(key) || key.includes(n))
  if (!exact && !partial) return -1

  const bothYears = year != null && row.year != null && row.year > 0
  const yearGap = bothYears ? Math.abs((row.year as number) - year) : null
  // a partial match with a year that disagrees is a different game
  if (partial && (yearGap == null || yearGap > 1)) return -1

  let s = exact ? 100 : 50
  if (yearGap != null) s += yearGap === 0 ? 20 : yearGap <= 1 ? 8 : -40
  // prefer the base game over its DLC when both match equally well
  if (row.type === 'game') s += 6
  // popularity as the tie-breaker: 20k submitted times beats 3
  s += Math.min(12, Math.log10(Math.max(1, row.samples)) * 3)
  return s
}

/** The row's times as the app stores them (hours). Null when HLTB has none. */
function toLength(row: HltbRow): GameLength | null {
  const main = hours(row.main)
  const plus = hours(row.plus)
  const full = hours(row.full)
  // multiplayer-only titles have no completion time at all, just invested hours
  const coop = hours(row.coop) ?? hours(row.versus)
  if (main == null && plus == null && full == null && coop == null) return null
  return {
    main: main ?? coop,
    plus,
    full,
    source: 'hltb',
    samples: row.samples || null,
  }
}

/**
 * Game length from HowLongToBeat, or null when the gateway is off, the lookup
 * fails or no row is a confident match. Never throws: a missing length must
 * degrade the stats, not break a detail page.
 */
export async function hltbLength(title: string, year?: number | null): Promise<GameLength | null> {
  const base = gatewayUrl()
  if (!base || !gatewayEnabled()) return null
  const query = cleanTitle(title)
  const key = normalizeTitle(query)
  if (key.length < 2) return null

  let rows: HltbRow[]
  try {
    // a game page must not wait on a nice-to-have: the length is the LAST hop
    // before the detail page renders, so this timeout is deliberately short
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), 6000)
    const res = await fetch(`${base}/hltb/search`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...gatewayHeaders() },
      body: JSON.stringify({ query }),
      signal: ctrl.signal,
    }).finally(() => clearTimeout(timer))
    if (!res.ok) return null
    rows = ((await res.json())?.data ?? []) as HltbRow[]
  } catch {
    return null // offline, gateway too old to know /hltb, HLTB shape changed…
  }

  let best: HltbRow | null = null
  let bestScore = 0
  for (const row of rows) {
    const s = score(row, key, year ?? null)
    if (s > bestScore) {
      best = row
      bestScore = s
    }
  }
  return best ? toLength(best) : null
}
