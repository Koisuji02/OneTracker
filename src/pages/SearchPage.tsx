import { useLiveQuery } from 'dexie-react-hooks'
import {
  BookOpen,
  BookText,
  Clapperboard,
  Gamepad2,
  Search,
  Sparkles,
  Tv,
} from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import {
  ApiKeyMissingError,
  getDetails,
  searchAnime,
  searchBooks,
  searchComics,
  searchGames,
  searchManga,
  searchMovies,
  searchTv,
} from '../api'
import { enrichAnimeCovers, enrichGameCovers } from '../api/covers'
import MediaRow from '../components/MediaRow'
import PosterCard from '../components/PosterCard'
import { addToLibrary, db } from '../db'
import { useT } from '../i18n'
import { useSettings } from '../settings'
import type { SearchResult } from '../types'

interface RowConfig {
  key: string
  label: string
  icon: ReactNode
  run: (q: string) => Promise<SearchResult[]>
}

interface RowState {
  status: 'loading' | 'done' | 'keymissing' | 'error'
  items: SearchResult[]
}

/**
 * Module-level cache: keeps the last query + results alive across navigation
 * (open a result, go back → results are still there). It resets when the app
 * is closed/reloaded, which is exactly the wanted behavior.
 */
let searchMemory: { q: string; rows: Record<string, RowState> } = { q: '', rows: {} }

const KEY_MISSING_MSG: Record<string, string> = {
  games: 'search.rawgKeyMissing',
  comics: 'search.comicvineKeyMissing',
}

function SkeletonRow() {
  return (
    <>
      {Array.from({ length: 6 }, (_, i) => (
        <div key={i} className="w-28 shrink-0">
          <div className="aspect-[2/3] animate-pulse rounded-xl bg-card2" />
          <div className="mt-2 h-3 w-20 animate-pulse rounded bg-card2" />
        </div>
      ))}
    </>
  )
}

export default function SearchPage() {
  const t = useT()
  const nav = useNavigate()
  const settings = useSettings()
  const [q, setQ] = useState(searchMemory.q)
  const [rows, setRows] = useState<Record<string, RowState>>(searchMemory.rows)
  const seqRef = useRef(0)
  // when restored from memory, don't refire the search on mount
  const restoredRef = useRef(searchMemory.q.trim().length >= 2)

  useEffect(() => {
    searchMemory = { q, rows }
  }, [q, rows])

  // id → poster of tracked items: search results reuse the SAME cover the
  // rest of the app shows (titled box art etc.), keeping artwork consistent
  const libraryPosters = useLiveQuery(async () => {
    const items = await db.items.toArray()
    return new Map(items.map((i) => [i.id, i.poster ?? null]))
  }, [])

  const configs = useMemo<RowConfig[]>(() => {
    const list: RowConfig[] = [
      { key: 'tv', label: t('search.tv'), icon: <Tv size={18} />, run: searchTv },
      {
        key: 'anime',
        label: t('search.anime'),
        icon: <Sparkles size={18} />,
        // same classic posters the detail pages show (shared cover cache)
        run: (q) => searchAnime(q).then(enrichAnimeCovers),
      },
      { key: 'movies', label: t('search.movies'), icon: <Clapperboard size={18} />, run: searchMovies },
    ]
    if (settings.showBooks) {
      list.push({ key: 'books', label: t('search.books'), icon: <BookOpen size={18} />, run: searchBooks })
      list.push({ key: 'manga', label: t('search.manga'), icon: <BookText size={18} />, run: searchManga })
      list.push({ key: 'comics', label: t('search.comics'), icon: <BookText size={18} />, run: searchComics })
    }
    if (settings.showGames) {
      list.push({
        key: 'games',
        label: t('search.games'),
        icon: <Gamepad2 size={18} />,
        // titled box art from the shared cover cache
        run: (q) => searchGames(q).then(enrichGameCovers),
      })
    }
    return list
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.language, settings.showBooks, settings.showGames])

  useEffect(() => {
    const query = q.trim()
    if (query.length < 2) {
      setRows({})
      return
    }
    if (restoredRef.current) {
      restoredRef.current = false
      return
    }
    const timer = setTimeout(() => {
      const seq = ++seqRef.current
      for (const cfg of configs) {
        setRows((s) => ({ ...s, [cfg.key]: { status: 'loading', items: s[cfg.key]?.items ?? [] } }))
        cfg
          .run(query)
          .then((items) => {
            if (seqRef.current !== seq) return
            setRows((s) => ({ ...s, [cfg.key]: { status: 'done', items } }))
          })
          .catch((err) => {
            if (seqRef.current !== seq) return
            setRows((s) => ({
              ...s,
              [cfg.key]: {
                status: err instanceof ApiKeyMissingError ? 'keymissing' : 'error',
                items: [],
              },
            }))
          })
      }
    }, 350)
    return () => clearTimeout(timer)
  }, [q, configs])

  const quickAdd = async (r: SearchResult) => {
    try {
      const details = await getDetails(r.provider, r.mediaType, r.providerId)
      await addToLibrary(details)
    } catch {
      // ignore — user can retry from the detail page
    }
  }

  const active = q.trim().length >= 2

  return (
    <div>
      <div className="sticky top-0 z-30 bg-surface/95 px-4 pb-3 pt-safe backdrop-blur">
        <div className="relative">
          <Search size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-ink3" />
          <input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={t('search.placeholder')}
            className="w-full rounded-full border border-line bg-card py-3 pl-11 pr-4 text-[15px] outline-none transition-colors placeholder:text-ink4 focus:border-accent"
          />
        </div>
      </div>

      {!active && (
        <div className="flex flex-col items-center gap-3 px-6 py-16 text-center">
          <Search size={36} className="text-ink4" />
          <p className="text-sm text-ink3">{t('search.hint')}</p>
        </div>
      )}

      {active && (
        <div className="space-y-6 pb-4 pt-2">
          {configs.map((cfg) => {
            const row = rows[cfg.key]
            if (!row) return null
            return (
              <MediaRow key={cfg.key} title={cfg.label} icon={cfg.icon}>
                {row.status === 'loading' && row.items.length === 0 && <SkeletonRow />}
                {row.status === 'keymissing' && (
                  <Link
                    to="/settings"
                    className="w-full rounded-2xl border border-accent/30 bg-brand/10 px-4 py-4 text-sm font-medium text-accent"
                  >
                    {t(KEY_MISSING_MSG[cfg.key] ?? 'search.tmdbKeyMissing')} →
                  </Link>
                )}
                {row.status === 'error' && (
                  <span className="py-4 text-sm text-ink3">{t('common.error')}</span>
                )}
                {(row.status === 'done' || row.items.length > 0) &&
                  row.status !== 'keymissing' &&
                  (row.items.length === 0 && row.status === 'done' ? (
                    <span className="py-4 text-sm text-ink4">{t('search.noResults')}</span>
                  ) : (
                    row.items.map((r) => {
                      const id = `${r.provider}:${r.providerId}`
                      return (
                        <PosterCard
                          key={id}
                          title={r.title}
                          year={r.year}
                          poster={libraryPosters?.get(id) ?? r.poster}
                          inLibrary={libraryPosters?.has(id) ?? false}
                          onAdd={() => quickAdd(r)}
                          onClick={() => nav(`/media/${r.provider}/${r.mediaType}/${r.providerId}`)}
                        />
                      )
                    })
                  ))}
              </MediaRow>
            )
          })}
        </div>
      )}
    </div>
  )
}
