/**
 * Critic/community score banners with each service's real identity:
 * official brand color + a recognizable inline logo (drawn as tiny SVGs,
 * no external assets). Shown on detail pages under the actions row.
 */
import type { ReactNode } from 'react'
import type { ExternalRating } from '../types'

function TomatoIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4">
      <circle cx="12" cy="13.5" r="8.5" fill="#FA320A" stroke="#fff" strokeWidth="1.2" />
      <path d="M12 5.5 C10 3 7.5 3.5 7.5 3.5 c1 1.8 2.6 2.4 2.6 2.4 C7 5.6 5.8 7.2 5.8 7.2 c2.8 1 4.8-.3 6.2-.3 1.4 0 3.4 1.3 6.2.3 0 0-1.2-1.6-4.3-1.3 0 0 1.6-.6 2.6-2.4 0 0-2.5-.5-4.5 2z" fill="#00912D" />
    </svg>
  )
}

function MetacriticIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4">
      <defs>
        <linearGradient id="mc-g" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#FFCC33" />
          <stop offset="50%" stopColor="#66CC33" />
          <stop offset="100%" stopColor="#00AEEF" />
        </linearGradient>
      </defs>
      <circle cx="12" cy="12" r="10" fill="url(#mc-g)" />
      <text x="12" y="16.5" textAnchor="middle" fontSize="13" fontWeight="900" fill="#0F1B2A">m</text>
    </svg>
  )
}

function MalIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4">
      <rect width="24" height="24" rx="4" fill="#ffffff" />
      <text x="12" y="16" textAnchor="middle" fontSize="9" fontWeight="900" fill="#2E51A2">MAL</text>
    </svg>
  )
}

function AniListIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4">
      <rect width="24" height="24" rx="5" fill="#02A9FF" />
      {/* simplified AniList "A" mark */}
      <path d="M13.4 5.5 h3.2 v10 H21 v3 h-7.6 z" fill="#ffffff" />
      <path d="M9.4 5.5 L4 18.5 h3.4 l.9-2.5 h3.4 l.9 2.5 H16 L10.9 5.5 z M9.2 13.2 l1-3 1 3 z" fill="#152232" opacity="0.85" />
    </svg>
  )
}

function MangaDexIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4">
      <rect width="24" height="24" rx="5" fill="#ffffff" />
      {/* simplified MangaDex cat-ear mark */}
      <path d="M5 19 V9 l3-4 2.5 3.5 h3 L16 5 l3 4 v10 z" fill="#FF6740" />
      <circle cx="9.5" cy="13.5" r="1.3" fill="#fff" />
      <circle cx="14.5" cy="13.5" r="1.3" fill="#fff" />
    </svg>
  )
}

function BookIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round">
      <path d="M12 6 C10 4.5 7 4.5 4 5.5 v13 c3-1 6-1 8 .5 2-1.5 5-1.5 8-.5 v-13 c-3-1-6-1-8 .5 z" />
      <path d="M12 6 v13" />
    </svg>
  )
}

interface ServiceStyle {
  bg: string
  fg: string
  label: string
  icon?: ReactNode
  /** wordmark-only brands (IMDb, RAWG) render the label as the logo */
  wordmark?: boolean
}

const SERVICES: Record<string, ServiceStyle> = {
  imdb: { bg: '#F5C518', fg: '#000000', label: 'IMDb', wordmark: true },
  rt: { bg: '#2A0A03', fg: '#ffffff', label: 'Rotten Tomatoes', icon: <TomatoIcon /> },
  metacritic: { bg: '#0F2B41', fg: '#ffffff', label: 'Metacritic', icon: <MetacriticIcon /> },
  mal: { bg: '#2E51A2', fg: '#ffffff', label: 'MyAnimeList', icon: <MalIcon /> },
  anilist: { bg: '#0B1622', fg: '#ffffff', label: 'AniList', icon: <AniListIcon /> },
  mangadex: { bg: '#191A1C', fg: '#ffffff', label: 'MangaDex', icon: <MangaDexIcon /> },
  openlibrary: { bg: '#5B4636', fg: '#ffffff', label: 'Open Library', icon: <BookIcon /> },
  rawg: { bg: '#151515', fg: '#ffffff', label: 'RAWG', wordmark: true },
}

export default function RatingsBanners({ list }: { list: ExternalRating[] }) {
  if (list.length === 0) return null
  return (
    <div className="mt-4 flex flex-wrap items-center gap-2 px-4">
      {list.map((r) => {
        const s = SERVICES[r.source] ?? { bg: '#333', fg: '#fff', label: r.label }
        return (
          <span
            key={r.source}
            className="inline-flex items-center gap-2 rounded-lg px-2.5 py-1.5 shadow-md"
            style={{ background: s.bg, color: s.fg, border: '1px solid rgba(255,255,255,0.12)' }}
          >
            {s.icon}
            <span
              className={
                s.wordmark ? 'text-sm font-black italic tracking-tight' : 'text-[11px] font-bold opacity-90'
              }
            >
              {s.label}
            </span>
            <span className="text-sm font-black tabular-nums">{r.score}</span>
          </span>
        )
      })}
    </div>
  )
}
