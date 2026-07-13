import { cn } from '../util'

/**
 * Short labels for RAWG DETAILED platform slugs (stash.games-style chips):
 * a game on PS3 shows "PS3", not a generic "PS" family badge.
 */
export const PLATFORM_LABELS: Record<string, string> = {
  pc: 'PC',
  macos: 'MAC',
  macintosh: 'MAC',
  linux: 'LINUX',
  web: 'WEB',
  // PlayStation
  playstation1: 'PS1',
  playstation2: 'PS2',
  playstation3: 'PS3',
  playstation4: 'PS4',
  playstation5: 'PS5',
  'ps-vita': 'VITA',
  psp: 'PSP',
  // Xbox
  'xbox-old': 'XBOX',
  xbox360: 'X360',
  'xbox-one': 'XONE',
  'xbox-series-x': 'XSX',
  // Nintendo
  'nintendo-switch': 'SWITCH',
  'nintendo-switch-2': 'SWITCH 2',
  'nintendo-3ds': '3DS',
  'nintendo-ds': 'DS',
  'nintendo-dsi': 'DSi',
  'wii-u': 'WII U',
  wii: 'WII',
  gamecube: 'NGC',
  'nintendo-64': 'N64',
  snes: 'SNES',
  nes: 'NES',
  'game-boy-advance': 'GBA',
  'game-boy-color': 'GBC',
  'game-boy': 'GB',
  // mobile & legacy
  ios: 'iOS',
  android: 'ANDROID',
  'sega-master-system': 'SMS',
  'sega-saturn': 'SATURN',
  'sega-cd': 'SEGA CD',
  'sega-32x': '32X',
  genesis: 'GENESIS',
  dreamcast: 'DC',
  'game-gear': 'GAME GEAR',
  'atari-2600': 'ATARI 2600',
  'atari-7800': 'ATARI 7800',
  jaguar: 'JAGUAR',
  '3do': '3DO',
  'neo-geo': 'NEO GEO',
  'commodore-amiga': 'AMIGA',
  // family fallbacks (older items saved parent slugs)
  playstation: 'PS',
  xbox: 'XBOX',
  nintendo: 'NINTENDO',
  mac: 'MAC',
  sega: 'SEGA',
  atari: 'ATARI',
}

export function platformLabel(slug: string): string {
  return PLATFORM_LABELS[slug] ?? slug.replace(/-/g, ' ').toUpperCase()
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
          {platformLabel(s)}
        </span>
      ))}
    </div>
  )
}
