import { useLiveQuery } from 'dexie-react-hooks'
import { Gamepad2 } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import EmptyState from '../components/EmptyState'
import PageHeader from '../components/PageHeader'
import TrackCard from '../components/TrackCard'
import { db, setGameStatus } from '../db'
import { useT } from '../i18n'
import type { LibraryItem } from '../types'

function GameCard({ item, playing }: { item: LibraryItem; playing: boolean }) {
  const t = useT()
  const nav = useNavigate()

  const parts: string[] = []
  if (playing) {
    if (item.myPlaytime != null) parts.push(`${item.myPlaytime} ${t('games.hoursPlayed')}`)
    if (item.playtime) parts.push(`~${item.playtime} h`)
  } else {
    if (item.year) parts.push(String(item.year))
    if (item.playtime) parts.push(`~${item.playtime} h`)
  }

  const progress =
    playing && item.myPlaytime != null && item.playtime
      ? Math.min(1, item.myPlaytime / item.playtime)
      : null

  return (
    <TrackCard
      poster={item.poster}
      topLabel={item.genres?.slice(0, 2).join(' • ') || t('nav.games')}
      title={item.title}
      subtitle={parts.join(' • ')}
      progress={progress}
      onClick={() => nav(`/media/${item.provider}/${item.mediaType}/${item.providerId}`)}
      onCheck={() => setGameStatus(item.id, playing ? 'completed' : 'watching')}
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

export default function GamesPage() {
  const t = useT()
  const items = useLiveQuery(
    () =>
      db.items
        .where('mediaType')
        .equals('game')
        .and((i) => i.status !== 'completed')
        .toArray(),
    [],
  )

  if (!items) return null

  const playing = items
    .filter((i) => i.status === 'watching')
    .sort((a, b) => b.addedAt - a.addedAt)
  const backlog = items
    .filter((i) => i.status === 'planned')
    .sort((a, b) => b.addedAt - a.addedAt)

  return (
    <div>
      <PageHeader title={t('games.title')} />

      <section className="px-4">
        <SectionTitle text={t('games.playing')} />
        {playing.length === 0 ? (
          <EmptyState icon={<Gamepad2 size={32} />} text={t('games.emptyPlaying')} />
        ) : (
          <div className="space-y-3">
            {playing.map((item) => (
              <GameCard key={item.id} item={item} playing />
            ))}
          </div>
        )}
      </section>

      <section className="mt-8 px-4">
        <SectionTitle text={t('games.toPlay')} />
        {backlog.length === 0 ? (
          <EmptyState icon={<Gamepad2 size={32} />} text={t('games.empty')} />
        ) : (
          <div className="space-y-3">
            {backlog.map((item) => (
              <GameCard key={item.id} item={item} playing={false} />
            ))}
          </div>
        )}
      </section>
    </div>
  )
}
