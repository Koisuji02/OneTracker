import { cn } from '../util'

/** Short labels for RAWG parent-platform slugs (stash.games-style chips). */
export const PLATFORM_LABELS: Record<string, string> = {
  pc: 'PC',
  playstation: 'PS',
  xbox: 'XBOX',
  nintendo: 'SWITCH',
  mac: 'MAC',
  linux: 'LINUX',
  ios: 'iOS',
  android: 'ANDROID',
  web: 'WEB',
  sega: 'SEGA',
  atari: 'ATARI',
  'commodore-amiga': 'AMIGA',
  '3do': '3DO',
  'neo-geo': 'NEO GEO',
}

export default function PlatformChips({
  slugs,
  className,
}: {
  slugs?: string[] | null
  className?: string
}) {
  if (!slugs || slugs.length === 0) return null
  return (
    <div className={cn('flex flex-wrap gap-1.5', className)}>
      {slugs.map((s) => (
        <span
          key={s}
          className="rounded-md border border-line bg-card px-2 py-0.5 text-[10px] font-black tracking-wider text-ink2"
        >
          {PLATFORM_LABELS[s] ?? s.toUpperCase()}
        </span>
      ))}
    </div>
  )
}
