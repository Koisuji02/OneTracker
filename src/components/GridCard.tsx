/**
 * The grid form of a tracking row (TrackCard). Same information, laid out on
 * the cover instead of beside it: what's next, how far along you are, and the
 * one-tap check — so switching a tab to grid changes the density, never what
 * you can do.
 *
 * Both components take the SAME props on purpose: each page computes its
 * next-unit state once and renders whichever layout the tab is set to.
 */
import { Check, ImageOff, Lock } from 'lucide-react'
import type { ReactNode } from 'react'
import Cover from './Cover'
import { cn } from '../util'

interface GridCardProps {
  poster?: string | null
  /** the work's name, under the cover */
  title: string
  /** bold line ON the cover: "S01 | E04", "Ch. 12", a year… */
  caption?: string | null
  /** small accent badge next to the caption (e.g. "+134", "x2") */
  badge?: string | null
  /** grey line under the title (next air date, platforms…) */
  subtitle?: ReactNode
  /** 0..1 — thin bar across the bottom of the cover */
  progress?: number | null
  onClick: () => void
  onCheck?: () => void
  /** replaces the check icon with text (e.g. "x2" for rewatch rounds) */
  checkContent?: string
  /** unreleased unit: a lock replaces the check button */
  locked?: boolean
}

export default function GridCard({
  poster,
  title,
  caption,
  badge,
  subtitle,
  progress,
  onClick,
  onCheck,
  checkContent,
  locked,
}: GridCardProps) {
  return (
    <div className="fade-up cursor-pointer select-none" onClick={onClick}>
      <div className="relative aspect-[2/3] overflow-hidden rounded-xl border border-line bg-card2">
        {poster ? (
          <Cover src={poster} alt={title} persist className="h-full w-full object-cover" />
        ) : (
          <div className="grid h-full w-full place-items-center text-ink4">
            <ImageOff size={22} />
          </div>
        )}

        {/* the caption sits on a gradient so it stays legible on any artwork */}
        {caption && (
          <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 via-black/45 to-transparent px-1.5 pb-2 pt-6">
            <div className="flex items-baseline gap-1">
              <span className="truncate text-[11px] font-bold text-white">{caption}</span>
              {badge && (
                <span className="shrink-0 text-[10px] font-bold text-accent">{badge}</span>
              )}
            </div>
          </div>
        )}

        {locked ? (
          <span
            aria-label="not released yet"
            className="absolute right-1.5 top-1.5 grid h-8 w-8 place-items-center rounded-xl bg-black/70 text-white backdrop-blur"
          >
            <Lock size={14} />
          </span>
        ) : (
          onCheck && (
            <button
              aria-label="mark watched"
              onClick={(e) => {
                e.stopPropagation()
                onCheck()
              }}
              className={cn(
                // "not watched yet" reads the same as in the list: a HOLLOW
                // control you still have to press. It sits on artwork instead of
                // the card background, so it carries its own dark scrim to stay
                // legible on a bright poster. A rewatch round (xN) keeps the
                // filled badge, exactly like the list card.
                'absolute right-1.5 top-1.5 grid h-8 w-8 place-items-center rounded-xl border-2 shadow-lg transition-transform active:scale-90',
                checkContent
                  ? 'border-accent bg-brand text-[10px] font-black text-black'
                  : 'border-white/60 bg-black/45 text-white backdrop-blur',
              )}
            >
              {checkContent ?? <Check size={15} strokeWidth={3.5} />}
            </button>
          )
        )}

        {progress != null && (
          <div className="absolute inset-x-0 bottom-0 h-1 bg-black/50">
            <div
              className="h-full bg-brand transition-all"
              style={{ width: `${Math.round(Math.min(1, progress) * 100)}%` }}
            />
          </div>
        )}
      </div>

      <div className="mt-1.5 truncate text-xs font-medium text-ink">{title}</div>
      {subtitle && <div className="truncate text-[11px] text-ink3">{subtitle}</div>}
    </div>
  )
}
