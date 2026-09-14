/**
 * To buy: the mirror of Owned — everything in the library that is NOT flagged
 * with the key, so it doubles as a shopping list. Same container shape as
 * Favorites/Archived/Owned: one grid section per media kind, the shared sort
 * menu, covers with their normal status/rating/favorite badges.
 *
 * Archived items are left out on purpose: they're tucked away from every other
 * view, and something you set aside isn't something you still need to buy.
 * Marking an item owned (the key button on its detail page) drops it from here.
 */
import { useLiveQuery } from 'dexie-react-hooks'
import { ArrowLeft, DollarSign } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import EmptyState from '../components/EmptyState'
import PosterCard from '../components/PosterCard'
import PosterGrid from '../components/PosterGrid'
import SortMenu from '../components/SortMenu'
import { db, isEpisodic, rewatchGrades, sortLibrary } from '../db'
import { useT } from '../i18n'
import { updateSettings, useSettings } from '../settings'
import type { LibraryItem } from '../types'

function ToBuySection({
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
              i.status === 'completed' ? 'done' : i.status === 'watching' ? 'ongoing' : null
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

export default function ToBuyPage() {
  const t = useT()
  const nav = useNavigate()
  const settings = useSettings()
  const toBuy = useLiveQuery(() => db.items.filter((i) => !i.owned && !i.archived).toArray(), [])
  const eps = useLiveQuery(() => db.episodes.toArray(), [])

  if (!toBuy || !eps) return null

  const grades = rewatchGrades(toBuy, eps)
  const sorted = sortLibrary(toBuy, settings.librarySort)
  const buySeries = sorted.filter((i) => isEpisodic(i.mediaType))
  const buyMovies = sorted.filter((i) => i.mediaType === 'movie')
  const buyBooks = sorted.filter((i) => i.mediaType === 'book' || i.mediaType === 'manga')
  const buyGames = sorted.filter((i) => i.mediaType === 'game')

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
        <h1 className="flex-1 text-2xl font-extrabold tracking-tight">{t('account.toBuy')}</h1>
        {toBuy.length > 0 && (
          <SortMenu
            value={settings.librarySort}
            onChange={(m) => updateSettings({ librarySort: m })}
          />
        )}
      </header>

      {toBuy.length === 0 ? (
        <div className="mt-8">
          <EmptyState icon={<DollarSign size={32} />} text={t('account.emptyRow')} />
        </div>
      ) : (
        <>
          <ToBuySection title={t('nav.series')} items={buySeries} grades={grades} />
          <ToBuySection title={t('nav.movies')} items={buyMovies} grades={grades} />
          {settings.showBooks && (
            <ToBuySection title={t('nav.books')} items={buyBooks} grades={grades} />
          )}
          {settings.showGames && (
            <ToBuySection title={t('nav.games')} items={buyGames} grades={grades} />
          )}
        </>
      )}
    </div>
  )
}
