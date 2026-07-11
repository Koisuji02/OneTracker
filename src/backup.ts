import { db } from './db'
import { getSettings, updateSettings } from './settings'
import type { LibraryItem, WatchList, WatchedEpisode } from './types'

export interface BackupData {
  app: 'onetracker'
  /** 1 = items+episodes · 2 = adds lists and rewatch counts */
  version: 1 | 2
  exportedAt: string
  settings: {
    language: string | null
    showBooks: boolean
    showGames: boolean
    theme?: string
    profileName?: string
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
    version: 2,
    exportedAt: new Date().toISOString(),
    settings: {
      language: s.language,
      showBooks: s.showBooks,
      showGames: s.showGames,
      theme: s.theme,
      profileName: s.profileName,
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
    updateSettings({
      showBooks: !!data.settings.showBooks,
      showGames: !!data.settings.showGames,
      ...(data.settings.theme ? { theme: data.settings.theme } : {}),
      ...(data.settings.profileName != null ? { profileName: data.settings.profileName } : {}),
    })
  }
}
