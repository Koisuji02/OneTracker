import { db } from './db'
import { getSettings, updateSettings, type DetailLayout, type SortMode } from './settings'
import type { GamePlaythrough, LibraryItem, WatchList, WatchedEpisode } from './types'

export interface BackupData {
  app: 'onetracker'
  /**
   * 1 = items+episodes · 2 = +lists/rewatch · 3 = +avatar/layout/sort
   * 4 = game times moved to per-playthrough entries (`item.playthroughs`).
   * Older files still restore: db.gamePlaythroughs derives the runs from the
   * legacy `myPlaytime` + `watchCount` pair.
   */
  version: 1 | 2 | 3 | 4
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
    version: 4,
    exportedAt: new Date().toISOString(),
    // everything the user personalizes — per-item state (status, rating,
    // favorite, archived, rewatch counts, per-playthrough game times) already
    // travels inside `items`; here we add the app-wide preferences. API keys and Google
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

/**
 * MERGE a backup into the library instead of replacing it — what two devices
 * sharing one Drive file need.
 *
 * The rule that matters: **progress is never lost**. An episode present on
 * either side stays, at the higher watch count; an item present on either side
 * stays, and where both have it the fields follow whichever copy was touched
 * more recently, except the ones where "more" is unambiguously right
 * (watch count, playthroughs, chapters read).
 *
 * That makes the merge commutative and idempotent: merging A into B and B into
 * A converge, and merging twice changes nothing — which is what lets both
 * devices push the result without fighting.
 */
export async function mergeBackup(json: string): Promise<void> {
  const data = parseBackup(json)
  const [items, episodes, lists] = await Promise.all([
    db.items.toArray(),
    db.episodes.toArray(),
    db.lists.toArray(),
  ])

  const localItems = new Map(items.map((i) => [i.id, i]))
  const mergedItems: LibraryItem[] = []
  for (const remote of data.items) {
    const local = localItems.get(remote.id)
    mergedItems.push(local ? mergeItem(local, remote) : remote)
    localItems.delete(remote.id)
  }
  // whatever only this device has is kept as it is
  mergedItems.push(...localItems.values())

  const localEps = new Map(episodes.map((e) => [e.id, e]))
  const mergedEps: WatchedEpisode[] = []
  for (const remote of data.episodes ?? []) {
    const local = localEps.get(remote.id)
    const runtime = local?.runtime ?? remote.runtime
    mergedEps.push(
      local
        ? {
            ...local,
            count: Math.max(local.count ?? 1, remote.count ?? 1),
            watchedAt: Math.max(local.watchedAt ?? 0, remote.watchedAt ?? 0),
            // absent stays absent, like lastReadAt above: a `null` written over
            // a missing key would make every merge produce a "new" backup
            ...(runtime != null ? { runtime } : {}),
          }
        : remote,
    )
    localEps.delete(remote.id)
  }
  mergedEps.push(...localEps.values())

  const localLists = new Map(lists.map((l) => [l.id, l]))
  const mergedLists: WatchList[] = []
  for (const remote of data.lists ?? []) {
    const local = localLists.get(remote.id)
    // a list is a small hand-made thing: the newer edit wins whole
    mergedLists.push(
      local && (local.updatedAt ?? local.createdAt) >= (remote.updatedAt ?? remote.createdAt)
        ? local
        : remote,
    )
    localLists.delete(remote.id)
  }
  mergedLists.push(...localLists.values())

  await db.transaction('rw', db.items, db.episodes, db.lists, async () => {
    await db.items.bulkPut(mergedItems)
    await db.episodes.bulkPut(mergedEps)
    await db.lists.bulkPut(mergedLists)
  })
}

/** When the two copies disagree, which one was touched last. */
const touchedAt = (i: LibraryItem): number =>
  Math.max(i.lastReadAt ?? 0, i.completedAt ?? 0, i.addedAt ?? 0)

function mergeItem(local: LibraryItem, remote: LibraryItem): LibraryItem {
  const newer = touchedAt(remote) > touchedAt(local) ? remote : local
  const older = newer === remote ? local : remote
  const lastReadAt = Math.max(local.lastReadAt ?? 0, remote.lastReadAt ?? 0)
  const runs = mergeRuns(local, remote)
  return {
    ...older,
    ...newer,
    // counters only ever grow, whichever side did the growing
    watchCount: Math.max(local.watchCount ?? 1, remote.watchCount ?? 1),
    ...(local.chaptersRead != null || remote.chaptersRead != null
      ? { chaptersRead: Math.max(local.chaptersRead ?? 0, remote.chaptersRead ?? 0) }
      : {}),
    // playthroughs are append-only per device: union them by their timestamp
    ...(runs ? { playthroughs: runs } : {}),
    addedAt: Math.min(local.addedAt ?? Date.now(), remote.addedAt ?? Date.now()),
    // absent stays absent: writing `null` where there was no key at all would
    // change the serialised backup and trigger a pointless upload every merge
    ...(lastReadAt ? { lastReadAt } : {}),
  }
}

function mergeRuns(local: LibraryItem, remote: LibraryItem): GamePlaythrough[] | undefined {
  if (!local.playthroughs && !remote.playthroughs) return undefined
  const byTime = new Map<number, GamePlaythrough>()
  for (const p of [...(local.playthroughs ?? []), ...(remote.playthroughs ?? [])]) {
    // same run recorded on both sides = same timestamp; a typed time wins over
    // "use the HLTB number", because someone bothered to type it
    const seen = byTime.get(p.at)
    if (!seen || (seen.hours == null && p.hours != null)) byTime.set(p.at, p)
  }
  return [...byTime.values()].sort((a, b) => a.at - b.at)
}

function parseBackup(json: string): BackupData {
  const data = JSON.parse(json) as BackupData
  if (data?.app !== 'onetracker' || !Array.isArray(data.items)) {
    throw new Error('Invalid backup file')
  }
  return data
}

/** Replace the whole library with the backup contents. */
export async function applyBackup(json: string): Promise<void> {
  const data = parseBackup(json)
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
