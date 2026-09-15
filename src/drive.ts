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
 *
 * SESSIONS. The access token lives in memory only (it expires in an hour, so
 * storing it buys nothing) and `resumeGoogleSession` re-mints it WITHOUT any
 * UI before every background save — otherwise nothing could reach Drive after
 * an app restart until the user tapped "Backup su Drive" by hand.
 *
 * How far that reaches depends on the gateway:
 * - WITH the Google client secret configured on it, sign-in runs in the
 *   plugin's `offline` mode: it returns an authorization code, the gateway
 *   exchanges it for a REFRESH token (the secret must never ship in an APK),
 *   and from then on a new access token can be minted silently forever.
 * - WITHOUT it, `online` mode is used and the silent path is limited to the
 *   ~1h the plugin's own persisted token lasts; after that only an interactive
 *   sign-in helps. Both modes work, the second one just needs a tap now and
 *   then, and Settings shows when the last backup actually landed.
 */
import { SocialLogin } from '@capgo/capacitor-social-login'
import { Capacitor } from '@capacitor/core'
import { gatewayEnabled, gatewayHeaders, gatewayUrl } from './api/gateway'
import { buildBackup, mergeBackup } from './backup'
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

/** Keep an access token in memory (Google's last about an hour). */
function setToken(value: string, expiresIn = 3600): string {
  token = { value, exp: Date.now() + expiresIn * 1000 }
  return value
}

/** Google profile for an access token — an offline sign-in returns none. */
async function fetchProfile(at: string): Promise<any> {
  const res = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
    headers: { Authorization: `Bearer ${at}` },
  })
  if (!res.ok) return null
  return res.json()
}

// -------------------------------------------- gateway token exchange (Google)

interface GoogleTokens {
  access_token?: string
  expires_in?: number
  refresh_token?: string
  error?: string
}

/**
 * Run one Google token operation through the gateway, which is the only place
 * that holds the web client's secret (see worker/README.md).
 */
async function gatewayToken(payload: Record<string, string>): Promise<GoogleTokens> {
  const base = gatewayUrl()
  if (!base) throw new Error('gateway-required')
  const res = await fetch(`${base}/google/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...gatewayHeaders() },
    body: JSON.stringify(payload),
  })
  const data = (await res.json().catch(() => ({}))) as GoogleTokens
  if (!res.ok || !data.access_token) throw new Error(data.error ?? `google-token-${res.status}`)
  return data
}

/** Hand a refresh token back to Google (best-effort, on disconnect). */
async function gatewayRevoke(refreshToken: string): Promise<void> {
  const base = gatewayUrl()
  if (!base) return
  await fetch(`${base}/google/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...gatewayHeaders() },
    body: JSON.stringify({ revoke: refreshToken }),
  })
}

/**
 * Whether the gateway can exchange codes for refresh tokens (its /health says
 * `google`). Decided once per session: it picks the sign-in mode, so it must
 * not flip halfway through a login.
 */
let refreshCapable: boolean | null = null
async function gatewayCanRefresh(): Promise<boolean> {
  if (!gatewayEnabled()) return false
  if (refreshCapable !== null) return refreshCapable
  try {
    const res = await fetch(`${gatewayUrl()}/health`, { headers: gatewayHeaders() })
    refreshCapable = !!(await res.json())?.configured?.google
  } catch {
    refreshCapable = false // offline or gateway down: online mode still works
  }
  return refreshCapable
}

/** A live in-memory access token. Callers go through resumeGoogleSession. */
function hasFreshToken(): boolean {
  return !!token && Date.now() < token.exp - 60_000
}

// ------------------------------------------------------------ native (capgo)

type GoogleMode = 'online' | 'offline'

let socialMode: GoogleMode | null = null

/**
 * Initialize the plugin for the mode we can actually use. `offline` yields an
 * authorization code the gateway turns into a refresh token; `online` yields a
 * short-lived access token directly. It needs the WEB client id either way —
 * the Android OAuth client is matched implicitly by package name + SHA-1
 * registered in Google Cloud.
 */
async function ensureSocialInit(): Promise<GoogleMode> {
  const settings = getSettings()
  const webClientId = settings.googleClientId.trim() || settings.googleClientIdAndroid.trim()
  if (!webClientId) throw new Error('missing-client-id')
  const mode: GoogleMode = (await gatewayCanRefresh()) ? 'offline' : 'online'
  if (socialMode !== mode) {
    await SocialLogin.initialize({ google: { webClientId, mode } })
    socialMode = mode
  }
  return mode
}

async function nativeLogin(): Promise<{ accessToken: string; expiresIn: number; profile: any }> {
  const mode = await ensureSocialInit()
  const res: any = await SocialLogin.login({
    provider: 'google',
    // offline mode must ask for the refresh token explicitly, or Google only
    // re-issues one the very first time the account is granted
    options: { scopes: SCOPE_ARRAY, forceRefreshToken: mode === 'offline' },
  })
  const r = res?.result ?? res

  if (mode === 'offline') {
    const code = r?.serverAuthCode as string | undefined
    if (!code) throw new Error('no-server-auth-code')
    try {
      const t = await gatewayToken({ code })
      // the refresh token comes back on the FIRST grant only — never drop one
      if (t.refresh_token) updateSettings({ googleRefreshToken: t.refresh_token })
      return { accessToken: t.access_token as string, expiresIn: t.expires_in ?? 3600, profile: null }
    } catch {
      // the gateway turned out not to be able to exchange it (secret rotated,
      // gateway rolled back): drop to online mode so signing in still works
      refreshCapable = false
      socialMode = null
      return nativeLogin()
    }
  }

  const accessToken = r?.accessToken?.token as string | undefined
  if (!accessToken) throw new Error('no-access-token')
  return { accessToken, expiresIn: 3600, profile: r?.profile ?? null }
}

/**
 * New access token from the stored refresh token, or null when there isn't one
 * (or it no longer works). Platform-independent: the exchange is the gateway's
 * job, so this is the silent path on device AND in the browser.
 */
async function refreshedToken(): Promise<string | null> {
  const stored = getSettings().googleRefreshToken
  if (!stored) return null
  try {
    const t = await gatewayToken({ refresh_token: stored })
    return setToken(t.access_token as string, t.expires_in ?? 3600)
  } catch (err) {
    // invalid_grant = revoked by the user (or unused for six months): forget
    // it, so Settings offers a reconnect instead of retrying forever
    if (String((err as Error)?.message).includes('invalid_grant')) {
      updateSettings({ googleRefreshToken: null })
    }
    return null
  }
}

/**
 * A Drive token with NO user interface, for an account already connected.
 *
 * 1. A stored REFRESH token is the real answer: the gateway trades it for a new
 *    access token, at any distance in time, with nothing on screen.
 * 2. Otherwise (online mode) the plugin persisted its own tokens in
 *    SharedPreferences and reloads them on `initialize`, so
 *    `getAuthorizationCode` returns one — validated against Google — until it
 *    expires after about an hour, at which point the plugin clears its state.
 *    (`SocialLogin.refresh` is not implemented on Android, so that is the end
 *    of the silent road.)
 */
async function silentTokenNative(): Promise<string | null> {
  const viaRefresh = await refreshedToken()
  if (viaRefresh) return viaRefresh
  try {
    await ensureSocialInit()
    const at = (await SocialLogin.getAuthorizationCode({ provider: 'google' }))?.accessToken
    return at ? setToken(at) : null
  } catch {
    return null
  }
}

async function getAccessTokenNative(interactive: boolean): Promise<string> {
  if (token && Date.now() < token.exp - 60_000) return token.value
  // silent first, ALWAYS: the account is already granted, so a restarted app
  // (or a token older than an hour) gets a new one with no sheet at all
  const silent = await silentTokenNative()
  if (silent) return silent
  // only an explicit user action (connect / manual save / restore) may open the
  // account picker — background work must never surprise the user with one
  if (!interactive) throw new Error('needs-auth')
  const { accessToken, expiresIn } = await nativeLogin()
  return setToken(accessToken, expiresIn)
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

/**
 * GIS token client. With `silent` the browser is asked for a token without any
 * consent screen (`prompt: ''`), which succeeds when the Google session is
 * still alive and the scopes were granted before — and simply fails otherwise,
 * which is exactly what a background save wants.
 */
async function getAccessTokenWeb(interactive: boolean): Promise<string> {
  const viaRefresh = await refreshedToken()
  if (viaRefresh) return viaRefresh
  const clientId = getSettings().googleClientId.trim()
  if (!clientId) throw new Error('missing-client-id')
  await loadGis()
  return new Promise((resolve, reject) => {
    const client = window.google.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope: SCOPES,
      ...(interactive ? {} : { prompt: '' }),
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

/**
 * Bring the Drive session back with NO user interface. Call it at app start
 * (and before any background save): with an account connected the token is
 * re-minted from the grant Play Services / the browser already holds, so
 * auto-backup works from the first minute after launch instead of waiting for
 * the user to tap something in Settings.
 *
 * Returns whether Drive is reachable now. Never throws, never shows UI.
 */
export async function resumeGoogleSession(): Promise<boolean> {
  const { googleEmail, googleRefreshToken } = getSettings()
  if (!googleEmail && !googleRefreshToken) return false // nothing to resume
  if (hasFreshToken()) return true
  try {
    if (isNative()) return (await silentTokenNative()) != null
    await getAccessTokenWeb(false)
    return true
  } catch {
    return false // session gone (revoked, signed out, offline) — Settings can reconnect
  }
}

/** Sign in with Google and store the profile in settings. */
export async function connectGoogle(): Promise<void> {
  if (isNative()) {
    const { accessToken, expiresIn, profile } = await nativeLogin()
    setToken(accessToken, expiresIn)
    // an offline sign-in returns the code and nothing else, so the account
    // details come from Google with the token we just got
    const p = profile ?? (await fetchProfile(accessToken))
    updateSettings({
      googleEmail: p?.email ?? null,
      googleName: p?.name ?? null,
      googlePicture: p?.imageUrl ?? p?.picture ?? null,
    })
    return
  }
  const at = await getAccessTokenWeb(true)
  const u = await fetchProfile(at)
  if (!u) throw new Error('Failed to fetch Google profile')
  updateSettings({
    googleEmail: u.email ?? null,
    googleName: u.name ?? null,
    googlePicture: u.picture ?? null,
  })
}

export function disconnectGoogle(): void {
  const stored = getSettings().googleRefreshToken
  // a refresh token outlives the app, so hand it back rather than orphan it
  if (stored) gatewayRevoke(stored).catch(() => {})
  if (isNative()) {
    // rejects in offline mode (the plugin says so) — nothing to clean up there
    SocialLogin.logout({ provider: 'google' }).catch(() => {})
  } else if (token && window.google?.accounts?.oauth2) {
    window.google.accounts.oauth2.revoke(token.value, () => {})
  }
  token = null
  socialMode = null // the next connect re-initializes, mode included
  updateSettings({
    googleEmail: null,
    googleName: null,
    googlePicture: null,
    googleRefreshToken: null,
    lastBackupAt: null,
    lastBackupError: null,
  })
}

interface BackupFile {
  id: string
  /** RFC-3339 stamp Drive bumps on every write — our revision marker */
  modifiedTime: string
}

async function findBackupFile(at: string): Promise<BackupFile | null> {
  const url = new URL('https://www.googleapis.com/drive/v3/files')
  url.searchParams.set('spaces', 'appDataFolder')
  url.searchParams.set('q', `name = '${FILE_NAME}'`)
  url.searchParams.set('fields', 'files(id, modifiedTime)')
  const res = await fetch(url.toString(), { headers: { Authorization: `Bearer ${at}` } })
  if (!res.ok) throw new Error(`Drive list failed (${res.status})`)
  const file = (await res.json()).files?.[0]
  return file?.id ? { id: file.id, modifiedTime: file.modifiedTime ?? '' } : null
}

async function findBackupFileId(at: string): Promise<string | null> {
  return (await findBackupFile(at))?.id ?? null
}

/**
 * Upload the backup JSON to the app's hidden Drive folder (create or update).
 *
 * Every attempt stamps `lastBackupAt` / `lastBackupError` in settings: auto-
 * backup is silent, and without a stamp there is no way to tell a working sync
 * from one that has been failing for a week.
 */
export async function saveToDrive(json: string, interactive = true): Promise<void> {
  try {
    await uploadBackup(json, interactive)
    updateSettings({ lastBackupAt: Date.now(), lastBackupError: null })
  } catch (err) {
    updateSettings({ lastBackupError: (err as Error)?.message ?? 'error' })
    throw err
  }
}

async function uploadBackup(json: string, interactive: boolean): Promise<void> {
  const at = await getAccessToken(interactive)
  const existing = await findBackupFileId(at)
  let res: Response
  if (existing) {
    res = await fetch(
      `https://www.googleapis.com/upload/drive/v3/files/${existing}?uploadType=media&fields=modifiedTime`,
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
    res = await fetch(
      'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=modifiedTime',
      {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${at}`,
        'Content-Type': `multipart/related; boundary=${boundary}`,
      },
        body,
      },
    )
  }
  if (!res.ok) throw new Error(`Drive upload failed (${res.status})`)
  // remember the revision we just created: anything different up there later
  // is the other device's work, and must be merged before we overwrite it
  const written = await res.json().catch(() => null)
  if (written?.modifiedTime) updateSettings({ driveSeenTime: written.modifiedTime })
}

/**
 * Reconcile this device with Drive: pull whatever the OTHER device wrote since
 * we last looked, merge it into the library, then push the result.
 *
 * This is what makes one account usable from the phone AND the browser. Without
 * the pull, each device would happily overwrite the shared file with its own
 * (possibly older) state and silently lose the other's progress — a device only
 * ever downloaded on first connect.
 *
 * The merge keeps the higher progress on both sides (see backup.mergeBackup),
 * so it is safe to run on both devices in any order: they converge.
 */
export async function syncDrive(interactive = false): Promise<boolean> {
  if (!(await resumeGoogleSession()) && !interactive) return false
  try {
    const at = await getAccessToken(interactive)
    const file = await findBackupFile(at)
    if (file && file.modifiedTime !== getSettings().driveSeenTime) {
      const res = await fetch(
        `https://www.googleapis.com/drive/v3/files/${file.id}?alt=media`,
        { headers: { Authorization: `Bearer ${at}` } },
      )
      if (res.ok) {
        const remote = await res.text()
        // merge FIRST, so what we upload below already contains both sides
        await mergeBackup(remote)
        updateSettings({ driveSeenTime: file.modifiedTime })
      }
    }
    await saveToDrive(await buildBackup(), interactive)
    return true
  } catch (err) {
    updateSettings({ lastBackupError: (err as Error)?.message ?? 'error' })
    return false
  }
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
