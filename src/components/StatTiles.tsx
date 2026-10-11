/**
 * A row of numbers with their names under them — the month's "12 episodes,
 * 2 films, 20 chapters", laid out as tiles instead of one long line.
 *
 * Three to a row, centred, so 4 or 5 tiles wrap into a tidy 3 + 1 / 3 + 2.
 * `card` sits on the app's surfaces (History, the recap's closing card);
 * `glass` on the recap's coloured slides.
 */
import type { ReactNode } from 'react'
import { cn } from '../util'

export interface StatTile {
  value: ReactNode
  label: string
}

export default function StatTiles({
  tiles,
  tone = 'card',
  className,
}: {
  tiles: StatTile[]
  tone?: 'card' | 'glass'
  className?: string
}) {
  if (tiles.length === 0) return null
  return (
    <div className={cn('flex w-full flex-wrap justify-center gap-2', className)}>
      {tiles.map((tile) => (
        <div
          key={tile.label}
          className={cn(
            'flex w-[calc((100%-1rem)/3)] shrink-0 flex-col items-center justify-center rounded-xl px-1.5 py-3 text-center',
            tone === 'glass' ? 'bg-white/12 backdrop-blur-sm' : 'border border-line bg-card2',
          )}
        >
          <span className="text-2xl font-black leading-none tabular-nums">{tile.value}</span>
          <span
            className={cn(
              'mt-1.5 text-[10px] font-bold uppercase leading-tight tracking-wider',
              tone === 'glass' ? 'opacity-75' : 'text-ink3',
            )}
          >
            {tile.label}
          </span>
        </div>
      ))}
    </div>
  )
}
