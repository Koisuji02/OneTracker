/**
 * Personal-rating badge — a rounded square, tiered by value:
 * - 0–7.9   → white tile, black centered number
 * - 8–8.4   → metallic bronze tile, plain white number (no outline)
 * - 8.5–8.9 → metallic silver tile, white number
 * - 9–9.9   → metallic gold tile, white number
 * - 10      → reflective "diamond" tile with a rare shine sweep, white number
 */
import { metalBackground, type MetalName } from '../metals'
import { cn } from '../util'

type Tier = 'plain' | MetalName

function tierOf(value: number): Tier {
  if (value >= 10) return 'diamond'
  if (value >= 9) return 'gold'
  if (value >= 8.5) return 'silver'
  if (value >= 8) return 'bronze'
  return 'plain'
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
  const metal = tier === 'plain' ? null : tier

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
          background: metalBackground(metal),
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
