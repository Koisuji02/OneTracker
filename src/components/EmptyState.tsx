import type { ReactNode } from 'react'

interface EmptyStateProps {
  icon: ReactNode
  text: string
}

export default function EmptyState({ icon, text }: EmptyStateProps) {
  return (
    <div className="mx-4 flex flex-col items-center gap-3 rounded-2xl border border-dashed border-line px-6 py-10 text-center">
      <span className="text-ink4">{icon}</span>
      <p className="text-sm text-ink3">{text}</p>
    </div>
  )
}
