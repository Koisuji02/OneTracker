/**
 * Profile tab: hero with rotating favorite artwork, editable identity
 * (custom name + avatar), watch-time stats, favorites, user lists and the
 * catalog rows (everything started or finished, expandable to grid views).
 */
import { useLiveQuery } from 'dexie-react-hooks'
import {
  BookOpen,
  Check,
  ChevronDown,
  ChevronRight,
  Clapperboard,
  Gamepad2,
  Heart,
  ListVideo,
  Pencil,
  Plus,
  Settings,
  Sparkles,
  Tv,
} from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import Avatar from '../components/Avatar'
import MediaRow from '../components/MediaRow'
import PosterCard from '../components/PosterCard'
import { computeStats, db, isEpisodic } from '../db'
import { useT } from '../i18n'
import { updateSettings, useSettings } from '../settings'
import type { LibraryItem } from '../types'
import { cn, formatWatchTime } from '../util'

const ROTATION_MS = 30 * 60 * 1000 // favorite backdrop rotates every 30 min

function CatalogRow({
  title,
  icon,
  to,
  items,
}: {
  title: string
  icon: React.ReactNode
  to: string
  items: LibraryItem[]
}) {
  const t = useT()
  const nav = useNavigate()
  return (
    <MediaRow title={title} icon={icon} to={to}>
      {items.length === 0 ? (
        <span className="py-3 text-sm text-ink4">{t('account.emptyRow')}</span>
      ) : (
        items.map((i) => (
          <PosterCard
            key={i.id}
            title={i.title}
            poster={i.poster}
            year={i.year}
            rating={i.rating}
            statusKind={i.status === 'completed' ? 'done' : 'ongoing'}
            onClick={() => nav(`/media/${i.provider}/${i.mediaType}/${i.providerId}`)}
          />
        ))
      )}
    </MediaRow>
  )
}

export default function AccountPage() {
  const t = useT()
  const settings = useSettings()
  const [expanded, setExpanded] = useState(false)
  const [editingName, setEditingName] = useState(false)
  const [nameDraft, setNameDraft] = useState('')
  const [slot, setSlot] = useState(() => Math.floor(Date.now() / ROTATION_MS))
  const stats = useLiveQuery(() => computeStats(), [])
  const items = useLiveQuery(() => db.items.toArray(), [])
  const lists = useLiveQuery(() => db.lists.orderBy('createdAt').toArray(), [])

  useEffect(() => {
    const timer = setInterval(() => setSlot(Math.floor(Date.now() / ROTATION_MS)), 60_000)
    return () => clearInterval(timer)
  }, [])

  if (!items || !stats || !lists) return null

  const favoriteArt = items.filter((i) => i.favorite && (i.backdrop || i.poster))
  const bgItem = favoriteArt.length > 0 ? favoriteArt[slot % favoriteArt.length] : null
  const displayName = settings.profileName || settings.googleName || t('account.guest')

  // catalog = everything the user has started or finished
  const started = items
    .filter((i) => i.status !== 'planned')
    .sort((a, b) => (b.completedAt ?? b.lastReadAt ?? b.addedAt) - (a.completedAt ?? a.lastReadAt ?? a.addedAt))
  const catSeries = started.filter((i) => isEpisodic(i.mediaType))
  const catMovies = started.filter((i) => i.mediaType === 'movie')
  const catBooks = started.filter((i) => i.mediaType === 'book' || i.mediaType === 'manga')
  const catGames = started.filter((i) => i.mediaType === 'game')
  const favoritesCount = items.filter((i) => i.favorite).length
  const firstList = lists[0]

  const saveName = () => {
    updateSettings({ profileName: nameDraft.trim() })
    setEditingName(false)
  }

  const timeRows = [
    { icon: <Tv size={18} />, label: t('account.tvTime'), value: formatWatchTime(stats.tvMin, t) },
    { icon: <Sparkles size={18} />, label: t('account.animeTime'), value: formatWatchTime(stats.animeMin, t) },
    { icon: <Clapperboard size={18} />, label: t('account.movieTime'), value: formatWatchTime(stats.movieMin, t) },
    ...(settings.showGames
      ? [{ icon: <Gamepad2 size={18} />, label: t('account.gameTime'), value: formatWatchTime(stats.gameMin, t) }]
      : []),
  ]
  const countRows = [
    `${stats.episodesWatched} ${t('account.episodesWatched')}`,
    `${stats.moviesWatched} ${t('account.moviesWatched')}`,
    ...(settings.showBooks
      ? [`${stats.chaptersRead} ${t('account.chaptersRead')}`, `${stats.booksRead} ${t('account.booksReadCount')}`]
      : []),
    ...(settings.showGames ? [`${stats.gamesPlayed} ${t('account.gamesPlayedCount')}`] : []),
  ]

  return (
    <div className="pb-6">
      {/* hero with rotating favorite artwork */}
      <div className="relative">
        <div className="relative h-64 w-full overflow-hidden md:h-80 md:rounded-b-3xl">
          {bgItem ? (
            <img
              src={bgItem.backdrop ?? bgItem.poster ?? undefined}
              alt=""
              className="h-full w-full object-cover"
            />
          ) : (
            <div className="h-full w-full bg-gradient-to-br from-card2 to-surface" />
          )}
          {/* fade only near the bottom so the artwork stays visible */}
          <div className="absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-surface to-transparent" />
          <Link
            to="/settings"
            aria-label={t('settings.title')}
            className="absolute right-4 top-6 grid h-10 w-10 place-items-center rounded-full bg-black/40 text-white backdrop-blur transition-colors hover:bg-black/60"
          >
            <Settings size={18} />
          </Link>
        </div>

        {/* profile overlapping the hero */}
        <div className="relative -mt-10 flex items-end gap-4 px-4">
          <Link to="/avatar" aria-label={t('avatar.title')} className="shrink-0">
            <Avatar className="h-20 w-20 border-4 border-surface text-3xl" />
          </Link>
          <div className="min-w-0 flex-1 pb-1">
            {editingName ? (
              <div className="flex items-center gap-2">
                <input
                  autoFocus
                  value={nameDraft}
                  onChange={(e) => setNameDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') saveName()
                    if (e.key === 'Escape') setEditingName(false)
                  }}
                  maxLength={30}
                  className="w-44 border-b-2 border-accent bg-transparent text-lg font-bold outline-none"
                />
                <button
                  onClick={saveName}
                  aria-label="save name"
                  className="grid h-8 w-8 place-items-center rounded-full bg-brand text-black"
                >
                  <Check size={15} strokeWidth={3} />
                </button>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <span className="truncate text-lg font-bold">{displayName}</span>
                <button
                  onClick={() => {
                    setNameDraft(settings.profileName || settings.googleName || '')
                    setEditingName(true)
                  }}
                  aria-label="edit name"
                  className="grid h-7 w-7 shrink-0 place-items-center rounded-full border border-line text-ink3 transition-colors hover:border-accent hover:text-accent"
                >
                  <Pencil size={12} />
                </button>
              </div>
            )}
            <div className="truncate text-sm text-ink3">
              {settings.googleEmail ?? t('account.localData')}
            </div>
          </div>
        </div>
      </div>

      {/* watch time */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="mx-4 mt-5 block w-[calc(100%-2rem)] rounded-2xl border border-line bg-card p-5 text-left"
      >
        <div className="flex items-center justify-between">
          <span className="text-xs font-bold uppercase tracking-wider text-ink3">
            {t('account.watchTime')}
          </span>
          <ChevronDown
            size={16}
            className={cn('text-ink3 transition-transform', expanded && 'rotate-180')}
          />
        </div>
        <div className="mt-2 text-3xl font-extrabold tracking-tight text-accent">
          {formatWatchTime(stats.totalMin, t)}
        </div>
        <div className="mt-1 text-xs text-ink4">{t('account.tapForDetails')}</div>
        {expanded && (
          <div className="mt-4 space-y-3 border-t border-line pt-4">
            {timeRows.map((r) => (
              <div key={r.label} className="flex items-center gap-3">
                <span className="text-accent">{r.icon}</span>
                <span className="flex-1 text-sm text-ink2">{r.label}</span>
                <span className="text-sm font-bold">{r.value}</span>
              </div>
            ))}
            <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 border-t border-line pt-3">
              {countRows.map((c) => (
                <span key={c} className="text-xs text-ink3">
                  {c}
                </span>
              ))}
            </div>
          </div>
        )}
      </button>

      {/* favorites */}
      <Link
        to="/favorites"
        className="mx-4 mt-3 flex items-center gap-3 rounded-2xl border border-line bg-card p-4 transition-colors hover:border-accent/50"
      >
        <span className="grid h-10 w-10 place-items-center rounded-full bg-brand/10 text-accent">
          <Heart size={18} fill="currentColor" />
        </span>
        <span className="flex-1 font-bold">{t('account.favorites')}</span>
        <span className="text-sm text-ink3">{favoritesCount}</span>
        <ChevronRight size={18} className="text-ink4" />
      </Link>

      {/* lists */}
      <div className="mt-6">
        <Link to="/lists" className="mb-2 flex items-center gap-2 px-4">
          <ListVideo size={18} className="text-accent" />
          <h2 className="text-base font-bold">{t('lists.title')}</h2>
          <ChevronRight size={18} className="text-ink3" />
        </Link>
        {firstList ? (
          <Link
            to={`/lists/${firstList.id}`}
            className="mx-4 block rounded-2xl border p-4"
            style={{ background: `${firstList.color}1f`, borderColor: `${firstList.color}66` }}
          >
            <div className="flex items-center justify-between">
              <span className="font-bold" style={{ color: firstList.color }}>
                {firstList.name}
              </span>
              <span className="text-xs text-ink3">
                {firstList.itemIds.length} {t('lists.items')}
              </span>
            </div>
            <ListPreviewThumbs itemIds={firstList.itemIds} items={items} />
          </Link>
        ) : (
          <Link
            to="/lists"
            className="mx-4 flex items-center justify-center gap-2 rounded-2xl border border-dashed border-line px-4 py-6 text-sm font-semibold text-ink3 transition-colors hover:border-accent hover:text-accent"
          >
            <Plus size={16} /> {t('lists.new')}
          </Link>
        )}
      </div>

      {/* catalog */}
      <div className="mt-8 space-y-7">
        <CatalogRow title={t('nav.series')} icon={<Tv size={18} />} to="/catalog/series" items={catSeries} />
        <CatalogRow
          title={t('nav.movies')}
          icon={<Clapperboard size={18} />}
          to="/catalog/movies"
          items={catMovies}
        />
        {settings.showBooks && (
          <CatalogRow title={t('nav.books')} icon={<BookOpen size={18} />} to="/catalog/books" items={catBooks} />
        )}
        {settings.showGames && (
          <CatalogRow title={t('nav.games')} icon={<Gamepad2 size={18} />} to="/catalog/games" items={catGames} />
        )}
      </div>
    </div>
  )
}

/** Small non-scrollable poster strip inside the list preview box. */
function ListPreviewThumbs({ itemIds, items }: { itemIds: string[]; items: LibraryItem[] }) {
  const byId = new Map(items.map((i) => [i.id, i]))
  const shown = itemIds
    .map((id) => byId.get(id))
    .filter(Boolean)
    .slice(0, 6) as LibraryItem[]
  if (shown.length === 0) return null
  return (
    <div className="mt-3 flex gap-2 overflow-hidden">
      {shown.map((i) => (
        <div key={i.id} className="h-20 w-14 shrink-0 overflow-hidden rounded-lg bg-card2">
          {i.poster && <img src={i.poster} alt="" className="h-full w-full object-cover" />}
        </div>
      ))}
    </div>
  )
}
