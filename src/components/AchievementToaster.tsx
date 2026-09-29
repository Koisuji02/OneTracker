/**
 * Announces medals the moment they're earned: a small squared pop-up drops in
 * at the top centre (Google Play style) — the medal first, then it widens to
 * name it — and leaves on its own. After that the medal lives only in the
 * medagliere, where it glows until it's been seen.
 *
 * It watches a CHEAP signature of the library and recomputes the medals only
 * when that changes, debounced: a whole season marked at once, a TV Time
 * import or a Drive merge is one recomputation and at most one summary pop-up.
 */
import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  METALS,
  SECTIONS,
  computeAchievements,
  getAchievementState,
  medalKey,
  pickLang,
  sectionVisible,
  unlockedKeys,
  updateAchievementState,
  type AchievementRow,
} from '../achievements'
import { db } from '../db'
import { useT } from '../i18n'
import { getSettings, useSettings } from '../settings'
import Medal from './Medal'

interface Toast {
  id: number
  row: AchievementRow
  tier: number
  /** medals this pop-up stands for (> 1 = the summary form) */
  count: number
}

/** More than this many rows at once → one summary pop-up instead of a queue. */
const MAX_SINGLE = 3
/** Let a burst of writes settle before recomputing. */
const DEBOUNCE_MS = 1200

let toastSeq = 0

export default function AchievementToaster() {
  const t = useT()
  const nav = useNavigate()
  const { language: lang } = useSettings()
  const [queue, setQueue] = useState<Toast[]>([])

  // everything a medal can depend on, in one comparable string
  const signal = useLiveQuery(async () => {
    const [items, epCount, last, clashCount] = await Promise.all([
      db.items.toArray(),
      db.episodes.count(),
      db.episodes.orderBy('watchedAt').last(),
      db.clashes.count(),
    ])
    const itemsSig = items
      .map(
        (i) =>
          `${i.id}:${i.status}:${i.watchCount ?? 0}:${i.playthroughs?.length ?? 0}:` +
          `${i.favorite ? 1 : 0}${i.owned ? 1 : 0}${i.archived ? 1 : 0}:${i.rating ?? ''}:` +
          `${(i.genres?.length ?? 0) + (i.tags?.length ?? 0)}`,
      )
      .join('|')
    return `${itemsSig}#${epCount}:${last?.id ?? ''}:${last?.watchedAt ?? 0}:${last?.count ?? 1}#${clashCount}`
  }, [])

  useEffect(() => {
    if (signal === undefined) return
    let cancelled = false
    const timer = window.setTimeout(async () => {
      const [items, episodes, clashes] = await Promise.all([
        db.items.toArray(),
        db.episodes.toArray(),
        db.clashes.toArray(),
      ])
      if (cancelled) return
      const rows = computeAchievements(items, episodes, clashes)
      const unlocked = unlockedKeys(rows)
      const state = getAchievementState()
      if (!state.ready) {
        // first pass on this device: what's already earned is recorded silently
        // (the medagliere shows it as new instead of a burst of pop-ups)
        updateAchievementState({ ready: true, notified: unlocked })
        return
      }
      const known = new Set(state.notified)
      const fresh = unlocked.filter((k) => !known.has(k))
      if (fresh.length === 0) return
      updateAchievementState({ notified: [...state.notified, ...fresh] })

      // announce only what the medagliere shows: a switched-off tab's medals
      // simply wait there, already counted as announced
      const settings = getSettings()
      const where = new Map<string, { row: AchievementRow; tier: number }>()
      for (const row of rows) for (let i = 0; i <= row.tier; i++) where.set(medalKey(row, i), { row, tier: i })
      const shown = fresh
        .map((k) => where.get(k))
        .filter((x): x is { row: AchievementRow; tier: number } => !!x && sectionVisible(x.row.section, settings))
      if (shown.length === 0) return
      // a row that climbed several grades at once is announced at its best one
      const best = new Map<string, { row: AchievementRow; tier: number }>()
      for (const x of shown) {
        const prev = best.get(x.row.key)
        if (!prev || x.tier > prev.tier) best.set(x.row.key, x)
      }
      const toasts = [...best.values()]
      if (toasts.length > MAX_SINGLE) {
        const top = toasts.reduce((a, b) => (b.tier > a.tier ? b : a))
        setQueue((q) => [...q, { id: ++toastSeq, ...top, count: shown.length }])
      } else {
        setQueue((q) => [...q, ...toasts.map((x) => ({ id: ++toastSeq, ...x, count: 1 }))])
      }
    }, DEBOUNCE_MS)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [signal])

  const current = queue[0]
  if (!current) return null
  const section = SECTIONS.find((s) => s.key === current.row.section)
  const many = current.count > 1

  return (
    <div className="pointer-events-none fixed inset-x-0 top-safe z-[80] flex justify-center px-4">
      <button
        key={current.id}
        type="button"
        onClick={() => {
          setQueue((q) => q.slice(1))
          nav('/achievements')
        }}
        onAnimationEnd={(e) => {
          // the medal inside animates too (diamond sparkles): only our own end counts
          if (e.target === e.currentTarget) setQueue((q) => q.slice(1))
        }}
        className="ach-toast pointer-events-auto flex items-center gap-3 overflow-hidden rounded-2xl border border-line bg-card py-2 pl-2 pr-4 text-left shadow-2xl shadow-black/50"
      >
        <Medal metal={METALS[current.tier]} icon={current.row.icon} ribbon={current.row.color} size={38} />
        <span className="min-w-0 whitespace-nowrap">
          <span className="block text-[10px] font-bold uppercase tracking-wider text-accent">
            {many ? `${current.count} ${t('ach.toastMany')}` : t('ach.toastOne')}
          </span>
          <span className="block truncate text-sm font-extrabold leading-tight">
            {pickLang(current.row.tierNames[current.tier], lang)}
          </span>
          <span className="block truncate text-xs text-ink3">
            {many
              ? t('ach.tapToSee')
              : `${section ? pickLang(section.label, lang) : ''} | ${pickLang(current.row.label, lang)}`}
          </span>
        </span>
      </button>
    </div>
  )
}
