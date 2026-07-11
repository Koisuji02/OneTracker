import { getSettings, updateSettings } from './settings'

const GIS_SRC = 'https://accounts.google.com/gsi/client'
const SCOPES =
  'https://www.googleapis.com/auth/drive.appdata https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/userinfo.profile'
const FILE_NAME = 'onetracker-backup.json'

declare global {
  interface Window {
    google?: any
  }
}

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

let token: { value: string; exp: number } | null = null

export async function getAccessToken(): Promise<string> {
  const clientId = getSettings().googleClientId.trim()
  if (!clientId) throw new Error('missing-client-id')
  if (token && Date.now() < token.exp - 60_000) return token.value
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

/** Sign in with Google and store the profile in settings. */
export async function connectGoogle(): Promise<void> {
  const at = await getAccessToken()
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
  if (token && window.google?.accounts?.oauth2) {
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
export async function saveToDrive(json: string): Promise<void> {
  const at = await getAccessToken()
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
export async function restoreFromDrive(): Promise<string | null> {
  const at = await getAccessToken()
  const id = await findBackupFileId(at)
  if (!id) return null
  const res = await fetch(`https://www.googleapis.com/drive/v3/files/${id}?alt=media`, {
    headers: { Authorization: `Bearer ${at}` },
  })
  if (!res.ok) throw new Error(`Drive download failed (${res.status})`)
  return res.text()
}
