/**
 * Personal-rating badge — a rounded square, tiered by value:
 * - 0–8.4   → white tile, black centered number
 * - 8.5–8.9 → metallic bronze tile, plain white number (no outline)
 * - 9–9.4   → metallic silver tile, white number
 * - 9.5–9.9 → metallic gold tile, white number
 * - 10      → reflective "diamond" tile with a rare shine sweep, white number
 */
import { cn } from '../util'

type Tier = 'plain' | 'bronze' | 'silver' | 'gold' | 'diamond'

function tierOf(value: number): Tier {
  if (value >= 10) return 'diamond'
  if (value >= 9.5) return 'gold'
  if (value >= 9) return 'silver'
  if (value >= 8.5) return 'bronze'
  return 'plain'
}

/** [light, dark, mid] stops of the metallic gradient. */
const METALS: Record<Exclude<Tier, 'plain'>, [string, string, string]> = {
  bronze: ['#f0b27d', '#8a4f1d', '#c47f3e'],
  silver: ['#f2f2f7', '#7c7c88', '#c9c9d2'],
  gold: ['#ffe98a', '#a97b06', '#f2c94c'],
  diamond: ['#e8fcff', '#4aa8dd', '#b9e8f5'],
}

const SIZES = {
  sm: 'h-7 w-7 text-[11px]',
  md: 'h-9 w-9 text-sm',
  // matches the h-11 detail-page action buttons (star/heart/archive/trash)
  lg: 'h-11 w-11 text-[17px]',
}

export default function RatingBadge({
  value,
  size = 'sm',
}: {
  value: number
  size?: 'sm' | 'md' | 'lg'
}) {
  const tier = tierOf(value)
  const label = Number.isInteger(value) ? String(value) : value.toFixed(1)
  const metal = tier === 'plain' ? null : METALS[tier]

  return (
    <span
      className={cn(
        'relative grid shrink-0 place-items-center overflow-hidden rounded-xl font-black leading-none shadow-lg',
        SIZES[size],
        metal ? 'text-white' : 'bg-white text-black',
      )}
      style={{
        fontVariantNumeric: 'tabular-nums',
        ...(metal && {
          // glint top-left, darker under the number so plain white stays readable
          background: `linear-gradient(145deg, ${metal[0]} 0%, ${metal[2]} 30%, ${metal[1]} 62%, ${metal[2]} 100%)`,
          boxShadow:
            'inset 0 1px 2px rgba(255,255,255,0.55), inset 0 -2px 3px rgba(0,0,0,0.35), 0 2px 6px rgba(0,0,0,0.4)',
        }),
      }}
    >
      {label}
      {tier === 'diamond' && <span aria-hidden className="badge-shine pointer-events-none" />}
    </span>
  )
}
