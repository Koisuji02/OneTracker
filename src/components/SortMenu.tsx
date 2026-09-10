/**
 * Sort control for the library grids (Favorites / Archived / Catalog): an icon
 * button at title level that drops down the three orderings. The choice is
 * stored in settings so it sticks across pages and launches.
 */
import { ArrowDownUp, Check } from 'lucide-react'
import { useState } from 'react'
import type { SortMode } from '../settings'
import { useT } from '../i18n'
import { cn } from '../util'

const OPTIONS: SortMode[] = ['added', 'rating', 'release']

export default function SortMenu({
  value,
  onChange,
}: {
  value: SortMode
  onChange: (m: SortMode) => void
}) {
  const t = useT()
  const [open, setOpen] = useState(false)

  return (
    <div className="relative">
      <button
        aria-label={t('sort.label')}
        onClick={() => setOpen((o) => !o)}
        className={cn(
          'grid h-10 w-10 place-items-center rounded-full border transition-colors',
          open
            ? 'border-accent text-accent'
            : 'border-line text-ink2 hover:border-accent hover:text-accent',
        )}
      >
        <ArrowDownUp size={18} />
      </button>
      {open && (
        <>
          {/* click-away catcher */}
          <div className="fixed inset-0 z-20" onClick={() => setOpen(false)} />
          <div className="absolute right-0 z-30 mt-2 w-48 overflow-hidden rounded-xl border border-line bg-card shadow-xl">
            {OPTIONS.map((m) => (
              <button
                key={m}
                onClick={() => {
                  onChange(m)
                  setOpen(false)
                }}
                className={cn(
                  'flex w-full items-center justify-between px-4 py-2.5 text-left text-sm transition-colors hover:bg-card2',
                  m === value ? 'font-semibold text-accent' : 'text-ink',
                )}
              >
                {t(`sort.${m}`)}
                {m === value && <Check size={16} />}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
