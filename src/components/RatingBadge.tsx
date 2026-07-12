/**
 * Personal-rating badge.
 * - 0–8.4  → white circle, black centered number
 * - 8.5+   → the badge IS a trophy shape (metallic bronze / silver / gold,
 *            "diamond" at 10) with the number inside the cup. No animations.
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
  diamond: ['#dffbff', '#5eb6e8', '#b9e8f5'],
}

function Trophy({ value, tier, size }: { value: string; tier: Exclude<Tier, 'plain'>; size: number }) {
  const [light, dark, mid] = METALS[tier]
  const gid = `trophy-${tier}`
  return (
    <svg
      width={size}
      height={size * 1.05}
      viewBox="0 0 40 42"
      className="drop-shadow-[0_1px_2px_rgba(0,0,0,0.5)]"
    >
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor={light} />
          <stop offset="55%" stopColor={dark} />
          <stop offset="100%" stopColor={mid} />
        </linearGradient>
      </defs>
      {/* handles */}
      <path
        d="M8 7 H2.5 V12 A9.5 9.5 0 0 0 11 21 M32 7 H37.5 V12 A9.5 9.5 0 0 1 29 21"
        fill="none"
        stroke={`url(#${gid})`}
        strokeWidth="3"
        strokeLinecap="round"
      />
      {/* cup */}
      <path d="M8 4 H32 V15 A12 12 0 0 1 8 15 Z" fill={`url(#${gid})`} />
      {/* stem + base */}
      <path d="M17.5 26 H22.5 V31 H17.5 Z" fill={`url(#${gid})`} />
      <rect x="11" y="31" width="18" height="5" rx="1.5" fill={`url(#${gid})`} />
      {/* number inside the cup — sized so it renders as large as the
          plain-circle number even though the trophy shape is bigger */}
      <text
        x="20"
        y="14"
        textAnchor="middle"
        dominantBaseline="middle"
        fontSize={value.length > 2 ? 12 : 13.5}
        fontWeight="900"
        fill="#ffffff"
        stroke="rgba(0,0,0,0.45)"
        strokeWidth="0.7"
        paintOrder="stroke"
        style={{ fontVariantNumeric: 'tabular-nums' }}
      >
        {value}
      </text>
    </svg>
  )
}

export default function RatingBadge({
  value,
  size = 'sm',
}: {
  value: number
  size?: 'sm' | 'md'
}) {
  const tier = tierOf(value)
  const label = Number.isInteger(value) ? String(value) : value.toFixed(1)

  if (tier === 'plain') {
    return (
      <span
        className={cn(
          'grid shrink-0 place-items-center rounded-full bg-white font-black leading-none text-black shadow-lg',
          size === 'sm' ? 'h-7 w-7 text-[11px]' : 'h-9 w-9 text-sm',
        )}
        style={{ fontVariantNumeric: 'tabular-nums' }}
      >
        {label}
      </span>
    )
  }

  // the trophy silhouette is larger than the circle so the number inside
  // stays as readable as the plain badge's
  return <Trophy value={label} tier={tier} size={size === 'sm' ? 36 : 46} />
}
