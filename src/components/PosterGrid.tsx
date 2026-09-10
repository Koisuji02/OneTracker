/**
 * The cover grid shared by every library view (Catalog, Favorites, Archive,
 * Owned, Lists) and by the grid mode of the four media tabs.
 *
 * THREE columns on a phone, not two: at two columns a handful of covers fills
 * the screen and browsing a real library turns into endless scrolling. Three
 * keeps the artwork perfectly readable while roughly doubling what fits on
 * screen. Wider screens keep adding columns from there.
 */
import type { ReactNode } from 'react'
import { cn } from '../util'

export default function PosterGrid({
  children,
  className,
}: {
  children: ReactNode
  className?: string
}) {
  return (
    <div
      className={cn(
        'grid grid-cols-3 gap-x-3 gap-y-4 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6',
        className,
      )}
    >
      {children}
    </div>
  )
}
