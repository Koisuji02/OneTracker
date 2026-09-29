/**
 * Clash ("Scontro"): pit your favourites of one media against each other, one
 * duel at a time, until only the champion is left.
 *
 * Two routes:
 * - /clash       the home: pick a pool (series, films, books, games), see the
 *                last champions and the hall of fame, resume a clash left open
 * - /clash/play  the duels, then the champion's screen
 *
 * The bracket logic is in src/clash.ts; a finished clash is stored through
 * db.recordClash and counts towards the "Scontri" feat of the medagliere.
 */
import { useLiveQuery } from 'dexie-react-hooks'
import {
  ArrowLeft,
  BookOpen,
  Check,
  Clapperboard,
  Gamepad2,
  ImageOff,
  LogOut,
  RotateCcw,
  Swords,
  Trophy,
  Tv,
  Undo2,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  CLASH_KINDS,
  choose,
  defaultSize,
  duelOf,
  duelsPlayed,
  duelsTotal,
  getActiveClash,
  roundKey,
  setActiveClash,
  sizeOptions,
  standings,
  startClash,
  toEntrant,
  type ClashState,
} from '../clash'
import Cover from '../components/Cover'
import EmptyState from '../components/EmptyState'
import { db, recordClash } from '../db'
import { useT } from '../i18n'
import { useSettings } from '../settings'
import type { ClashEntrant, ClashKind, ClashResult } from '../types'
import { cn, formatDate } from '../util'

const KIND_ICON: Record<ClashKind, LucideIcon> = {
  series: Tv,
  movies: Clapperboard,
  books: BookOpen,
  games: Gamepad2,
}
const KIND_LABEL: Record<ClashKind, string> = {
  series: 'nav.series',
  movies: 'nav.movies',
  books: 'nav.books',
  games: 'nav.games',
}

const routeOf = (e: ClashEntrant) => {
  const [provider, ...rest] = e.id.split(':')
  return `/media/${provider}/${e.mediaType}/${rest.join(':')}`
}

function BackHeader({ title, subtitle }: { title: string; subtitle?: string }) {
  const nav = useNavigate()
  return (
    <header className="flex items-center gap-3 px-4 pb-4 pt-safe">
      <button
        onClick={() => nav(-1)}
        aria-label="back"
        className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-line text-ink2 transition-colors hover:border-accent hover:text-accent"
      >
        <ArrowLeft size={18} />
      </button>
      <div className="min-w-0 flex-1">
        <h1 className="truncate text-2xl font-extrabold tracking-tight">{title}</h1>
        {subtitle && <div className="truncate text-xs text-ink3">{subtitle}</div>}
      </div>
    </header>
  )
}

function Poster({ src, className }: { src?: string | null; className?: string }) {
  return (
    <div className={cn('shrink-0 overflow-hidden bg-card2', className)}>
      {src ? (
        <Cover src={src} persist className="h-full w-full object-cover" />
      ) : (
        <div className="grid h-full w-full place-items-center text-ink4">
          <ImageOff size={18} />
        </div>
      )}
    </div>
  )
}

// ------------------------------------------------------------------- home

/** The sheet that sets up a clash: how many contenders, then go. */
function SetupSheet({
  kind,
  pool,
  onStart,
  onClose,
}: {
  kind: ClashKind
  pool: number
  onStart: (size: number) => void
  onClose: () => void
}) {
  const t = useT()
  const [size, setSize] = useState(() => defaultSize(pool))
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 sm:items-center" onClick={onClose}>
      <div
        className="fade-up pb-safe-sheet w-full max-w-sm rounded-t-3xl border border-line bg-card p-5 sm:rounded-3xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="text-center text-base font-bold">
          {t('clash.title')} | {t(KIND_LABEL[kind])}
        </div>
        <div className="mt-5 text-xs font-bold uppercase tracking-wider text-ink3">{t('clash.howMany')}</div>
        <div className="mt-2.5 flex flex-wrap gap-2">
          {sizeOptions(pool).map((n) => (
            <button
              key={n}
              onClick={() => setSize(n)}
              className={cn(
                'rounded-lg border px-3.5 py-2 text-sm font-bold tabular-nums transition-colors',
                n === size
                  ? 'border-brand bg-brand text-black'
                  : 'border-line text-ink2 hover:border-accent hover:text-accent',
              )}
            >
              {n === pool ? `${t('clash.all')} (${n})` : n}
            </button>
          ))}
        </div>
        {size < pool && <p className="mt-2.5 text-xs text-ink3">{t('clash.randomPick')}</p>}
        <button
          onClick={() => onStart(size)}
          className="mt-5 flex w-full items-center justify-center gap-2 rounded-2xl bg-brand py-3 text-sm font-bold text-black transition-transform active:scale-95"
        >
          <Swords size={16} strokeWidth={2.5} /> {t('clash.start')}
        </button>
        <button onClick={onClose} className="mt-2 w-full py-1 text-sm font-semibold text-ink3">
          {t('common.cancel')}
        </button>
      </div>
    </div>
  )
}

function HallRow({ result, onOpen }: { result: ClashResult; onOpen: () => void }) {
  const t = useT()
  const { language } = useSettings()
  const champion = result.podium[0]
  if (!champion) return null
  return (
    <button
      onClick={onOpen}
      className="flex w-full items-center gap-3 rounded-2xl border border-line bg-card p-2.5 text-left transition-colors hover:border-accent/50"
    >
      <Poster src={champion.poster} className="h-14 w-10 rounded-lg" />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-bold">{champion.title}</span>
        <span className="block truncate text-xs text-ink3">
          {t(KIND_LABEL[result.kind])} | {result.size} {t('clash.contenders')} |{' '}
          {formatDate(new Date(result.finishedAt).toISOString(), language)}
        </span>
      </span>
      <Trophy size={16} className="shrink-0 text-accent" />
    </button>
  )
}

export default function ClashPage() {
  const t = useT()
  const nav = useNavigate()
  const { showBooks, showGames } = useSettings()
  const favorites = useLiveQuery(() => db.items.filter((i) => i.favorite).toArray(), [])
  const history = useLiveQuery(() => db.clashes.orderBy('finishedAt').reverse().toArray(), [])
  const [setup, setSetup] = useState<ClashKind | null>(null)
  // read once per visit: coming back from the duel re-mounts this page
  const [open] = useState(() => getActiveClash())

  if (!favorites || !history) return null

  const kinds = CLASH_KINDS.filter(
    (k) => (k.kind !== 'books' || showBooks) && (k.kind !== 'games' || showGames),
  )
  const poolOf = (kind: ClashKind) =>
    favorites.filter((i) => CLASH_KINDS.find((k) => k.kind === kind)!.matches(i))
  const openState = open?.[open.length - 1]

  const start = (kind: ClashKind, size: number) => {
    setActiveClash([startClash(kind, poolOf(kind).map(toEntrant), size)])
    setSetup(null)
    nav('/clash/play')
  }

  return (
    <div className="pb-8">
      <BackHeader title={t('clash.title')} />

      <p className="px-4 text-sm leading-relaxed text-ink2">{t('clash.intro')}</p>

      {openState && (
        <button
          onClick={() => nav('/clash/play')}
          className="mx-4 mt-5 flex w-[calc(100%-2rem)] items-center gap-3 rounded-2xl border border-brand bg-brand p-4 text-left text-black transition-transform active:scale-[0.99]"
        >
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-black/10">
            <Swords size={18} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block font-bold">{t('clash.resume')}</span>
            <span className="block truncate text-xs text-black/60">
              {t(KIND_LABEL[openState.kind])} | {t(roundKey(openState))} | {t('clash.duel')}{' '}
              {duelsPlayed(openState) + 1} {t('clash.of')} {duelsTotal(openState)}
            </span>
          </span>
        </button>
      )}

      <h2 className="mt-7 px-4 text-lg font-bold">{t('clash.choose')}</h2>
      <div className="mt-3 grid grid-cols-2 gap-3 px-4">
        {kinds.map(({ kind }) => {
          const pool = poolOf(kind)
          const Icon = KIND_ICON[kind]
          const last = history.find((r) => r.kind === kind)?.podium[0]
          const ready = pool.length >= 2
          return (
            <button
              key={kind}
              disabled={!ready}
              onClick={() => setSetup(kind)}
              className="flex flex-col items-stretch gap-3 rounded-2xl border border-line bg-card p-3.5 text-left transition-colors enabled:hover:border-accent/50 enabled:active:scale-[0.99] disabled:opacity-50"
            >
              <span className="flex items-center gap-3">
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-brand/10 text-accent">
                  <Icon size={18} />
                </span>
                <span className="min-w-0">
                  <span className="block truncate font-bold">{t(KIND_LABEL[kind])}</span>
                  <span className="block text-xs tabular-nums text-ink3">
                    {pool.length} {t('clash.favorites')}
                  </span>
                </span>
              </span>
              {!ready ? (
                <span className="text-[11px] leading-snug text-ink4">{t('clash.needTwo')}</span>
              ) : last ? (
                <span className="flex items-center gap-2 rounded-xl bg-card2 p-1.5">
                  <Poster src={last.poster} className="h-9 w-6 rounded-md" />
                  <span className="min-w-0">
                    <span className="block text-[9px] font-bold uppercase tracking-wider text-ink3">
                      {t('clash.lastChampion')}
                    </span>
                    <span className="block truncate text-xs font-semibold">{last.title}</span>
                  </span>
                </span>
              ) : null}
            </button>
          )
        })}
      </div>

      <h2 className="mt-8 flex items-center gap-2 px-4 text-lg font-bold">
        <Trophy size={18} className="text-accent" /> {t('clash.hall')}
      </h2>
      <div className="mt-3">
        {history.length === 0 ? (
          <EmptyState icon={<Trophy size={30} />} text={t('clash.hallEmpty')} />
        ) : (
          <div className="space-y-2 px-4">
            {history.slice(0, 30).map((r) => (
              <HallRow key={r.id} result={r} onOpen={() => r.podium[0] && nav(routeOf(r.podium[0]))} />
            ))}
          </div>
        )}
      </div>

      {setup && (
        <SetupSheet
          kind={setup}
          pool={poolOf(setup).length}
          onStart={(size) => start(setup, size)}
          onClose={() => setSetup(null)}
        />
      )}
    </div>
  )
}

// ------------------------------------------------------------------- play

function Contender({
  entrant,
  state,
  onPick,
}: {
  entrant: ClashEntrant
  state: 'idle' | 'won' | 'lost'
  onPick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onPick}
      disabled={state !== 'idle'}
      className={cn(
        'group min-w-0 text-left transition-all duration-300',
        state === 'won' && 'scale-[1.04]',
        state === 'lost' && 'scale-95 opacity-25',
      )}
    >
      <div
        className={cn(
          'relative aspect-[2/3] overflow-hidden rounded-2xl border-2 bg-card2 transition-colors',
          state === 'won' ? 'border-brand' : 'border-line group-hover:border-accent/60',
        )}
      >
        <Poster src={entrant.poster} className="h-full w-full" />
        {state === 'won' && (
          <span className="absolute right-2 top-2 grid h-8 w-8 place-items-center rounded-lg bg-brand text-black shadow-lg">
            <Check size={16} strokeWidth={3} />
          </span>
        )}
      </div>
      <div className="mt-2 line-clamp-2 text-sm font-bold leading-snug">{entrant.title}</div>
      {entrant.year && <div className="text-xs tabular-nums text-ink3">{entrant.year}</div>}
    </button>
  )
}

/** Squares, like the rest of the app, raining once over the champion. */
function Confetti() {
  const bits = useMemo(
    () =>
      Array.from({ length: 34 }, (_, i) => ({
        left: Math.random() * 100,
        delay: Math.random() * 0.7,
        drift: (Math.random() - 0.5) * 140,
        spin: 360 + Math.random() * 720,
        size: 6 + Math.random() * 6,
        color: ['var(--brand)', 'var(--accent)', '#ffffff', '#f2c94c', '#c9c9d2', '#b9e8f5'][i % 6],
      })),
    [],
  )
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 z-40 overflow-hidden">
      {bits.map((b, i) => (
        <span
          key={i}
          className="confetti"
          style={
            {
              left: `${b.left}%`,
              width: b.size,
              height: b.size,
              background: b.color,
              animationDelay: `${b.delay}s`,
              '--drift': `${b.drift}px`,
              '--spin': `${b.spin}deg`,
            } as React.CSSProperties
          }
        />
      ))}
    </div>
  )
}

function ChampionScreen({ state, onRematch }: { state: ClashState; onRematch: () => void }) {
  const t = useT()
  const nav = useNavigate()
  const ranked = standings(state)
  const champion = ranked[0]
  return (
    <div className="pb-8">
      <Confetti />
      <BackHeader title={t('clash.title')} subtitle={t(KIND_LABEL[state.kind])} />
      <div className="px-4 text-center">
        <div className="inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-accent">
          <Trophy size={14} /> {t('clash.champion')}
        </div>
        <button onClick={() => nav(routeOf(champion))} className="relative mx-auto mt-4 block w-44">
          <Poster src={champion.poster} className="aspect-[2/3] w-full rounded-2xl border-2 border-brand shadow-2xl" />
          <span className="absolute -right-3 -top-3 grid h-11 w-11 place-items-center rounded-xl bg-brand text-black shadow-lg">
            <Trophy size={20} />
          </span>
        </button>
        <h2 className="mt-4 text-2xl font-extrabold tracking-tight">{champion.title}</h2>
        <p className="mt-1 text-sm text-ink3">
          {t('clash.championOf')} {state.entrants.length} {t('clash.contenders')}
        </p>
      </div>

      {ranked.length > 1 && (
        <div className="mx-4 mt-6 space-y-2">
          {ranked.slice(1, 4).map((e, i) => (
            <button
              key={e.id}
              onClick={() => nav(routeOf(e))}
              className="flex w-full items-center gap-3 rounded-2xl border border-line bg-card p-2.5 text-left transition-colors hover:border-accent/50"
            >
              <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-card2 text-sm font-black tabular-nums">
                {i === 0 ? 2 : 3}
              </span>
              <Poster src={e.poster} className="h-12 w-8 rounded-md" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-bold">{e.title}</span>
                <span className="block text-xs text-ink3">
                  {i === 0 ? t('clash.finalist') : t('clash.semifinalist')}
                </span>
              </span>
            </button>
          ))}
        </div>
      )}

      <div className="mx-4 mt-6 flex gap-2">
        <button
          onClick={onRematch}
          className="flex flex-1 items-center justify-center gap-2 rounded-2xl bg-brand py-3 text-sm font-bold text-black transition-transform active:scale-95"
        >
          <RotateCcw size={16} strokeWidth={2.5} /> {t('clash.rematch')}
        </button>
        <button
          onClick={() => nav(-1)}
          className="flex flex-1 items-center justify-center gap-2 rounded-2xl border border-line py-3 text-sm font-bold text-ink2 transition-colors hover:border-accent hover:text-accent"
        >
          {t('clash.otherChallenge')}
        </button>
      </div>
    </div>
  )
}

export function ClashPlayPage() {
  const t = useT()
  const nav = useNavigate()
  const [stack, setStack] = useState<ClashState[] | null>(() => getActiveClash())
  const [picked, setPicked] = useState<string | null>(null)
  const [quitArmed, setQuitArmed] = useState(false)
  const pickTimer = useRef(0)
  const saved = useRef<ClashState | null>(null)
  const state = stack?.[stack.length - 1] ?? null

  // no clash to play (opened cold, e.g. after a restart): back to the home
  useEffect(() => {
    if (!getActiveClash()) nav('/clash', { replace: true })
    // on mount only: quitting leaves through nav(-1) on its own
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // the slot outlives this page, so leaving mid-clash keeps it resumable
  useEffect(() => {
    setActiveClash(stack)
  }, [stack])

  // a champion is crowned exactly once per bracket
  useEffect(() => {
    if (!state?.champion || saved.current === state) return
    saved.current = state
    void recordClash({
      kind: state.kind,
      size: state.entrants.length,
      podium: standings(state).slice(0, 4),
      finishedAt: Date.now(),
    })
  }, [state])

  useEffect(() => () => clearTimeout(pickTimer.current), [])

  useEffect(() => {
    if (!quitArmed) return
    const timer = window.setTimeout(() => setQuitArmed(false), 3000)
    return () => clearTimeout(timer)
  }, [quitArmed])

  const pick = (id: string) => {
    if (picked || !state || state.champion) return
    setPicked(id)
    pickTimer.current = window.setTimeout(() => {
      setStack((s) => (s ? [...s, choose(s[s.length - 1], id)] : s))
      setPicked(null)
    }, 420)
  }
  const undo = () => {
    if (picked) return
    setStack((s) => (s && s.length > 1 ? s.slice(0, -1) : s))
  }

  // ← / → pick, Backspace undoes — for the desktop build
  useEffect(() => {
    if (!state || state.champion) return
    const [a, b] = duelOf(state)
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft') pick(a)
      else if (e.key === 'ArrowRight') pick(b)
      else if (e.key === 'Backspace') undo()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  if (!state) return null

  if (state.champion) {
    return (
      <ChampionScreen
        key={state.entrants.map((e) => e.id).join('|') + state.out.join('|')}
        state={state}
        onRematch={() => setStack([startClash(state.kind, state.entrants, state.entrants.length)])}
      />
    )
  }

  const [a, b] = duelOf(state)
  const byId = new Map(state.entrants.map((e) => [e.id, e]))
  const played = duelsPlayed(state)
  const total = duelsTotal(state)
  const stateOf = (id: string) => (picked ? (picked === id ? 'won' : 'lost') : 'idle')

  return (
    <div className="pb-6">
      <BackHeader title={t('clash.title')} subtitle={t(KIND_LABEL[state.kind])} />

      <div className="px-4">
        <div className="flex items-baseline justify-between gap-3">
          <span className="text-xs font-bold uppercase tracking-wider text-accent">{t(roundKey(state))}</span>
          <span className="text-xs tabular-nums text-ink3">
            {t('clash.duel')} {played + 1} {t('clash.of')} {total}
          </span>
        </div>
        <div className="mt-2 h-1 overflow-hidden rounded-full bg-card2">
          <div
            className="h-full rounded-full bg-brand transition-all duration-500"
            style={{ width: `${(played / total) * 100}%` }}
          />
        </div>
      </div>

      <div key={`${a}|${b}`} className="fade-up relative mt-6 grid grid-cols-2 gap-4 px-4">
        <Contender entrant={byId.get(a)!} state={stateOf(a)} onPick={() => pick(a)} />
        <Contender entrant={byId.get(b)!} state={stateOf(b)} onPick={() => pick(b)} />
        <span className="pointer-events-none absolute left-1/2 top-[34%] grid h-12 w-12 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-xl border-4 border-surface bg-brand text-sm font-black text-black shadow-lg">
          VS
        </span>
      </div>

      <p className="mt-5 text-center text-sm text-ink3">{t('clash.pick')}</p>

      <div className="mt-6 flex gap-2 px-4">
        <button
          onClick={undo}
          disabled={stack!.length <= 1 || !!picked}
          className="flex flex-1 items-center justify-center gap-2 rounded-2xl border border-line py-3 text-sm font-bold text-ink2 transition-colors enabled:hover:border-accent enabled:hover:text-accent disabled:opacity-40"
        >
          <Undo2 size={16} /> {t('clash.undo')}
        </button>
        <button
          onClick={() => {
            if (!quitArmed) return setQuitArmed(true)
            // abandoned for good: nothing to resume from the home
            setActiveClash(null)
            nav(-1)
          }}
          className={cn(
            'flex flex-1 items-center justify-center gap-2 rounded-2xl border py-3 text-sm font-bold transition-colors',
            quitArmed
              ? 'border-red-500 text-red-400'
              : 'border-line text-ink2 hover:border-red-500 hover:text-red-400',
          )}
        >
          <LogOut size={16} /> {quitArmed ? t('clash.quitConfirm') : t('clash.quit')}
        </button>
      </div>
    </div>
  )
}
