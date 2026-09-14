/**
 * "No connection" state for the parts of the app that genuinely need a
 * provider (search, a title that was never opened before, Drive sync).
 *
 * It exists so those screens stop looking BROKEN when they are merely offline:
 * an empty result list reads as "nothing found", which is a lie — the library
 * itself keeps working, only the lookup can't happen right now.
 */
import { WifiOff } from 'lucide-react'
import { useT } from '../i18n'

export default function OfflineNotice({ hint }: { hint?: string }) {
  const t = useT()
  return (
    <div className="mx-4 flex flex-col items-center gap-3 rounded-2xl border border-dashed border-line px-6 py-12 text-center">
      <span className="grid h-16 w-16 place-items-center rounded-2xl bg-card2 text-ink3">
        <WifiOff size={30} />
      </span>
      <p className="text-base font-bold text-ink">{t('offline.title')}</p>
      <p className="max-w-xs text-sm text-ink3">{hint ?? t('offline.body')}</p>
    </div>
  )
}

/** Slim inline variant for a section inside a page that still has content. */
export function OfflineChip({ text }: { text?: string }) {
  const t = useT()
  return (
    <span className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-card2 px-3 py-1.5 text-xs font-semibold text-ink3">
      <WifiOff size={13} />
      {text ?? t('offline.title')}
    </span>
  )
}
