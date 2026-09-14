/**
 * "How long did you play it?" — the sheet that opens when a game is marked
 * completed (or sent into a replay round), from the detail page's state picker
 * or the ✓ on a Games card.
 *
 * It is the ONLY place personal game hours are entered: a game's hours are the
 * hours of a finished playthrough, so an always-editable field on the detail
 * page invited a number for a game still in progress — which then counted in
 * the totals for something never finished.
 *
 * The two choices are exclusive: type your own hours, or take HowLongToBeat's
 * main-story time (`null`, which lets the baseline keep tracking HLTB).
 */
import { ArrowLeft, Clock } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useT } from '../i18n'
import type { GameLength } from '../types'

/** HowLongToBeat's own dark-navy / blue identity, like the rating banners. */
const HLTB_BG = '#12283C'
const HLTB_BLUE = '#5FA8E8'

function HltbMark() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5 shrink-0" aria-hidden>
      {/* stopwatch: the "how long" cue, drawn here rather than shipped as art */}
      <circle cx="12" cy="13.5" r="7.5" fill="none" stroke={HLTB_BLUE} strokeWidth="2" />
      <path
        d="M12 9.5 V13.5 L14.8 15.4"
        fill="none"
        stroke={HLTB_BLUE}
        strokeWidth="2"
        strokeLinecap="round"
      />
      <path d="M9.6 3.2 h4.8 v1.9 h-4.8 z" fill={HLTB_BLUE} />
    </svg>
  )
}

const DIGITS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]
/** Item height in px — the roller's geometry is computed from it. */
const ITEM = 44
/** Odd number of stacked 0–9 runs, so there is a true middle run to snap back to. */
const RUNS = 11
const MID = Math.floor(RUNS / 2)

/**
 * One digit wheel, endless in both directions like a suitcase lock: the 0–9 run
 * is stacked `RUNS` times and, once a flick settles, the scroll position hops
 * silently back to the middle run — so the user can keep spinning either way
 * and never hits an end.
 */
function DigitWheel({
  value,
  onChange,
  label,
}: {
  value: number
  onChange: (d: number) => void
  label: string
}) {
  const ref = useRef<HTMLDivElement>(null)
  const settle = useRef<ReturnType<typeof setTimeout> | null>(null)
  const start = useRef(value)

  useEffect(() => {
    const el = ref.current
    if (el) el.scrollTop = (MID * 10 + start.current) * ITEM
  }, [])

  const onScroll = () => {
    const el = ref.current
    if (!el) return
    if (settle.current) clearTimeout(settle.current)
    settle.current = setTimeout(() => {
      const idx = Math.round(el.scrollTop / ITEM)
      const digit = ((idx % 10) + 10) % 10
      const mid = MID * 10 + digit
      // re-centre only when a run away, so a normal flick is never interrupted
      if (Math.abs(idx - mid) >= 10) el.scrollTop = mid * ITEM
      onChange(digit)
    }, 130)
  }

  return (
    <div
      ref={ref}
      onScroll={onScroll}
      aria-label={label}
      className="no-scrollbar snap-y snap-mandatory overflow-y-auto overscroll-contain rounded-xl bg-surface"
      style={{
        height: ITEM * 3,
        width: 42,
        scrollbarWidth: 'none',
        // the rows outside the window fade out, so the selected digit reads
        maskImage: 'linear-gradient(transparent, #000 32%, #000 68%, transparent)',
        WebkitMaskImage: 'linear-gradient(transparent, #000 32%, #000 68%, transparent)',
      }}
    >
      <div style={{ paddingTop: ITEM, paddingBottom: ITEM }}>
        {Array.from({ length: RUNS }).flatMap((_, run) =>
          DIGITS.map((d) => (
            <div
              key={`${run}-${d}`}
              className="snap-center text-center text-xl font-black tabular-nums"
              style={{ height: ITEM, lineHeight: `${ITEM}px` }}
            >
              {d}
            </div>
          )),
        )}
      </div>
    </div>
  )
}

const pad = (n: number) => String(Math.min(99999, Math.max(0, n))).padStart(5, '0')

/**
 * 5 wheels = 1…99999 hours.
 *
 * `onChange` takes an UPDATER, not a value: two wheels can settle in the same
 * tick (a flick that carries momentum on both), and rebuilding the number from
 * a captured `value` would let the second write throw away the first.
 */
function HourRoller({
  value,
  onChange,
}: {
  value: number
  onChange: (update: (prev: number) => number) => void
}) {
  const digits = pad(value).split('').map(Number)
  const set = (pos: number, d: number) =>
    onChange((prev) => {
      const next = pad(prev).split('')
      next[pos] = String(d)
      return Number(next.join(''))
    })
  return (
    <div className="relative flex items-center justify-center gap-1.5">
      {/* the lock's window: the selected row sits between these two hairlines */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 border-y border-accent/70"
        style={{ height: ITEM, top: ITEM }}
      />
      {digits.map((d, i) => (
        <DigitWheel key={i} value={d} label={`digit ${5 - i}`} onChange={(n) => set(i, n)} />
      ))}
      <span className="ml-1 text-sm font-bold text-ink3">h</span>
    </div>
  )
}

export default function GameTimeDialog({
  title,
  round,
  length,
  initial,
  onConfirm,
  onClose,
}: {
  title: string
  /** playthrough this mark closes: 1 = first completion, 2+ = replay round */
  round: number
  length: GameLength | null
  /** hours already stored for the game, prefilled into the wheels */
  initial: number | null
  /** hours to store — `null` means "keep using the how-long-to-beat time" */
  onConfirm: (hours: number | null) => void
  onClose: () => void
}) {
  const t = useT()
  const base = length?.main ?? length?.plus ?? length?.full ?? null
  const [manual, setManual] = useState(false)
  const [hours, setHours] = useState(initial ?? base ?? 0)

  const breakdown = [
    [t('games.lengthMain'), length?.main],
    [t('games.lengthPlus'), length?.plus],
    [t('games.lengthFull'), length?.full],
  ].filter((x): x is [string, number] => typeof x[1] === 'number' && x[1] > 0)

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 sm:items-center"
      onClick={onClose}
    >
      <div
        className="fade-up pb-safe-sheet w-full max-w-sm rounded-t-3xl border border-line bg-card p-5 sm:rounded-3xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2">
          {manual && (
            <button
              onClick={() => setManual(false)}
              aria-label={t('common.cancel')}
              className="grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-line text-ink3 transition-colors hover:border-accent hover:text-accent"
            >
              <ArrowLeft size={15} />
            </button>
          )}
          <div className="min-w-0 flex-1 text-center">
            <div className="truncate text-base font-bold">{title}</div>
            <div className="text-xs font-semibold text-accent">
              {round >= 2 ? `${t('games.replayed')} x${round}` : t('games.completed')}
            </div>
          </div>
          {manual && <span className="h-8 w-8 shrink-0" aria-hidden />}
        </div>

        <div className="mt-4 text-center text-sm text-ink2">{t('games.howLongQ')}</div>

        {manual ? (
          <div className="mt-4">
            <HourRoller value={hours} onChange={setHours} />
            <button
              disabled={hours < 1}
              onClick={() => onConfirm(hours)}
              className="mt-5 w-full rounded-2xl bg-brand py-3 text-sm font-bold text-black transition-transform active:scale-95 disabled:opacity-40"
            >
              {t('common.confirm')}
            </button>
          </div>
        ) : (
          <>
            <div className="mt-4 grid grid-cols-2 gap-2.5">
              <button
                onClick={() => setManual(true)}
                className="flex flex-col items-center justify-center gap-1.5 rounded-2xl border border-line bg-card2 py-4 transition-colors hover:border-accent hover:text-accent"
              >
                <Clock size={20} />
                <span className="text-xs font-bold">{t('games.enterTime')}</span>
              </button>
              <button
                disabled={base == null}
                onClick={() => onConfirm(null)}
                className="flex flex-col items-center justify-center gap-1.5 rounded-2xl py-4 shadow-md transition-transform active:scale-95 disabled:opacity-40"
                style={{
                  background: HLTB_BG,
                  color: '#ffffff',
                  border: '1px solid rgba(255,255,255,0.14)',
                }}
              >
                <HltbMark />
                <span className="text-[11px] font-bold leading-none" style={{ color: HLTB_BLUE }}>
                  HowLongToBeat
                </span>
                <span className="text-sm font-black tabular-nums">
                  {base != null ? `${base} h` : t('games.noHltb')}
                </span>
              </button>
            </div>
            {breakdown.length > 0 && (
              <div className="mt-3 flex justify-center gap-4 text-[11px] text-ink4">
                {breakdown.map(([label, h]) => (
                  <span key={label}>
                    {label} <span className="font-bold text-ink2">{h} h</span>
                  </span>
                ))}
              </div>
            )}
          </>
        )}

        <button onClick={onClose} className="mt-3 w-full py-1 text-sm font-semibold text-ink3">
          {t('common.cancel')}
        </button>
      </div>
    </div>
  )
}
