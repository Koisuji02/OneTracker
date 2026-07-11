import { useState } from 'react'
import { useT } from '../i18n'
import RatingBadge from './RatingBadge'

/** Emoji face matching the slider value. */
function faceFor(v: number): string {
  if (v >= 10) return '💎'
  if (v >= 8.5) return '🤩'
  if (v >= 7) return '😄'
  if (v >= 5.5) return '🙂'
  if (v >= 4) return '😐'
  if (v >= 2) return '😞'
  return '😡'
}

interface RatingModalProps {
  title: string
  initial: number | null
  onSave: (value: number) => void
  onRemove: () => void
  onClose: () => void
}

/** 0–10 slider (one decimal) with a reactive emoji face. */
export default function RatingModal({ title, initial, onSave, onRemove, onClose }: RatingModalProps) {
  const t = useT()
  const [value, setValue] = useState(initial ?? 7)

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 sm:items-center"
      onClick={onClose}
    >
      <div
        className="fade-up w-full max-w-sm rounded-t-3xl border border-line bg-card p-5 sm:rounded-3xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-1 text-center text-xs font-bold uppercase tracking-wider text-ink3">
          {t('rating.title')}
        </div>
        <div className="truncate text-center text-base font-bold">{title}</div>

        <div className="mt-5 flex items-center gap-4">
          <span className="w-12 text-center text-4xl">{faceFor(value)}</span>
          <input
            type="range"
            min={0}
            max={10}
            step={0.1}
            value={value}
            onChange={(e) => setValue(Number(e.target.value))}
            className="flex-1 accent-[var(--brand)]"
          />
          <RatingBadge value={value} size="md" />
        </div>

        <div className="mt-6 flex flex-col gap-2.5">
          <button
            onClick={() => {
              onSave(Math.round(value * 10) / 10)
              onClose()
            }}
            className="rounded-full bg-brand py-3 text-sm font-bold text-black transition-transform active:scale-95"
          >
            {t('common.save')}
          </button>
          {initial != null && (
            <button
              onClick={() => {
                onRemove()
                onClose()
              }}
              className="rounded-full border border-line py-3 text-sm font-bold text-ink2 transition-colors hover:border-red-500 hover:text-red-400"
            >
              {t('rating.remove')}
            </button>
          )}
          <button onClick={onClose} className="py-1 text-sm font-semibold text-ink3">
            {t('common.cancel')}
          </button>
        </div>
      </div>
    </div>
  )
}
