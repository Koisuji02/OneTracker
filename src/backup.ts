import { db } from './db'
import { getSettings, updateSettings, type DetailLayout, type SortMode } from './settings'
import type { LibraryItem, WatchList, WatchedEpisode } from './types'

export interface BackupData {
  app: 'onetracker'
  /** 1 = items+episodes · 2 = +lists/rewatch · 3 = +avatar/layout/sort */
  version: 1 | 2 | 3
  exportedAt: string
  settings: {
    language: string | null
    showBooks: boolean
    showGames: boolean
    theme?: string
    profileName?: string
    avatar?: string | null
    detailLayout?: DetailLayout
    librarySort?: SortMode
  }
  items: LibraryItem[]
  episodes: WatchedEpisode[]
  lists?: WatchList[]
}

export async function buildBackup(): Promise<string> {
  const [items, episodes, lists] = await Promise.all([
    db.items.toArray(),
    db.episodes.toArray(),
    db.lists.toArray(),
  ])
  const s = getSettings()
  const data: BackupData = {
    app: 'onetracker',
    version: 3,
    exportedAt: new Date().toISOString(),
    // everything the user personalizes — per-item state (status, rating,
    // favorite, archived, rewatch counts, playtime) already travels inside
    // `items`; here we add the app-wide preferences. API keys and Google
    // identity are deliberately excluded (secrets / device-specific).
    settings: {
      language: s.language,
      showBooks: s.showBooks,
      showGames: s.showGames,
      theme: s.theme,
      profileName: s.profileName,
      avatar: s.avatar,
      detailLayout: s.detailLayout,
      librarySort: s.librarySort,
    },
    items,
    episodes,
    lists,
  }
  return JSON.stringify(data, null, 2)
}

export function downloadBackup(json: string): void {
  const blob = new Blob([json], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `onetracker-backup-${new Date().toISOString().slice(0, 10)}.json`
  a.click()
  URL.revokeObjectURL(url)
}

/** Replace the whole library with the backup contents. */
export async function applyBackup(json: string): Promise<void> {
  const data = JSON.parse(json) as BackupData
  if (data?.app !== 'onetracker' || !Array.isArray(data.items)) {
    throw new Error('Invalid backup file')
  }
  await db.transaction('rw', db.items, db.episodes, db.lists, async () => {
    await db.items.clear()
    await db.episodes.clear()
    await db.lists.clear()
    await db.items.bulkPut(data.items)
    await db.episodes.bulkPut(data.episodes ?? [])
    await db.lists.bulkPut(data.lists ?? [])
  })
  if (data.settings) {
    const s = data.settings
    updateSettings({
      showBooks: !!s.showBooks,
      showGames: !!s.showGames,
      ...(s.theme ? { theme: s.theme } : {}),
      ...(s.profileName != null ? { profileName: s.profileName } : {}),
      ...(s.avatar !== undefined ? { avatar: s.avatar } : {}),
      ...(s.detailLayout ? { detailLayout: s.detailLayout } : {}),
      ...(s.librarySort ? { librarySort: s.librarySort } : {}),
    })
  }
}
