import { App as CapApp } from '@capacitor/app'
import { Capacitor } from '@capacitor/core'
import { Toast } from '@capacitor/toast'
import { useEffect, useRef } from 'react'
import {
  HashRouter,
  Navigate,
  Route,
  Routes,
  useLocation,
  useNavigate,
} from 'react-router-dom'
import { buildBackup } from './backup'
import BottomNav from './components/BottomNav'
import { hasFreshToken, saveToDrive } from './drive'
import { translate } from './i18n'
import AccountPage from './pages/AccountPage'
import AvatarPage from './pages/AvatarPage'
import BooksPage from './pages/BooksPage'
import CatalogPage from './pages/CatalogPage'
import DetailPage from './pages/DetailPage'
import FavoritesPage from './pages/FavoritesPage'
import GamesPage from './pages/GamesPage'
import ListDetailPage from './pages/ListDetailPage'
import ListsPage from './pages/ListsPage'
import OnboardingPage from './pages/OnboardingPage'
import SearchPage from './pages/SearchPage'
import SeriesPage from './pages/SeriesPage'
import SettingsPage from './pages/SettingsPage'
import { MoviesPage } from './pages/SinglesPages'
import { getSettings, useSettings } from './settings'
import { applyTheme } from './themes'

function ScrollToTop() {
  const { pathname } = useLocation()
  useEffect(() => {
    window.scrollTo(0, 0)
  }, [pathname])
  return null
}

/**
 * Android hardware back button:
 * - on a home tab (Series/Movies/Books/Games) → double-press to exit
 *   (first press shows the classic Android toast hint)
 * - everywhere else (Search, Profile, detail, settings, lists, catalog…) →
 *   real history back, returning exactly to the previous page
 */
const EXIT_TABS = new Set(['/series', '/movies', '/books', '/games'])
const DOUBLE_BACK_MS = 2000

function AndroidBackHandler() {
  const nav = useNavigate()
  const { pathname } = useLocation()
  const pathRef = useRef(pathname)
  pathRef.current = pathname
  const lastBackRef = useRef(0)

  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return
    const sub = CapApp.addListener('backButton', () => {
      const path = pathRef.current
      if (EXIT_TABS.has(path)) {
        const now = Date.now()
        if (now - lastBackRef.current < DOUBLE_BACK_MS) {
          CapApp.exitApp()
        } else {
          lastBackRef.current = now
          Toast.show({
            text: translate(getSettings().language, 'app.exitHint'),
            duration: 'short',
          })
        }
      } else {
        nav(-1)
      }
    })
    return () => {
      sub.then((s) => s.remove())
    }
  }, [nav])

  return null
}

/**
 * When a Google account is connected, the library auto-syncs to Drive:
 * every 10 minutes and whenever the app goes to the background — but only
 * while the OAuth token is still fresh, so no consent popups ever appear
 * outside of an explicit user action.
 */
function DriveAutoSync() {
  const { googleEmail } = useSettings()
  useEffect(() => {
    if (!googleEmail) return
    const sync = async () => {
      if (!hasFreshToken()) return
      try {
        await saveToDrive(await buildBackup())
      } catch {
        // silent best-effort
      }
    }
    const interval = setInterval(sync, 10 * 60 * 1000)
    const onHide = () => {
      if (document.visibilityState === 'hidden') sync()
    }
    document.addEventListener('visibilitychange', onHide)
    return () => {
      clearInterval(interval)
      document.removeEventListener('visibilitychange', onHide)
    }
  }, [googleEmail])
  return null
}

export default function App() {
  const settings = useSettings()

  useEffect(() => {
    applyTheme(settings.theme)
  }, [settings.theme])

  if (!settings.onboarded) return <OnboardingPage />

  return (
    <HashRouter>
      <ScrollToTop />
      <AndroidBackHandler />
      <DriveAutoSync />
      <div className="min-h-full pb-24 md:pb-10 md:pl-20">
        <div className="mx-auto w-full max-w-3xl">
          <Routes>
            <Route path="/" element={<Navigate to="/series" replace />} />
            <Route path="/series" element={<SeriesPage />} />
            <Route path="/movies" element={<MoviesPage />} />
            <Route path="/books" element={<BooksPage />} />
            <Route path="/games" element={<GamesPage />} />
            <Route path="/search" element={<SearchPage />} />
            <Route path="/account" element={<AccountPage />} />
            <Route path="/favorites" element={<FavoritesPage />} />
            <Route path="/catalog/:kind" element={<CatalogPage />} />
            <Route path="/lists" element={<ListsPage />} />
            <Route path="/lists/:id" element={<ListDetailPage />} />
            <Route path="/avatar" element={<AvatarPage />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="/media/:provider/:mediaType/:id" element={<DetailPage />} />
            <Route path="*" element={<Navigate to="/series" replace />} />
          </Routes>
        </div>
        <BottomNav />
      </div>
    </HashRouter>
  )
}
