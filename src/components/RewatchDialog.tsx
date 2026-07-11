import { EyeOff, RotateCcw } from 'lucide-react'
import { useT } from '../i18n'

/**
 * Mini-dialog shown when tapping an ALREADY-watched unit (episode, chapter,
 * movie…): either remove the check or bump the rewatch grade (x2, x3…).
 */
interface RewatchDialogProps {
  /** e.g. "Episode 5" or a movie title */
  label: string
  /** current watch count of the clicked unit */
  count: number
  onUnmark: () => void
  onRewatch: () => void
  onClose: () => void
}

export default function RewatchDialog({
  label,
  count,
  onUnmark,
  onRewatch,
  onClose,
}: RewatchDialogProps) {
  const t = useT()
  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 sm:items-center"
      onClick={onClose}
    >
      <div
        className="fade-up w-full max-w-sm rounded-t-3xl border border-line bg-card p-5 sm:rounded-3xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-1 text-center text-base font-bold">{label}</div>
        {count >= 2 && (
          <div className="mb-2 text-center text-xs text-ink3">x{count}</div>
        )}
        <div className="mt-3 flex flex-col gap-2.5">
          <button
            onClick={() => {
              onRewatch()
              onClose()
            }}
            className="flex items-center justify-center gap-2 rounded-full bg-brand py-3 text-sm font-bold text-black transition-transform active:scale-95"
          >
            <RotateCcw size={16} strokeWidth={2.5} />
            {t('rewatch.again')} (x{count + 1})
          </button>
          <button
            onClick={() => {
              onUnmark()
              onClose()
            }}
            className="flex items-center justify-center gap-2 rounded-full border border-line py-3 text-sm font-bold text-ink2 transition-colors hover:border-red-500 hover:text-red-400"
          >
            <EyeOff size={16} />
            {t('rewatch.unmark')}
          </button>
          <button onClick={onClose} className="py-1 text-sm font-semibold text-ink3">
            {t('common.cancel')}
          </button>
        </div>
      </div>
    </div>
  )
}
