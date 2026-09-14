/**
 * List ⇄ grid switch, sitting at the far right of a media tab's title.
 *
 * ONE control with both layouts always visible: the active half is filled with
 * the theme's accent, the other stays hollow, so the current mode and the
 * alternative read at a glance without opening anything. List on the left,
 * grid on the right, matching the order of the two layouts' density.
 *
 * It is purely presentational — each tab owns its own value (see ViewKey in
 * settings.ts), which is why one tab can be a list while another is a grid.
 */
import { LayoutGrid, List } from 'lucide-react'
import { useT } from '../i18n'
import type { ViewMode } from '../settings'
import { cn } from '../util'

export default function ViewToggle({
  value,
  onChange,
}: {
  value: ViewMode
  onChange: (mode: ViewMode) => void
}) {
  const t = useT()
  const half = (mode: ViewMode, label: string, icon: React.ReactNode) => (
    <button
      type="button"
      aria-label={label}
      aria-pressed={value === mode}
      onClick={() => onChange(mode)}
      className={cn(
        'grid h-9 w-10 place-items-center rounded-lg transition-colors',
        value === mode ? 'bg-brand text-black' : 'text-ink3 hover:text-accent',
      )}
    >
      {icon}
    </button>
  )

  return (
    <div className="flex shrink-0 items-center gap-0.5 rounded-xl border border-line bg-card p-0.5">
      {half('list', t('view.list'), <List size={17} strokeWidth={2.5} />)}
      {half('grid', t('view.grid'), <LayoutGrid size={17} strokeWidth={2.5} />)}
    </div>
  )
}
