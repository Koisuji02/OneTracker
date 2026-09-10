/**
 * Books tab (visible when enabled in Settings). Two kinds of items live here:
 * - manga & comics (`mediaType: 'manga'`): chapter-tracked like series, with
 *   a "Continue reading" section and a next-chapter card
 * - books (`mediaType: 'book'`): single "mark as read" items
 */
import { useLiveQuery } from 'dexie-react-hooks'
import { BookOpen, Clock } from 'lucide-react'
import type { ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import EmptyState from '../components/EmptyState'
import GridCard from '../components/GridCard'
import PageHeader from '../components/PageHeader'
import PosterGrid from '../components/PosterGrid'
import TrackCard from '../components/TrackCard'
import ViewToggle from '../components/ViewToggle'
import {
  computeNextRewatch,
  db,
  isCaughtUp,
  isWaiting,
  lastActivity,
  markRewatchUnit,
  markUpTo,
  setSingleStatus,
  totalEpisodesOf,
  unitActivity,
} from '../db'
import { useT } from '../i18n'
import { updateSettings, useSettings, type ViewMode } from '../settings'
import type { LibraryItem, WatchedEpisode } from '../types'
import { formatDate } from '../util'

function MangaCard({
  item,
  readCount,
  view,
}: {
  item: LibraryItem
  readCount: number
  view: ViewMode
}) {
  const t = useT()
  const nav = useNavigate()
  const { language } = useSettings()
  const total = item.totalEpisodes ?? null
  const caughtUp = isCaughtUp(item, readCount)
  const remaining = total != null ? Math.max(0, total - readCount - 1) : 0

  const subtitle = caughtUp ? (
    <span className="inline-flex items-center gap-1.5 text-accent">
      <Clock size={13} /> {t('books.waiting')}
      {item.lastReleaseDate && (
        <span className="text-ink3">
          • {t('books.lastOn')} {formatDate(item.lastReleaseDate, language)}
        </span>
      )}
    </span>
  ) : item.ongoing ? (
    <span className="inline-flex items-center gap-1.5">
      <Clock size={13} className="text-accent" /> {t('books.ongoing')}
    </span>
  ) : total != null ? (
    `${total} ${t('books.chapters').toLowerCase()}`
  ) : null

  const shared = {
    poster: item.poster,
    badge: !caughtUp && remaining > 0 ? `+${remaining}` : null,
    progress: item.status === 'watching' && total ? readCount / total : null,
    onClick: () => nav(`/media/${item.provider}/${item.mediaType}/${item.providerId}`),
    onCheck: caughtUp ? undefined : () => markUpTo(item, 1, readCount + 1),
  }
  const label = `${t('books.chapter')} ${caughtUp ? readCount : readCount + 1}`

  if (view === 'grid') {
    return (
      <GridCard
        {...shared}
        title={item.title}
        caption={label}
        subtitle={caughtUp ? t('books.waiting') : item.ongoing ? t('books.ongoing') : null}
      />
    )
  }
  return <TrackCard {...shared} topLabel={item.title} title={label} subtitle={subtitle} />
}

/**
 * A finished manga/comic being re-read stays in "Continue reading", exactly
 * like a series rewatch round: the button carries the round's grade (x2, x3…)
 * and each tap re-marks the next chapter at that grade.
 */
function MangaRewatchCard({
  item,
  next,
  view,
}: {
  item: LibraryItem
  next: NonNullable<ReturnType<typeof computeNextRewatch>>
  view: ViewMode
}) {
  const t = useT()
  const nav = useNavigate()
  const total = totalEpisodesOf(item)
  const shared = {
    poster: item.poster,
    badge: `x${next.grade}`,
    progress: total ? next.done / total : null,
    onClick: () => nav(`/media/${item.provider}/${item.mediaType}/${item.providerId}`),
    onCheck: () => markRewatchUnit(item, next.season, next.episode, next.grade),
    checkContent: `x${next.grade}`,
  }
  const label = `${t('books.chapter')} ${next.episode}`

  if (view === 'grid') {
    return <GridCard {...shared} title={item.title} caption={label} />
  }
  return <TrackCard {...shared} topLabel={item.title} title={label} />
}

/** Books are 3-state like movies: planned → (start) watching → (finish) completed. */
function BookCard({
  item,
  stage,
  view,
}: {
  item: LibraryItem
  stage: 'planned' | 'watching'
  view: ViewMode
}) {
  const nav = useNavigate()
  const parts: string[] = []
  if (item.authors?.length) parts.push(item.authors.join(', '))
  else if (item.year) parts.push(String(item.year))
  // re-read in progress (Rileggi x2): the round's grade rides on the card until
  // the ✓ closes it, so it reads like a series/manga rewatch
  const round = stage === 'watching' && (item.watchCount ?? 1) >= 2 ? `x${item.watchCount}` : null
  const shared = {
    poster: item.poster,
    title: item.title,
    subtitle: parts.join(' • '),
    badge: round,
    checkContent: round ?? undefined,
    onClick: () => nav(`/media/${item.provider}/${item.mediaType}/${item.providerId}`),
    onCheck: () => setSingleStatus(item.id, stage === 'watching' ? 'completed' : 'watching'),
  }

  if (view === 'grid') return <GridCard {...shared} caption={round} />
  return <TrackCard {...shared} topLabel={item.genres?.slice(0, 2).join(' • ') || 'Book'} />
}

function SectionTitle({ text }: { text: string }) {
  return (
    <div className="mb-3 flex items-center gap-2">
      <span className="h-4 w-1 rounded-full bg-brand" />
      <h2 className="text-lg font-bold">{text}</h2>
    </div>
  )
}

export default function BooksPage() {
  const t = useT()
  const { viewBooks } = useSettings()
  // completed items stay in the query on purpose: a finished manga with an open
  // re-read round belongs in "Continue reading" (the ones without a round are
  // filtered out below)
  const items = useLiveQuery(() => db.items.where('mediaType').anyOf('book', 'manga').toArray(), [])
  const eps = useLiveQuery(() => db.episodes.toArray(), [])

  if (!items || !eps) return null

  const counts = new Map<string, number>()
  const epsByItem = new Map<string, WatchedEpisode[]>()
  for (const e of eps) {
    counts.set(e.itemId, (counts.get(e.itemId) ?? 0) + 1)
    const list = epsByItem.get(e.itemId)
    if (list) list.push(e)
    else epsByItem.set(e.itemId, [e])
  }
  const watchedKeys = new Set(eps.map((e) => e.id))
  const activity = unitActivity(eps)

  const byRecent = (a: LibraryItem, b: LibraryItem) =>
    lastActivity(b, activity) - lastActivity(a, activity)
  const active = items.filter((i) => !i.archived)
  // caught-up ongoing manga (no new chapter yet) go to their own Waiting section
  const reading = active.filter((i) => i.status === 'watching' && !isWaiting(i, watchedKeys))
  // finished manga with an unfinished re-read round stay in "Continue"
  const rereading = active
    .filter((i) => i.mediaType === 'manga' && i.status === 'completed')
    .map((item) => ({ item, next: computeNextRewatch(item, epsByItem.get(item.id) ?? []) }))
    .filter(
      (x): x is { item: LibraryItem; next: NonNullable<ReturnType<typeof computeNextRewatch>> } =>
        x.next != null,
    )
  /**
   * ONE Continue list ordered by last activity, re-read rounds included: the
   * chapter you just marked comes first whether it was a first read or a x2 —
   * the same order the home-screen widget uses.
   */
  const continuing: Array<
    | { kind: 'read'; item: LibraryItem }
    | {
        kind: 'reread'
        item: LibraryItem
        next: NonNullable<ReturnType<typeof computeNextRewatch>>
      }
  > = [
    ...reading.map((item) => ({ kind: 'read' as const, item })),
    ...rereading.map(({ item, next }) => ({ kind: 'reread' as const, item, next })),
  ].sort((a, b) => lastActivity(b.item, activity) - lastActivity(a.item, activity))
  const waiting = active
    .filter((i) => i.status === 'watching' && isWaiting(i, watchedKeys))
    .sort(byRecent)
  const toRead = active.filter((i) => i.status === 'planned').sort((a, b) => b.addedAt - a.addedAt)

  const card = (item: LibraryItem, stage: 'planned' | 'watching') =>
    item.mediaType === 'manga' ? (
      <MangaCard
        key={item.id}
        item={item}
        readCount={counts.get(item.id) ?? 0}
        view={viewBooks}
      />
    ) : (
      <BookCard key={item.id} item={item} stage={stage} view={viewBooks} />
    )

  const lay = (children: ReactNode) =>
    viewBooks === 'grid' ? (
      <PosterGrid>{children}</PosterGrid>
    ) : (
      <div className="space-y-3">{children}</div>
    )

  return (
    <div>
      <PageHeader
        title={t('books.title')}
        action={
          <ViewToggle value={viewBooks} onChange={(viewBooks) => updateSettings({ viewBooks })} />
        }
      />

      <section className="px-4">
        <SectionTitle text={t('books.continue')} />
        {continuing.length === 0 ? (
          <EmptyState icon={<BookOpen size={32} />} text={t('books.emptyContinue')} />
        ) : (
          lay(
            continuing.map((entry) =>
              entry.kind === 'reread' ? (
                <MangaRewatchCard
                  key={`rw-${entry.item.id}`}
                  item={entry.item}
                  next={entry.next}
                  view={viewBooks}
                />
              ) : (
                card(entry.item, 'watching')
              ),
            ),
          )
        )}
      </section>

      <section className="mt-8 px-4">
        <SectionTitle text={t('books.toRead')} />
        {toRead.length === 0 ? (
          <EmptyState icon={<BookOpen size={32} />} text={t('books.empty')} />
        ) : (
          lay(toRead.map((i) => card(i, 'planned')))
        )}
      </section>

      {waiting.length > 0 && (
        <section className="mt-8 px-4">
          <SectionTitle text={t('common.waiting')} />
          {lay(waiting.map((i) => card(i, 'watching')))}
        </section>
      )}
    </div>
  )
}
