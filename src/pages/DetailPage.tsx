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
  Archive,
  ArrowLeft,
  Check,
  ChevronDown,
  Clock,
  Heart,
  ImageOff,
  Key,
  Loader2,
  Lock,
  Plus,
  Star,
  Trash2,
} from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ApiKeyMissingError, getDetails, getEpisodes } from '../api'
import CheckButton from '../components/CheckButton'
import Cover from '../components/Cover'
import Gallery from '../components/Gallery'
import OfflineNotice from '../components/OfflineNotice'
import PlatformChips from '../components/PlatformChips'
import RatingBadge from '../components/RatingBadge'
import RatingModal from '../components/RatingModal'
import RatingsBanners from '../components/RatingsBanners'
import RewatchDialog from '../components/RewatchDialog'
import {
  addToLibrary,
  db,
  epKey,
  isCaughtUp,
  isEpisodic,
  markUpTo,
  mergeMeta,
  refreshItemMetadata,
  removeFromLibrary,
  rewatchSingle,
  rewatchUpTo,
  setGameStatus,
  setMyPlaytime,
  setRangeWatched,
  setRating,
  setSeasonWatched,
  setSingleStatus,
  toggleArchived,
  toggleFavorite,
  toggleOwned,
  totalEpisodesOf,
  unitAired,
  unmarkUnit,
} from '../db'
import { useT } from '../i18n'
import { useOnline } from '../net'
import { useSettings } from '../settings'
import type {
  EpisodeInfo,

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

/** One checkable unit row (episode or chapter). */
function UnitRow({
  number,
  title,
  sub,
  runtime,
  row,
  onMark,
  onOpenDialog,
  locked,
}: {
  number: number
  title: string
  sub?: string | null
  runtime?: number | null
  row: WatchedEpisode | undefined
  onMark: () => void
  onOpenDialog: () => void
  /** unit not aired yet — a lock replaces the check */
  locked?: boolean
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
      {locked ? (
        <span
          aria-label="not aired yet"
          className="grid h-8 w-8 shrink-0 place-items-center rounded-full border border-line text-ink4"
        >
          <Lock size={14} />
        </span>
      ) : (
        <CheckButton
          size="sm"
          checked={watched}
          count={row?.count ?? 1}
          onClick={() => (watched ? onOpenDialog() : onMark())}
        />
      )}
    </div>
  )
}

/**
 * Season accordion for tv/anime with cascade + rewatch behavior.
 *
 * Unit rows are addressed by their season SLOT (1..episodeCount, the position
 * in the episode list) and never by the displayed episode number: TMDB numbers
 * long-running anime ABSOLUTELY inside seasons (Naruto Shippuden S18 shows eps
 * 144–151), while db keys, the widget and the TV Time import all speak slots.
 */
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
  // "all watched" compares against AIRED episodes once the list is loaded
  const airedCount = eps
    ? eps.filter((e) => unitAired(meta, season.number, e.episode, e.airDate)).length
    : season.episodeCount
  const allWatched = watchedInSeason >= airedCount && airedCount > 0

  const markAll = async () => {
    setBusy(true)
    try {
      const item = await ensure()
      if (!item) return
      const list = eps ?? (await getEpisodes(meta, season.number))
      if (eps === null) setEps(list)
      // never bulk-mark episodes that haven't aired yet
      const airedSlots = list
        .map((e, i) => ({ episode: i + 1, runtime: e.runtime, out: unitAired(meta, season.number, e.episode, e.airDate) }))
        .filter((s) => s.out)
      await setSeasonWatched(item, season.number, airedSlots, !allWatched)
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
            eps.map((ep, i) => {
              const slot = i + 1
              return (
                <UnitRow
                  key={ep.episode}
                  number={ep.episode}
                  title={ep.title || `${t('detail.episode')} ${ep.episode}`}
                  sub={ep.airDate}
                  runtime={ep.runtime}
                  locked={!unitAired(meta, season.number, ep.episode, ep.airDate)}
                  row={watchedMap.get(epKey(meta.id, season.number, slot))}
                  onMark={async () => {
                    const item = await ensure()
                    if (item) await markUpTo(item, season.number, slot, ep.runtime)
                  }}
                  onOpenDialog={() =>
                    onDialog({
                      season: season.number,
                      episode: slot,
                      count: watchedMap.get(epKey(meta.id, season.number, slot))?.count ?? 1,
                      label: ep.title || `${t('detail.episode')} ${ep.episode}`,
                    })
                  }
                />
              )
            })
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
  const online = useOnline()
  const { language, detailLayout } = useSettings()
  const [details, setDetails] = useState<MediaDetails | null>(null)
  const [error, setError] = useState<'keymissing' | 'error' | null>(null)
  const [unitDialog, setUnitDialog] = useState<UnitDialog>(null)
  const [singleDialog, setSingleDialog] = useState(false)
  const [gameDialog, setGameDialog] = useState(false)
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
    const applyFresh = (d: MediaDetails) => {
      if (!alive) return
      setDetails(d)
      // keep the library snapshot fresh (new episodes/chapters, dates, art)
      refreshItemMetadata(d).catch(() => {})
    }
    // SWR: cached data renders instantly; a background revalidation (>6h)
    // delivers fresh data through the same callback
    getDetails(provider, mediaType, id, applyFresh)
      .then(applyFresh)
      .catch((err) => {
        if (alive) setError(err instanceof ApiKeyMissingError ? 'keymissing' : 'error')
      })
    return () => {
      alive = false
    }
  }, [provider, mediaType, id, language])

  // ONE source of truth: fresh provider data layered over the stored snapshot,
  // so a provider that answers with holes can never blank what the DB knows
  const meta: MediaDetails | null = mergeMeta(details, libItem)

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
    // a title never opened before has nothing cached to fall back on: say
    // "no connection", not "something went wrong" — nothing went wrong
    if (!online) {
      return (
        <div className="flex h-[70vh] flex-col items-center justify-center gap-4">
          <OfflineNotice hint={t('offline.detail')} />
          <button onClick={() => nav(-1)} className="text-sm font-semibold text-accent">
            ← {t('common.close')}
          </button>
        </div>
      )
    }
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
  // Chapter rows must ALWAYS be usable: fall back to the highest chapter the
  // user already read, then to a provisional 100-chapter block when no source
  // knows the count (ongoing/hiatus works). `chapterTotal` above stays honest —
  // the header and the percentage only show a real, provider-confirmed total.
  const highestRead = isManga
    ? Math.max(0, ...[...watchedMap.values()].map((e) => e.episode))
    : 0
  const chapterSlots = isManga
    ? Math.max(chapterTotal ?? 0, highestRead, chapterTotal == null ? 100 : 0)
    : 0
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
  if (isManga && chapterSlots) {
    for (let s = 1; s <= chapterSlots; s += 100) {
      chapterBlocks.push([s, Math.min(s + 99, chapterSlots)])
    }
  }
  const firstUnread = chaptersDone + 1

  // singles/games not released yet can't be started — the button locks
  const unreleased =
    (single || isGame) && !!meta.releaseDate && Date.parse(meta.releaseDate) > Date.now()

  // ---- building blocks shared by the three detail layouts ----

  const backBtn = (
    <button
      onClick={() => nav(-1)}
      aria-label="back"
      className="absolute left-3 top-safe z-20 grid h-10 w-10 place-items-center rounded-full bg-black/50 text-white backdrop-blur transition-colors hover:bg-black/70"
    >
      <ArrowLeft size={20} />
    </button>
  )

  const posterImg = (cls: string) => (
    <div className={cn('shrink-0 overflow-hidden bg-card2', cls)}>
      {meta.poster ? (
        <Cover
          src={meta.poster}
          alt={meta.title}
          persist={inLibrary}
          loading="eager"
          fetchPriority="high"
          decoding="async"
          className="h-full w-full object-cover"
        />
      ) : (
        <div className="grid h-full w-full place-items-center text-ink4">
          <ImageOff size={24} />
        </div>
      )}
    </div>
  )

  const genreChips = (centered = false) =>
    meta.genres &&
    meta.genres.length > 0 && (
      <div className={cn('mt-2 flex flex-wrap gap-1.5', centered && 'justify-center')}>
        {meta.genres.slice(0, 3).map((g) => (
          <span
            key={g}
            className="rounded-full border border-line bg-card px-2.5 py-0.5 text-[11px] font-medium text-ink2"
          >
            {g}
          </span>
        ))}
      </div>
    )

  const lockedBtn = (
    <div className="flex flex-1 flex-col items-center justify-center rounded-full border border-line bg-card py-2 text-ink3">
      <span className="inline-flex items-center gap-1.5 text-sm font-bold">
        {t('detail.locked')}
        <Lock size={14} />
      </span>
      {meta.releaseDate && (
        <span className="text-xs text-ink4">{formatDate(meta.releaseDate, language)}</span>
      )}
    </div>
  )

  const mainAction = !inLibrary ? (
    <button
      onClick={() => ensure()}
      disabled={!details}
      className="flex flex-1 items-center justify-center gap-2 rounded-full bg-brand py-3 text-sm font-bold text-black transition-transform active:scale-95 disabled:opacity-50"
    >
      <Plus size={18} strokeWidth={3} /> {t('detail.addToList')}
    </button>
  ) : (
    <>
      {single &&
        (unreleased ? (
          lockedBtn
        ) : (
          <button
            onClick={() => {
              if (completed) setSingleDialog(true)
              // planned → start (moves to Continue) · watching → complete
              else setSingleStatus(canonicalId, libItem?.status === 'watching' ? 'completed' : 'watching')
            }}
            className={cn(
              'flex flex-1 items-center justify-center gap-2 rounded-full py-3 text-sm font-bold transition-transform active:scale-95',
              completed
                ? 'border border-accent bg-brand/10 text-accent'
                : 'bg-brand text-black',
            )}
          >
            <Check size={18} strokeWidth={3} />
            {libItem?.status === 'planned' && t('detail.start')}
            {libItem?.status === 'watching' &&
              t(singleLabels[meta.mediaType]?.[0] ?? 'detail.markWatched')}
            {completed && t(singleLabels[meta.mediaType]?.[1] ?? 'detail.watched')}
            {completed && (libItem?.watchCount ?? 1) >= 2 && ` x${libItem?.watchCount}`}
          </button>
        ))}
      {isGame &&
        (unreleased ? (
          lockedBtn
        ) : (
          <button
            onClick={() => setGameDialog(true)}
            className={cn(
              'flex flex-1 items-center justify-center gap-2 rounded-full py-3 text-sm font-bold transition-transform active:scale-95',
              libItem?.status === 'completed'
                ? 'border border-accent bg-brand/10 text-accent'
                : 'bg-brand text-black',
            )}
          >
            {libItem?.status === 'planned' && t('games.toPlay')}
            {libItem?.status === 'watching' && t('games.playing')}
            {libItem?.status === 'completed' &&
              ((libItem?.watchCount ?? 1) >= 2
                ? `${t('games.replayed')} x${libItem?.watchCount}`
                : t('games.completed'))}
          </button>
        ))}
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
    </>
  )

  const trashBtn = inLibrary ? (
    <button
      onClick={() => removeFromLibrary(canonicalId)}
      aria-label={t('detail.removeFromList')}
      className="grid h-11 w-11 shrink-0 place-items-center rounded-full border border-line text-ink3 transition-colors hover:border-red-500 hover:text-red-500"
    >
      <Trash2 size={18} />
    </button>
  ) : null

  const archiveBtn = inLibrary ? (
    <button
      onClick={() => toggleArchived(canonicalId)}
      aria-label={t('detail.archive')}
      className={cn(
        'grid h-11 w-11 shrink-0 place-items-center rounded-full border transition-colors',
        libItem?.archived
          ? 'border-accent bg-brand text-black'
          : 'border-line text-ink3 hover:border-accent hover:text-accent',
      )}
    >
      <Archive size={18} />
    </button>
  ) : null

  const heartBtn = (
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
  )

  // "owned" (key) — marking it adds the item to the library if needed, like the
  // heart; it's an orthogonal flag with its own catalog box, no cover badge
  const ownedBtn = (
    <button
      onClick={async () => {
        const item = await ensure()
        if (item) toggleOwned(item.id)
      }}
      aria-label={t('detail.owned')}
      className={cn(
        'grid h-11 w-11 shrink-0 place-items-center rounded-full border transition-colors',
        libItem?.owned
          ? 'border-accent bg-brand text-black'
          : 'border-line text-ink3 hover:border-accent hover:text-accent',
      )}
    >
      <Key size={18} />
    </button>
  )

  const starBtn = (
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
        <RatingBadge value={libItem.rating} size="lg" />
      ) : (
        <Star size={18} />
      )}
    </button>
  )

  // vertical rail used by the poster layout — order: rating, favorite, archive, trash
  const railBase =
    'grid h-11 w-11 place-items-center rounded-full shadow-lg backdrop-blur transition-transform active:scale-90'
  const railButtons = (
    <>
      <button
        onClick={async () => {
          const item = await ensure()
          if (item) toggleOwned(item.id)
        }}
        aria-label={t('detail.owned')}
        className={cn(railBase, libItem?.owned ? 'bg-brand text-black' : 'bg-black/50 text-white')}
      >
        <Key size={18} />
      </button>
      <button
        onClick={() => setRatingOpen(true)}
        aria-label={t('rating.add')}
        className={cn(railBase, 'bg-black/50 text-white')}
      >
        {libItem?.rating != null ? <RatingBadge value={libItem.rating} size="lg" /> : <Star size={18} />}
      </button>
      <button
        onClick={async () => {
          const item = await ensure()
          if (item) toggleFavorite(item.id)
        }}
        aria-label="favorite"
        className={cn(railBase, libItem?.favorite ? 'bg-brand text-black' : 'bg-black/50 text-white')}
      >
        <Heart size={18} fill={libItem?.favorite ? 'currentColor' : 'none'} />
      </button>
      {inLibrary && (
        <button
          onClick={() => toggleArchived(canonicalId)}
          aria-label={t('detail.archive')}
          className={cn(railBase, libItem?.archived ? 'bg-brand text-black' : 'bg-black/50 text-white')}
        >
          <Archive size={18} />
        </button>
      )}
      {inLibrary && (
        <button
          onClick={() => removeFromLibrary(canonicalId)}
          aria-label={t('detail.removeFromList')}
          className={cn(railBase, 'bg-black/50 text-white hover:text-red-400')}
        >
          <Trash2 size={18} />
        </button>
      )}
    </>
  )

  return (
    <div className="pb-8">
      {detailLayout === 'classic' && (
        <>
          {/* hero */}
          <div className="relative h-52 w-full overflow-hidden md:h-72 md:rounded-b-3xl">
            {meta.backdrop ? (
              <Cover
                src={meta.backdrop}
                persist={inLibrary}
                loading="eager"
                fetchPriority="high"
                decoding="async"
                className="h-full w-full object-cover"
              />
            ) : (
              <div className="h-full w-full bg-gradient-to-br from-card2 to-surface" />
            )}
            <div className="absolute inset-0 bg-gradient-to-t from-surface via-surface/30 to-black/30" />
            {backBtn}
          </div>

          {/* poster + title */}
          <div className="relative -mt-20 flex items-end gap-4 px-4">
            {posterImg('h-36 w-24 rounded-xl border border-line shadow-2xl')}
            <div className="min-w-0 flex-1 pb-1">
              <h1 className="text-xl font-extrabold leading-tight">{meta.title}</h1>
              {metaLine && <p className="mt-1 text-sm text-ink2">{metaLine}</p>}
              {genreChips()}
            </div>
          </div>
        </>
      )}

      {detailLayout === 'poster' && (
        /* poster wall: the cover repeats as a softly blurred wallpaper behind
           a big floating poster — low blur + high opacity keep the two reading
           as one continuous artwork melting into the page */
        <div className="relative h-[68vh] min-h-[500px] w-full overflow-hidden">
          {meta.poster || meta.backdrop ? (
            <Cover
              src={(meta.poster ?? meta.backdrop)!}
              persist={inLibrary}
              loading="eager"
              fetchPriority="high"
              decoding="async"
              className="absolute inset-0 h-full w-full scale-110 object-cover opacity-60 blur-md"
            />
          ) : (
            <div className="absolute inset-0 bg-gradient-to-br from-card2 to-surface" />
          )}
          <div className="absolute inset-0 bg-gradient-to-t from-surface via-surface/35 to-surface/5" />
          {backBtn}
          <div className="relative z-10 flex h-full flex-col items-center justify-end px-6 pb-5">
            <div className="relative flex w-full justify-center">
              {posterImg('aspect-[2/3] w-56 rounded-2xl border border-line shadow-2xl')}
              {/* rail hugs the screen edge, vertically centered ON THE COVER */}
              <div className="absolute -right-3 top-1/2 z-20 flex -translate-y-1/2 flex-col items-center gap-2.5">
                {railButtons}
              </div>
            </div>
            <h1 className="mt-4 text-center text-2xl font-extrabold leading-tight">{meta.title}</h1>
            {metaLine && <p className="mt-1 text-center text-sm text-ink2">{metaLine}</p>}
            {genreChips(true)}
          </div>
        </div>
      )}

      {detailLayout === 'immersive' && (
        <>
          {/* immersive: the (originally horizontal) art fills a tall-but-not-
             towering frame — less vertical crop — and fades into the content
             without a hard cut */}
          <div className="relative h-[48vh] min-h-[340px] w-full overflow-hidden">
            {meta.backdrop || meta.poster ? (
              <Cover
                src={(meta.backdrop ?? meta.poster)!}
                persist={inLibrary}
                loading="eager"
                fetchPriority="high"
                decoding="async"
                className="h-full w-full object-cover"
              />
            ) : (
              <div className="h-full w-full bg-gradient-to-br from-card2 to-surface" />
            )}
            <div className="absolute inset-0 bg-gradient-to-t from-surface via-surface/25 to-black/30" />
            {backBtn}
          </div>
          <div className="relative z-10 -mt-24 flex items-end gap-4 px-4">
            {posterImg('h-48 w-32 rounded-2xl border border-line shadow-2xl')}
            <div className="min-w-0 flex-1 pb-1">
              <h1 className="text-2xl font-extrabold leading-tight">{meta.title}</h1>
              {metaLine && <p className="mt-1 text-sm text-ink2">{metaLine}</p>}
              {genreChips()}
            </div>
          </div>
        </>
      )}

      {/* actions */}
      <div className="mt-5 flex items-center gap-2.5 px-4">{mainAction}</div>
      {/* icon actions: one centered row between the progress bar and the
          ratings (the poster layout keeps its vertical rail on the art) */}
      {detailLayout !== 'poster' && (
        <div className="mt-3.5 flex items-center justify-center gap-6 px-4">
          {ownedBtn}
          {starBtn}
          {heartBtn}
          {archiveBtn}
          {trashBtn}
        </div>
      )}

      {/* game platforms */}
      {isGame && <PlatformChips slugs={meta.platforms} className="mt-4 px-4" />}

      {/* critic ratings — the scenic layouts center them like everything else */}
      {details?.externalRatings && (
        <RatingsBanners list={details.externalRatings} centered={detailLayout !== 'classic'} />
      )}

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
              // no chapter count yet (every count source unreachable) — say
              // so honestly instead of a scary generic error
              <p className="text-sm text-ink3">{t('detail.noChapters')}</p>
            )}
          </div>
        </section>
      )}

      {/* order: tags → images → overview (skim the shape of the work first,
          then look at it, then read about it) */}
      {meta.tags && meta.tags.length > 0 && (
        <section className="mt-6 px-4">
          <h2 className="mb-2 text-lg font-bold">{t('detail.tags')}</h2>
          <div className="flex flex-wrap gap-2">
            {meta.tags.map((tag) => (
              <span
                key={tag}
                className="rounded-full border border-line bg-card px-3 py-1 text-xs font-medium text-ink2"
              >
                {tag}
              </span>
            ))}
          </div>
        </section>
      )}

      {/* stills / screenshots / volume covers */}
      <Gallery urls={meta.screenshots ?? []} title={t('detail.gallery')} />

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
          onUnmark={() => setSingleStatus(canonicalId, 'watching')}
          onRewatch={() => rewatchSingle(canonicalId)}
          onClose={() => setSingleDialog(false)}
        />
      )}
      {gameDialog && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 sm:items-center"
          onClick={() => setGameDialog(false)}
        >
          <div
            className="fade-up pb-safe-sheet w-full max-w-sm rounded-t-3xl border border-line bg-card p-5 sm:rounded-3xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-3 truncate text-center text-base font-bold">{meta.title}</div>
            <div className="flex flex-col gap-2.5">
              {(
                [
                  ['planned', t('games.toPlay')],
                  ['watching', t('games.playing')],
                ] as Array<['planned' | 'watching', string]>
              ).map(([s, label]) => (
                <button
                  key={s}
                  onClick={() => {
                    setGameStatus(canonicalId, s)
                    setGameDialog(false)
                  }}
                  className={cn(
                    'rounded-full border py-3 text-sm font-bold transition-colors',
                    libItem?.status === s
                      ? 'border-accent bg-brand text-black'
                      : 'border-line text-ink2 hover:border-accent hover:text-accent',
                  )}
                >
                  {label}
                </button>
              ))}
              <button
                onClick={() => {
                  if (libItem?.status === 'completed') rewatchSingle(canonicalId)
                  else setGameStatus(canonicalId, 'completed')
                  setGameDialog(false)
                }}
                className={cn(
                  'rounded-full py-3 text-sm font-bold transition-transform active:scale-95',
                  libItem?.status === 'completed'
                    ? 'bg-brand text-black'
                    : 'border border-line text-ink2 hover:border-accent hover:text-accent',
                )}
              >
                {libItem?.status === 'completed'
                  ? `${t('games.replayed')} x${(libItem?.watchCount ?? 1) + 1}`
                  : t('games.completed')}
              </button>
              <button
                onClick={() => setGameDialog(false)}
                className="py-1 text-sm font-semibold text-ink3"
              >
                {t('common.cancel')}
              </button>
            </div>
          </div>
        </div>
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
