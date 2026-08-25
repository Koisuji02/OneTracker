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
import { db, isCaughtUp, isWaiting, markUpTo, setSingleStatus } from '../db'
import { useT } from '../i18n'
import { updateSettings, useSettings, type ViewMode } from '../settings'
import type { LibraryItem } from '../types'
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
  const shared = {
    poster: item.poster,
    title: item.title,
    subtitle: parts.join(' • '),
    onClick: () => nav(`/media/${item.provider}/${item.mediaType}/${item.providerId}`),
    onCheck: () => setSingleStatus(item.id, stage === 'watching' ? 'completed' : 'watching'),
  }

  if (view === 'grid') return <GridCard {...shared} />
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
  const items = useLiveQuery(
    () =>
      db.items
        .where('mediaType')
        .anyOf('book', 'manga')
        .and((i) => i.status !== 'completed')
        .toArray(),
    [],
  )
  const eps = useLiveQuery(() => db.episodes.toArray(), [])

  if (!items || !eps) return null

  const counts = new Map<string, number>()
  for (const e of eps) counts.set(e.itemId, (counts.get(e.itemId) ?? 0) + 1)
  const watchedKeys = new Set(eps.map((e) => e.id))

  const byRecent = (a: LibraryItem, b: LibraryItem) => (b.lastReadAt ?? 0) - (a.lastReadAt ?? 0)
  const active = items.filter((i) => !i.archived)
  // caught-up ongoing manga (no new chapter yet) go to their own Waiting section
  const reading = active
    .filter((i) => i.status === 'watching' && !isWaiting(i, watchedKeys))
    .sort(byRecent)
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
        {reading.length === 0 ? (
          <EmptyState icon={<BookOpen size={32} />} text={t('books.emptyContinue')} />
        ) : (
          lay(reading.map((i) => card(i, 'watching')))
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
