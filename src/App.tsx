import { useEffect } from 'react'
import { HashRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom'
import BottomNav from './components/BottomNav'
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
import SearchPage from './pages/SearchPage'
import SeriesPage from './pages/SeriesPage'
import SettingsPage from './pages/SettingsPage'
import { MoviesPage } from './pages/SinglesPages'
import { updateSettings, useSettings, type Language } from './settings'
import { applyTheme } from './themes'

function ScrollToTop() {
  const { pathname } = useLocation()
  useEffect(() => {
    window.scrollTo(0, 0)
  }, [pathname])
  return null
}

function FirstRun() {
  return (
    <div className="flex min-h-full flex-col items-center justify-center gap-8 px-6 text-center">
      <div className="grid h-20 w-20 place-items-center rounded-3xl bg-brand shadow-[0_0_60px_-10px_#ffd60a80]">
        <svg viewBox="0 0 64 64" className="h-12 w-12">
          <rect x="10" y="16" width="44" height="30" rx="6" fill="none" stroke="#0b0b0e" strokeWidth="4" />
          <path d="M22 52h20" stroke="#0b0b0e" strokeWidth="4" strokeLinecap="round" />
          <path d="M27 25l12 6-12 6z" fill="#0b0b0e" />
        </svg>
      </div>
      <div>
        <h1 className="text-3xl font-extrabold tracking-tight">
          {translate('en', 'firstRun.welcome')}
        </h1>
        <p className="mt-2 text-ink3">{translate('en', 'firstRun.subtitle')}</p>
      </div>
      <div className="w-full max-w-xs">
        <p className="mb-3 text-xs font-bold uppercase tracking-wider text-ink3">
          {translate('en', 'firstRun.choose')} / {translate('it', 'firstRun.choose')}
        </p>
        <div className="flex flex-col gap-3">
          {(
            [
              ['en', 'English', '🇬🇧'],
              ['it', 'Italiano', '🇮🇹'],
            ] as Array<[Language, string, string]>
          ).map(([lang, label, flag]) => (
            <button
              key={lang}
              onClick={() => updateSettings({ language: lang })}
              className="flex items-center justify-center gap-2.5 rounded-full border border-line bg-card py-3.5 font-bold transition-colors hover:border-accent hover:text-accent"
            >
              <span className="text-lg">{flag}</span> {label}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

export default function App() {
  const settings = useSettings()

  useEffect(() => {
    applyTheme(settings.theme)
  }, [settings.theme])

  if (!settings.language) return <FirstRun />

  return (
    <HashRouter>
      <ScrollToTop />
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
