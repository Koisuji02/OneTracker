import { useLiveQuery } from 'dexie-react-hooks'
import { Clock, Tv } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { getEpisodes } from '../api'
import EmptyState from '../components/EmptyState'
import GridCard from '../components/GridCard'
import PageHeader from '../components/PageHeader'
import PosterGrid from '../components/PosterGrid'
import TrackCard from '../components/TrackCard'
import ViewToggle from '../components/ViewToggle'
import {
  byActivity,
  computeNextEpisode,
  computeNextRewatch,
  db,
  isWaiting,
  lastActivity,
  markRewatchUnit,
  markUpTo,
  totalEpisodesOf,
  unitActivity,
  unitAired,
} from '../db'
import { useT } from '../i18n'
import { updateSettings, useSettings, type ViewMode } from '../settings'
import type { EpisodeInfo, LibraryItem, WatchedEpisode } from '../types'
import { formatDate, seasonEpisodeLabel } from '../util'

function ShowCard({
  item,
  watchedKeys,
  watchedCount,
  showProgress,
  view,
  waiting = false,
}: {
  item: LibraryItem
  watchedKeys: Set<string>
  watchedCount: number
  showProgress: boolean
  view: ViewMode
  /** in the "In attesa" section: always render the waiting-style card even
   *  when the next episode exists but is only announced (locked, not aired) */
  waiting?: boolean
}) {
  const t = useT()
  const nav = useNavigate()
  const { language } = useSettings()
  const next = computeNextEpisode(item, watchedKeys)
  const [epInfo, setEpInfo] = useState<EpisodeInfo | null>(null)

  // `item` and `next` are both rebuilt on every liveQuery emission, so the
  // effect keys off PRIMITIVES (and reads the item through a ref): depending on
  // the objects would refetch — and blank the line — whenever anything else in
  // the library moved, while `totalEpisodes` still catches a season list that
  // only grows with a later metadata refresh.
  const latestItem = useRef(item)
  latestItem.current = item
  const season = next?.season
  const slot = next?.episode

  useEffect(() => {
    let alive = true
    setEpInfo(null)
    if (season == null || slot == null) return
    getEpisodes(latestItem.current, season)
      .then((eps) => {
        // `slot` is a season SLOT (1..episodeCount), so index into the list
        // instead of matching numbers: TMDB numbers long anime ABSOLUTELY
        // inside a season (One Piece S21 starts at 892) and a number match
        // would find nothing — losing the air date this card depends on
        if (alive) setEpInfo(eps[slot - 1] ?? null)
      })
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [item.id, item.totalEpisodes, season, slot])

  const open = () => nav(`/media/${item.provider}/${item.mediaType}/${item.providerId}`)

  if (!next || waiting) {
    // caught up (or only unreleased episodes left): waiting for new episodes
    if (item.status !== 'watching' && item.status !== 'planned') return null
    const total = totalEpisodesOf(item)
    // the most specific date we know for what's coming: the next episode's own
    // air date, else the show-level next/first release date
    const nextDate = epInfo?.airDate ?? item.nextReleaseDate ?? item.releaseDate
    const when = nextDate
      ? `${t('series.nextOn')} ${formatDate(nextDate, language)}`
      : t('books.ongoing')
    const progress =
      showProgress && total ? Math.min(1, watchedCount / total) : showProgress ? 1 : null
    if (view === 'grid') {
      return (
        <GridCard
          poster={item.poster}
          title={item.title}
          caption={t('series.waiting')}
          subtitle={when}
          progress={progress}
          onClick={open}
        />
      )
    }
    return (
      <TrackCard
        poster={item.poster}
        topLabel={item.title}
        title={t('series.waiting')}
        subtitle={
          <span className="inline-flex items-center gap-1.5">
            <Clock size={13} className="text-accent" />
            {when}
          </span>
        }
        progress={progress}
        onClick={open}
      />
    )
  }
  const total = totalEpisodesOf(item)
  const remaining = total != null ? Math.max(0, total - watchedCount - 1) : 0
  // an episode that hasn't aired yet (or an unpremiered show) can't be marked
  const locked = !unitAired(item, next.season, next.episode, epInfo?.airDate)
  const shared = {
    poster: item.poster,
    badge: remaining > 0 ? `+${remaining}` : null,
    subtitle: epInfo?.title ?? `${t('detail.episode')} ${next.episode}`,
    progress: showProgress && total ? watchedCount / total : null,
    onClick: open,
    onCheck: () => markUpTo(item, next.season, next.episode, epInfo?.runtime),
    locked,
  }
  const label = seasonEpisodeLabel(next.season, next.episode)

  if (view === 'grid') {
    return <GridCard {...shared} title={item.title} caption={label} />
  }
  return <TrackCard {...shared} topLabel={item.title} title={label} />
}

/**
 * A completed series being rewatched stays in "Continue watching": the button
 * shows the rewatch grade (x2, x3…) instead of the check, and each tap marks
 * the next episode of the round at that grade.
 */
function RewatchCard({
  item,
  next,
  view,
}: {
  item: LibraryItem
  next: { season: number; episode: number; grade: number; done: number }
  view: ViewMode
}) {
  const t = useT()
  const nav = useNavigate()
  const [epInfo, setEpInfo] = useState<EpisodeInfo | null>(null)

  // same reasoning as the card above: primitives in the deps, item via a ref
  const latestItem = useRef(item)
  latestItem.current = item
  const { season, episode } = next

  useEffect(() => {
    let alive = true
    getEpisodes(latestItem.current, season)
      .then((eps) => {
        if (alive) setEpInfo(eps[episode - 1] ?? null)
      })
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [item.id, item.totalEpisodes, season, episode])

  const total = totalEpisodesOf(item)
  // how much of the ROUND is left after the unit being offered now. The badge
  // says the same thing here as on a first watch: the grade already rides on
  // the ✓, so repeating it next to the label was pure noise.
  const remaining = total != null ? Math.max(0, total - next.done - 1) : 0
  const shared = {
    poster: item.poster,
    badge: remaining > 0 ? `+${remaining}` : null,
    subtitle: epInfo?.title ?? `${t('detail.episode')} ${next.episode}`,
    progress: total ? next.done / total : null,
    onClick: () => nav(`/media/${item.provider}/${item.mediaType}/${item.providerId}`),
    onCheck: () => markRewatchUnit(item, next.season, next.episode, next.grade),
    checkContent: `x${next.grade}`,
  }
  const label = seasonEpisodeLabel(next.season, next.episode)

  if (view === 'grid') {
    return <GridCard {...shared} title={item.title} caption={label} />
  }
  return <TrackCard {...shared} topLabel={item.title} title={label} />
}

function SectionTitle({ text }: { text: string }) {
  return (
    <div className="mb-3 flex items-center gap-2">
      <span className="h-4 w-1 rounded-full bg-brand" />
      <h2 className="text-lg font-bold">{text}</h2>
    </div>
  )
}

export default function SeriesPage() {
  const t = useT()
  const { viewSeries } = useSettings()
  const items = useLiveQuery(() => db.items.where('mediaType').anyOf('tv', 'anime').toArray(), [])
  const eps = useLiveQuery(() => db.episodes.toArray(), [])

  const watchedKeys = new Set((eps ?? []).map((e) => e.id))
  const counts = new Map<string, number>()
  const epsByItem = new Map<string, WatchedEpisode[]>()
  for (const e of eps ?? []) {
    counts.set(e.itemId, (counts.get(e.itemId) ?? 0) + 1)
    const list = epsByItem.get(e.itemId)
    if (list) list.push(e)
    else epsByItem.set(e.itemId, [e])
  }
  const activity = unitActivity(eps ?? [])

  // archived items live only in the Archive page
  const active = (items ?? []).filter((i) => !i.archived)

  /**
   * Continue vs Waiting is decided on the NEXT UNIT'S OWN AIR DATE whenever the
   * app has it: the cached episode lists of everything in progress are loaded
   * here (only those — completed shows can't move) and indexed by season SLOT.
   *
   * The show-level `lastAired` boundary in the stored snapshot is the fallback,
   * and it LAGS — it's only as fresh as the last metadata refresh. That lag is
   * what used to keep a series parked in "In attesa" for the entire day one of
   * its episodes came out. The unit's own date settles it in both directions:
   * out today → back to Continue, still only announced → back to Waiting.
   */
  const inPlay = active.filter((i) => i.status === 'watching' || i.status === 'planned')
  const inPlayIds = inPlay.map((i) => i.id)
  const seasonLists = useLiveQuery(
    () => db.episodeCache.where('itemId').anyOf(inPlayIds).toArray(),
    [inPlayIds.join('|')],
  )
  // `${itemId}:${season}:${slot}` → that unit's air date
  const airDates = new Map<string, string | null>()
  for (const entry of seasonLists ?? []) {
    entry.episodes.forEach((e, i) => {
      airDates.set(`${entry.itemId}:${entry.season}:${i + 1}`, e.airDate ?? null)
    })
  }
  const parkedNow = (i: LibraryItem) =>
    isWaiting(i, watchedKeys, (season, slot) => airDates.get(`${i.id}:${season}:${slot}`))

  if (!items || !eps) return null

  const byRecent = byActivity(activity)
  // caught-up ongoing shows (no new episode out yet) move to their own
  // "Waiting" section so Continue stays actionable
  const watching = active.filter((i) => i.status === 'watching' && !parkedNow(i))
  // waiting also hosts planned series that haven't premiered yet
  const waiting = inPlay.filter(parkedNow).sort(byRecent)
  // completed series with an unfinished rewatch round stay in "Continue"
  const rewatching = active
    .filter((i) => i.status === 'completed')
    .map((item) => ({ item, next: computeNextRewatch(item, epsByItem.get(item.id) ?? []) }))
    .filter(
      (x): x is { item: LibraryItem; next: NonNullable<ReturnType<typeof computeNextRewatch>> } =>
        x.next != null,
    )
  /**
   * ONE Continue list, ordered by last activity. Rewatch rounds are not a
   * second-class section pinned under the first-watch shows: marking a rewatch
   * episode stamps the item like any other mark, so the show you just touched
   * comes first — the same order the home-screen widget shows.
   */
  const continuing: Array<
    | { kind: 'watch'; item: LibraryItem }
    | { kind: 'rewatch'; item: LibraryItem; next: NonNullable<ReturnType<typeof computeNextRewatch>> }
  > = [
    ...watching.map((item) => ({ kind: 'watch' as const, item })),
    ...rewatching.map(({ item, next }) => ({ kind: 'rewatch' as const, item, next })),
  ].sort((a, b) => lastActivity(b.item, activity) - lastActivity(a.item, activity))
  const planned = active
    .filter((i) => i.status === 'planned' && !parkedNow(i))
    .sort((a, b) => b.addedAt - a.addedAt)

  // one wrapper for both layouts: the cards decide how they look, the section
  // only decides whether they stack as rows or tile as a grid
  const lay = (children: ReactNode) =>
    viewSeries === 'grid' ? (
      <PosterGrid>{children}</PosterGrid>
    ) : (
      <div className="space-y-3">{children}</div>
    )

  return (
    <div>
      <PageHeader
        title={t('series.title')}
        action={
          <ViewToggle
            value={viewSeries}
            onChange={(viewSeries) => updateSettings({ viewSeries })}
          />
        }
      />

      <section className="px-4">
        <SectionTitle text={t('series.continue')} />
        {continuing.length === 0 ? (
          <EmptyState icon={<Tv size={32} />} text={t('series.emptyContinue')} />
        ) : (
          lay(
            continuing.map((entry) =>
              entry.kind === 'rewatch' ? (
                <RewatchCard
                  key={`rw-${entry.item.id}`}
                  item={entry.item}
                  next={entry.next}
                  view={viewSeries}
                />
              ) : (
                <ShowCard
                  key={entry.item.id}
                  item={entry.item}
                  watchedKeys={watchedKeys}
                  watchedCount={counts.get(entry.item.id) ?? 0}
                  showProgress
                  view={viewSeries}
                />
              ),
            ),
          )
        )}
      </section>

      <section className="mt-8 px-4">
        <SectionTitle text={t('series.toWatch')} />
        {planned.length === 0 ? (
          <EmptyState icon={<Tv size={32} />} text={t('series.emptyToWatch')} />
        ) : (
          lay(
            planned.map((item) => (
              <ShowCard
                key={item.id}
                item={item}
                watchedKeys={watchedKeys}
                watchedCount={counts.get(item.id) ?? 0}
                showProgress={false}
                view={viewSeries}
              />
            )),
          )
        )}
      </section>

      {waiting.length > 0 && (
        <section className="mt-8 px-4">
          <SectionTitle text={t('common.waiting')} />
          {lay(
            waiting.map((item) => (
              <ShowCard
                key={item.id}
                item={item}
                watchedKeys={watchedKeys}
                watchedCount={counts.get(item.id) ?? 0}
                showProgress
                waiting
                view={viewSeries}
              />
            )),
          )}
        </section>
      )}
    </div>
  )
}
