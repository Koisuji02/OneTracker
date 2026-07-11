import { BookOpen, Clapperboard, Gamepad2, Search, Tv, UserRound } from 'lucide-react'
import { NavLink } from 'react-router-dom'
import { useT } from '../i18n'
import { useSettings } from '../settings'
import { cn } from '../util'

interface Tab {
  to: string
  label: string
  icon: typeof Tv
}

export default function BottomNav() {
  const t = useT()
  const { showBooks, showGames } = useSettings()

  const tabs: Tab[] = [
    { to: '/series', label: t('nav.series'), icon: Tv },
    { to: '/movies', label: t('nav.movies'), icon: Clapperboard },
    ...(showBooks ? [{ to: '/books', label: t('nav.books'), icon: BookOpen }] : []),
    ...(showGames ? [{ to: '/games', label: t('nav.games'), icon: Gamepad2 }] : []),
    { to: '/search', label: t('nav.search'), icon: Search },
    { to: '/account', label: t('nav.profile'), icon: UserRound },
  ]

  const link = (tab: Tab, vertical: boolean) => (
    <NavLink
      key={tab.to}
      to={tab.to}
      className={({ isActive }) =>
        cn(
          'flex flex-col items-center justify-center gap-1 transition-colors',
          vertical ? 'w-full py-3 rounded-2xl' : 'flex-1 py-2',
          isActive ? 'text-accent' : 'text-ink3 hover:text-ink2',
        )
      }
    >
      {({ isActive }) => (
        <>
          <span
            className={cn(
              'grid place-items-center rounded-full px-4 py-1 transition-colors',
              isActive && 'bg-brand/10',
            )}
          >
            <tab.icon size={22} strokeWidth={isActive ? 2.5 : 2} />
          </span>
          <span className="text-[10px] font-semibold tracking-wide">{tab.label}</span>
        </>
      )}
    </NavLink>
  )

  return (
    <>
      {/* mobile: bottom bar */}
      <nav
        className="fixed inset-x-0 bottom-0 z-40 flex border-t border-line bg-surface/90 backdrop-blur-md md:hidden"
        style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
      >
        {tabs.map((tab) => link(tab, false))}
      </nav>

      {/* desktop: left rail */}
      <nav className="fixed inset-y-0 left-0 z-40 hidden w-20 flex-col items-center gap-1 border-r border-line bg-surface py-5 md:flex">
        <div className="mb-4 grid h-11 w-11 place-items-center rounded-2xl bg-brand">
          <Tv size={22} strokeWidth={2.5} className="text-black" />
        </div>
        {tabs.map((tab) => link(tab, true))}
      </nav>
    </>
  )
}
