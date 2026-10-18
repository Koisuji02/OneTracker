import { useLiveQuery } from 'dexie-react-hooks'
import { Clock, Gamepad2 } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import EmptyState from '../components/EmptyState'
import GameTimeDialog from '../components/GameTimeDialog'
import GridCard from '../components/GridCard'
import PageHeader from '../components/PageHeader'
import PosterGrid from '../components/PosterGrid'
import TrackCard from '../components/TrackCard'
import ViewToggle from '../components/ViewToggle'
import { platformLabel } from '../components/PlatformChips'
import {
  db,
  gameBaseHours,
  gamePlaythroughs,
  isWaiting,
  lastActivity,
  logGamePlaythrough,
  setGameStatus,
} from '../db'
import { useT } from '../i18n'
import { updateSettings, useSettings, type ViewMode } from '../settings'
import type { LibraryItem } from '../types'
import { formatDate } from '../util'

/** games have no episodes: isWaiting only reads their release date. */
const NO_KEYS = new Set<string>()

/** stage = 'planned' (Start → play) · 'watching' (Playing → complete) · 'waiting' (unreleased). */
function GameCard({
  item,
  stage,
  view,
  onComplete,
}: {
  item: LibraryItem
  stage: 'planned' | 'watching' | 'waiting'
  view: ViewMode
  /** ✓ on a game in progress: the page asks for the played hours first */
  onComplete: (item: LibraryItem) => void
}) {
  const t = useT()
  const nav = useNavigate()
  const { language } = useSettings()
  const playing = stage === 'watching'

  // how long the game takes (HowLongToBeat main story, see db.gameBaseHours)
  const base = gameBaseHours(item)

  // Same line whatever the stage: year, length, platforms. The hours already
  // banked by earlier runs used to replace the year on a replay, which made
  // the card jump to a different shape for no gain — the round is on the ✓.
  const parts: string[] = []
  if (item.year) parts.push(String(item.year))
  if (base) parts.push(`~${base} h`)
  if (item.platforms?.length) {
    parts.push(item.platforms.slice(0, 4).map(platformLabel).join('/'))
  }

  const when = item.releaseDate ? formatDate(item.releaseDate, language) : t('common.waiting')
  // replay in progress: "Rigiocato (x2)" sends the game back to Continue and
  // the round's grade rides on the card until the ✓ closes it
  const round = playing && (item.watchCount ?? 1) >= 2 ? `x${item.watchCount}` : null
  const subtitle =
    stage === 'waiting' ? (
      <span className="inline-flex items-center gap-1.5 text-accent">
        <Clock size={13} />
        {when}
      </span>
    ) : (
      parts.join(' | ')
    )
  // no progress bar for games: hours are recorded when a run is CLOSED, so
  // there is nothing honest to measure a run in progress against
  const shared = {
    poster: item.poster,
    title: item.title,
    // a game has no unit to name on the cover: the round is on the ✓ only
    checkContent: round ?? undefined,
    onClick: () => nav(`/media/${item.provider}/${item.mediaType}/${item.providerId}`),
    onCheck:
      stage === 'waiting'
        ? undefined
        : () => (playing ? onComplete(item) : setGameStatus(item.id, 'watching')),
  }

  if (view === 'grid') {
    return (
      <GridCard
        {...shared}
        caption={stage === 'waiting' ? when : null}
        subtitle={stage === 'waiting' ? null : parts.join(' | ')}
      />
    )
  }
  return (
    <TrackCard
      {...shared}
      topLabel={item.genres?.slice(0, 2).join(' | ') || t('nav.games')}
      subtitle={subtitle}
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
  const { viewGames } = useSettings()
  /** game whose ✓ was tapped, waiting for its played hours */
  const [closing, setClosing] = useState<LibraryItem | null>(null)
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

  const active = items.filter((i) => !i.archived)
  // last touched first — starting a game OR opening a replay round stamps it,
  // so what you just marked sits on top (same order as the widget)
  const playing = active
    .filter((i) => i.status === 'watching')
    .sort((a, b) => lastActivity(b) - lastActivity(a))
  const waiting = active.filter((i) => isWaiting(i, NO_KEYS)).sort((a, b) => b.addedAt - a.addedAt)
  const backlog = active
    .filter((i) => i.status === 'planned' && !isWaiting(i, NO_KEYS))
    .sort((a, b) => b.addedAt - a.addedAt)

  const lay = (children: ReactNode) =>
    viewGames === 'grid' ? (
      <PosterGrid>{children}</PosterGrid>
    ) : (
      <div className="space-y-3">{children}</div>
    )

  return (
    <div>
      <PageHeader
        title={t('games.title')}
        action={
          <ViewToggle value={viewGames} onChange={(viewGames) => updateSettings({ viewGames })} />
        }
      />

      <section className="px-4">
        <SectionTitle text={t('games.playing')} />
        {playing.length === 0 ? (
          <EmptyState icon={<Gamepad2 size={32} />} text={t('games.emptyPlaying')} />
        ) : (
          lay(
            playing.map((item) => (
              <GameCard key={item.id} item={item} stage="watching" view={viewGames} onComplete={setClosing} />
            )),
          )
        )}
      </section>

      <section className="mt-8 px-4">
        <SectionTitle text={t('games.toPlay')} />
        {backlog.length === 0 ? (
          <EmptyState icon={<Gamepad2 size={32} />} text={t('games.empty')} />
        ) : (
          lay(
            backlog.map((item) => (
              <GameCard key={item.id} item={item} stage="planned" view={viewGames} onComplete={setClosing} />
            )),
          )
        )}
      </section>

      {waiting.length > 0 && (
        <section className="mt-8 px-4">
          <SectionTitle text={t('common.waiting')} />
          {lay(
            waiting.map((item) => (
              <GameCard key={item.id} item={item} stage="waiting" view={viewGames} onComplete={setClosing} />
            )),
          )}
        </section>
      )}

      {closing && (
        <GameTimeDialog
          // keyed so switching game re-seeds the wheels instead of keeping
          // the previous game's hours
          key={closing.id}
          title={closing.title}
          round={gamePlaythroughs(closing).length + 1}
          length={closing.timeToBeat ?? null}
          initial={
            [...gamePlaythroughs(closing)].reverse().find((r) => r.hours != null)?.hours ?? null
          }
          onConfirm={async (hours) => {
            const item = closing
            setClosing(null)
            await logGamePlaythrough(item.id, hours)
          }}
          onClose={() => setClosing(null)}
        />
      )}
    </div>
  )
}
