import { useLiveQuery } from 'dexie-react-hooks'
import { Clapperboard } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import EmptyState from '../components/EmptyState'
import PageHeader from '../components/PageHeader'
import TrackCard from '../components/TrackCard'
import { db, setSingleWatched } from '../db'
import { useT } from '../i18n'
import type { LibraryItem } from '../types'

function subtitleOf(item: LibraryItem): string {
  const parts: string[] = []
  if (item.year) parts.push(String(item.year))
  if (item.runtime) parts.push(`${item.runtime} min`)
  return parts.join(' • ')
}

export function MoviesPage() {
  const t = useT()
  const nav = useNavigate()
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
  const sorted = [...items].sort((a, b) => b.addedAt - a.addedAt)

  return (
    <div>
      <PageHeader title={t('movies.title')} />
      <section className="px-4">
        <div className="mb-3 flex items-center gap-2">
          <span className="h-4 w-1 rounded-full bg-brand" />
          <h2 className="text-lg font-bold">{t('movies.toWatch')}</h2>
        </div>
        {sorted.length === 0 ? (
          <EmptyState icon={<Clapperboard size={32} />} text={t('movies.empty')} />
        ) : (
          <div className="space-y-3">
            {sorted.map((item) => (
              <TrackCard
                key={item.id}
                poster={item.poster}
                topLabel={item.genres?.slice(0, 2).join(' • ') || t('nav.movies')}
                title={item.title}
                subtitle={subtitleOf(item)}
                onClick={() => nav(`/media/${item.provider}/${item.mediaType}/${item.providerId}`)}
                onCheck={() => setSingleWatched(item.id, true)}
              />
            ))}
          </div>
        )}
      </section>
    </div>
  )
}
