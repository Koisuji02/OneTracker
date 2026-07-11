import { useLiveQuery } from 'dexie-react-hooks'
import { ArrowLeft, Heart } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import EmptyState from '../components/EmptyState'
import PosterCard from '../components/PosterCard'
import { db, isEpisodic } from '../db'
import { useT } from '../i18n'
import { useSettings } from '../settings'
import type { LibraryItem } from '../types'

function FavSection({ title, items }: { title: string; items: LibraryItem[] }) {
  const nav = useNavigate()
  if (items.length === 0) return null
  return (
    <section className="mt-6 px-4">
      <div className="mb-3 flex items-center gap-2">
        <span className="h-4 w-1 rounded-full bg-brand" />
        <h2 className="text-lg font-bold">{title}</h2>
      </div>
      <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-5">
        {items.map((i) => (
          <PosterCard
            key={i.id}
            className="w-auto"
            title={i.title}
            poster={i.poster}
            year={i.year}
            rating={i.rating}
            onClick={() => nav(`/media/${i.provider}/${i.mediaType}/${i.providerId}`)}
          />
        ))}
      </div>
    </section>
  )
}

export default function FavoritesPage() {
  const t = useT()
  const nav = useNavigate()
  const settings = useSettings()
  const favorites = useLiveQuery(
    () => db.items.filter((i) => i.favorite).toArray(),
    [],
  )

  if (!favorites) return null

  const favSeries = favorites.filter((i) => isEpisodic(i.mediaType))
  const favMovies = favorites.filter((i) => i.mediaType === 'movie')
  const favBooks = favorites.filter((i) => i.mediaType === 'book' || i.mediaType === 'manga')
  const favGames = favorites.filter((i) => i.mediaType === 'game')

  return (
    <div className="pb-8">
      <header className="flex items-center gap-3 px-4 pb-2 pt-6">
        <button
          onClick={() => nav(-1)}
          aria-label="back"
          className="grid h-10 w-10 place-items-center rounded-full border border-line text-ink2 transition-colors hover:border-accent hover:text-accent"
        >
          <ArrowLeft size={18} />
        </button>
        <h1 className="text-2xl font-extrabold tracking-tight">{t('account.favorites')}</h1>
      </header>

      {favorites.length === 0 ? (
        <div className="mt-8">
          <EmptyState icon={<Heart size={32} />} text={t('account.emptyRow')} />
        </div>
      ) : (
        <>
          <FavSection title={t('account.favSeries')} items={favSeries} />
          <FavSection title={t('account.favMovies')} items={favMovies} />
          {settings.showBooks && <FavSection title={t('account.favBooks')} items={favBooks} />}
          {settings.showGames && <FavSection title={t('account.favGames')} items={favGames} />}
        </>
      )}
    </div>
  )
}
