import { App as CapApp } from '@capacitor/app'
import { Capacitor } from '@capacitor/core'
import { Toast } from '@capacitor/toast'
import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useLayoutEffect, useRef } from 'react'
import {
  HashRouter,
  Navigate,
  Route,
  Routes,
  useLocation,
  useNavigate,
  useNavigationType,
} from 'react-router-dom'
import BottomNav from './components/BottomNav'
import { db } from './db'
import { syncDrive } from './drive'
import { translate } from './i18n'
import AboutPage from './pages/AboutPage'
import AccountPage from './pages/AccountPage'
import AvatarPage from './pages/AvatarPage'
import BooksPage from './pages/BooksPage'
import ArchivedPage from './pages/ArchivedPage'
import OwnedPage from './pages/OwnedPage'
import ToBuyPage from './pages/ToBuyPage'
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
import { evict } from './imageCache'
import { onReconnect } from './net'
import { getSettings, useSettings } from './settings'
import { syncLibrary } from './sync'
import { applyTheme } from './themes'
import { drainWidgetActions, syncWidget } from './widget'

/**
 * Scroll behavior across navigation:
 * - a NEW page (PUSH/REPLACE, e.g. opening a detail) starts at the top
 * - going BACK/forward (POP) restores exactly where the user was, so returning
 *   from a detail to a long Continue/catalog list lands back at that spot
 * List pages load their data asynchronously (useLiveQuery/Dexie), so the page
 * may still be short on the first frame — we re-apply the saved offset over a
 * few frames until the content has grown enough to reach it.
 */
// scroll offset per history entry (location.key), so back/forward returns to
// the exact spot while a fresh visit to the same path starts at the top
const scrollPositions = new Map<string, number>()
// take over from the WebView's own history scroll restoration, which otherwise
// fights us and resets to 0 before async list content has loaded
if (typeof history !== 'undefined' && 'scrollRestoration' in history) {
  history.scrollRestoration = 'manual'
}

function ScrollRestoration() {
  const { key } = useLocation()
  const navType = useNavigationType()

  useLayoutEffect(() => {
    // going BACK/forward (POP) → restore this entry's offset; a NEW navigation
    // (PUSH/REPLACE) → start at the top
    const target = navType === 'POP' ? (scrollPositions.get(key) ?? 0) : 0
    let timer = 0
    if (target > 0) {
      // list pages fill in ASYNCHRONOUSLY (useLiveQuery/Dexie): re-apply the
      // saved offset — immediately, then on a short timer until the page is
      // tall enough to reach it — giving up after ~4s. setTimeout (not rAF)
      // so it also runs while the tab is backgrounded.
      const start = Date.now()
      const apply = () => {
        window.scrollTo(0, target)
        if (Math.abs(window.scrollY - target) <= 2 || Date.now() - start > 4000) return
        timer = window.setTimeout(apply, 100)
      }
      apply()
    } else {
      window.scrollTo(0, 0)
    }
    // keep this entry's offset current while the user scrolls…
    const save = () => scrollPositions.set(key, window.scrollY)
    window.addEventListener('scroll', save, { passive: true })
    return () => {
      clearTimeout(timer)
      window.removeEventListener('scroll', save)
      // …and — the reliable path — capture it the instant we navigate away,
      // BEFORE the next page's effect resets scroll to the top
      scrollPositions.set(key, window.scrollY)
    }
  }, [key, navType])

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
 * When a Google account is connected, the library auto-syncs to Drive: once at
 * launch, then on a 10-minute timer and every time the app goes to the
 * background.
 *
 * Each pass first RESUMES the session silently (see drive.resumeGoogleSession):
 * the access token lives in memory only, so without that the backup used to
 * skip on every fresh launch and the library reached Drive only when the user
 * tapped "Backup su Drive" by hand. A sign-in sheet is still never opened on
 * its own — a lapsed session just means this pass does nothing, and Settings
 * shows when the last backup actually landed.
 */
function DriveAutoSync() {
  const { googleEmail } = useSettings()
  useEffect(() => {
    if (!googleEmail) return
    // reconcile, don't just push: the other device may have written since we
    // last looked, and overwriting it would lose that progress (see syncDrive)
    const sync = () => void syncDrive(false)
    sync()
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

/**
 * Catch-up pass: refresh the metadata that can have gone stale (new episodes,
 * new chapters, announced dates) and push the pending Drive backup.
 *
 * It runs at startup, whenever the device comes back online, and each time the
 * app returns to the foreground — the three moments where the library can be
 * behind reality. `syncLibrary` throttles itself, so these triggers are cheap.
 * The cached-artwork budget is trimmed here too, once per launch.
 */
function NetworkSync() {
  useEffect(() => {
    void syncLibrary()
    void evict()
    const offReconnect = onReconnect(() => {
      void syncLibrary(true)
    })
    const onShow = () => {
      if (document.visibilityState === 'visible') void syncLibrary()
    }
    document.addEventListener('visibilitychange', onShow)
    return () => {
      offReconnect()
      document.removeEventListener('visibilitychange', onShow)
    }
  }, [])

  return null
}

/**
 * Keep the home-screen widget in sync: repush the continue list whenever the
 * library changes (item/episode count or the most recent watch) or the theme
 * changes. No-op off native.
 */
function WidgetSync() {
  const { theme } = useSettings()
  // Signal on ANY change that can move an item in/out of "Continue": item
  // status/rewatch-count changes (a game set to playing, a movie started) AND
  // episode marks. Hashing statuses catches transitions that don't alter row
  // counts (the reason the widget sometimes lagged behind the app).
  const signal = useLiveQuery(async () => {
    const [items, epCount, last] = await Promise.all([
      db.items.toArray(),
      db.episodes.count(),
      db.episodes.orderBy('watchedAt').last(),
    ])
    const itemsSig = items.map((i) => `${i.id}:${i.status}:${i.watchCount ?? 0}`).join('|')
    return `${itemsSig}#${epCount}:${last?.watchedAt ?? 0}`
  }, [])
  useEffect(() => {
    syncWidget()
  }, [signal, theme])
  // repush when leaving the app (fresh widget) and apply any ✓ taps queued on
  // the widget when we come back to the foreground
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return
    drainWidgetActions()
    const onHide = () => {
      if (document.visibilityState === 'hidden') syncWidget()
    }
    document.addEventListener('visibilitychange', onHide)
    const sub = CapApp.addListener('appStateChange', (s) => {
      if (s.isActive) drainWidgetActions()
    })
    return () => {
      document.removeEventListener('visibilitychange', onHide)
      sub.then((x) => x.remove())
    }
  }, [])
  return null
}

/**
 * Route the app when a widget row is tapped (com.onetracker.app://open/media/…).
 *
 * The scheme is BROWSABLE, so the link can also arrive from a web page or
 * another app: the destination is matched against the ONE route shape the
 * widget ever sends, and anything else is dropped rather than handed to the
 * router.
 */
const DEEP_LINK_ROUTE = /^\/media\/[a-z]+\/[a-z]+\/[\w.:-]+$/

function DeepLinkHandler() {
  const nav = useNavigate()
  const navRef = useRef(nav)
  navRef.current = nav
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return
    const go = (url?: string | null) => {
      if (!url) return
      const i = url.indexOf('/media/')
      if (i < 0) return
      const route = url.slice(i)
      if (DEEP_LINK_ROUTE.test(route)) navRef.current(route)
    }
    // must run exactly ONCE: useNavigate() changes identity on every route
    // change, so depending on it re-runs getLaunchUrl() after each navigation
    // and yanks the user back to the deep-linked page (can't leave the detail
    // page opened from the widget)
    CapApp.getLaunchUrl()
      .then((r) => go(r?.url))
      .catch(() => {})
    const sub = CapApp.addListener('appUrlOpen', (e) => go(e.url))
    return () => {
      sub.then((s) => s.remove())
    }
  }, [])
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
      <ScrollRestoration />
      <AndroidBackHandler />
      <DriveAutoSync />
      <NetworkSync />
      <WidgetSync />
      <DeepLinkHandler />
      <div className="min-h-full pb-[calc(6rem+env(safe-area-inset-bottom,0px))] md:pb-10 md:pl-20">
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
            <Route path="/archived" element={<ArchivedPage />} />
            <Route path="/owned" element={<OwnedPage />} />
            <Route path="/tobuy" element={<ToBuyPage />} />
            <Route path="/catalog/:kind" element={<CatalogPage />} />
            <Route path="/lists" element={<ListsPage />} />
            <Route path="/lists/:id" element={<ListDetailPage />} />
            <Route path="/avatar" element={<AvatarPage />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="/about" element={<AboutPage />} />
            <Route path="/media/:provider/:mediaType/:id" element={<DetailPage />} />
            <Route path="*" element={<Navigate to="/series" replace />} />
          </Routes>
        </div>
        <BottomNav />
      </div>
    </HashRouter>
  )
}
