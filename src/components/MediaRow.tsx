import { ChevronRight } from 'lucide-react'
import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'

interface MediaRowProps {
  title: string
  icon?: ReactNode
  /** when set, the header shows a chevron linking to a full grid view */
  to?: string
  children: ReactNode
}

export default function MediaRow({ title, icon, to, children }: MediaRowProps) {
  const header = (
    <>
      {icon && <span className="text-accent">{icon}</span>}
      <h2 className="text-base font-bold">{title}</h2>
      {to && <ChevronRight size={18} className="text-ink3" />}
    </>
  )
  return (
    <section className="fade-up">
      {to ? (
        <Link to={to} className="mb-2 flex items-center gap-2 px-4">
          {header}
        </Link>
      ) : (
        <div className="mb-2 flex items-center gap-2 px-4">{header}</div>
      )}
      <div className="no-scrollbar flex gap-3 overflow-x-auto px-4 pb-2">{children}</div>
    </section>
  )
}
