import { EyeOff, Play, RotateCcw } from 'lucide-react'
import { useT } from '../i18n'

/**
 * Mini-dialog shown when tapping an ALREADY-watched thing (episode, chapter,
 * movie, book): remove the check, or count another time through.
 *
 * `onRestart` is what a ONE-SHOT medium adds: a film or a book has no episodes
 * to tick off, so "Ri-inizia xN" is its way of being in progress again — it
 * goes back to Continue and the ✓ there closes the round. Units (episodes,
 * chapters) don't pass it: a single episode is simply re-watched at once.
 */
interface RewatchDialogProps {
  /** e.g. "Episode 5" or a movie title */
  label: string
  /** current watch count of the clicked unit */
  count: number
  onUnmark: () => void
  onRewatch: () => void
  /** one-shot media only: start a new round instead of logging it as done */
  onRestart?: () => void
  onClose: () => void
}

export default function RewatchDialog({
  label,
  count,
  onUnmark,
  onRewatch,
  onRestart,
  onClose,
}: RewatchDialogProps) {
  const t = useT()
  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 sm:items-center"
      onClick={onClose}
    >
      <div
        className="fade-up pb-safe-sheet w-full max-w-sm rounded-t-3xl border border-line bg-card p-5 sm:rounded-3xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-1 text-center text-base font-bold">{label}</div>
        {count >= 2 && (
          <div className="mb-2 text-center text-xs text-ink3">x{count}</div>
        )}
        <div className="mt-3 flex flex-col gap-2.5">
          {onRestart && (
            <button
              onClick={() => {
                onRestart()
                onClose()
              }}
              className="flex items-center justify-center gap-2 rounded-2xl bg-brand py-3 text-sm font-bold text-black transition-transform active:scale-95"
            >
              <Play size={16} strokeWidth={2.5} />
              {t('rewatch.restart')} (x{count + 1})
            </button>
          )}
          <button
            onClick={() => {
              onRewatch()
              onClose()
            }}
            className={
              onRestart
                ? 'flex items-center justify-center gap-2 rounded-2xl border border-line py-3 text-sm font-bold text-ink2 transition-colors hover:border-accent hover:text-accent'
                : 'flex items-center justify-center gap-2 rounded-2xl bg-brand py-3 text-sm font-bold text-black transition-transform active:scale-95'
            }
          >
            <RotateCcw size={16} strokeWidth={2.5} />
            {t('rewatch.again')} (x{count + 1})
          </button>
          <button
            onClick={() => {
              onUnmark()
              onClose()
            }}
            className="flex items-center justify-center gap-2 rounded-2xl border border-line py-3 text-sm font-bold text-ink2 transition-colors hover:border-red-500 hover:text-red-400"
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
