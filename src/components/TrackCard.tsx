import { ChevronRight, ImageOff } from 'lucide-react'
import type { ReactNode } from 'react'
import CheckButton from './CheckButton'

interface TrackCardProps {
  poster?: string | null
  /** small yellow uppercase label on top (e.g. series name) */
  topLabel: string
  /** main bold line (e.g. "S01 | E04" or movie title) */
  title: string
  /** small yellow badge next to the title (e.g. "+134") */
  badge?: string | null
  /** grey line under the title (e.g. episode name) */
  subtitle?: ReactNode
  /** 0..1 — renders a progress bar when set */
  progress?: number | null
  onClick: () => void
  onCheck?: () => void
}

export default function TrackCard({
  poster,
  topLabel,
  title,
  badge,
  subtitle,
  progress,
  onClick,
  onCheck,
}: TrackCardProps) {
  return (
    <div
      onClick={onClick}
      className="fade-up flex cursor-pointer select-none items-center gap-3 rounded-2xl border border-line bg-card p-2.5 pr-3 transition-transform active:scale-[0.99]"
    >
      <div className="h-24 w-16 shrink-0 overflow-hidden rounded-xl bg-card2">
        {poster ? (
          <img src={poster} alt="" loading="lazy" className="h-full w-full object-cover" />
        ) : (
          <div className="grid h-full w-full place-items-center text-ink4">
            <ImageOff size={20} />
          </div>
        )}
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-0.5 text-[11px] font-bold uppercase tracking-wider text-accent">
          <span className="truncate">{topLabel}</span>
          <ChevronRight size={12} strokeWidth={3} className="shrink-0" />
        </div>
        <div className="mt-0.5 flex items-baseline gap-2">
          <span className="truncate text-[15px] font-bold text-ink">{title}</span>
          {badge && <span className="shrink-0 text-[11px] font-bold text-accent">{badge}</span>}
        </div>
        {subtitle && <div className="mt-0.5 truncate text-sm text-ink2">{subtitle}</div>}
        {progress != null && (
          <div className="mt-2 h-1 w-full overflow-hidden rounded-full bg-card2">
            <div
              className="h-full rounded-full bg-brand transition-all"
              style={{ width: `${Math.round(progress * 100)}%` }}
            />
          </div>
        )}
      </div>

      {onCheck && <CheckButton onClick={onCheck} />}
    </div>
  )
}
