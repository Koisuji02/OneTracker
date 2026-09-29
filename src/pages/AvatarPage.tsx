/**
 * Avatar picker: upload a personal photo (downscaled and stored locally as a
 * data-URL), pick a poster from your own library, or use one of the bundled
 * character presets (emoji on a colored tile — original, license-free).
 *
 * EVERY favourite is on offer, grouped by media. The grid used to be one list
 * — favourites first, then the rest — cut at 40 covers, so with enough
 * favourites the older ones (typically books and manga) silently fell off.
 * The rest of the library follows, a page at a time.
 */
import { useLiveQuery } from 'dexie-react-hooks'
import { ArrowLeft, Trash2, Upload } from 'lucide-react'
import { useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import Avatar from '../components/Avatar'
import Cover from '../components/Cover'
import { db, isEpisodic } from '../db'
import { useT } from '../i18n'
import { updateSettings, useSettings } from '../settings'
import type { LibraryItem } from '../types'
import { cn } from '../util'

/** Built-in "character" presets: [emoji, background]. */
const PRESETS: Array<[string, string]> = [
  ['🦊', '#c2410c'],
  ['🐼', '#1e3a8a'],
  ['🤖', '#0f766e'],
  ['👻', '#6d28d9'],
  ['🐉', '#15803d'],
  ['🍥', '#b45309'],
  ['⚔️', '#374151'],
  ['🚀', '#0369a1'],
  ['🧙', '#7c3aed'],
  ['🏴‍☠️', '#1f2937'],
  ['💀', '#52525b'],
  ['🌸', '#be185d'],
  ['🐺', '#334155'],
  ['🎮', '#9333ea'],
  ['🍿', '#a16207'],
  ['🎬', '#b91c1c'],
]

/** Non-favourites shown per "show more" step. */
const PAGE = 24

/** Downscale an uploaded image to a 256px square data-URL. */
async function fileToAvatar(file: File): Promise<string> {
  const url = URL.createObjectURL(file)
  try {
    const img = new Image()
    await new Promise((res, rej) => {
      img.onload = res
      img.onerror = rej
      img.src = url
    })
    const size = 256
    const canvas = document.createElement('canvas')
    canvas.width = size
    canvas.height = size
    const ctx = canvas.getContext('2d')!
    const side = Math.min(img.width, img.height)
    ctx.drawImage(img, (img.width - side) / 2, (img.height - side) / 2, side, side, 0, 0, size, size)
    return canvas.toDataURL('image/jpeg', 0.85)
  } finally {
    URL.revokeObjectURL(url)
  }
}

/** The artwork an item can lend to the avatar (a poster, else its backdrop). */
const artOf = (i: LibraryItem) => i.poster ?? i.backdrop ?? null

function PosterTile({
  item,
  selected,
  onPick,
}: {
  item: LibraryItem
  selected: boolean
  onPick: (url: string) => void
}) {
  const art = artOf(item)!
  return (
    <button
      onClick={() => onPick(art)}
      title={item.title}
      aria-label={item.title}
      className={cn(
        'aspect-square overflow-hidden rounded-2xl border-2 bg-card2 transition-transform hover:scale-105 active:scale-95',
        selected ? 'border-brand' : 'border-line',
      )}
    >
      <Cover src={art} alt={item.title} persist className="h-full w-full object-cover" />
    </button>
  )
}

export default function AvatarPage() {
  const t = useT()
  const nav = useNavigate()
  const settings = useSettings()
  const fileRef = useRef<HTMLInputElement>(null)
  const items = useLiveQuery(() => db.items.toArray(), [])
  const [shown, setShown] = useState(PAGE)

  const pick = (value: string | null) => {
    updateSettings({ avatar: value })
    nav(-1)
  }

  const withArt = (items ?? []).filter((i) => artOf(i)).sort((a, b) => b.addedAt - a.addedAt)
  const favorites = withArt.filter((i) => i.favorite)
  const favGroups = [
    { key: 'series', title: t('account.favSeries'), items: favorites.filter((i) => isEpisodic(i.mediaType)) },
    { key: 'movies', title: t('account.favMovies'), items: favorites.filter((i) => i.mediaType === 'movie') },
    {
      key: 'books',
      title: t('account.favBooks'),
      items: favorites.filter((i) => i.mediaType === 'book' || i.mediaType === 'manga'),
    },
    { key: 'games', title: t('account.favGames'), items: favorites.filter((i) => i.mediaType === 'game') },
  ].filter((g) => g.items.length > 0)
  const others = withArt.filter((i) => !i.favorite)

  const tile = (i: LibraryItem) => (
    <PosterTile key={i.id} item={i} selected={settings.avatar === artOf(i)} onPick={pick} />
  )

  return (
    <div className="pb-10">
      <header className="flex items-center gap-3 px-4 pb-4 pt-safe">
        <button
          onClick={() => nav(-1)}
          aria-label="back"
          className="grid h-10 w-10 place-items-center rounded-xl border border-line text-ink2 transition-colors hover:border-accent hover:text-accent"
        >
          <ArrowLeft size={18} />
        </button>
        <h1 className="flex-1 text-2xl font-extrabold tracking-tight">{t('avatar.title')}</h1>
        <Avatar className="h-12 w-12 text-xl" />
      </header>

      <div className="flex gap-2.5 px-4">
        <button
          onClick={() => fileRef.current?.click()}
          className="flex flex-1 items-center justify-center gap-2 rounded-2xl bg-brand py-3 text-sm font-bold text-black transition-transform active:scale-95"
        >
          <Upload size={16} strokeWidth={2.5} /> {t('avatar.upload')}
        </button>
        {settings.avatar && (
          <button
            onClick={() => pick(null)}
            className="flex items-center justify-center gap-2 rounded-2xl border border-line px-4 py-3 text-sm font-bold text-ink2 transition-colors hover:border-red-500 hover:text-red-400"
          >
            <Trash2 size={16} /> {t('avatar.reset')}
          </button>
        )}
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={async (e) => {
            const f = e.target.files?.[0]
            if (f) pick(await fileToAvatar(f))
            e.target.value = ''
          }}
        />
      </div>

      <section className="mt-7 px-4">
        <h2 className="mb-3 text-lg font-bold">{t('avatar.builtin')}</h2>
        <div className="grid grid-cols-4 gap-3 sm:grid-cols-6">
          {PRESETS.map(([emoji, bg]) => (
            <button
              key={emoji + bg}
              onClick={() => pick(`emoji:${emoji}:${bg}`)}
              className="grid aspect-square place-items-center rounded-2xl border-2 border-line text-3xl transition-transform hover:scale-105 active:scale-95"
              style={{ background: bg }}
            >
              {emoji}
            </button>
          ))}
        </div>
      </section>

      {favGroups.length > 0 && (
        <section className="mt-7 px-4">
          <h2 className="text-lg font-bold">{t('avatar.favorites')}</h2>
          {favGroups.map((g) => (
            <div key={g.key} className="mt-4">
              <h3 className="mb-2.5 text-xs font-bold uppercase tracking-wider text-ink3">
                {g.title} <span className="tabular-nums text-ink4">{g.items.length}</span>
              </h3>
              <div className="grid grid-cols-4 gap-3 sm:grid-cols-6">{g.items.map(tile)}</div>
            </div>
          ))}
        </section>
      )}

      {others.length > 0 && (
        <section className="mt-7 px-4">
          <h2 className="mb-3 text-lg font-bold">
            {favGroups.length > 0 ? t('avatar.others') : t('avatar.library')}
          </h2>
          <div className="grid grid-cols-4 gap-3 sm:grid-cols-6">{others.slice(0, shown).map(tile)}</div>
          {others.length > shown && (
            <button
              onClick={() => setShown((n) => n + PAGE * 2)}
              className="mt-4 w-full rounded-2xl border border-line py-3 text-sm font-bold text-ink2 transition-colors hover:border-accent hover:text-accent"
            >
              {t('avatar.showMore')} <span className="tabular-nums text-ink4">({others.length - shown})</span>
            </button>
          )}
        </section>
      )}
    </div>
  )
}
