import { useLiveQuery } from 'dexie-react-hooks'
import { Clapperboard, Clock } from 'lucide-react'
import type { ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import EmptyState from '../components/EmptyState'
import GridCard from '../components/GridCard'
import PageHeader from '../components/PageHeader'
import PosterGrid from '../components/PosterGrid'
import TrackCard from '../components/TrackCard'
import ViewToggle from '../components/ViewToggle'
import { db, isWaiting, setSingleStatus } from '../db'
import { useT } from '../i18n'
import { updateSettings, useSettings, type ViewMode } from '../settings'
import type { LibraryItem } from '../types'
import { formatDate } from '../util'

/** movies/games have no episodes: isWaiting only reads their release date. */
const NO_KEYS = new Set<string>()

function subtitleOf(item: LibraryItem): string {
  const parts: string[] = []
  if (item.year) parts.push(String(item.year))
  if (item.runtime) parts.push(`${item.runtime} min`)
  return parts.join(' • ')
}

function SectionTitle({ text }: { text: string }) {
  return (
    <div className="mb-3 flex items-center gap-2">
      <span className="h-4 w-1 rounded-full bg-brand" />
      <h2 className="text-lg font-bold">{text}</h2>
    </div>
  )
}

/** stage = 'planned' (Start → begin) · 'watching' (Continue → complete) · 'waiting' (no action). */
function MovieCard({
  item,
  stage,
  view,
}: {
  item: LibraryItem
  stage: 'planned' | 'watching' | 'waiting'
  view: ViewMode
}) {
  const t = useT()
  const nav = useNavigate()
  const { language } = useSettings()

  const when = item.releaseDate ? formatDate(item.releaseDate, language) : t('common.waiting')
  const subtitle =
    stage === 'waiting' ? (
      <span className="inline-flex items-center gap-1.5 text-accent">
        <Clock size={13} />
        {when}
      </span>
    ) : (
      subtitleOf(item)
    )
  const shared = {
    poster: item.poster,
    title: item.title,
    onClick: () => nav(`/media/${item.provider}/${item.mediaType}/${item.providerId}`),
    onCheck:
      stage === 'waiting'
        ? undefined
        : () => setSingleStatus(item.id, stage === 'watching' ? 'completed' : 'watching'),
  }

  if (view === 'grid') {
    return (
      <GridCard
        {...shared}
        // the cover already shows the artwork: the only line worth burning on
        // it is the date you're waiting for
        caption={stage === 'waiting' ? when : null}
        subtitle={stage === 'waiting' ? null : subtitleOf(item)}
      />
    )
  }
  return (
    <TrackCard
      {...shared}
      topLabel={item.genres?.slice(0, 2).join(' • ') || t('nav.movies')}
      subtitle={subtitle}
    />
  )
}

export function MoviesPage() {
  const t = useT()
  const { viewMovies } = useSettings()
  const items = useLiveQuery(
    () =>
      db.items
        .where('mediaType')
        .equals('movie')
        .and((i) => i.status !== 'completed')
        .toArray(),
    [],
  )

  if (!items) return null

  const active = items.filter((i) => !i.archived)
  const watching = active.filter((i) => i.status === 'watching').sort((a, b) => (b.lastReadAt ?? 0) - (a.lastReadAt ?? 0))
  const waiting = active.filter((i) => isWaiting(i, NO_KEYS)).sort((a, b) => b.addedAt - a.addedAt)
  const toWatch = active
    .filter((i) => i.status === 'planned' && !isWaiting(i, NO_KEYS))
    .sort((a, b) => b.addedAt - a.addedAt)

  const lay = (children: ReactNode) =>
    viewMovies === 'grid' ? (
      <PosterGrid>{children}</PosterGrid>
    ) : (
      <div className="space-y-3">{children}</div>
    )

  return (
    <div>
      <PageHeader
        title={t('movies.title')}
        action={
          <ViewToggle
            value={viewMovies}
            onChange={(viewMovies) => updateSettings({ viewMovies })}
          />
        }
      />

      <section className="px-4">
        <SectionTitle text={t('movies.watching')} />
        {watching.length === 0 ? (
          <EmptyState icon={<Clapperboard size={32} />} text={t('movies.emptyContinue')} />
        ) : (
          lay(
            watching.map((item) => (
              <MovieCard key={item.id} item={item} stage="watching" view={viewMovies} />
            )),
          )
        )}
      </section>

      <section className="mt-8 px-4">
        <SectionTitle text={t('movies.toWatch')} />
        {toWatch.length === 0 ? (
          <EmptyState icon={<Clapperboard size={32} />} text={t('movies.empty')} />
        ) : (
          lay(
            toWatch.map((item) => (
              <MovieCard key={item.id} item={item} stage="planned" view={viewMovies} />
            )),
          )
        )}
      </section>

      {waiting.length > 0 && (
        <section className="mt-8 px-4">
          <SectionTitle text={t('common.waiting')} />
          {lay(
            waiting.map((item) => (
              <MovieCard key={item.id} item={item} stage="waiting" view={viewMovies} />
            )),
          )}
        </section>
      )}
    </div>
  )
}
