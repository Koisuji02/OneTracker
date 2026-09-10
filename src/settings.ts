import { useSyncExternalStore } from 'react'

export type Language = 'en' | 'it'
/** id of a preset in src/themes.ts */
export type Theme = string
/** detail-page look: classic hero · poster wall · immersive vertical art */
export type DetailLayout = 'classic' | 'poster' | 'immersive'
/** library grid ordering (Favorites / Archived / Catalog) */
export type SortMode = 'added' | 'rating' | 'release'
/** how a media tab lists what you're tracking: rows or a wall of covers */
export type ViewMode = 'list' | 'grid'
/** the four media tabs, each with its OWN independent view mode */
export type ViewKey = 'viewSeries' | 'viewMovies' | 'viewBooks' | 'viewGames'

export interface Settings {
  /** null = not chosen yet (first launch) */
  language: Language | null
  /** first-run wizard completed (language → books → games → account) */
  onboarded: boolean
  theme: Theme
  detailLayout: DetailLayout
  /** ordering of the library grids (Favorites / Archived / Catalog) */
  librarySort: SortMode
  /**
   * Per-tab layout. Deliberately four separate fields and not one shared
   * setting: watching series as rows while browsing games as covers is a
   * perfectly normal combination, and one tab must never move another.
   */
  viewSeries: ViewMode
  viewMovies: ViewMode
  viewBooks: ViewMode
  viewGames: ViewMode
  profileName: string
  showBooks: boolean
  showGames: boolean
  tmdbKey: string
  rawgKey: string
  omdbKey: string
  comicvineKey: string
  /** avatar: null = default icon · `emoji:<char>:<bg>` preset · otherwise an image URL/dataURL */
  avatar: string | null
  /** optional API gateway (Cloudflare Worker) — empty = call providers directly */
  gatewayUrl: string
  /** shared token the gateway checks (see worker/README.md) */
  gatewayToken: string
  /** Web OAuth client (browser/preview GIS flow) */
  googleClientId: string
  /** Android OAuth client (native Custom-Tab PKCE flow) */
  googleClientIdAndroid: string
  googleEmail: string | null
  googleName: string | null
  googlePicture: string | null
}

const STORAGE_KEY = 'onetracker.settings'

const defaults: Settings = {
  language: null,
  onboarded: false,
  theme: 'amoled',
  detailLayout: 'immersive',
  librarySort: 'added',
  viewSeries: 'list',
  viewMovies: 'list',
  viewBooks: 'list',
  viewGames: 'list',
  profileName: '',
  showBooks: false,
  showGames: false,
  tmdbKey: (import.meta.env.VITE_TMDB_KEY as string) ?? '',
  rawgKey: (import.meta.env.VITE_RAWG_KEY as string) ?? '',
  omdbKey: (import.meta.env.VITE_OMDB_KEY as string) ?? '',
  comicvineKey: (import.meta.env.VITE_COMICVINE_KEY as string) ?? '',
  avatar: null,
  gatewayUrl: (import.meta.env.VITE_GATEWAY_URL as string) ?? '',
  gatewayToken: (import.meta.env.VITE_GATEWAY_TOKEN as string) ?? '',
  googleClientId:
    (import.meta.env.VITE_GOOGLE_CLIENT_ID_WEB as string) ??
    (import.meta.env.VITE_GOOGLE_CLIENT_ID as string) ??
    '',
  googleClientIdAndroid: (import.meta.env.VITE_GOOGLE_CLIENT_ID_ANDROID as string) ?? '',
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
  'gatewayUrl',
  'gatewayToken',
  'googleClientId',
  'googleClientIdAndroid',
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
  gatewayUrl: defaults.gatewayUrl,
  gatewayToken: defaults.gatewayToken,
  googleClientId: defaults.googleClientId,
  googleClientIdAndroid: defaults.googleClientIdAndroid,
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
