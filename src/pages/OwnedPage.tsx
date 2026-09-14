/**
 * Owned: everything the user marked with the key button on a detail page.
 * A container like Favorites/Archived — one grid section per media kind. The
 * "owned" flag itself gets NO cover badge (by design); covers just show their
 * normal status/rating/favorite badges.
 */
import { useLiveQuery } from 'dexie-react-hooks'
import { ArrowLeft, KeyRound } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import EmptyState from '../components/EmptyState'
import PosterCard from '../components/PosterCard'
import PosterGrid from '../components/PosterGrid'
import SortMenu from '../components/SortMenu'
import { db, isEpisodic, rewatchGrades, sortLibrary } from '../db'
import { useT } from '../i18n'
import { updateSettings, useSettings } from '../settings'
import type { LibraryItem } from '../types'

function OwnedSection({
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
            statusKind={
              i.archived
                ? 'archived'
                : i.status === 'completed'
                  ? 'done'
                  : i.status === 'watching'
                    ? 'ongoing'
                    : null
            }
            rewatchCount={grades.get(i.id)}
            favorite={i.favorite}
            onClick={() => nav(`/media/${i.provider}/${i.mediaType}/${i.providerId}`)}
          />
        ))}
      </PosterGrid>
    </section>
  )
}

export default function OwnedPage() {
  const t = useT()
  const nav = useNavigate()
  const settings = useSettings()
  const owned = useLiveQuery(() => db.items.filter((i) => !!i.owned).toArray(), [])
  const eps = useLiveQuery(() => db.episodes.toArray(), [])

  if (!owned || !eps) return null

  const grades = rewatchGrades(owned, eps)
  const sorted = sortLibrary(owned, settings.librarySort)
  const ownSeries = sorted.filter((i) => isEpisodic(i.mediaType))
  const ownMovies = sorted.filter((i) => i.mediaType === 'movie')
  const ownBooks = sorted.filter((i) => i.mediaType === 'book' || i.mediaType === 'manga')
  const ownGames = sorted.filter((i) => i.mediaType === 'game')

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
        <h1 className="flex-1 text-2xl font-extrabold tracking-tight">{t('account.owned')}</h1>
        {owned.length > 0 && (
          <SortMenu
            value={settings.librarySort}
            onChange={(m) => updateSettings({ librarySort: m })}
          />
        )}
      </header>

      {owned.length === 0 ? (
        <div className="mt-8">
          <EmptyState icon={<KeyRound size={32} />} text={t('account.emptyRow')} />
        </div>
      ) : (
        <>
          <OwnedSection title={t('nav.series')} items={ownSeries} grades={grades} />
          <OwnedSection title={t('nav.movies')} items={ownMovies} grades={grades} />
          {settings.showBooks && <OwnedSection title={t('nav.books')} items={ownBooks} grades={grades} />}
          {settings.showGames && <OwnedSection title={t('nav.games')} items={ownGames} grades={grades} />}
        </>
      )}
    </div>
  )
}
