import { UserRound } from 'lucide-react'
import { useSettings } from '../settings'
import { cn } from '../util'

/**
 * The user's avatar. `settings.avatar` encodes the choice:
 * - null            → Google photo if connected, else the anonymous icon
 * - `emoji:<c>:<bg>` → built-in character preset (emoji on a colored circle)
 * - anything else   → an image URL / data-URL (uploaded photo or poster)
 */
export default function Avatar({ className }: { className?: string }) {
  const { avatar, googlePicture } = useSettings()

  if (avatar?.startsWith('emoji:')) {
    const [, emoji, bg] = avatar.split(':')
    return (
      <div
        className={cn('grid place-items-center overflow-hidden rounded-full', className)}
        style={{ background: bg }}
      >
        <span className="text-[55%] leading-none">{emoji}</span>
      </div>
    )
  }

  const src = avatar ?? googlePicture
  if (src) {
    return (
      <img
        src={src}
        alt=""
        referrerPolicy="no-referrer"
        className={cn('rounded-full bg-card object-cover', className)}
      />
    )
  }

  return (
    <div
      className={cn(
        'grid place-items-center rounded-full bg-card text-ink3',
        className,
      )}
    >
      <UserRound className="h-2/5 w-2/5" />
    </div>
  )
}
