import { useLiveQuery } from 'dexie-react-hooks'
import { Clock, Tv } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { getEpisodes } from '../api'
import EmptyState from '../components/EmptyState'
import PageHeader from '../components/PageHeader'
import TrackCard from '../components/TrackCard'
import { computeNextEpisode, db, markUpTo, totalEpisodesOf } from '../db'
import { useT } from '../i18n'
import { useSettings } from '../settings'
import type { EpisodeInfo, LibraryItem } from '../types'
import { formatDate, seasonEpisodeLabel } from '../util'

function ShowCard({
  item,
  watchedKeys,
  watchedCount,
  showProgress,
}: {
  item: LibraryItem
  watchedKeys: Set<string>
  watchedCount: number
  showProgress: boolean
}) {
  const t = useT()
  const nav = useNavigate()
  const { language } = useSettings()
  const next = computeNextEpisode(item, watchedKeys)
  const [epInfo, setEpInfo] = useState<EpisodeInfo | null>(null)

  useEffect(() => {
    let alive = true
    setEpInfo(null)
    if (!next) return
    getEpisodes(item, next.season)
      .then((eps) => {
        if (alive) setEpInfo(eps.find((e) => e.episode === next.episode) ?? null)
      })
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [item.id, next?.season, next?.episode])

  if (!next) {
    // caught up with an ongoing show: keep it here, waiting for new episodes
    if (item.status !== 'watching') return null
    return (
      <TrackCard
        poster={item.poster}
        topLabel={item.title}
        title={t('series.waiting')}
        subtitle={
          <span className="inline-flex items-center gap-1.5">
            <Clock size={13} className="text-accent" />
            {item.nextReleaseDate
              ? `${t('series.nextOn')} ${formatDate(item.nextReleaseDate, language)}`
              : t('books.ongoing')}
          </span>
        }
        progress={showProgress ? 1 : null}
        onClick={() => nav(`/media/${item.provider}/${item.mediaType}/${item.providerId}`)}
      />
    )
  }
  const total = totalEpisodesOf(item)
  const remaining = total != null ? Math.max(0, total - watchedCount - 1) : 0

  return (
    <TrackCard
      poster={item.poster}
      topLabel={item.title}
      title={seasonEpisodeLabel(next.season, next.episode)}
      badge={remaining > 0 ? `+${remaining}` : null}
      subtitle={epInfo?.title ?? `${t('detail.episode')} ${next.episode}`}
      progress={showProgress && total ? watchedCount / total : null}
      onClick={() => nav(`/media/${item.provider}/${item.mediaType}/${item.providerId}`)}
      onCheck={() => markUpTo(item, next.season, next.episode, epInfo?.runtime)}
    />
  )
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
  const items = useLiveQuery(() => db.items.where('mediaType').anyOf('tv', 'anime').toArray(), [])
  const eps = useLiveQuery(() => db.episodes.toArray(), [])

  if (!items || !eps) return null

  const watchedKeys = new Set(eps.map((e) => e.id))
  const counts = new Map<string, number>()
  const lastWatched = new Map<string, number>()
  for (const e of eps) {
    counts.set(e.itemId, (counts.get(e.itemId) ?? 0) + 1)
    lastWatched.set(e.itemId, Math.max(lastWatched.get(e.itemId) ?? 0, e.watchedAt))
  }

  const watching = items
    .filter((i) => i.status === 'watching')
    .sort((a, b) => (lastWatched.get(b.id) ?? 0) - (lastWatched.get(a.id) ?? 0))
  const planned = items
    .filter((i) => i.status === 'planned')
    .sort((a, b) => b.addedAt - a.addedAt)

  return (
    <div>
      <PageHeader title={t('series.title')} />

      <section className="px-4">
        <SectionTitle text={t('series.continue')} />
        {watching.length === 0 ? (
          <EmptyState icon={<Tv size={32} />} text={t('series.emptyContinue')} />
        ) : (
          <div className="space-y-3">
            {watching.map((item) => (
              <ShowCard
                key={item.id}
                item={item}
                watchedKeys={watchedKeys}
                watchedCount={counts.get(item.id) ?? 0}
                showProgress
              />
            ))}
          </div>
        )}
      </section>

      <section className="mt-8 px-4">
        <SectionTitle text={t('series.toWatch')} />
        {planned.length === 0 ? (
          <EmptyState icon={<Tv size={32} />} text={t('series.emptyToWatch')} />
        ) : (
          <div className="space-y-3">
            {planned.map((item) => (
              <ShowCard
                key={item.id}
                item={item}
                watchedKeys={watchedKeys}
                watchedCount={counts.get(item.id) ?? 0}
                showProgress={false}
              />
            ))}
          </div>
        )}
      </section>
    </div>
  )
}
