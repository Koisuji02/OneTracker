/**
 * Full-screen grid view of one catalog section (opened from the chevron next
 * to a row title in the Profile tab). Shows rating badges and the
 * hourglass/flag status icon on every cover.
 */
import { useLiveQuery } from 'dexie-react-hooks'
import { ArrowLeft, BookOpen, Clapperboard, Gamepad2, Tv } from 'lucide-react'
import { useNavigate, useParams } from 'react-router-dom'
import EmptyState from '../components/EmptyState'
import PosterCard from '../components/PosterCard'
import PosterGrid from '../components/PosterGrid'
import SortMenu from '../components/SortMenu'
import { db, isEpisodic, rewatchGrades, sortLibrary } from '../db'
import { useT } from '../i18n'
import { updateSettings, useSettings } from '../settings'
import type { LibraryItem } from '../types'

const KINDS: Record<
  string,
  { titleKey: string; icon: React.ReactNode; filter: (i: LibraryItem) => boolean }
> = {
  series: {
    titleKey: 'nav.series',
    icon: <Tv size={20} />,
    filter: (i) => isEpisodic(i.mediaType),
  },
  movies: {
    titleKey: 'nav.movies',
    icon: <Clapperboard size={20} />,
    filter: (i) => i.mediaType === 'movie',
  },
  books: {
    titleKey: 'nav.books',
    icon: <BookOpen size={20} />,
    filter: (i) => i.mediaType === 'book' || i.mediaType === 'manga',
  },
  games: {
    titleKey: 'nav.games',
    icon: <Gamepad2 size={20} />,
    filter: (i) => i.mediaType === 'game',
  },
}

export default function CatalogPage() {
  const { kind } = useParams() as { kind: string }
  const t = useT()
  const nav = useNavigate()
  const settings = useSettings()
  const items = useLiveQuery(() => db.items.toArray(), [])
  const eps = useLiveQuery(() => db.episodes.toArray(), [])

  const def = KINDS[kind]
  if (!items || !eps || !def) return null

  const grades = rewatchGrades(items, eps)
  const list = sortLibrary(
    items.filter((i) => i.status !== 'planned' && !i.archived && def.filter(i)),
    settings.librarySort,
  )

  return (
    <div className="pb-8">
      <header className="flex items-center gap-3 px-4 pb-4 pt-safe">
        <button
          onClick={() => nav(-1)}
          aria-label="back"
          className="grid h-10 w-10 place-items-center rounded-full border border-line text-ink2 transition-colors hover:border-accent hover:text-accent"
        >
          <ArrowLeft size={18} />
        </button>
        <span className="text-accent">{def.icon}</span>
        <h1 className="flex-1 text-2xl font-extrabold tracking-tight">{t(def.titleKey)}</h1>
        <span className="text-sm text-ink3">{list.length}</span>
        {list.length > 0 && (
          <SortMenu
            value={settings.librarySort}
            onChange={(m) => updateSettings({ librarySort: m })}
          />
        )}
      </header>

      {list.length === 0 ? (
        <EmptyState icon={def.icon} text={t('account.emptyRow')} />
      ) : (
        <PosterGrid className="px-4">
          {list.map((i) => (
            <PosterCard
              key={i.id}
              className="w-auto"
              title={i.title}
              poster={i.poster}
              persist
              year={i.year}
              rating={i.rating}
              statusKind={i.status === 'completed' ? 'done' : 'ongoing'}
              rewatchCount={grades.get(i.id)}
              favorite={i.favorite}
              onClick={() => nav(`/media/${i.provider}/${i.mediaType}/${i.providerId}`)}
            />
          ))}
        </PosterGrid>
      )}
    </div>
  )
}
