import { Check } from 'lucide-react'
import { cn } from '../util'

interface CheckButtonProps {
  onClick: () => void
  checked?: boolean
  /** times watched — 2+ renders "x2"/"x3" instead of the check icon */
  count?: number
  size?: 'md' | 'sm'
}

export default function CheckButton({
  onClick,
  checked = false,
  count = 1,
  size = 'md',
}: CheckButtonProps) {
  return (
    <button
      aria-label="mark watched"
      onClick={(e) => {
        e.stopPropagation()
        onClick()
      }}
      className={cn(
        'grid shrink-0 place-items-center rounded-full border-2 transition-all active:scale-90',
        size === 'md' ? 'h-11 w-11' : 'h-8 w-8',
        checked
          ? 'border-accent bg-brand text-black'
          : 'border-line text-ink3 hover:border-accent hover:text-accent',
      )}
    >
      {checked && count >= 2 ? (
        <span className={cn('font-black', size === 'md' ? 'text-xs' : 'text-[10px]')}>
          x{count}
        </span>
      ) : (
        <Check size={size === 'md' ? 20 : 15} strokeWidth={3} />
      )}
    </button>
  )
}
