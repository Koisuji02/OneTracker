import type { ReactNode } from 'react'

interface PageHeaderProps {
  title: string
  action?: ReactNode
}

export default function PageHeader({ title, action }: PageHeaderProps) {
  return (
    <header className="flex items-center justify-between px-4 pb-4 pt-6">
      <h1 className="text-2xl font-extrabold tracking-tight">{title}</h1>
      {action}
    </header>
  )
}
