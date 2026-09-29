/**
 * An achievement medal: a pleated metal rosette (the "coccarda") around an
 * enamel medallion that carries the category's icon, with two ribbon tails in
 * the media's colour. The metal IS the grade — bronze, silver, gold, diamond —
 * and it is the very same metal as the rating badge (src/metals.ts).
 *
 * A locked medal is its own silhouette: one flat dark shape with no icon, so
 * every medal is on the page from day one and you can see what's missing.
 *
 * The gradients are defined ONCE for the whole app by <MedalDefs/> (mounted in
 * App.tsx): the medagliere draws hundreds of medals, and each one carrying its
 * own <defs> would multiply the DOM for nothing.
 */
import type { LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import { METAL_STOPS, metalBackground, type MetalName } from '../metals'
import { cn } from '../util'

/**
 * A small squared metal tile — the rating badge's material, for chips and
 * counters that name a grade ("ORO") or stand in for one.
 */
export function MetalTile({
  metal,
  className,
  children,
}: {
  metal: MetalName
  className?: string
  children?: ReactNode
}) {
  return (
    <span
      className={cn('inline-grid shrink-0 place-items-center rounded-md text-white', className)}
      style={{
        background: metalBackground(metal),
        boxShadow: 'inset 0 1px 1px rgba(255,255,255,0.55), inset 0 -1px 2px rgba(0,0,0,0.35)',
        textShadow: '0 1px 1px rgba(0,0,0,0.45)',
      }}
    >
      {children}
    </span>
  )
}

const CX = 50
const CY = 50

/** The pleated ring and the shading of its folds, built once. */
function rosette(teeth = 20, outer = 46, valley = 39, crease = 32) {
  const pt = (r: number, a: number) =>
    `${(CX + r * Math.cos(a)).toFixed(2)} ${(CY + r * Math.sin(a)).toFixed(2)}`
  let ring = ''
  for (let j = 0; j < teeth * 2; j++) {
    const a = (j * Math.PI) / teeth - Math.PI / 2
    ring += `${j === 0 ? 'M' : 'L'}${pt(j % 2 === 0 ? outer : valley, a)}`
  }
  // the right half of every tooth, a shade darker: reads as folded ribbon
  let folds = ''
  for (let k = 0; k < teeth; k++) {
    const tip = (2 * k * Math.PI) / teeth - Math.PI / 2
    const side = tip + Math.PI / teeth
    folds += `M${pt(outer, tip)}L${pt(valley, side)}L${pt(crease, side)}L${pt(crease, tip)}Z`
  }
  return { ring: `${ring}Z`, folds }
}

const { ring: RING, folds: FOLDS } = rosette()
const TAIL_L = 'M36 74L51 79L41 126L33 117L24 124Z'
const TAIL_R = 'M64 74L49 79L59 126L67 117L76 124Z'

/** A four-point sparkle centred on (x, y). */
const sparkle = (x: number, y: number, s: number) => {
  const k = s * 0.28
  return `M${x} ${y - s}L${x + k} ${y - k}L${x + s} ${y}L${x + k} ${y + k}L${x} ${y + s}L${x - k} ${y + k}L${x - s} ${y}L${x - k} ${y - k}Z`
}
const SPARKLES = [sparkle(83, 16, 6.5), sparkle(15, 27, 4.5), sparkle(88, 62, 3.2)].join('')

const METAL_KEYS = Object.keys(METAL_STOPS) as MetalName[]

/** The shared gradients. Render once, anywhere in the document. */
export function MedalDefs() {
  return (
    <svg width="0" height="0" aria-hidden focusable="false" style={{ position: 'absolute' }}>
      <defs>
        {METAL_KEYS.flatMap((m) => {
          const [light, dark, mid] = METAL_STOPS[m]
          const stops = [
            <stop key="a" offset="0" stopColor={light} />,
            <stop key="b" offset="0.3" stopColor={mid} />,
            <stop key="c" offset="0.62" stopColor={dark} />,
            <stop key="d" offset="1" stopColor={mid} />,
          ]
          return [
            <linearGradient key={m} id={`medal-${m}`} x1="0" y1="0" x2="1" y2="1">
              {stops}
            </linearGradient>,
            // the rim runs the other way, so it reads as a separate bevel
            <linearGradient key={`${m}-r`} id={`medal-${m}-r`} x1="1" y1="1" x2="0" y2="0">
              {stops}
            </linearGradient>,
          ]
        })}
        <radialGradient id="medal-enamel" cx="0.36" cy="0.3" r="0.85">
          <stop offset="0" stopColor="#3b3b46" />
          <stop offset="0.55" stopColor="#1b1b22" />
          <stop offset="1" stopColor="#09090c" />
        </radialGradient>
      </defs>
    </svg>
  )
}

interface MedalProps {
  metal: MetalName
  icon: LucideIcon
  /** ribbon colour (any CSS colour, `var(--brand)` included) */
  ribbon: string
  /** not earned yet: draw the silhouette only */
  locked?: boolean
  /** width in px; the height follows (the tails hang below) */
  size?: number
  /** the diamond's reflective sweep — for the big views, not for grids */
  shine?: boolean
  className?: string
}

export default function Medal({
  metal,
  icon: Icon,
  ribbon,
  locked = false,
  size = 60,
  shine = false,
  className,
}: MedalProps) {
  const height = Math.round(size * 1.28)

  if (locked) {
    return (
      <svg
        viewBox="0 0 100 128"
        width={size}
        height={height}
        aria-hidden
        className={cn('medal-shadow block shrink-0', className)}
      >
        <g fill="currentColor" stroke="var(--line)" strokeWidth="1.6" strokeLinejoin="round">
          <path d={TAIL_L} />
          <path d={TAIL_R} />
          <path d={RING} />
        </g>
        <circle cx={CX} cy={CY} r="29" fill="none" stroke="var(--line)" strokeWidth="1.2" opacity="0.7" />
      </svg>
    )
  }

  const light = METAL_STOPS[metal][0]
  return (
    <span
      className={cn('relative block shrink-0', className)}
      style={{ width: size, height }}
    >
      <svg viewBox="0 0 100 128" width={size} height={height} aria-hidden className="block overflow-visible">
        <path d={TAIL_L} style={{ fill: ribbon }} />
        <path d={TAIL_R} style={{ fill: ribbon }} />
        {/* the far tail sits in shadow */}
        <path d={TAIL_R} fill="#000" opacity="0.3" />
        <path d={RING} fill={`url(#medal-${metal})`} />
        <path d={FOLDS} fill="#000" opacity="0.2" />
        <circle cx={CX} cy={CY} r="33" fill="#000" opacity="0.32" />
        <circle cx={CX} cy={CY} r="31" fill={`url(#medal-${metal}-r)`} />
        <circle cx={CX} cy={CY} r="25.5" fill="url(#medal-enamel)" />
        <circle cx={CX} cy={CY} r="25.5" fill="none" stroke={light} strokeOpacity="0.35" strokeWidth="1" />
        <Icon x={CX - 13} y={CY - 13} size={26} color={light} strokeWidth={2.3} />
        {metal === 'diamond' && <path d={SPARKLES} fill="#fff" className="medal-twinkle" />}
      </svg>
      {metal === 'diamond' && shine && (
        // the rating badge's rare glint, clipped to the medallion
        <span
          aria-hidden
          className="pointer-events-none absolute overflow-hidden rounded-full"
          style={{ left: '19%', top: `${(19 / 128) * 100}%`, width: '62%', height: `${(62 / 128) * 100}%` }}
        >
          <span className="badge-shine" />
        </span>
      )}
    </span>
  )
}
