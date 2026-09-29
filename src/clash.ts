/**
 * Clash: a single-elimination tournament between favourites, played one duel
 * at a time — tap the one you prefer until only your champion is left.
 *
 * The state is plain immutable data and the play screen keeps a STACK of
 * states, so "undo" is just a pop. The game in progress also sits in a
 * module-level slot: the Android back button takes you from the duel to the
 * clash home and back again without losing a single pick.
 */
import type { ClashEntrant, ClashKind, LibraryItem } from './types'

/** Which favourites play in which pool — the four media tabs. */
export const CLASH_KINDS: Array<{ kind: ClashKind; matches: (i: LibraryItem) => boolean }> = [
  { kind: 'series', matches: (i) => i.mediaType === 'tv' || i.mediaType === 'anime' },
  { kind: 'movies', matches: (i) => i.mediaType === 'movie' },
  { kind: 'books', matches: (i) => i.mediaType === 'book' || i.mediaType === 'manga' },
  { kind: 'games', matches: (i) => i.mediaType === 'game' },
]

export interface ClashState {
  kind: ClashKind
  /** everyone in the bracket, as they looked when it started */
  entrants: ClashEntrant[]
  /** contestants of the round being played, paired (0,1), (2,3)… */
  current: string[]
  /** round one only: who skips it because the field isn't a power of two */
  byes: string[]
  /** index of the duel within `current` */
  duel: number
  /** through to the next round so far */
  next: string[]
  round: number
  /** eliminated, in the order they fell — the standings read it backwards */
  out: string[]
  champion: string | null
}

export function toEntrant(item: LibraryItem): ClashEntrant {
  return {
    id: item.id,
    title: item.title,
    poster: item.poster ?? null,
    year: item.year ?? null,
    mediaType: item.mediaType,
  }
}

function shuffle<T>(list: T[]): T[] {
  const a = [...list]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

/** Bracket sizes on offer: the round numbers below the pool, plus everyone. */
export function sizeOptions(pool: number): number[] {
  return [...[4, 8, 16, 32, 64].filter((n) => n < pool), pool]
}

/** The pick a new clash starts on: everyone up to 16, otherwise a clean 16. */
export const defaultSize = (pool: number) => (pool <= 16 ? pool : 16)

/**
 * Draw `size` contenders at random and seed round one. When the field isn't a
 * power of two, the first few get a bye: round one (the "preliminary") only
 * trims the field down to the next clean bracket.
 */
export function startClash(kind: ClashKind, pool: ClashEntrant[], size: number): ClashState {
  const entrants = shuffle(pool).slice(0, Math.max(2, Math.min(size, pool.length)))
  let bracket = 1
  while (bracket < entrants.length) bracket *= 2
  const byes = bracket - entrants.length
  const ids = entrants.map((e) => e.id)
  return {
    kind,
    entrants,
    current: ids.slice(byes),
    byes: ids.slice(0, byes),
    duel: 0,
    next: [],
    round: 0,
    out: [],
    champion: null,
  }
}

/** The two ids facing each other right now. */
export function duelOf(s: ClashState): [string, string] {
  return [s.current[s.duel * 2], s.current[s.duel * 2 + 1]]
}

/** Alternate byes and winners, so a rested contender meets a fresh winner. */
function interleave(a: string[], b: string[]): string[] {
  const out: string[] = []
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if (i < a.length) out.push(a[i])
    if (i < b.length) out.push(b[i])
  }
  return out
}

/** Settle the current duel in favour of `winner`. */
export function choose(s: ClashState, winner: string): ClashState {
  const [a, b] = duelOf(s)
  const loser = winner === a ? b : a
  const next = [...s.next, winner]
  const out = [...s.out, loser]
  const duel = s.duel + 1
  if (duel * 2 < s.current.length) return { ...s, next, out, duel }
  // round over: the byes join the winners of the preliminary
  const advancing = s.byes.length > 0 ? interleave(s.byes, next) : next
  if (advancing.length === 1) {
    return { ...s, current: [], byes: [], next: [], duel: 0, out, champion: advancing[0] }
  }
  return { ...s, current: advancing, byes: [], next: [], duel: 0, round: s.round + 1, out }
}

/** i18n key naming the round being played. */
export function roundKey(s: ClashState): string {
  if (s.byes.length > 0) return 'clash.prelim'
  switch (s.current.length) {
    case 2:
      return 'clash.final'
    case 4:
      return 'clash.semi'
    case 8:
      return 'clash.quarter'
    case 16:
      return 'clash.r16'
    case 32:
      return 'clash.r32'
    case 64:
      return 'clash.r64'
    default:
      return 'clash.early'
  }
}

/** Duels played / to play in the whole bracket (a knockout of N has N − 1). */
export const duelsPlayed = (s: ClashState) => s.out.length
export const duelsTotal = (s: ClashState) => s.entrants.length - 1

/** Best first: the champion, then everyone in reverse order of elimination. */
export function standings(s: ClashState): ClashEntrant[] {
  const byId = new Map(s.entrants.map((e) => [e.id, e]))
  const order = [...(s.champion ? [s.champion] : []), ...[...s.out].reverse()]
  return order.map((id) => byId.get(id)).filter((e): e is ClashEntrant => !!e)
}

// ---------------------------------------------------------- game in progress

let active: ClashState[] | null = null

/** The unfinished clash (its whole undo stack), if one was left mid-way. */
export function getActiveClash(): ClashState[] | null {
  return active
}

export function setActiveClash(stack: ClashState[] | null): void {
  active = stack && stack.length > 0 && !stack[stack.length - 1].champion ? stack : null
}
