/**
 * Cronologia: what was watched, read and played, one month at a time.
 *
 * Opens on the current month; ← / → step through months (→ is dimmed on the
 * current one, ← on the first month anything was ever marked). The month
 * lives in the URL (`?m=2026-09`, replaced rather than pushed), so coming
 * back from a title's page lands on the same month and the back button
 * leaves the history instead of rewinding through every month visited.
 *
 * The data is derived, not stored — see src/history.ts for what dates what.
 */
import { useLiveQuery } from 'dexie-react-hooks'
import { ArrowLeft, ChevronLeft, ChevronRight, History, Play } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import EmptyState from '../components/EmptyState'
import MonthRecapStory, { monthTiles } from '../components/MonthRecap'
import PosterCard from '../components/PosterCard'
import PosterGrid from '../components/PosterGrid'
import StatTiles from '../components/StatTiles'
import { db } from '../db'
import {
  firstMonth,
  markRecapSeen,
  monthHistory,
  monthKey,
  monthLabel,
  recapCandidate,
  shiftMonth,
  validYm,
  visibleEntries,
  type HistoryEntry,
  type HistoryKind,
} from '../history'
import { useT } from '../i18n'
import { useSettings } from '../settings'
import { cn } from '../util'

/**
 * What a cover says about its month, under the title: how much, never how
 * long (the month has no time, see MonthStats). Finishing something is also
 * the cover's flag (statusKind), the same mark the rest of the app uses.
 */
function useCaption() {
  const t = useT()
  return (e: HistoryEntry): string => {
    if (e.units > 0) return `${e.units} ${t(e.kind === 'books' ? 'history.chaptersShort' : 'history.episodesShort')}`
    if (e.kind === 'games') {
      return e.finished > 0 ? `${t('history.beaten')}${e.finished > 1 ? ` x${e.finished}` : ''}` : t('history.playing')
    }
    return t(e.kind === 'books' ? 'history.read' : 'history.seen')
  }
}

const SECTIONS: Array<{ kind: HistoryKind; title: string }> = [
  { kind: 'series', title: 'nav.series' },
  { kind: 'movies', title: 'nav.movies' },
  { kind: 'books', title: 'nav.books' },
  { kind: 'games', title: 'nav.games' },
]

export default function HistoryPage() {
  const t = useT()
  const nav = useNavigate()
  const settings = useSettings()
  const caption = useCaption()
  const [params, setParams] = useSearchParams()
  const [recapOpen, setRecapOpen] = useState(false)
  const items = useLiveQuery(() => db.items.toArray(), [])
  const eps = useLiveQuery(() => db.episodes.toArray(), [])

  const current = monthKey(new Date())
  const asked = validYm(params.get('m'))
  // a month in the future (a shared link, a clock change) is the current one
  const ym = asked && asked <= current ? asked : current

  const month = useMemo(() => (items && eps ? monthHistory(items, eps, ym) : null), [items, eps, ym])
  const first = useMemo(() => (items && eps ? firstMonth(items, eps) : current), [items, eps, current])

  if (!month) return null

  const show = { showBooks: settings.showBooks, showGames: settings.showGames }
  const entries = visibleEntries(month.entries, show)
  const s = month.stats
  const canPrev = ym > first
  const canNext = ym < current
  const go = (delta: number) => setParams({ m: shiftMonth(ym, delta) }, { replace: true })

  // hidden media stay out of the numbers, exactly as out of the covers
  const shown = {
    ...s,
    ...(show.showBooks ? {} : { chapters: 0, books: 0 }),
    ...(show.showGames ? {} : { games: 0, playing: 0 }),
  }

  return (
    <div className="pb-8">
      <header className="flex items-center gap-3 px-4 pb-2 pt-safe">
        <button
          onClick={() => nav(-1)}
          aria-label="back"
          className="grid h-10 w-10 place-items-center rounded-xl border border-line text-ink2 transition-colors hover:border-accent hover:text-accent"
        >
          <ArrowLeft size={18} />
        </button>
        <h1 className="flex-1 text-2xl font-extrabold tracking-tight">{t('history.title')}</h1>
      </header>

      {/* the month, its arrows and its numbers */}
      <div className="mx-4 mt-3 rounded-2xl border border-line bg-card p-4">
        <div className="flex items-center gap-2">
          <button
            onClick={() => canPrev && go(-1)}
            disabled={!canPrev}
            aria-label={t('history.prev')}
            className={cn(
              'grid h-10 w-10 place-items-center rounded-xl border border-line transition-colors',
              canPrev ? 'text-ink2 hover:border-accent hover:text-accent' : 'text-ink4 opacity-40',
            )}
          >
            <ChevronLeft size={20} />
          </button>
          <div className="min-w-0 flex-1 text-center">
            <div className="truncate text-lg font-extrabold">{monthLabel(ym, settings.language)}</div>
            {ym === current && <div className="text-[11px] font-bold uppercase tracking-wider text-accent">{t('history.thisMonth')}</div>}
          </div>
          <button
            onClick={() => canNext && go(1)}
            disabled={!canNext}
            aria-label={t('history.next')}
            className={cn(
              'grid h-10 w-10 place-items-center rounded-xl border border-line transition-colors',
              canNext ? 'text-ink2 hover:border-accent hover:text-accent' : 'text-ink4 opacity-40',
            )}
          >
            <ChevronRight size={20} />
          </button>
        </div>

        {entries.length > 0 && (
          <div className="mt-4 border-t border-line pt-4 text-center">
            <StatTiles tiles={monthTiles(shown, t, true)} />
            <button
              onClick={() => {
                setRecapOpen(true)
                // the recap that would have popped up by itself has now been seen
                if (ym === recapCandidate()) markRecapSeen(ym)
              }}
              className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl bg-brand px-4 py-2.5 text-sm font-bold text-black transition-transform active:scale-[0.99]"
            >
              <Play size={15} fill="currentColor" /> {t('history.recap')}
            </button>
          </div>
        )}
      </div>

      {entries.length === 0 ? (
        <div className="mt-6">
          <EmptyState icon={<History size={32} />} text={t('history.empty')} />
        </div>
      ) : (
        SECTIONS.map(({ kind, title }) => {
          const list = entries.filter((e) => e.kind === kind)
          if (list.length === 0) return null
          return (
            <section key={kind} className="mt-6 px-4">
              <div className="mb-3 flex items-center gap-2">
                <span className="h-4 w-1 rounded-full bg-brand" />
                <h2 className="text-lg font-bold">{t(title)}</h2>
                <span className="text-sm text-ink3">{list.length}</span>
              </div>
              <PosterGrid>
                {list.map((e) => (
                  <PosterCard
                    key={e.item.id}
                    className="w-auto"
                    title={e.item.title}
                    poster={e.item.poster}
                    persist
                    subtitle={caption(e)}
                    statusKind={e.finished > 0 || e.completedHere ? 'done' : null}
                    rating={e.item.rating}
                    favorite={e.item.favorite}
                    onClick={() => nav(`/media/${e.item.provider}/${e.item.mediaType}/${e.item.providerId}`)}
                  />
                ))}
              </PosterGrid>
            </section>
          )
        })
      )}

      {recapOpen && <MonthRecapStory ym={ym} onClose={() => setRecapOpen(false)} />}
    </div>
  )
}
