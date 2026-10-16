/**
 * The end-of-month recap: a full-screen story, one slide per thing worth
 * telling (time spent, the series of the month, films, books, games, the
 * busiest day, the genre), then a closing card with every cover.
 *
 * Story mechanics: each slide runs for SLIDE_MS with its progress bar
 * filling at the top; tap the right side for the next one, the left side
 * for the previous, hold anywhere to pause. The last slide stays until it is
 * closed. Slides with nothing to say are simply not built.
 *
 * Two ways in: `RecapLauncher` (mounted once in App) opens it by itself at
 * the end of each month, and the History page has a button for any month.
 *
 * The share button (top bar, and on the closing card) sends the month as one
 * story-sized image through the system share sheet — see src/recapShare.ts.
 */
import { useLiveQuery } from 'dexie-react-hooks'
import { Toast } from '@capacitor/toast'
import { CalendarDays, Clapperboard, Gamepad2, History, Share2, Sparkles, Tv, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { useBackInterceptor } from '../back'
import { db } from '../db'
import {
  counted,
  dayLabel,
  markRecapSeen,
  monthHistory,
  monthLabel,
  monthRecap,
  recapCandidate,
  recapSeen,
  noun,
  visibleEntries,
  type HistoryEntry,
  type MonthRecap as Recap,
  type MonthStats,
} from '../history'
import { useT } from '../i18n'
import { renderRecapCard, shareImage } from '../recapShare'
import { getSettings, useSettings } from '../settings'
import type { LibraryItem } from '../types'
import { cn } from '../util'
import Cover from './Cover'
import StatTiles, { type StatTile } from './StatTiles'

const SLIDE_MS = 6000
/** A press shorter than this is a tap (next/previous); longer is a hold (pause). */
const TAP_MS = 250

/** "8 h 20 min" · "45 min" — compact, the same in both languages. */
export function shortTime(min: number): string {
  const m = Math.max(0, Math.round(min))
  if (m < 60) return `${m} min`
  const h = Math.floor(m / 60)
  const rest = m % 60
  return rest ? `${h} h ${rest} min` : `${h} h`
}

interface Slide {
  key: string
  /** background: a class for colour, or artwork to blur behind the content */
  bg: string
  art?: string | null
  /** dark ink on bright slides (the theme colour), white elsewhere */
  dark?: boolean
  body: ReactNode
}

function Poster({ item, className }: { item: LibraryItem; className?: string }) {
  return (
    <div className={cn('overflow-hidden rounded-xl bg-black/30', className)}>
      {item.poster && <Cover src={item.poster} alt={item.title} persist className="h-full w-full object-cover" />}
    </div>
  )
}

/** Every slide is the same centred column; only what's inside changes. */
function Center({ children }: { children: ReactNode }) {
  return <div className="flex h-full flex-col items-center justify-center text-center">{children}</div>
}

function Lead({ children }: { children: ReactNode }) {
  return <div className="text-xs font-bold uppercase tracking-[0.22em] opacity-80">{children}</div>
}

/** The title under a cover: two lines at most, balanced. */
function Title({ children }: { children: ReactNode }) {
  return (
    <div className="mt-6 line-clamp-2 max-w-full text-3xl font-black leading-tight" style={{ textWrap: 'balance' }}>
      {children}
    </div>
  )
}

/** The month's totals as tiles: what the closing card and History share. */
export function monthTiles(s: MonthStats, t: (k: string) => string, withDays = false): StatTile[] {
  const tile = (n: number, key: string): StatTile => ({ value: n, label: noun(n, key, t) })
  return [
    s.episodes > 0 ? tile(s.episodes, 'history.episodes') : null,
    s.movies > 0 ? tile(s.movies, 'history.movies') : null,
    s.chapters > 0 ? tile(s.chapters, 'history.chapters') : null,
    s.books > 0 ? tile(s.books, 'history.books') : null,
    s.games > 0 ? tile(s.games, 'history.games') : null,
    s.playing > 0 ? tile(s.playing, 'history.playingGames') : null,
    withDays && s.activeDays > 0 ? tile(s.activeDays, 'history.activeDays') : null,
  ].filter((x): x is StatTile => x !== null)
}

function useSlides(
  recap: Recap | null,
  onOpenHistory?: () => void,
  onClose?: () => void,
  onShare?: () => void,
): Slide[] {
  const t = useT()
  const { language: lang } = useSettings()
  if (!recap) return []
  const s = recap.stats
  const slides: Slide[] = []
  const unitsLine = (e: HistoryEntry) =>
    [
      e.units > 0 ? counted(e.units, e.kind === 'books' ? 'history.chapters' : 'history.episodes', t) : null,
      e.minutes > 0 ? shortTime(e.minutes) : null,
    ]
      .filter(Boolean)
      .join(' | ')

  slides.push({
    key: 'intro',
    bg: 'bg-brand',
    dark: true,
    body: (
      <Center>
        <div className="text-2xl font-bold">{t('recap.your')}</div>
        <div className="mt-2 text-6xl font-black leading-none tracking-tight">{monthLabel(recap.ym, lang, false)}</div>
        <div className="mt-3 text-2xl font-bold opacity-50">{recap.ym.slice(0, 4)}</div>
        <div className="mt-12 h-1 w-12 rounded-sm bg-black/80" />
        <div className="mt-6 max-w-[15rem] text-lg font-semibold leading-snug">{t('recap.introSub')}</div>
      </Center>
    ),
  })

  if (s.totalMin > 0) {
    const hours = Math.floor(s.totalMin / 60)
    const parts = [
      { icon: <Tv size={15} />, label: t('nav.series'), min: s.seriesMin },
      { icon: <Clapperboard size={15} />, label: t('nav.movies'), min: s.movieMin },
      { icon: <Gamepad2 size={15} />, label: t('nav.games'), min: s.gameMin },
    ].filter((p) => p.min > 0)
    slides.push({
      key: 'time',
      bg: 'bg-gradient-to-br from-[#24127a] via-[#4c1d95] to-[#7c3aed]',
      body: (
        <Center>
          <Lead>{t('recap.timeLead')}</Lead>
          <div className="mt-4 text-8xl font-black leading-none tracking-tight tabular-nums">
            {hours > 0 ? hours : s.totalMin}
          </div>
          <div className="mt-2 text-3xl font-extrabold">{hours > 0 ? t('recap.hours') : t('recap.minutes')}</div>
          {hours > 0 && s.totalMin % 60 > 0 && (
            <div className="mt-1 text-base font-semibold opacity-60">
              {t('recap.and')} {s.totalMin % 60} min
            </div>
          )}
          <div className="mt-10 w-full max-w-xs space-y-4 text-left">
            {parts.map((p) => (
              <div key={p.label}>
                <div className="mb-1.5 flex items-center gap-2 text-sm font-semibold">
                  {p.icon}
                  <span className="flex-1">{p.label}</span>
                  <span className="tabular-nums opacity-80">{shortTime(p.min)}</span>
                </div>
                <div className="h-2 overflow-hidden rounded-sm bg-white/15">
                  <div className="recap-grow h-full rounded-sm bg-white" style={{ width: `${(p.min / s.totalMin) * 100}%` }} />
                </div>
              </div>
            ))}
          </div>
        </Center>
      ),
    })
  }

  if (recap.topSeries) {
    const e = recap.topSeries
    slides.push({
      key: 'series',
      bg: 'bg-[#101014]',
      art: e.item.backdrop ?? e.item.poster,
      body: (
        <Center>
          <Lead>{t('recap.topSeries')}</Lead>
          <Poster item={e.item} className="mt-7 aspect-[2/3] w-44 shadow-2xl ring-1 ring-white/10" />
          <Title>{e.item.title}</Title>
          <div className="mt-2 text-lg font-semibold opacity-80">{unitsLine(e)}</div>
          {recap.moreSeries > 0 && (
            <div className="mt-6 rounded-lg bg-white/10 px-3 py-1.5 text-sm font-semibold backdrop-blur-sm">
              + {recap.moreSeries} {t(recap.moreSeries === 1 ? 'recap.moreSeriesOne' : 'recap.moreSeries')}
            </div>
          )}
        </Center>
      ),
    })
  }

  if (recap.movies.length > 0) {
    const shown = recap.movies.slice(0, 5)
    const mid = (shown.length - 1) / 2
    slides.push({
      key: 'movies',
      bg: 'bg-gradient-to-br from-[#04352b] via-[#065f46] to-[#0f766e]',
      body: (
        <Center>
          <Lead>{t('recap.moviesLead')}</Lead>
          <div className="mt-4 text-8xl font-black leading-none tabular-nums">{s.movies}</div>
          <div className="mt-2 text-lg font-bold opacity-80">{shortTime(s.movieMin)}</div>
          {/* a fan of covers, centred, the middle one on top */}
          <div className="mt-10 flex justify-center pb-4">
            {shown.map((e, i) => (
              <div
                key={e.item.id}
                className="w-24 shrink-0"
                style={{
                  // fewer covers overlap less: two sit side by side, five fan out
                  marginInline: -(shown.length <= 2 ? 6 : shown.length === 3 ? 14 : 24),
                  transform: `translateY(${Math.abs(i - mid) * 10}px) rotate(${(i - mid) * 7}deg)`,
                  zIndex: 10 - Math.round(Math.abs(i - mid) * 2),
                }}
              >
                <Poster item={e.item} className="aspect-[2/3] w-full shadow-2xl ring-1 ring-black/20" />
              </div>
            ))}
          </div>
          <div className="mt-6 line-clamp-2 max-w-full text-base font-bold">
            {shown.map((e) => e.item.title).join(' | ')}
          </div>
        </Center>
      ),
    })
  }

  if (recap.topBook) {
    const e = recap.topBook
    const tiles: Array<StatTile | null> = [
      s.chapters > 0 ? { value: s.chapters, label: noun(s.chapters, 'history.chapters', t) } : null,
      s.books > 0 ? { value: s.books, label: noun(s.books, 'history.books', t) } : null,
    ]
    const bookTiles = tiles.filter((x): x is StatTile => x !== null)
    slides.push({
      key: 'book',
      bg: 'bg-gradient-to-br from-[#3b0a2e] via-[#701a4b] to-[#9d174d]',
      body: (
        <Center>
          <Lead>{t('recap.bookLead')}</Lead>
          <Poster item={e.item} className="mt-7 aspect-[2/3] w-40 shadow-2xl ring-1 ring-white/10" />
          <Title>{e.item.title}</Title>
          <div className="mt-2 text-lg font-semibold opacity-80">{e.units > 0 ? unitsLine(e) : t('history.read')}</div>
          {bookTiles.length > 1 && <StatTiles tiles={bookTiles} tone="glass" className="mt-8 max-w-xs" />}
        </Center>
      ),
    })
  }

  if (recap.topGame) {
    const e = recap.topGame
    slides.push({
      key: 'game',
      bg: 'bg-[#0d1117]',
      art: e.item.backdrop ?? e.item.poster,
      body: (
        <Center>
          <Lead>{t('recap.gameLead')}</Lead>
          <Poster item={e.item} className="mt-7 aspect-[2/3] w-44 shadow-2xl ring-1 ring-white/10" />
          <Title>{e.item.title}</Title>
          <div className="mt-2 text-lg font-semibold opacity-80">
            {e.finished > 0 ? (
              <>
                {t('history.beaten')}
                {e.finished > 1 ? ` x${e.finished}` : ''} | {shortTime(e.minutes)}
              </>
            ) : (
              t('history.playing')
            )}
          </div>
          {s.games + s.playing > 1 && (
            <div className="mt-6 rounded-lg bg-white/10 px-3 py-1.5 text-sm font-semibold backdrop-blur-sm">
              {[
                s.games > 0 ? `${counted(s.games, 'history.games', t)} | ${shortTime(s.gameMin)}` : null,
                s.playing > 0 ? counted(s.playing, 'history.playingGames', t) : null,
              ]
                .filter(Boolean)
                .join(' | ')}
            </div>
          )}
        </Center>
      ),
    })
  }

  if (recap.busiest) {
    const d = recap.busiest
    slides.push({
      key: 'day',
      bg: 'bg-gradient-to-br from-[#5c1a0b] via-[#9a3412] to-[#ea580c]',
      body: (
        <Center>
          <span className="grid h-16 w-16 place-items-center rounded-2xl bg-white/12">
            <CalendarDays size={32} strokeWidth={2.2} />
          </span>
          <div className="mt-7">
            <Lead>{t('recap.busiestLead')}</Lead>
          </div>
          <div className="mt-4 text-5xl font-black leading-tight">{dayLabel(recap.ym, d.day, lang)}</div>
          <div className="mt-3 text-xl font-bold opacity-85">
            {d.minutes > 0 ? shortTime(d.minutes) : counted(d.things, 'recap.things', t)}
          </div>
          <div className="mt-8 rounded-lg bg-white/10 px-3 py-1.5 text-sm font-semibold backdrop-blur-sm">
            {counted(s.activeDays, 'history.activeDays', t)}
          </div>
        </Center>
      ),
    })
  }

  if (recap.genre) {
    slides.push({
      key: 'genre',
      bg: 'bg-gradient-to-br from-[#082f49] via-[#075985] to-[#0284c7]',
      body: (
        <Center>
          <span className="grid h-16 w-16 place-items-center rounded-2xl bg-white/12">
            <Sparkles size={32} strokeWidth={2.2} />
          </span>
          <div className="mt-7">
            <Lead>{t('recap.genreLead')}</Lead>
          </div>
          <div className="mt-4 max-w-full break-words text-6xl font-black leading-none tracking-tight">{recap.genre}</div>
        </Center>
      ),
    })
  }

  // the closing card: the month, its time, every cover, the totals, the way out
  const covers = recap.covers.slice(0, 9)
  slides.push({
    key: 'outro',
    bg: 'bg-surface',
    body: (
      <Center>
        <div className="w-full rounded-2xl border border-line bg-card p-4 text-ink">
          <div className="text-xl font-black">{monthLabel(recap.ym, lang)}</div>
          {s.totalMin > 0 && (
            <div className="mt-1 text-3xl font-extrabold tracking-tight text-accent">{shortTime(s.totalMin)}</div>
          )}
          {covers.length > 0 && (
            <div className="mt-4 grid grid-cols-3 gap-2">
              {covers.map((c) => (
                <Poster key={c.id} item={c} className="aspect-[2/3] w-full" />
              ))}
            </div>
          )}
          <StatTiles tiles={monthTiles(s, t)} className="mt-3" />
        </div>
        <div className="mt-6 text-lg font-bold text-ink">{t('recap.outro')}</div>
        {onShare && (
          <button
            onClick={(e) => {
              e.stopPropagation()
              onShare()
            }}
            className="mt-5 flex w-full items-center justify-center gap-2 rounded-xl border border-line bg-card px-4 py-3 text-sm font-bold text-ink"
          >
            <Share2 size={16} /> {t('recap.share')}
          </button>
        )}
        <div className="mt-2 flex w-full gap-2">
          {onOpenHistory && (
            <button
              onClick={(e) => {
                e.stopPropagation()
                onOpenHistory()
              }}
              className="flex flex-1 items-center justify-center gap-2 rounded-xl border border-line bg-card px-4 py-3 text-sm font-bold text-ink"
            >
              <History size={16} /> {t('recap.openHistory')}
            </button>
          )}
          <button
            onClick={(e) => {
              e.stopPropagation()
              onClose?.()
            }}
            className="flex-1 rounded-xl bg-brand px-4 py-3 text-sm font-bold text-black"
          >
            {t('recap.close')}
          </button>
        </div>
      </Center>
    ),
  })
  return slides
}

export default function MonthRecapStory({
  ym,
  onClose,
  onOpenHistory,
}: {
  ym: string
  onClose: () => void
  onOpenHistory?: () => void
}) {
  const settings = useSettings()
  const items = useLiveQuery(() => db.items.toArray(), [])
  const eps = useLiveQuery(() => db.episodes.toArray(), [])
  const recap = useMemo(
    () =>
      items && eps
        ? monthRecap(monthHistory(items, eps, ym), { showBooks: settings.showBooks, showGames: settings.showGames })
        : null,
    [items, eps, ym, settings.showBooks, settings.showGames],
  )
  const t = useT()
  const [sharing, setSharing] = useState(false)
  const share = async () => {
    if (!recap || sharing) return
    setSharing(true)
    try {
      const s = recap.stats
      const blob = await renderRecapCard({
        ym: recap.ym,
        lang: settings.language,
        lead: t('recap.your'),
        timeLabel: t('history.time'),
        time: s.totalMin > 0 ? shortTime(s.totalMin) : null,
        tiles: monthTiles(s, t).map((x) => ({ value: Number(x.value), label: String(x.label) })),
        covers: recap.covers.map((c) => c.poster).filter((u): u is string => !!u),
      })
      await shareImage(blob, `recap-${recap.ym}.png`, t('recap.share'))
    } catch {
      void Toast.show({ text: t('recap.shareFailed') }).catch(() => undefined)
    } finally {
      setSharing(false)
    }
  }
  const slides = useSlides(recap, onOpenHistory, onClose, share)
  const [index, setIndex] = useState(0)
  const [paused, setPaused] = useState(false)
  const pressedAt = useRef(0)
  const last = slides.length - 1

  useBackInterceptor(true, onClose)

  // the page underneath must not scroll while the story is up
  useEffect(() => {
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prev
    }
  }, [])

  if (slides.length === 0) return null
  const i = Math.min(index, last)
  const slide = slides[i]
  // relative to the index React holds NOW, not the one this render saw:
  // three quick taps are three slides, not the same one three times
  const step = (delta: number) => setIndex((n) => Math.max(0, Math.min(last, Math.min(n, last) + delta)))

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-[100] select-none bg-black"
      onPointerDown={() => {
        pressedAt.current = Date.now()
        setPaused(true)
      }}
      onPointerUp={(e) => {
        setPaused(false)
        if (Date.now() - pressedAt.current > TAP_MS) return
        const rect = e.currentTarget.getBoundingClientRect()
        step(e.clientX - rect.left < rect.width * 0.3 ? -1 : 1)
      }}
      onPointerCancel={() => setPaused(false)}
    >
      <div className={cn('relative mx-auto h-full w-full max-w-md overflow-hidden', slide.bg, slide.dark ? 'text-black' : 'text-white')}>
        {slide.art && (
          <>
            <Cover src={slide.art} persist className="absolute inset-0 h-full w-full scale-110 object-cover opacity-45 blur-2xl" />
            <div className="absolute inset-0 bg-gradient-to-b from-black/40 via-black/30 to-black/80" />
          </>
        )}

        {/* progress, one segment per slide */}
        <div className="absolute inset-x-0 z-10 flex gap-1 px-3" style={{ top: 'calc(0.6rem + var(--sat))' }}>
          {slides.map((s, n) => (
            <div key={s.key} className={cn('h-[3px] flex-1 overflow-hidden rounded-sm', slide.dark ? 'bg-black/20' : 'bg-white/25')}>
              {n < i && <div className={cn('h-full w-full', slide.dark ? 'bg-black' : 'bg-white')} />}
              {n === i && (
                <div
                  key={`${s.key}-${i}`}
                  className={cn('recap-bar h-full', slide.dark ? 'bg-black' : 'bg-white')}
                  style={{
                    animationDuration: `${SLIDE_MS}ms`,
                    animationPlayState: paused || sharing ? 'paused' : 'running',
                  }}
                  onAnimationEnd={() => {
                    if (i < last) step(1)
                  }}
                />
              )}
            </div>
          ))}
        </div>

        <div className="absolute right-3 z-20 flex gap-2" style={{ top: 'calc(1.4rem + var(--sat))' }}>
          <button
            aria-label={t('recap.share')}
            disabled={sharing}
            onPointerDown={(e) => e.stopPropagation()}
            onPointerUp={(e) => e.stopPropagation()}
            onClick={share}
            className={cn(
              'grid h-10 w-10 place-items-center rounded-xl backdrop-blur transition-opacity',
              slide.dark ? 'bg-black/10 text-black' : 'bg-white/10 text-white',
              sharing && 'opacity-50',
            )}
          >
            <Share2 size={18} />
          </button>
          <button
            aria-label="close"
            onPointerDown={(e) => e.stopPropagation()}
            onPointerUp={(e) => e.stopPropagation()}
            onClick={onClose}
            className={cn(
              'grid h-10 w-10 place-items-center rounded-xl backdrop-blur',
              slide.dark ? 'bg-black/10 text-black' : 'bg-white/10 text-white',
            )}
          >
            <X size={20} />
          </button>
        </div>

        <div
          key={slide.key}
          className="fade-up relative h-full px-7"
          style={{ paddingTop: 'calc(4.5rem + var(--sat))', paddingBottom: 'calc(2.5rem + env(safe-area-inset-bottom, 0px))' }}
          // the closing card has buttons of its own: taps there are theirs
          onPointerUp={(e) => {
            if (i === last && (e.target as HTMLElement).closest('button')) e.stopPropagation()
          }}
        >
          {slide.body}
        </div>
      </div>
    </div>
  )
}

/**
 * Opens the recap by itself once a month: on the last day of the month (that
 * month), or at the first opening after it (the month just ended). Only for
 * a month with something in it, once per device.
 */
export function RecapLauncher() {
  const nav = useNavigate()
  const [ym, setYm] = useState<string | null>(null)
  const [wake, setWake] = useState(0)

  // an app left open across midnight into the last day still gets it
  useEffect(() => {
    const onShow = () => {
      if (document.visibilityState === 'visible') setWake((w) => w + 1)
    }
    document.addEventListener('visibilitychange', onShow)
    return () => document.removeEventListener('visibilitychange', onShow)
  }, [])

  useEffect(() => {
    if (ym) return
    const due = recapCandidate()
    if (recapSeen(due)) return
    let cancelled = false
    // let the app draw its first screen before the story covers it
    const timer = setTimeout(async () => {
      const [items, eps] = await Promise.all([db.items.toArray(), db.episodes.toArray()])
      const { showBooks, showGames } = getSettings()
      const month = monthHistory(items, eps, due)
      if (!cancelled && visibleEntries(month.entries, { showBooks, showGames }).length > 0) setYm(due)
    }, 900)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [wake, ym])

  if (!ym) return null
  const done = () => {
    markRecapSeen(ym)
    setYm(null)
  }
  return (
    <MonthRecapStory
      ym={ym}
      onClose={done}
      onOpenHistory={() => {
        done()
        nav(`/history?m=${ym}`)
      }}
    />
  )
}

