import { useSyncExternalStore } from 'react'

export type Language = 'en' | 'it'
/** id of a preset in src/themes.ts */
export type Theme = string

export interface Settings {
  /** null = not chosen yet (first launch) */
  language: Language | null
  theme: Theme
  profileName: string
  showBooks: boolean
  showGames: boolean
  tmdbKey: string
  rawgKey: string
  omdbKey: string
  comicvineKey: string
  /** avatar: null = default icon · `emoji:<char>:<bg>` preset · otherwise an image URL/dataURL */
  avatar: string | null
  googleClientId: string
  googleEmail: string | null
  googleName: string | null
  googlePicture: string | null
}

const STORAGE_KEY = 'onetracker.settings'

const defaults: Settings = {
  language: null,
  theme: 'dark',
  profileName: '',
  showBooks: false,
  showGames: false,
  tmdbKey: (import.meta.env.VITE_TMDB_KEY as string) ?? '',
  rawgKey: (import.meta.env.VITE_RAWG_KEY as string) ?? '',
  omdbKey: (import.meta.env.VITE_OMDB_KEY as string) ?? '',
  comicvineKey: (import.meta.env.VITE_COMICVINE_KEY as string) ?? '',
  avatar: null,
  googleClientId: (import.meta.env.VITE_GOOGLE_CLIENT_ID as string) ?? '',
  googleEmail: null,
  googleName: null,
  googlePicture: null,
}

function load(): Settings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return { ...defaults }
    return { ...defaults, ...(JSON.parse(raw) as Partial<Settings>) }
  } catch {
    return { ...defaults }
  }
}

let cached: Settings = load()
const listeners = new Set<() => void>()

export function getSettings(): Settings {
  return cached
}

export function updateSettings(patch: Partial<Settings>): void {
  cached = { ...cached, ...patch }
  localStorage.setItem(STORAGE_KEY, JSON.stringify(cached))
  listeners.forEach((l) => l())
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function useSettings(): Settings {
  return useSyncExternalStore(subscribe, getSettings)
}
