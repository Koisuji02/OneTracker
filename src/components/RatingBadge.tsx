import { Trophy } from 'lucide-react'
import { cn } from '../util'

/**
 * Personal-rating badge with tiers:
 *   0–8.4 white circle · 8.5–8.9 bronze trophy · 9–9.4 silver ·
 *   9.5–9.9 gold · 10 pulsing "diamond".
 */
export default function RatingBadge({
  value,
  size = 'sm',
}: {
  value: number
  size?: 'sm' | 'md'
}) {
  const tier =
    value >= 10
      ? 'diamond'
      : value >= 9.5
        ? 'gold'
        : value >= 9
          ? 'silver'
          : value >= 8.5
            ? 'bronze'
            : 'plain'

  const tierBg: Record<string, string> = {
    plain: '#ffffff',
    bronze: 'linear-gradient(135deg, #e2a15e 0%, #a05f24 55%, #c98545 100%)',
    silver: 'linear-gradient(135deg, #e6e6ec 0%, #86868f 55%, #bcbcc6 100%)',
    gold: 'linear-gradient(135deg, #ffe27a 0%, #c9930a 55%, #f5c518 100%)',
    diamond: 'linear-gradient(135deg, #b9f2ff 0%, #7cc0ff 35%, #e8d5ff 65%, #6ee7f0 100%)',
  }

  const label = Number.isInteger(value) ? String(value) : value.toFixed(1)

  return (
    <span
      className={cn(
        'inline-flex items-center justify-center gap-0.5 rounded-full font-black shadow-lg',
        size === 'sm' ? 'h-6 min-w-6 px-1 text-[10px]' : 'h-8 min-w-8 px-1.5 text-xs',
        tier === 'plain' ? 'text-black' : 'text-white drop-shadow-[0_1px_1px_rgba(0,0,0,0.6)]',
        tier === 'diamond' && 'animate-pulse',
      )}
      style={{ background: tierBg[tier] }}
    >
      {tier !== 'plain' && <Trophy size={size === 'sm' ? 9 : 11} strokeWidth={3} />}
      {label}
    </span>
  )
}
