/**
 * Google sign-in + Drive (appDataFolder) backup.
 *
 * Two auth paths:
 * - Web / desktop browser → Google Identity Services token client (popup).
 * - Native Android → native Google sign-in via @capgo/capacitor-social-login
 *   (Play Services). Google BLOCKS OAuth in embedded WebViews AND has removed
 *   custom-URI-scheme redirects for Android clients, so the browser/PKCE route
 *   is a dead end on device; the native flow is the only supported option. It
 *   returns an access token carrying the Drive scope, usable directly against
 *   the Drive REST API, and re-issues one silently once the account is granted.
 */
import { SocialLogin } from '@capgo/capacitor-social-login'
import { Capacitor } from '@capacitor/core'
import { getSettings, updateSettings } from './settings'

const GIS_SRC = 'https://accounts.google.com/gsi/client'
// web GIS wants a space-separated string; the native plugin wants an array
const SCOPES =
  'https://www.googleapis.com/auth/drive.appdata https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/userinfo.profile'
const SCOPE_ARRAY = ['email', 'profile', 'https://www.googleapis.com/auth/drive.appdata']
const FILE_NAME = 'onetracker-backup.json'

declare global {
  interface Window {
    google?: any
  }
}

const isNative = () => Capacitor.isNativePlatform()
let token: { value: string; exp: number } | null = null

/** Only a live in-memory access token counts as "fresh" — auto-sync uses this
 *  and NEVER falls back to an interactive sign-in, so no picker pops on its own. */
export function hasFreshToken(): boolean {
  return !!token && Date.now() < token.exp - 60_000
}

// ------------------------------------------------------------ native (capgo)

let socialInited = false
async function ensureSocialInit(): Promise<void> {
  if (socialInited) return
  // On Android the plugin takes the WEB client id; the Android OAuth client is
  // matched implicitly by package name + SHA-1 registered in Google Cloud.
  const webClientId = getSettings().googleClientId.trim() || getSettings().googleClientIdAndroid.trim()
  if (!webClientId) throw new Error('missing-client-id')
  await SocialLogin.initialize({ google: { webClientId, mode: 'online' } })
  socialInited = true
}

async function nativeLogin(): Promise<{ accessToken: string; profile: any }> {
  await ensureSocialInit()
  const res: any = await SocialLogin.login({
    provider: 'google',
    options: { scopes: SCOPE_ARRAY },
  })
  const r = res?.result ?? res
  const accessToken = r?.accessToken?.token as string | undefined
  if (!accessToken) throw new Error('no-access-token')
  return { accessToken, profile: r?.profile ?? null }
}

async function getAccessTokenNative(interactive: boolean): Promise<string> {
  if (token && Date.now() < token.exp - 60_000) return token.value
  // background/auto sync must NEVER open the account picker: only an explicit
  // user action (connect / manual save / restore) may sign in. When the cached
  // token is gone (app restarted, or >1h old) auto-sync simply skips until the
  // user next does something interactive.
  if (!interactive) throw new Error('needs-auth')
  const { accessToken } = await nativeLogin()
  token = { value: accessToken, exp: Date.now() + 3600_000 }
  return accessToken
}

// -------------------------------------------------------------- web (GIS)

let gisPromise: Promise<void> | null = null
function loadGis(): Promise<void> {
  if (window.google?.accounts?.oauth2) return Promise.resolve()
  gisPromise ??= new Promise((resolve, reject) => {
    const s = document.createElement('script')
    s.src = GIS_SRC
    s.async = true
    s.onload = () => resolve()
    s.onerror = () => reject(new Error('Failed to load Google Identity script'))
    document.head.appendChild(s)
  })
  return gisPromise
}

async function getAccessTokenWeb(interactive: boolean): Promise<string> {
  if (!interactive) throw new Error('needs-auth')
  const clientId = getSettings().googleClientId.trim()
  if (!clientId) throw new Error('missing-client-id')
  await loadGis()
  return new Promise((resolve, reject) => {
    const client = window.google.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope: SCOPES,
      callback: (resp: any) => {
        if (resp.error) {
          reject(new Error(resp.error))
          return
        }
        token = { value: resp.access_token, exp: Date.now() + (resp.expires_in ?? 3600) * 1000 }
        resolve(resp.access_token)
      },
      error_callback: (err: any) => reject(new Error(err?.type ?? 'oauth-error')),
    })
    client.requestAccessToken()
  })
}

// ------------------------------------------------------------------- public

/**
 * A Drive access token. `interactive` (default) may show the account picker;
 * pass false for background sync — it then only reuses a cached/silent token
 * and throws 'needs-auth' rather than surprising the user with a sheet.
 */
export async function getAccessToken(interactive = true): Promise<string> {
  if (token && Date.now() < token.exp - 60_000) return token.value
  return isNative() ? getAccessTokenNative(interactive) : getAccessTokenWeb(interactive)
}

/** Sign in with Google and store the profile in settings. */
export async function connectGoogle(): Promise<void> {
  if (isNative()) {
    const { accessToken, profile } = await nativeLogin()
    token = { value: accessToken, exp: Date.now() + 3600_000 }
    updateSettings({
      googleEmail: profile?.email ?? null,
      googleName: profile?.name ?? null,
      googlePicture: profile?.imageUrl ?? null,
    })
    return
  }
  const at = await getAccessTokenWeb(true)
  const res = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
    headers: { Authorization: `Bearer ${at}` },
  })
  if (!res.ok) throw new Error('Failed to fetch Google profile')
  const u = await res.json()
  updateSettings({
    googleEmail: u.email ?? null,
    googleName: u.name ?? null,
    googlePicture: u.picture ?? null,
  })
}

export function disconnectGoogle(): void {
  if (isNative()) {
    SocialLogin.logout({ provider: 'google' }).catch(() => {})
  } else if (token && window.google?.accounts?.oauth2) {
    window.google.accounts.oauth2.revoke(token.value, () => {})
  }
  token = null
  updateSettings({ googleEmail: null, googleName: null, googlePicture: null })
}

async function findBackupFileId(at: string): Promise<string | null> {
  const url = new URL('https://www.googleapis.com/drive/v3/files')
  url.searchParams.set('spaces', 'appDataFolder')
  url.searchParams.set('q', `name = '${FILE_NAME}'`)
  url.searchParams.set('fields', 'files(id, modifiedTime)')
  const res = await fetch(url.toString(), { headers: { Authorization: `Bearer ${at}` } })
  if (!res.ok) throw new Error(`Drive list failed (${res.status})`)
  const data = await res.json()
  return data.files?.[0]?.id ?? null
}

/** Upload the backup JSON to the app's hidden Drive folder (create or update). */
export async function saveToDrive(json: string, interactive = true): Promise<void> {
  const at = await getAccessToken(interactive)
  const existing = await findBackupFileId(at)
  let res: Response
  if (existing) {
    res = await fetch(
      `https://www.googleapis.com/upload/drive/v3/files/${existing}?uploadType=media`,
      {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${at}`, 'Content-Type': 'application/json' },
        body: json,
      },
    )
  } else {
    const boundary = 'onetracker_upload_boundary'
    const metadata = JSON.stringify({ name: FILE_NAME, parents: ['appDataFolder'] })
    const body =
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n` +
      `--${boundary}\r\nContent-Type: application/json\r\n\r\n${json}\r\n--${boundary}--`
    res = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${at}`,
        'Content-Type': `multipart/related; boundary=${boundary}`,
      },
      body,
    })
  }
  if (!res.ok) throw new Error(`Drive upload failed (${res.status})`)
}

/** Download the newest backup from Drive, or null when none exists. */
export async function restoreFromDrive(interactive = true): Promise<string | null> {
  const at = await getAccessToken(interactive)
  const id = await findBackupFileId(at)
  if (!id) return null
  const res = await fetch(`https://www.googleapis.com/drive/v3/files/${id}?alt=media`, {
    headers: { Authorization: `Bearer ${at}` },
  })
  if (!res.ok) throw new Error(`Drive download failed (${res.status})`)
  return res.text()
}
