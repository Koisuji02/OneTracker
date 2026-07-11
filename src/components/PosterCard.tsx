import { Check, Flag, Hourglass, ImageOff, Plus } from 'lucide-react'
import RatingBadge from './RatingBadge'
import { cn } from '../util'

interface PosterCardProps {
  title: string
  poster?: string | null
  year?: number | null
  onClick: () => void
  /** quick-add button state: undefined hides the button */
  inLibrary?: boolean
  onAdd?: () => void
  /** personal rating shown bottom-right on the cover */
  rating?: number | null
  /** bottom-left status: hourglass = in progress / still releasing, flag = fully done */
  statusKind?: 'ongoing' | 'done' | null
  className?: string
}

export default function PosterCard({
  title,
  poster,
  year,
  onClick,
  inLibrary,
  onAdd,
  rating,
  statusKind,
  className,
}: PosterCardProps) {
  return (
    <div className={cn('w-28 shrink-0 cursor-pointer select-none', className)} onClick={onClick}>
      <div className="relative aspect-[2/3] overflow-hidden rounded-xl border border-line bg-card2">
        {poster ? (
          <img
            src={poster}
            alt={title}
            loading="lazy"
            className="h-full w-full object-cover transition-transform duration-200 hover:scale-105"
          />
        ) : (
          <div className="grid h-full w-full place-items-center text-ink4">
            <ImageOff size={24} />
          </div>
        )}
        {onAdd !== undefined && (
          <button
            aria-label="add"
            onClick={(e) => {
              e.stopPropagation()
              if (!inLibrary) onAdd()
            }}
            className={cn(
              'absolute bottom-1.5 right-1.5 grid h-8 w-8 place-items-center rounded-full shadow-lg transition-colors',
              inLibrary
                ? 'bg-brand text-black'
                : 'bg-black/70 text-white backdrop-blur hover:bg-brand hover:text-black',
            )}
          >
            {inLibrary ? <Check size={16} strokeWidth={3} /> : <Plus size={16} strokeWidth={3} />}
          </button>
        )}
        {rating != null && (
          <span className="absolute bottom-1.5 right-1.5">
            <RatingBadge value={rating} />
          </span>
        )}
        {statusKind && (
          <span className="absolute bottom-1.5 left-1.5 grid h-6 w-6 place-items-center rounded-full bg-white text-black shadow-lg">
            {statusKind === 'done' ? <Flag size={12} strokeWidth={2.5} /> : <Hourglass size={12} strokeWidth={2.5} />}
          </span>
        )}
      </div>
      <div className="mt-1.5 truncate text-xs font-medium text-ink">{title}</div>
      {year != null && <div className="text-[11px] text-ink3">{year}</div>}
    </div>
  )
}
