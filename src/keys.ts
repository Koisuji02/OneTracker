/**
 * The keyed services — what the key guides (components/KeyGuide.tsx) are
 * built from.
 *
 * - TMDB       → Serie TV and Film (and anime). BUILT IN: the gateway holds
 *                the app's one key behind a cache shared by everyone, so it
 *                works with no setup; a user may add their own (Settings).
 * - IGDB       → Giochi. Built in the same way (the app's one Twitch app);
 *                a user's own Twitch app is the optional extra.
 * - Comic Vine → western comics in Libri: the user's own key (books and
 *                manga need none). Its guide sits on top of Libri.
 * - OMDb       → optional IMDb / Rotten Tomatoes / Metacritic ratings, the
 *                user's own key. Suggested once on top of Settings.
 *
 * Only the two whose key is a plain "sign in and copy it" are asked of users.
 */
import { gatewayEnabled } from './api/gateway'
import { getSettings, type Settings } from './settings'

export type KeyService = 'tmdb' | 'igdb' | 'comicvine' | 'omdb'

/** A text setting holding (part of) a key. */
type KeyField = 'tmdbKey' | 'igdbClientId' | 'igdbClientSecret' | 'comicvineKey' | 'omdbKey'

export interface KeyServiceDef {
  id: KeyService
  /** the service, as Settings lists it */
  label: string
  /** the site the guide sends the user to ("Apri Twitch") */
  name: string
  /** where the key is made — the page the guide's button opens */
  url: string
  /**
   * The page is cached by the site for everyone (logged-in or not), so it
   * must be opened with a fresh query each time to show the user's own key.
   */
  bustCache?: boolean
  /** the service's own colours, so the button says where it is going */
  bg: string
  fg: string
  fields: Array<{ field: KeyField; label: string; placeholder: string }>
  /** how many steps the guide has (`keys.<id>.step1…`) */
  steps: number
  /** the app works without it, so its guide can be put off ("Non ora") */
  optional: boolean
  /** works out of the box through the gateway's own key; the user's is extra */
  builtIn: boolean
}

export const KEY_SERVICES: Record<KeyService, KeyServiceDef> = {
  tmdb: {
    id: 'tmdb',
    label: 'TMDB',
    name: 'TMDB',
    url: 'https://www.themoviedb.org/settings/api',
    // TMDB's brand gradient with its navy ink
    bg: 'linear-gradient(90deg, #90cea1, #01b4e4)',
    fg: '#0d253f',
    fields: [{ field: 'tmdbKey', label: 'keys.tmdb.field', placeholder: '0123abcd… / eyJhbGciOi…' }],
    steps: 2,
    optional: true,
    builtIn: true,
  },
  igdb: {
    id: 'igdb',
    label: 'IGDB',
    name: 'Twitch',
    url: 'https://dev.twitch.tv/console/apps/create',
    // the key is a Twitch app, so the button is Twitch purple
    bg: '#9146ff',
    fg: '#ffffff',
    fields: [
      { field: 'igdbClientId', label: 'keys.igdb.fieldId', placeholder: 'Client ID' },
      { field: 'igdbClientSecret', label: 'keys.igdb.fieldSecret', placeholder: 'Client Secret' },
    ],
    steps: 3,
    optional: true,
    builtIn: true,
  },
  comicvine: {
    id: 'comicvine',
    label: 'Comic Vine',
    name: 'Comic Vine',
    url: 'https://comicvine.gamespot.com/api/',
    // Comic Vine's CDN keeps /api/ for 20 min as the logged-OUT page, even
    // right after the user signs in: a fresh query each time skips it
    bustCache: true,
    bg: '#e3242b',
    fg: '#ffffff',
    fields: [{ field: 'comicvineKey', label: 'keys.comicvine.field', placeholder: '0123456789abcdef…' }],
    // signing in lands on the cached page: the key shows on the NEXT open
    steps: 2,
    optional: true,
    builtIn: false,
  },
  omdb: {
    id: 'omdb',
    label: 'OMDb',
    name: 'OMDb',
    url: 'https://www.omdbapi.com/apikey.aspx',
    // OMDb has no brand colour of its own: its plain dark page, as in About
    bg: '#333333',
    fg: '#ffffff',
    fields: [{ field: 'omdbKey', label: 'keys.omdb.field', placeholder: 'abc12345' }],
    steps: 2,
    optional: true,
    builtIn: false,
  },
}

/** Every field of the service is filled in. */
export function hasKey(service: KeyService, s: Settings = getSettings()): boolean {
  return KEY_SERVICES[service].fields.every((f) => s[f.field].trim().length > 0)
}

/** The service answers: the user's key, or (built in) the gateway's. */
export function serviceReady(service: KeyService, s: Settings = getSettings()): boolean {
  return hasKey(service, s) || (KEY_SERVICES[service].builtIn && gatewayEnabled())
}

/**
 * The guide is still worth showing on its own (a tab, the top of Settings):
 * the service doesn't answer yet and the user hasn't put it off.
 */
export function guideDue(service: KeyService, s: Settings = getSettings()): boolean {
  return !serviceReady(service, s) && !(KEY_SERVICES[service].optional && s.dismissedGuides.includes(service))
}

/** The address the guide opens: a fresh one each time where the site caches it. */
export function keyPageUrl(service: KeyService): string {
  const def = KEY_SERVICES[service]
  return def.bustCache ? `${def.url}?ot=${Date.now()}` : def.url
}
