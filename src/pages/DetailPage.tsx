/**
 * Media detail page. Handles every media type:
 * - tv/anime: seasons accordion with per-episode checks (cascade marking:
 *   checking ep. 4 also marks 1–3; tapping a checked one opens the
 *   unwatch/rewatch dialog)
 * - manga/comics: chapters in checkable blocks of 100, same cascade rules
 * - movie/book: single watched toggle with rewatch support
 * - game: 3-state selector (to play / playing / completed) + personal hours
 * Plus: personal 0–10 rating, external critic banners, favorite, remove.
 *
 * Note on ids: AniList season-chains resolve to the ROOT season's id, so the
 * canonical id used for all library state is `details.id`, which can differ
 * from the URL param (e.g. opening "Fire Force 2" lands on the aggregated
 * "Fire Force" entry).
 */
import { useLiveQuery } from 'dexie-react-hooks'
import {
  ArrowLeft,
  Check,
  ChevronDown,
  Clock,
  Heart,
  ImageOff,
  Loader2,
  Plus,
  Star,
  Trash2,
} from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ApiKeyMissingError, getDetails, getEpisodes } from '../api'
import CheckButton from '../components/CheckButton'
import RatingBadge from '../components/RatingBadge'
import RatingModal from '../components/RatingModal'
import RewatchDialog from '../components/RewatchDialog'
import {
  addToLibrary,
  db,
  epKey,
  isCaughtUp,
  isEpisodic,
  markUpTo,
  refreshItemMetadata,
  removeFromLibrary,
  rewatchSingle,
  rewatchUpTo,
  setGameStatus,
  setMyPlaytime,
  setRangeWatched,
  setRating,
  setSeasonWatched,
  setSingleWatched,
  toggleFavorite,
  totalEpisodesOf,
  unmarkUnit,
} from '../db'
import { useT } from '../i18n'
import { useSettings } from '../settings'
import type {
  EpisodeInfo,
  ExternalRating,
  ItemStatus,
  LibraryItem,
  MediaDetails,
  MediaType,
  Provider,
  Season,
  WatchedEpisode,
} from '../types'
import { cn, formatDate } from '../util'

type Ensure = () => Promise<LibraryItem | null>
type UnitDialog = { season: number; episode: number; count: number; label: string } | null

/** Small colored pills with critic/community scores (IMDb, RT, MAL…). */
function RatingsBanners({ list }: { list: ExternalRating[] }) {
  const styles: Record<string, { bg: string; fg: string; emoji?: string }> = {
    imdb: { bg: '#f5c518', fg: '#000000' },
    rt: { bg: '#fa320a', fg: '#ffffff', emoji: '🍅' },
    metacritic: { bg: '#1b5e20', fg: '#ffffff' },
    mal: { bg: '#2e51a2', fg: '#ffffff' },
    anilist: { bg: '#3db4f2', fg: '#0b2534' },
    openlibrary: { bg: '#5b4636', fg: '#ffffff', emoji: '📖' },
    rawg: { bg: '#202020', fg: '#ffffff' },
  }
  if (list.length === 0) return null
  return (
    <div className="mt-4 flex flex-wrap items-center gap-2 px-4">
      {list.map((r) => {
        const s = styles[r.source] ?? { bg: '#333', fg: '#fff' }
        return (
          <span
            key={r.source}
            className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-black shadow"
            style={{ background: s.bg, color: s.fg }}
          >
            {s.emoji && <span>{s.emoji}</span>}
            <span className="opacity-80">{r.label}</span>
            {r.score}
          </span>
        )
      })}
    </div>
  )
}

/** One checkable unit row (episode or chapter). */
function UnitRow({
  number,
  title,
  sub,
  runtime,
  row,
  onMark,
  onOpenDialog,
}: {
  number: number
  title: string
  sub?: string | null
  runtime?: number | null
  row: WatchedEpisode | undefined
  onMark: () => void
  onOpenDialog: () => void
}) {
  const watched = !!row
  return (
    <div className="flex items-center gap-3 border-b border-line/50 px-4 py-2.5 last:border-b-0">
      <span className="w-9 shrink-0 text-sm font-bold text-accent">{number}</span>
      <div className="min-w-0 flex-1">
        <div className={cn('truncate text-sm', watched && 'text-ink3')}>{title}</div>
        {sub && <div className="text-[11px] text-ink4">{sub}</div>}
      </div>
      {runtime != null && <span className="shrink-0 text-xs text-ink4">{runtime} min</span>}
      <CheckButton
        size="sm"
        checked={watched}
        count={row?.count ?? 1}
        onClick={() => (watched ? onOpenDialog() : onMark())}
      />
    </div>
  )
}

/** Season accordion for tv/anime with cascade + rewatch behavior. */
function SeasonBlock({
  meta,
  season,
  watchedMap,
  ensure,
  onDialog,
}: {
  meta: MediaDetails
  season: Season
  watchedMap: Map<string, WatchedEpisode>
  ensure: Ensure
  onDialog: (d: UnitDialog) => void
}) {
  const t = useT()
  const [open, setOpen] = useState(false)
  const [eps, setEps] = useState<EpisodeInfo[] | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (open && eps === null) {
      getEpisodes(meta, season.number)
        .then(setEps)
        .catch(() => setEps([]))
    }
  }, [open, eps, meta, season.number])

  let watchedInSeason = 0
  for (let e = 1; e <= season.episodeCount; e++) {
    if (watchedMap.has(epKey(meta.id, season.number, e))) watchedInSeason++
  }
  const allWatched = watchedInSeason >= season.episodeCount && season.episodeCount > 0

  const markAll = async () => {
    setBusy(true)
    try {
      const item = await ensure()
      if (!item) return
      const list = eps ?? (await getEpisodes(meta, season.number))
      if (eps === null) setEps(list)
      await setSeasonWatched(item, season.number, list, !allWatched)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="overflow-hidden rounded-2xl border border-line bg-card">
      <div
        role="button"
        tabIndex={0}
        onClick={() => setOpen(!open)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') setOpen(!open)
        }}
        className="flex w-full cursor-pointer items-center gap-3 px-4 py-3 text-left"
      >
        <ChevronDown
          size={18}
          className={cn('shrink-0 text-ink3 transition-transform', open && 'rotate-180')}
        />
        <span className="flex-1 truncate font-semibold">
          {season.name || `${t('common.season')} ${season.number}`}
        </span>
        <span className="text-sm text-ink3">
          {watchedInSeason}/{season.episodeCount}
        </span>
        <button
          onClick={(e) => {
            e.stopPropagation()
            markAll()
          }}
          disabled={busy}
          className={cn(
            'rounded-full border px-3 py-1 text-xs font-semibold transition-colors',
            allWatched
              ? 'border-accent bg-brand text-black'
              : 'border-line text-ink2 hover:border-accent hover:text-accent',
          )}
        >
          {busy ? '…' : allWatched ? t('detail.unmarkAllSeason') : t('detail.markAllSeason')}
        </button>
      </div>

      {open && (
        <div className="border-t border-line">
          {eps === null ? (
            <div className="flex justify-center py-6">
              <Loader2 size={20} className="animate-spin text-ink3" />
            </div>
          ) : (
            eps.map((ep) => (
              <UnitRow
                key={ep.episode}
                number={ep.episode}
                title={ep.title || `${t('detail.episode')} ${ep.episode}`}
                sub={ep.airDate}
                runtime={ep.runtime}
                row={watchedMap.get(epKey(meta.id, season.number, ep.episode))}
                onMark={async () => {
                  const item = await ensure()
                  if (item) await markUpTo(item, season.number, ep.episode, ep.runtime)
                }}
                onOpenDialog={() =>
                  onDialog({
                    season: season.number,
                    episode: ep.episode,
                    count: watchedMap.get(epKey(meta.id, season.number, ep.episode))?.count ?? 1,
                    label: ep.title || `${t('detail.episode')} ${ep.episode}`,
                  })
                }
              />
            ))
          )}
        </div>
      )}
    </div>
  )
}

/** Chapters block (manga/comics): units in accordions of 100, with mark-all. */
function ChapterChunk({
  meta,
  start,
  end,
  eps,
  watchedMap,
  ensure,
  onDialog,
  defaultOpen,
}: {
  meta: MediaDetails
  start: number
  end: number
  /** full chapter list (index = chapter-1) with real titles when available */
  eps: EpisodeInfo[] | null
  watchedMap: Map<string, WatchedEpisode>
  ensure: Ensure
  onDialog: (d: UnitDialog) => void
  defaultOpen: boolean
}) {
  const t = useT()
  const [open, setOpen] = useState(defaultOpen)
  const [busy, setBusy] = useState(false)
  let watchedIn = 0
  for (let c = start; c <= end; c++) {
    if (watchedMap.has(epKey(meta.id, 1, c))) watchedIn++
  }
  const allRead = watchedIn >= end - start + 1

  const markAll = async () => {
    setBusy(true)
    try {
      const item = await ensure()
      if (item) await setRangeWatched(item, 1, start, end, !allRead)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="overflow-hidden rounded-2xl border border-line bg-card">
      <div
        role="button"
        tabIndex={0}
        onClick={() => setOpen(!open)}
        className="flex w-full cursor-pointer items-center gap-3 px-4 py-3 text-left"
      >
        <ChevronDown
          size={18}
          className={cn('shrink-0 text-ink3 transition-transform', open && 'rotate-180')}
        />
        <span className="flex-1 font-semibold">
          {t('books.chapter')} {start}–{end}
        </span>
        <span className="text-sm text-ink3">
          {watchedIn}/{end - start + 1}
        </span>
        <button
          onClick={(e) => {
            e.stopPropagation()
            markAll()
          }}
          disabled={busy}
          className={cn(
            'rounded-full border px-3 py-1 text-xs font-semibold transition-colors',
            allRead
              ? 'border-accent bg-brand text-black'
              : 'border-line text-ink2 hover:border-accent hover:text-accent',
          )}
        >
          {busy ? '…' : allRead ? t('detail.unmarkAllSeason') : t('detail.markAllSeason')}
        </button>
      </div>
      {open && (
        <div className="border-t border-line">
          {Array.from({ length: end - start + 1 }, (_, i) => start + i).map((c) => (
            <UnitRow
              key={c}
              number={c}
              title={eps?.[c - 1]?.title || `${t('books.chapter')} ${c}`}
              row={watchedMap.get(epKey(meta.id, 1, c))}
              onMark={async () => {
                const item = await ensure()
                if (item) await markUpTo(item, 1, c)
              }}
              onOpenDialog={() =>
                onDialog({
                  season: 1,
                  episode: c,
                  count: watchedMap.get(epKey(meta.id, 1, c))?.count ?? 1,
                  label: eps?.[c - 1]?.title || `${t('books.chapter')} ${c}`,
                })
              }
            />
          ))}
        </div>
      )}
    </div>
  )
}

export default function DetailPage() {
  const { provider, mediaType, id } = useParams() as {
    provider: Provider
    mediaType: MediaType
    id: string
  }
  const t = useT()
  const nav = useNavigate()
  const { language } = useSettings()
  const [details, setDetails] = useState<MediaDetails | null>(null)
  const [error, setError] = useState<'keymissing' | 'error' | null>(null)
  const [unitDialog, setUnitDialog] = useState<UnitDialog>(null)
  const [singleDialog, setSingleDialog] = useState(false)
  const [ratingOpen, setRatingOpen] = useState(false)
  const [chapterEps, setChapterEps] = useState<EpisodeInfo[] | null>(null)

  const paramId = `${provider}:${id}`
  // season-chain aggregation may resolve to a different (root) id
  const canonicalId = details?.id ?? paramId
  const libItem = useLiveQuery(() => db.items.get(canonicalId), [canonicalId])
  const watchedEps = useLiveQuery(
    () => db.episodes.where('itemId').equals(canonicalId).toArray(),
    [canonicalId],
  )

  useEffect(() => {
    let alive = true
    setDetails(null)
    setError(null)
    getDetails(provider, mediaType, id)
      .then((d) => {
        if (!alive) return
        setDetails(d)
        // keep the library snapshot fresh (new episodes/chapters, dates, art)
        refreshItemMetadata(d).catch(() => {})
      })
      .catch((err) => {
        if (alive) setError(err instanceof ApiKeyMissingError ? 'keymissing' : 'error')
      })
    return () => {
      alive = false
    }
  }, [provider, mediaType, id, language])

  // fall back to the library snapshot when the API is unavailable
  const meta: MediaDetails | null = details ?? (libItem as MediaDetails | undefined) ?? null

  // manga: load the chapter list once (brings real titles from MangaDex)
  const isMangaMeta = meta?.mediaType === 'manga'
  useEffect(() => {
    let alive = true
    setChapterEps(null)
    if (!isMangaMeta || !meta) return
    getEpisodes(meta, 1)
      .then((eps) => {
        if (alive) setChapterEps(eps)
      })
      .catch(() => {})
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isMangaMeta, details?.id, meta?.totalEpisodes])
  const watchedMap = new Map((watchedEps ?? []).map((e) => [e.id, e]))

  const ensure: Ensure = useCallback(async () => {
    const existing = await db.items.get(canonicalId)
    if (existing) return existing
    if (details) return addToLibrary(details)
    return null
  }, [canonicalId, details])

  if (!meta) {
    return (
      <div className="flex h-[70vh] flex-col items-center justify-center gap-4 px-6 text-center">
        {error === null && <Loader2 size={28} className="animate-spin text-accent" />}
        {error === 'keymissing' && (
          <>
            <p className="text-sm text-ink2">{t('search.tmdbKeyMissing')}</p>
            <Link
              to="/settings"
              className="rounded-full bg-brand px-5 py-2.5 text-sm font-bold text-black"
            >
              {t('settings.title')}
            </Link>
          </>
        )}
        {error === 'error' && <p className="text-sm text-ink2">{t('common.error')}</p>}
        <button onClick={() => nav(-1)} className="text-sm font-semibold text-accent">
          ← {t('common.close')}
        </button>
      </div>
    )
  }

  const episodic = isEpisodic(meta.mediaType)
  const isManga = meta.mediaType === 'manga'
  const isGame = meta.mediaType === 'game'
  const single = meta.mediaType === 'movie' || meta.mediaType === 'book'
  const total = episodic ? totalEpisodesOf(meta as LibraryItem) : null
  const watchedCount = watchedMap.size
  const inLibrary = !!libItem
  const completed = libItem?.status === 'completed'
  const chapterTotal = meta.totalEpisodes ?? null
  const chaptersDone = isManga ? watchedCount : 0
  const caughtUp = libItem ? isCaughtUp(libItem, watchedCount) : false

  const singleLabels: Record<string, [string, string]> = {
    movie: ['detail.markWatched', 'detail.watched'],
    book: ['detail.markRead', 'detail.read'],
  }

  const metaLine = [
    meta.year ? String(meta.year) : null,
    meta.runtime ? `${meta.runtime} min` : null,
    episodic && total ? `${total} ${t('common.episodes')}` : null,
    isManga && chapterTotal ? `${chapterTotal} ${t('books.chapters').toLowerCase()}` : null,
    meta.playtime ? `~${meta.playtime} h` : null,
    meta.authors?.length ? meta.authors.join(', ') : null,
  ]
    .filter(Boolean)
    .join(' • ')

  // manga chapter blocks of 100
  const chapterBlocks: Array<[number, number]> = []
  if (isManga && chapterTotal) {
    for (let s = 1; s <= chapterTotal; s += 100) {
      chapterBlocks.push([s, Math.min(s + 99, chapterTotal)])
    }
  }
  const firstUnread = chaptersDone + 1

  return (
    <div className="pb-8">
      {/* hero */}
      <div className="relative h-52 w-full overflow-hidden md:h-72 md:rounded-b-3xl">
        {meta.backdrop ? (
          <img src={meta.backdrop} alt="" className="h-full w-full object-cover" />
        ) : (
          <div className="h-full w-full bg-gradient-to-br from-card2 to-surface" />
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-surface via-surface/30 to-black/30" />
        <button
          onClick={() => nav(-1)}
          aria-label="back"
          className="absolute left-3 top-safe grid h-10 w-10 place-items-center rounded-full bg-black/50 text-white backdrop-blur transition-colors hover:bg-black/70"
        >
          <ArrowLeft size={20} />
        </button>
      </div>

      {/* poster + title */}
      <div className="relative -mt-20 flex items-end gap-4 px-4">
        <div className="h-36 w-24 shrink-0 overflow-hidden rounded-xl border border-line bg-card2 shadow-2xl">
          {meta.poster ? (
            <img src={meta.poster} alt={meta.title} className="h-full w-full object-cover" />
          ) : (
            <div className="grid h-full w-full place-items-center text-ink4">
              <ImageOff size={24} />
            </div>
          )}
        </div>
        <div className="min-w-0 flex-1 pb-1">
          <h1 className="text-xl font-extrabold leading-tight">{meta.title}</h1>
          {metaLine && <p className="mt-1 text-sm text-ink2">{metaLine}</p>}
          {meta.genres && meta.genres.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {meta.genres.slice(0, 3).map((g) => (
                <span
                  key={g}
                  className="rounded-full border border-line bg-card px-2.5 py-0.5 text-[11px] font-medium text-ink2"
                >
                  {g}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* actions */}
      <div className="mt-5 flex items-center gap-2.5 px-4">
        {!inLibrary ? (
          <button
            onClick={() => ensure()}
            disabled={!details}
            className="flex flex-1 items-center justify-center gap-2 rounded-full bg-brand py-3 text-sm font-bold text-black transition-transform active:scale-95 disabled:opacity-50"
          >
            <Plus size={18} strokeWidth={3} /> {t('detail.addToList')}
          </button>
        ) : (
          <>
            {single && (
              <button
                onClick={() => (completed ? setSingleDialog(true) : setSingleWatched(canonicalId, true))}
                className={cn(
                  'flex flex-1 items-center justify-center gap-2 rounded-full py-3 text-sm font-bold transition-transform active:scale-95',
                  completed
                    ? 'border border-accent bg-brand/10 text-accent'
                    : 'bg-brand text-black',
                )}
              >
                <Check size={18} strokeWidth={3} />
                {t(singleLabels[meta.mediaType]?.[completed ? 1 : 0] ?? 'detail.markWatched')}
                {completed && (libItem?.watchCount ?? 1) >= 2 && ` x${libItem?.watchCount}`}
              </button>
            )}
            {isGame && (
              <div className="flex flex-1 gap-1.5">
                {(
                  [
                    ['planned', t('games.toPlay')],
                    ['watching', t('games.playing')],
                    ['completed', t('games.completed')],
                  ] as Array<[ItemStatus, string]>
                ).map(([s, label]) => (
                  <button
                    key={s}
                    onClick={() =>
                      s === 'completed' && libItem?.status === 'completed'
                        ? setSingleDialog(true)
                        : setGameStatus(canonicalId, s)
                    }
                    className={cn(
                      'flex-1 rounded-full border px-1 py-2.5 text-xs font-bold transition-colors',
                      libItem?.status === s
                        ? 'border-accent bg-brand text-black'
                        : 'border-line text-ink3 hover:border-accent hover:text-accent',
                    )}
                  >
                    {label}
                    {s === 'completed' && (libItem?.watchCount ?? 1) >= 2 && ` x${libItem?.watchCount}`}
                  </button>
                ))}
              </div>
            )}
            {(episodic || isManga) && (
              <div className="flex-1">
                <div className="mb-1.5 flex justify-between text-xs text-ink2">
                  <span>
                    {watchedCount}
                    {(episodic ? total : chapterTotal) != null &&
                      `/${episodic ? total : chapterTotal}`}{' '}
                    {episodic ? t('detail.progress') : t('books.chapters').toLowerCase()}
                  </span>
                  {(episodic ? total : chapterTotal) != null && (
                    <span>
                      {Math.round((watchedCount / (episodic ? total! : chapterTotal!)) * 100)}%
                    </span>
                  )}
                </div>
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-card2">
                  <div
                    className="h-full rounded-full bg-brand transition-all"
                    style={{
                      width:
                        (episodic ? total : chapterTotal) != null
                          ? `${Math.min(100, (watchedCount / (episodic ? total! : chapterTotal!)) * 100)}%`
                          : watchedCount > 0
                            ? '100%'
                            : '0%',
                    }}
                  />
                </div>
              </div>
            )}
            <button
              onClick={() => removeFromLibrary(canonicalId)}
              aria-label={t('detail.removeFromList')}
              className="grid h-11 w-11 shrink-0 place-items-center rounded-full border border-line text-ink3 transition-colors hover:border-red-500 hover:text-red-500"
            >
              <Trash2 size={18} />
            </button>
          </>
        )}
        <button
          onClick={() => setRatingOpen(true)}
          aria-label={t('rating.add')}
          className={cn(
            'grid shrink-0 place-items-center transition-transform active:scale-90',
            libItem?.rating == null &&
              'h-11 w-11 rounded-full border border-line text-ink3 transition-colors hover:border-accent hover:text-accent',
          )}
        >
          {libItem?.rating != null ? (
            <RatingBadge value={libItem.rating} size="md" />
          ) : (
            <Star size={18} />
          )}
        </button>
        <button
          onClick={async () => {
            const item = await ensure()
            if (item) toggleFavorite(item.id)
          }}
          aria-label="favorite"
          className={cn(
            'grid h-11 w-11 shrink-0 place-items-center rounded-full border transition-colors',
            libItem?.favorite
              ? 'border-accent bg-brand text-black'
              : 'border-line text-ink3 hover:border-accent hover:text-accent',
          )}
        >
          <Heart size={18} fill={libItem?.favorite ? 'currentColor' : 'none'} />
        </button>
      </div>

      {/* critic ratings */}
      {details?.externalRatings && <RatingsBanners list={details.externalRatings} />}

      {/* game: personal playtime */}
      {isGame && inLibrary && libItem?.status !== 'planned' && (
        <div className="mt-4 flex items-center gap-3 px-4">
          <label className="text-sm font-medium text-ink2">{t('games.myPlaytime')}</label>
          <input
            type="number"
            min={0}
            value={libItem?.myPlaytime ?? ''}
            onChange={(e) =>
              setMyPlaytime(
                canonicalId,
                e.target.value === '' ? null : Math.max(0, Number(e.target.value)),
              )
            }
            placeholder="0"
            className="w-24 rounded-xl border border-line bg-card px-3 py-2 text-sm outline-none transition-colors focus:border-accent"
          />
          <span className="text-sm text-ink3">h</span>
        </div>
      )}

      {/* manga: chapter checklist */}
      {isManga && (
        <section className="mt-6 px-4">
          <div className="mb-3 flex items-center gap-2.5">
            <h2 className="text-lg font-bold">{t('books.chapters')}</h2>
            {meta.ongoing && (
              <span
                className={cn(
                  'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-semibold',
                  caughtUp ? 'border-accent bg-brand/10 text-accent' : 'border-line text-ink3',
                )}
              >
                <Clock size={12} /> {caughtUp ? t('books.waiting') : t('books.ongoing')}
              </span>
            )}
          </div>
          {meta.lastReleaseDate && (
            <div className="mb-3 text-xs text-ink3">
              {t('books.lastOn')} {formatDate(meta.lastReleaseDate, language)}
            </div>
          )}
          <div className="space-y-3">
            {chapterBlocks.map(([start, end]) => (
              <ChapterChunk
                key={start}
                meta={meta}
                start={start}
                end={end}
                eps={chapterEps}
                watchedMap={watchedMap}
                ensure={ensure}
                onDialog={setUnitDialog}
                defaultOpen={firstUnread >= start && firstUnread <= end}
              />
            ))}
            {chapterBlocks.length === 0 && (
              <p className="text-sm text-ink3">{t('common.error')}</p>
            )}
          </div>
        </section>
      )}

      {/* overview */}
      {meta.overview && (
        <section className="mt-6 px-4">
          <h2 className="mb-2 text-lg font-bold">{t('detail.overview')}</h2>
          <p className="whitespace-pre-line text-sm leading-relaxed text-ink2">
            {meta.overview}
          </p>
        </section>
      )}

      {/* cast */}
      {details?.cast && details.cast.length > 0 && (
        <section className="mt-6">
          <h2 className="mb-3 px-4 text-lg font-bold">{t('detail.cast')}</h2>
          <div className="no-scrollbar flex gap-4 overflow-x-auto px-4">
            {details.cast.map((c, i) => (
              <div key={i} className="w-16 shrink-0 text-center">
                <div className="h-16 w-16 overflow-hidden rounded-full border border-line bg-card2">
                  {c.photo ? (
                    <img src={c.photo} alt={c.name} loading="lazy" className="h-full w-full object-cover" />
                  ) : (
                    <div className="grid h-full w-full place-items-center text-ink4">
                      <ImageOff size={16} />
                    </div>
                  )}
                </div>
                <div className="mt-1.5 line-clamp-2 text-[11px] font-medium leading-tight">
                  {c.name}
                </div>
                {c.role && <div className="truncate text-[10px] text-ink4">{c.role}</div>}
              </div>
            ))}
          </div>
        </section>
      )}

      {/* seasons & episodes */}
      {episodic && meta.seasons && meta.seasons.length > 0 && (
        <section className="mt-6 px-4">
          <h2 className="mb-3 text-lg font-bold">{t('detail.seasons')}</h2>
          <div className="space-y-3">
            {meta.seasons
              .filter((s) => s.number > 0)
              .map((s) => (
                <SeasonBlock
                  key={s.number}
                  meta={meta}
                  season={s}
                  watchedMap={watchedMap}
                  ensure={ensure}
                  onDialog={setUnitDialog}
                />
              ))}
          </div>
        </section>
      )}

      {/* dialogs */}
      {unitDialog && (
        <RewatchDialog
          label={unitDialog.label}
          count={unitDialog.count}
          onUnmark={async () => {
            const item = await ensure()
            if (item) await unmarkUnit(item, unitDialog.season, unitDialog.episode)
          }}
          onRewatch={async () => {
            const item = await ensure()
            if (item) await rewatchUpTo(item, unitDialog.season, unitDialog.episode)
          }}
          onClose={() => setUnitDialog(null)}
        />
      )}
      {singleDialog && (
        <RewatchDialog
          label={meta.title}
          count={libItem?.watchCount ?? 1}
          onUnmark={() =>
            isGame ? setGameStatus(canonicalId, 'watching') : setSingleWatched(canonicalId, false)
          }
          onRewatch={() => rewatchSingle(canonicalId)}
          onClose={() => setSingleDialog(false)}
        />
      )}
      {ratingOpen && (
        <RatingModal
          title={meta.title}
          initial={libItem?.rating ?? null}
          onSave={async (v) => {
            const item = await ensure()
            if (item) await setRating(item.id, v)
          }}
          onRemove={() => setRating(canonicalId, null)}
          onClose={() => setRatingOpen(false)}
        />
      )}
    </div>
  )
}
