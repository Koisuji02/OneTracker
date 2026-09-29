/**
 * The medagliere: every medal there is, earned or not. One row per media + tag
 * (or feat), four medals per row, bronze → diamond; a medal not earned yet is
 * its own dark silhouette. Medals earned since the last visit glow, and a tap
 * opens a medal's card: grade, media + tag, what it takes.
 */
import { ArrowLeft, Sparkles, X } from 'lucide-react'
import { memo, useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import Medal, { MetalTile } from '../components/Medal'
import {
  METALS,
  METAL_NAMES,
  SECTIONS,
  getAchievementState,
  medalKey,
  pickLang,
  sectionVisible,
  unlockedKeys,
  updateAchievementState,
  useAchievementRows,
  type AchievementRow,
} from '../achievements'
import { useT } from '../i18n'
import type { Language } from '../settings'
import { useSettings } from '../settings'
import { cn } from '../util'

const fmt = (n: number, lang: Language | null) => n.toLocaleString(lang === 'it' ? 'it-IT' : 'en-US')

/**
 * One row of four medals. Memoised: the page holds ~500 medals, and opening a
 * medal's card must not redraw all of them — the rows only change when the
 * library does.
 */
const MedalRow = memo(function MedalRow({
  row,
  fresh,
  lang,
  onOpen,
}: {
  row: AchievementRow
  fresh: Set<string>
  lang: Language | null
  onOpen: (row: AchievementRow, tier: number) => void
}) {
  const t = useT()
  const RowIcon = row.icon
  const next = row.tier < 3 ? row.thresholds[row.tier + 1] : null
  return (
    <div className="px-2 py-4">
      <div className="flex items-center justify-center gap-1.5 px-2 text-[11px] font-bold uppercase tracking-wider text-ink3">
        <RowIcon size={12} className="shrink-0" />
        <span className="truncate">{pickLang(row.label, lang)}</span>
      </div>
      <div className="mt-3 flex justify-center gap-3">
        {METALS.map((metal, i) => {
          const isNew = fresh.has(medalKey(row, i))
          return (
            <button
              key={metal}
              type="button"
              onClick={() => onOpen(row, i)}
              aria-label={`${pickLang(row.tierNames[i], lang)} | ${pickLang(METAL_NAMES[metal], lang)}`}
              className="relative rounded-lg transition-transform active:scale-95"
            >
              <Medal
                metal={metal}
                icon={row.icon}
                ribbon={row.color}
                locked={i > row.tier}
                size={56}
                className={isNew ? 'medal-new' : undefined}
              />
              {isNew && (
                <span className="absolute -top-1.5 left-1/2 -translate-x-1/2 rounded-md bg-brand px-1 py-px text-[8px] font-black uppercase leading-tight text-black">
                  {t('ach.new')}
                </span>
              )}
            </button>
          )
        })}
      </div>
      <div className="mt-2 text-center text-[11px] tabular-nums text-ink4">
        {next == null ? t('ach.maxed') : `${fmt(row.value, lang)} / ${fmt(next, lang)}`}
      </div>
    </div>
  )
})

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-3">
      <dt className="w-24 shrink-0 text-ink3">{label}</dt>
      <dd className="min-w-0 flex-1 font-semibold">{value}</dd>
    </div>
  )
}

/** One medal, up close: the pop-up behind every medal in the grid. */
function MedalCard({
  row,
  tier,
  lang,
  onClose,
}: {
  row: AchievementRow
  tier: number
  lang: Language | null
  onClose: () => void
}) {
  const t = useT()
  const metal = METALS[tier]
  const unlocked = tier <= row.tier
  const need = row.thresholds[tier]
  const section = SECTIONS.find((s) => s.key === row.section)
  const tierName = pickLang(row.tierNames[tier], lang)
  const metalName = pickLang(METAL_NAMES[metal], lang)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-5" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={tierName}
        className="fade-up w-full max-w-sm rounded-3xl border border-line bg-card p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex justify-center">
          <div className="medal-pop">
            <Medal metal={metal} icon={row.icon} ribbon={row.color} locked={!unlocked} size={124} shine />
          </div>
        </div>
        <div className="mt-4 text-center">
          <div className="text-xl font-extrabold tracking-tight">{tierName}</div>
          <div className="mt-2 flex items-center justify-center gap-2">
            <MetalTile metal={metal} className="h-5 px-2 text-[10px] font-black uppercase tracking-wider">
              {metalName}
            </MetalTile>
            <span
              className={cn(
                'rounded-md px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider',
                unlocked ? 'bg-brand text-black' : 'bg-card2 text-ink3',
              )}
            >
              {unlocked ? t('ach.unlocked') : t('ach.locked')}
            </span>
          </div>
        </div>

        <dl className="mt-5 space-y-3 border-t border-line pt-4 text-sm">
          <Fact label={t('ach.grade')} value={`${tierName} | ${metalName}`} />
          <Fact
            label={t('ach.mediaTag')}
            value={`${section ? pickLang(section.label, lang) : ''} | ${pickLang(row.label, lang)}`}
          />
          <Fact label={t('ach.requirement')} value={row.requirement(need, lang)} />
        </dl>

        <div className="mt-4">
          <div className="mb-1.5 flex justify-between text-xs">
            <span className="text-ink3">{t('ach.progress')}</span>
            <span className="font-bold tabular-nums">
              {fmt(Math.min(row.value, need), lang)} / {fmt(need, lang)}
            </span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-card2">
            <div
              className={cn('h-full rounded-full', unlocked ? 'bg-brand' : 'bg-ink3')}
              style={{ width: `${Math.min(1, row.value / need) * 100}%` }}
            />
          </div>
        </div>

        <button
          onClick={onClose}
          className="mt-5 w-full rounded-2xl border border-line py-3 text-sm font-bold text-ink2 transition-colors hover:border-accent hover:text-accent"
        >
          {t('common.close')}
        </button>
      </div>
    </div>
  )
}

export default function AchievementsPage() {
  const t = useT()
  const nav = useNavigate()
  const { language: lang, showBooks, showGames } = useSettings()
  const all = useAchievementRows()
  const rows = useMemo(
    () => all?.filter((r) => sectionVisible(r.section, { showBooks, showGames })),
    [all, showBooks, showGames],
  )
  const [open, setOpen] = useState<{ row: AchievementRow; tier: number } | null>(null)
  const openMedal = useCallback((row: AchievementRow, tier: number) => setOpen({ row, tier }), [])
  const closeMedal = useCallback(() => setOpen(null), [])
  // earned since the last visit: marked as seen straight away (so the Profile
  // counter clears) but they keep glowing for as long as the page is open
  const [fresh, setFresh] = useState<Set<string>>(() => new Set())
  const [retro, setRetro] = useState<number | null>(null)

  useEffect(() => {
    if (!rows) return
    const state = getAchievementState()
    const seen = new Set(state.seen)
    const newOnes = unlockedKeys(rows).filter((k) => !seen.has(k))
    // first ever visit: whatever the library had already earned arrives at
    // once, and deserves a word of explanation
    if (!state.visited && newOnes.length > 0) setRetro(newOnes.length)
    if (newOnes.length > 0) setFresh((prev) => new Set([...prev, ...newOnes]))
    if (!state.visited || newOnes.length > 0) {
      updateAchievementState({ seen: [...state.seen, ...newOnes], visited: true })
    }
  }, [rows])

  if (!rows) return null

  const total = rows.length * 4
  const earned = rows.reduce((n, r) => n + r.tier + 1, 0)
  const perMetal = METALS.map((_, i) => rows.filter((r) => r.tier >= i).length)
  const sections = SECTIONS.filter((s) => sectionVisible(s.key, { showBooks, showGames }))

  return (
    <div className="pb-10">
      <header className="flex items-center gap-3 px-4 pb-4 pt-safe">
        <button
          onClick={() => nav(-1)}
          aria-label="back"
          className="grid h-10 w-10 place-items-center rounded-xl border border-line text-ink2 transition-colors hover:border-accent hover:text-accent"
        >
          <ArrowLeft size={18} />
        </button>
        <h1 className="flex-1 text-2xl font-extrabold tracking-tight">{t('ach.title')}</h1>
      </header>

      {/* the whole haul at a glance */}
      <div className="mx-4 rounded-2xl border border-line bg-card p-4">
        <div className="flex items-baseline gap-2">
          <span className="text-3xl font-extrabold tracking-tight text-accent tabular-nums">
            {fmt(earned, lang)}
          </span>
          <span className="text-sm text-ink3 tabular-nums">
            / {fmt(total, lang)} {t('ach.unlockedOf')}
          </span>
        </div>
        <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-card2">
          <div className="h-full rounded-full bg-brand" style={{ width: `${(earned / total) * 100}%` }} />
        </div>
        <div className="mt-4 grid grid-cols-4 gap-2">
          {METALS.map((metal, i) => (
            <div key={metal} className="flex flex-col items-center gap-1.5 rounded-xl bg-card2 px-1 py-2.5">
              <MetalTile metal={metal} className="h-7 w-7 text-xs font-black tabular-nums">
                {perMetal[i]}
              </MetalTile>
              <div className="text-[10px] font-semibold text-ink3">{pickLang(METAL_NAMES[metal], lang)}</div>
            </div>
          ))}
        </div>
      </div>

      {retro != null && (
        <div className="mx-4 mt-3 flex items-start gap-3 rounded-2xl border border-accent/40 bg-brand/10 p-4">
          <Sparkles size={18} className="mt-0.5 shrink-0 text-accent" />
          <div className="min-w-0 flex-1 text-sm">
            <div className="font-bold">{t('ach.retroTitle')}</div>
            <div className="mt-0.5 text-ink2">
              {t('ach.retroA')} {retro} {t('ach.retroB')}
            </div>
          </div>
          <button
            onClick={() => setRetro(null)}
            aria-label={t('common.close')}
            className="grid h-7 w-7 shrink-0 place-items-center rounded-lg text-ink3 transition-colors hover:text-ink"
          >
            <X size={15} />
          </button>
        </div>
      )}

      {sections.map((section) => {
        const list = rows.filter((r) => r.section === section.key)
        const got = list.reduce((n, r) => n + r.tier + 1, 0)
        const Icon = section.icon
        return (
          <section
            key={section.key}
            className="mx-4 mt-6 overflow-hidden rounded-2xl border border-line bg-card [contain-intrinsic-size:auto_1400px] [content-visibility:auto]"
          >
            <div className="flex items-center gap-3 border-b border-line px-4 py-3">
              <span className="grid h-9 w-9 place-items-center rounded-xl bg-brand/10 text-accent">
                <Icon size={17} />
              </span>
              <h2 className="flex-1 text-base font-bold">{pickLang(section.label, lang)}</h2>
              <span className="text-xs font-bold tabular-nums text-ink3">
                {got}/{list.length * 4}
              </span>
            </div>
            <div className="divide-y divide-line">
              {list.map((row) => (
                <MedalRow key={row.key} row={row} fresh={fresh} lang={lang} onOpen={openMedal} />
              ))}
            </div>
          </section>
        )
      })}

      {open && <MedalCard row={open.row} tier={open.tier} lang={lang} onClose={closeMedal} />}
    </div>
  )
}
