import { useSyncExternalStore } from 'react'

export type Language = 'en' | 'it'
/** id of a preset in src/themes.ts */
export type Theme = string

export interface Settings {
  /** null = not chosen yet (first launch) */
  language: Language | null
  /** first-run wizard completed (language → books → games → account) */
  onboarded: boolean
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
  onboarded: false,
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

/** API-key fields where a baked-in .env value acts as fallback default. */
const KEY_FIELDS = [
  'tmdbKey',
  'rawgKey',
  'omdbKey',
  'comicvineKey',
  'googleClientId',
] as const

/**
 * Build-time defaults, exported so the Settings UI can HIDE the baked keys:
 * the form shows an empty field while a default is silently in use, and a
 * typed value overrides it.
 */
export const ENV_DEFAULTS = {
  tmdbKey: defaults.tmdbKey,
  rawgKey: defaults.rawgKey,
  omdbKey: defaults.omdbKey,
  comicvineKey: defaults.comicvineKey,
  googleClientId: defaults.googleClientId,
} as const

function load(): Settings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return { ...defaults }
    const stored = JSON.parse(raw) as Partial<Settings>
    const merged = { ...defaults, ...stored }
    // users from before the wizard existed shouldn't see it again
    if (stored.language && stored.onboarded === undefined) merged.onboarded = true
    // build-time keys (.env → bundle) win over EMPTY stored fields, so an APK
    // built with keys works out of the box while users can still override them
    for (const k of KEY_FIELDS) {
      if (!merged[k] && defaults[k]) merged[k] = defaults[k]
    }
    return merged
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
