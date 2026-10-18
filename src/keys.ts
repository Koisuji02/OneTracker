/**
 * The services that need the user's own key — what the key guides
 * (components/KeyGuide.tsx) are built from.
 *
 * Every user brings their own, free key (bring your own key): nothing keyed
 * ships in the app, each user's limits are their own, and each user's use is
 * personal and non-commercial — which is what the providers' free terms ask.
 * Four keys at most, one per thing they unlock:
 * - TMDB       → Serie TV and Film (and anime). Required for those tabs.
 * - IGDB       → Giochi. A Twitch app: client id + secret.
 * - Comic Vine → western comics in Libri (books and manga need no key).
 * - OMDb       → optional IMDb / Rotten Tomatoes / Metacritic ratings.
 */
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
  /** the service's own colours, so the button says where it is going */
  bg: string
  fg: string
  fields: Array<{ field: KeyField; label: string; placeholder: string }>
  /** how many steps the guide has (`keys.<id>.step1…`) */
  steps: number
  /** the app works without it, so its guide can be put off ("Non ora") */
  optional: boolean
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
    steps: 3,
    optional: false,
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
    optional: false,
  },
  comicvine: {
    id: 'comicvine',
    label: 'Comic Vine',
    name: 'Comic Vine',
    url: 'https://comicvine.gamespot.com/api/',
    bg: '#e3242b',
    fg: '#ffffff',
    fields: [{ field: 'comicvineKey', label: 'keys.comicvine.field', placeholder: '0123456789abcdef…' }],
    steps: 2,
    optional: true,
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
  },
}

/** Every field of the service is filled in. */
export function hasKey(service: KeyService, s: Settings = getSettings()): boolean {
  return KEY_SERVICES[service].fields.every((f) => s[f.field].trim().length > 0)
}

/** The guide is still worth showing: no key yet, and not put off by the user. */
export function guideDue(service: KeyService, s: Settings = getSettings()): boolean {
  return !hasKey(service, s) && !(KEY_SERVICES[service].optional && s.dismissedGuides.includes(service))
}
