/**
 * Archive: everything the user tucked away with the archive button. Mirrors
 * the Favorites page — one grid section per media kind. Covers show the
 * archive-box status icon instead of the hourglass/flag.
 */
import { useLiveQuery } from 'dexie-react-hooks'
import { Archive, ArrowLeft } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import EmptyState from '../components/EmptyState'
import PosterCard from '../components/PosterCard'
import PosterGrid from '../components/PosterGrid'
import SortMenu from '../components/SortMenu'
import { db, isEpisodic, rewatchGrades, sortLibrary } from '../db'
import { useT } from '../i18n'
import { updateSettings, useSettings } from '../settings'
import type { LibraryItem } from '../types'

function ArchSection({
  title,
  items,
  grades,
}: {
  title: string
  items: LibraryItem[]
  grades: Map<string, number>
}) {
  const nav = useNavigate()
  if (items.length === 0) return null
  return (
    <section className="mt-6 px-4">
      <div className="mb-3 flex items-center gap-2">
        <span className="h-4 w-1 rounded-full bg-brand" />
        <h2 className="text-lg font-bold">{title}</h2>
      </div>
      <PosterGrid>
        {items.map((i) => (
          <PosterCard
            key={i.id}
            className="w-auto"
            title={i.title}
            poster={i.poster}
            persist
            year={i.year}
            rating={i.rating}
            statusKind="archived"
            rewatchCount={grades.get(i.id)}
            favorite={i.favorite}
            onClick={() => nav(`/media/${i.provider}/${i.mediaType}/${i.providerId}`)}
          />
        ))}
      </PosterGrid>
    </section>
  )
}

export default function ArchivedPage() {
  const t = useT()
  const nav = useNavigate()
  const settings = useSettings()
  const archived = useLiveQuery(() => db.items.filter((i) => !!i.archived).toArray(), [])
  const eps = useLiveQuery(() => db.episodes.toArray(), [])

  if (!archived || !eps) return null

  const grades = rewatchGrades(archived, eps)
  const sorted = sortLibrary(archived, settings.librarySort)
  const arcSeries = sorted.filter((i) => isEpisodic(i.mediaType))
  const arcMovies = sorted.filter((i) => i.mediaType === 'movie')
  const arcBooks = sorted.filter((i) => i.mediaType === 'book' || i.mediaType === 'manga')
  const arcGames = sorted.filter((i) => i.mediaType === 'game')

  return (
    <div className="pb-8">
      <header className="flex items-center gap-3 px-4 pb-2 pt-safe">
        <button
          onClick={() => nav(-1)}
          aria-label="back"
          className="grid h-10 w-10 place-items-center rounded-full border border-line text-ink2 transition-colors hover:border-accent hover:text-accent"
        >
          <ArrowLeft size={18} />
        </button>
        <h1 className="flex-1 text-2xl font-extrabold tracking-tight">{t('account.archived')}</h1>
        {archived.length > 0 && (
          <SortMenu
            value={settings.librarySort}
            onChange={(m) => updateSettings({ librarySort: m })}
          />
        )}
      </header>

      {archived.length === 0 ? (
        <div className="mt-8">
          <EmptyState icon={<Archive size={32} />} text={t('account.emptyRow')} />
        </div>
      ) : (
        <>
          <ArchSection title={t('nav.series')} items={arcSeries} grades={grades} />
          <ArchSection title={t('nav.movies')} items={arcMovies} grades={grades} />
          {settings.showBooks && <ArchSection title={t('nav.books')} items={arcBooks} grades={grades} />}
          {settings.showGames && <ArchSection title={t('nav.games')} items={arcGames} grades={grades} />}
        </>
      )}
    </div>
  )
}
