/**
 * Books tab (visible when enabled in Settings). Two kinds of items live here:
 * - manga & comics (`mediaType: 'manga'`): chapter-tracked like series, with
 *   a "Continue reading" section and a next-chapter card
 * - books (`mediaType: 'book'`): single "mark as read" items
 */
import { useLiveQuery } from 'dexie-react-hooks'
import { BookOpen, Clock } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import EmptyState from '../components/EmptyState'
import PageHeader from '../components/PageHeader'
import TrackCard from '../components/TrackCard'
import { db, isCaughtUp, markUpTo, setSingleWatched } from '../db'
import { useT } from '../i18n'
import { useSettings } from '../settings'
import type { LibraryItem } from '../types'
import { formatDate } from '../util'

function MangaCard({ item, readCount }: { item: LibraryItem; readCount: number }) {
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

  return (
    <TrackCard
      poster={item.poster}
      topLabel={item.title}
      title={`${t('books.chapter')} ${caughtUp ? readCount : readCount + 1}`}
      badge={!caughtUp && remaining > 0 ? `+${remaining}` : null}
      subtitle={subtitle}
      progress={item.status === 'watching' && total ? readCount / total : null}
      onClick={() => nav(`/media/${item.provider}/${item.mediaType}/${item.providerId}`)}
      onCheck={caughtUp ? undefined : () => markUpTo(item, 1, readCount + 1)}
    />
  )
}

function BookCard({ item }: { item: LibraryItem }) {
  const nav = useNavigate()
  const parts: string[] = []
  if (item.authors?.length) parts.push(item.authors.join(', '))
  else if (item.year) parts.push(String(item.year))
  return (
    <TrackCard
      poster={item.poster}
      topLabel={item.genres?.slice(0, 2).join(' • ') || 'Book'}
      title={item.title}
      subtitle={parts.join(' • ')}
      onClick={() => nav(`/media/${item.provider}/${item.mediaType}/${item.providerId}`)}
      onCheck={() => setSingleWatched(item.id, true)}
    />
  )
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

  const reading = items
    .filter((i) => i.status === 'watching')
    .sort((a, b) => (b.lastReadAt ?? 0) - (a.lastReadAt ?? 0))
  const toRead = items
    .filter((i) => i.status === 'planned')
    .sort((a, b) => b.addedAt - a.addedAt)

  const card = (item: LibraryItem) =>
    item.mediaType === 'manga' ? (
      <MangaCard key={item.id} item={item} readCount={counts.get(item.id) ?? 0} />
    ) : (
      <BookCard key={item.id} item={item} />
    )

  return (
    <div>
      <PageHeader title={t('books.title')} />

      <section className="px-4">
        <SectionTitle text={t('books.continue')} />
        {reading.length === 0 ? (
          <EmptyState icon={<BookOpen size={32} />} text={t('books.emptyContinue')} />
        ) : (
          <div className="space-y-3">{reading.map(card)}</div>
        )}
      </section>

      <section className="mt-8 px-4">
        <SectionTitle text={t('books.toRead')} />
        {toRead.length === 0 ? (
          <EmptyState icon={<BookOpen size={32} />} text={t('books.empty')} />
        ) : (
          <div className="space-y-3">{toRead.map(card)}</div>
        )}
      </section>
    </div>
  )
}
