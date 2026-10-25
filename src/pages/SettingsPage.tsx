import {
  Activity,
  ArrowLeft,
  Check,
  ChevronDown,
  Cloud,
  CloudDownload,
  CloudUpload,
  Download,
  Info,
  Languages,
  LifeBuoy,
  Loader2,
  LogOut,
  Moon,
  Plus,
  Sun,
  Trash2,
  Tv,
  Upload,
} from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { App as CapApp } from '@capacitor/app'
import { Capacitor } from '@capacitor/core'
import { resetAchievementState } from '../achievements'
import { checkProviders, type HealthState, type ProviderHealth } from '../api/health'
import { applyBackup, buildBackup, downloadBackup } from '../backup'
import KeyGuide, { KeyMark } from '../components/KeyGuide'
import { OfflineChip } from '../components/OfflineNotice'
import { db } from '../db'
import { clearImageCache } from '../imageCache'
import { connectGoogle, disconnectGoogle, restoreFromDrive, syncDrive } from '../drive'
import { importTvTimeZip, type ImportProgress, type TvTimeImportResult } from '../importTvTime'
import { useT } from '../i18n'
import { useOnline } from '../net'
import { KEY_SERVICES, guideDue, hasKey, serviceReady, type KeyService } from '../keys'
import { getSettings, updateSettings, useSettings, type DetailLayout, type Language } from '../settings'
import { THEMES } from '../themes'
import { useTour } from '../tours'
import { cn } from '../util'
import { pinWidget } from '../widget'

function Section({ title, tour, children }: { title: string; tour?: string; children: ReactNode }) {
  return (
    <section data-tour={tour} className="mt-6 px-4">
      <h2 className="mb-2 px-1 text-xs font-bold uppercase tracking-wider text-ink3">
        {title}
      </h2>
      <div className="divide-y divide-line overflow-hidden rounded-2xl border border-line bg-card">
        {children}
      </div>
    </section>
  )
}

function ToggleRow({
  label,
  checked,
  onChange,
}: {
  label: string
  checked: boolean
  onChange: (v: boolean) => void
}) {
  return (
    <div className="flex items-center justify-between px-4 py-3.5">
      <span className="text-sm font-medium">{label}</span>
      <button
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={cn(
          'relative h-7 w-12 shrink-0 rounded-full transition-colors',
          checked ? 'bg-brand' : 'bg-card2',
        )}
      >
        <span
          className={cn(
            'absolute top-1 h-5 w-5 rounded-full bg-white shadow transition-all',
            checked ? 'left-6' : 'left-1',
          )}
        />
      </button>
    </div>
  )
}

/** One service key (src/keys.ts): tap to open its guide, on the field. */
function KeyRow({ service }: { service: KeyService }) {
  const t = useT()
  const settings = useSettings()
  const [open, setOpen] = useState(false)
  const on = hasKey(service, settings)
  // a built-in service already answers without one: say whose key it uses
  const status = on
    ? KEY_SERVICES[service].builtIn
      ? 'keys.yours'
      : 'keys.connected'
    : KEY_SERVICES[service].builtIn
      ? 'keys.builtIn'
      : 'keys.notConnected'
  return (
    <div>
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-card2"
      >
        <KeyMark service={service} size={34} />
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-medium">{KEY_SERVICES[service].label}</span>
          <span className="block text-xs text-ink3">{t(`keys.${service}.what`)}</span>
        </span>
        <span className={cn('text-xs font-semibold', on ? 'text-accent' : 'text-ink3')}>
          {t(status)}
        </span>
        <ChevronDown size={16} className={cn('text-ink3 transition-transform', open && 'rotate-180')} />
      </button>
      {open && (
        <div className="px-3 pb-3">
          <KeyGuide service={service} editing onSaved={() => setOpen(false)} className="bg-surface" />
        </div>
      )}
    </div>
  )
}

/** The home-screen widget (Android only): a preview and "Aggiungi alla Home". */
function WidgetRow() {
  const t = useT()
  const { language } = useSettings()
  const [hint, setHint] = useState<string | null>(null)
  return (
    <div className="flex items-center gap-4 px-4 py-4">
      <img src={`/help/widget-${language ?? 'en'}.webp`} alt="" className="w-28 shrink-0 rounded-lg" />
      <div className="min-w-0 flex-1">
        <p className="text-xs leading-relaxed text-ink2">{t('help.widget.body')}</p>
        <button
          onClick={async () => setHint(t((await pinWidget()) ? 'widget.confirm' : 'widget.manual'))}
          className="mt-3 flex items-center gap-1.5 rounded-xl bg-brand px-3 py-2 text-xs font-bold text-black transition-transform active:scale-[0.98]"
        >
          <Plus size={14} strokeWidth={3} /> {t('widget.add')}
        </button>
        {hint && <p className="mt-2 text-[11px] leading-snug text-ink3">{hint}</p>}
      </div>
    </div>
  )
}

/** Coloured dot + label per probed provider (Settings → diagnostics). */
const HEALTH_DOT: Record<HealthState, string> = {
  ok: 'bg-emerald-500',
  down: 'bg-red-500',
  unreachable: 'bg-orange-500',
  badkey: 'bg-yellow-500',
  nokey: 'bg-zinc-500',
}

function HealthRow({ h }: { h: ProviderHealth }) {
  const t = useT()
  return (
    <div className="flex items-start gap-3 px-4 py-3">
      <span className={cn('mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full', HEALTH_DOT[h.state])} />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className="text-sm font-semibold">{h.label}</span>
          <span className="text-xs text-ink3">{t(`health.${h.state}`)}</span>
          {h.state !== 'nokey' && <span className="text-[11px] text-ink4">{h.ms} ms</span>}
        </div>
        <div className="text-[11px] leading-snug text-ink4">
          {t(h.roleKey)}
          {h.detail ? ` | ${h.detail}` : ''}
        </div>
        {/* an unreachable host on an otherwise working connection is almost
            always network-level filtering — tell the user the actual remedy */}
        {h.state === 'unreachable' && (
          <div className="mt-1 text-[11px] leading-snug text-orange-400">{t('health.hintDns')}</div>
        )}
      </div>
    </div>
  )
}

function ActionRow({
  label,
  icon,
  onClick,
  busy,
  danger,
}: {
  label: string
  icon: ReactNode
  onClick: () => void
  busy?: boolean
  danger?: boolean
}) {
  return (
    <button
      onClick={onClick}
      disabled={busy}
      className={cn(
        'flex w-full items-center gap-3 px-4 py-3.5 text-left text-sm font-medium transition-colors',
        danger ? 'text-red-400 hover:bg-red-500/5' : 'hover:bg-card2',
      )}
    >
      <span className={danger ? 'text-red-400' : 'text-accent'}>
        {busy ? <Loader2 size={18} className="animate-spin" /> : icon}
      </span>
      {label}
    </button>
  )
}

/** Web fallback, read from android/app/build.gradle at build time (vite.config)
 *  so it can't drift; on device the real installed versionName wins below. */
const BUILD_VERSION = __APP_VERSION__

export default function SettingsPage() {
  const t = useT()
  const nav = useNavigate()
  const settings = useSettings()
  const online = useOnline()
  const fileRef = useRef<HTMLInputElement>(null)
  const tvtimeRef = useRef<HTMLInputElement>(null)
  const [toast, setToast] = useState<string | null>(null)
  // authoritative on-device build number, so it's obvious which APK is running
  const [version, setVersion] = useState(BUILD_VERSION)
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return
    CapApp.getInfo()
      .then((i) => setVersion(`${i.version} (${i.build})`))
      .catch(() => {})
  }, [])
  const [busy, setBusy] = useState<string | null>(null)
  const [health, setHealth] = useState<ProviderHealth[] | null>(null)
  const [importProg, setImportProg] = useState<ImportProgress | null>(null)
  const [importResult, setImportResult] = useState<TvTimeImportResult | null>(null)
  useTour('settings', true)

  useEffect(() => {
    if (!toast) return
    const h = setTimeout(() => setToast(null), 2600)
    return () => clearTimeout(h)
  }, [toast])

  const run = async (key: string, fn: () => Promise<string | null>) => {
    setBusy(key)
    try {
      const msg = await fn()
      if (msg) setToast(msg)
    } catch (e) {
      // surface the REAL reason (access_denied, state-mismatch, cancelled,
      // token-exchange-failed…) so Google/Cloud misconfig is diagnosable
      setToast(
        e instanceof Error && e.message === 'missing-client-id'
          ? t('settings.needClientId')
          : e instanceof Error && e.message && e.message !== 'cancelled'
            ? `${t('common.error')}: ${e.message}`
            : t('common.error'),
      )
    } finally {
      setBusy(null)
    }
  }

  const onImportFile = async (file: File) => {
    const text = await file.text()
    if (!confirm(t('settings.importConfirm'))) return
    try {
      await applyBackup(text)
      setToast(t('settings.imported'))
    } catch {
      setToast(t('common.error'))
    }
  }

  const onTvTimeZip = async (file: File) => {
    // the import looks every title up on TMDB
    if (!serviceReady('tmdb', getSettings())) {
      setToast(t('tvtimport.needTmdb'))
      return
    }
    setImportResult(null)
    setImportProg({ done: 0, total: 1, label: '…' })
    try {
      const result = await importTvTimeZip(file, setImportProg)
      setImportResult(result)
    } catch (e) {
      setToast(
        e instanceof Error && e.message === 'unrecognized-format'
          ? t('tvtimport.invalid')
          : t('common.error'),
      )
    } finally {
      setImportProg(null)
    }
  }

  return (
    <div className="pb-10">
      <header className="flex items-center gap-3 px-4 pb-2 pt-safe">
        <button
          onClick={() => nav(-1)}
          aria-label="back"
          className="grid h-10 w-10 place-items-center rounded-xl border border-line text-ink2 transition-colors hover:border-accent hover:text-accent"
        >
          <ArrowLeft size={18} />
        </button>
        <h1 className="text-2xl font-extrabold tracking-tight">{t('settings.title')}</h1>
      </header>

      {/* the optional ratings key, suggested here until added or put off */}
      {guideDue('omdb', settings) && <KeyGuide service="omdb" className="mx-4 mt-4" />}

      <Section title={t('settings.language')}>
        <div className="flex gap-2 px-4 py-3.5">
          {(['en', 'it'] as Language[]).map((lang) => (
            <button
              key={lang}
              onClick={() => updateSettings({ language: lang })}
              className={cn(
                'flex-1 rounded-xl border py-2.5 text-sm font-bold transition-colors',
                settings.language === lang
                  ? 'border-accent bg-brand text-black'
                  : 'border-line text-ink2 hover:border-accent/50',
              )}
            >
              <Languages size={14} className="mr-1.5 inline-block" />
              {lang === 'en' ? t('settings.english') : t('settings.italian')}
            </button>
          ))}
        </div>
      </Section>

      <Section title={t('settings.theme')} tour="theme">
        <div className="grid grid-cols-4 gap-3 px-4 py-4">
          {THEMES.map((th) => (
            <button
              key={th.id}
              onClick={() => updateSettings({ theme: th.id })}
              className="flex flex-col items-center gap-1.5"
            >
              <span
                className={cn(
                  'relative grid h-12 w-full place-items-center overflow-hidden rounded-xl border-2 transition-all',
                  settings.theme === th.id ? 'border-accent' : 'border-line',
                )}
                style={{ background: th.vars.surface }}
              >
                <span
                  className="absolute left-1.5 top-1.5 h-1.5 w-6 rounded-full opacity-80"
                  style={{ background: th.vars.card2 }}
                />
                <span className="grid h-5 w-5 place-items-center rounded-md" style={{ background: th.vars.brand }}>
                  {settings.theme === th.id ? (
                    <Check size={12} strokeWidth={4} className="text-black" />
                  ) : th.light ? (
                    <Sun size={11} className="text-black" />
                  ) : (
                    <Moon size={11} className="text-black" />
                  )}
                </span>
              </span>
              <span
                className={cn(
                  'text-[10px] font-semibold',
                  settings.theme === th.id ? 'text-accent' : 'text-ink3',
                )}
              >
                {th.name[settings.language ?? 'en']}
              </span>
            </button>
          ))}
        </div>
      </Section>

      <Section title={t('settings.detailLayout')} tour="layout">
        <div className="flex gap-2 px-4 py-4">
          {(
            [
              ['classic', t('settings.layoutClassic')],
              ['poster', t('settings.layoutPoster')],
              ['immersive', t('settings.layoutImmersive')],
            ] as Array<[DetailLayout, string]>
          ).map(([id, label]) => (
            <button
              key={id}
              onClick={() => updateSettings({ detailLayout: id })}
              className={cn(
                'flex-1 rounded-xl border py-2.5 text-sm font-bold transition-colors',
                settings.detailLayout === id
                  ? 'border-accent bg-brand text-black'
                  : 'border-line text-ink2 hover:border-accent/50',
              )}
            >
              {label}
            </button>
          ))}
        </div>
      </Section>

      <Section title={t('settings.sections')} tour="sections">
        <ToggleRow
          label={t('settings.showBooks')}
          checked={settings.showBooks}
          onChange={(v) => updateSettings({ showBooks: v })}
        />
        <ToggleRow
          label={t('settings.showGames')}
          checked={settings.showGames}
          onChange={(v) => updateSettings({ showGames: v })}
        />
      </Section>

      {Capacitor.getPlatform() === 'android' && (
        <Section title={t('settings.widget')} tour="widget">
          <WidgetRow />
        </Section>
      )}

      <Section title={t('keys.section')} tour="keys">
        <p className="px-4 pt-3 text-xs text-ink3">{t('keys.sectionHint')}</p>
        {settings.showBooks && <KeyRow service="comicvine" />}
        <KeyRow service="omdb" />
      </Section>

      {/* TMDB and IGDB work out of the box (the gateway's own keys); a user's
          own key is the way round a slow or busy shared one */}
      <Section title={t('keys.ownSection')}>
        <p className="px-4 pt-3 text-xs text-ink3">{t('keys.ownHint')}</p>
        <KeyRow service="tmdb" />
        {settings.showGames && <KeyRow service="igdb" />}
      </Section>

      {/* diagnostics: which providers answer right now, and why they don't */}
      <Section title={t('settings.diagnostics')}>
        {/* every check below needs the network — say so instead of reporting
            every provider as unreachable */}
        {!online && (
          <div className="px-4 pb-3">
            <OfflineChip />
          </div>
        )}
        <ActionRow
          label={t('settings.checkProviders')}
          icon={<Activity size={18} />}
          busy={busy === 'health'}
          onClick={() =>
            run('health', async () => {
              setHealth(await checkProviders())
              return null
            })
          }
        />
        {health?.map((h) => (
          <HealthRow key={h.id} h={h} />
        ))}
      </Section>

      <Section title={t('settings.google')} tour="google">
        {!online && (
          <div className="px-4 pb-3">
            <OfflineChip text={t('offline.driveHint')} />
          </div>
        )}
        {settings.googleEmail ? (
          <>
            <div className="flex items-center gap-3 px-4 py-3.5">
              {settings.googlePicture && (
                <img
                  src={settings.googlePicture}
                  alt=""
                  referrerPolicy="no-referrer"
                  className="h-8 w-8 rounded-xl"
                />
              )}
              <div className="min-w-0 flex-1">
                <div className="text-[11px] text-ink3">{t('settings.connected')}</div>
                <div className="truncate text-sm font-medium">{settings.googleEmail}</div>
              </div>
              <button
                onClick={() => disconnectGoogle()}
                className="flex items-center gap-1.5 rounded-lg border border-line px-3 py-1.5 text-xs font-semibold text-ink2 transition-colors hover:border-red-500 hover:text-red-400"
              >
                <LogOut size={13} /> {t('settings.disconnect')}
              </button>
            </div>
            {/* auto-backup is silent by design, so this line is the only way
                to tell a working sync from one that has been failing */}
            <div className="px-4 pb-3 text-[11px]">
              <span className="text-ink3">{t('settings.lastBackup')}: </span>
              {settings.lastBackupAt ? (
                <span className="font-semibold text-ink2">
                  {new Date(settings.lastBackupAt).toLocaleString(
                    settings.language === 'it' ? 'it-IT' : 'en-GB',
                  )}
                </span>
              ) : (
                <span className="font-semibold text-ink3">{t('settings.backupNever')}</span>
              )}
              {settings.lastBackupError && (
                <div className="mt-0.5 text-red-400">{t('settings.backupFailing')}</div>
              )}
            </div>
            <ActionRow
              label={t('settings.saveDrive')}
              icon={<CloudUpload size={18} />}
              busy={busy === 'save'}
              onClick={() =>
                run('save', async () => {
                  // pulls the other device's changes in before pushing
                  await syncDrive(true)
                  return t('settings.driveSaved')
                })
              }
            />
            <ActionRow
              label={t('settings.restoreDrive')}
              icon={<CloudDownload size={18} />}
              busy={busy === 'restore'}
              onClick={() =>
                run('restore', async () => {
                  const json = await restoreFromDrive()
                  if (!json) return t('settings.driveEmpty')
                  if (!confirm(t('settings.restoreConfirm'))) return null
                  await applyBackup(json)
                  return t('settings.driveRestored')
                })
              }
            />
          </>
        ) : (
          <ActionRow
            label={t('settings.connect')}
            icon={<Cloud size={18} />}
            busy={busy === 'connect'}
            onClick={() =>
              run('connect', async () => {
                await connectGoogle()
                // fresh install (nothing tracked yet) → pull the cloud backup
                // automatically; never clobber a library that already has data
                if ((await db.items.count()) === 0) {
                  const json = await restoreFromDrive()
                  if (json) {
                    await applyBackup(json)
                    return t('settings.driveRestored')
                  }
                }
                return null
              })
            }
          />
        )}
      </Section>

      <Section title={t('tvtimport.title')}>
        {importProg ? (
          <div className="px-4 py-4">
            <div className="flex items-center gap-3">
              <Loader2 size={18} className="animate-spin text-accent" />
              <span className="min-w-0 flex-1 truncate text-sm font-medium">
                {importProg.label}
              </span>
              <span className="text-xs text-ink3">
                {importProg.done}/{importProg.total}
              </span>
            </div>
            <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-card2">
              <div
                className="h-full rounded-full bg-brand transition-all"
                style={{
                  width: `${Math.round((importProg.done / Math.max(1, importProg.total)) * 100)}%`,
                }}
              />
            </div>
          </div>
        ) : (
          <>
            <ActionRow
              label={t('tvtimport.action')}
              icon={<Tv size={18} />}
              onClick={() => tvtimeRef.current?.click()}
            />
            <div className="px-4 pb-3 pt-1 text-[11px] text-ink4">{t('tvtimport.hint')}</div>
          </>
        )}
        {importResult && (
          <div className="border-t border-line px-4 py-3 text-sm">
            <span className="font-bold text-accent">{t('tvtimport.done')}: </span>
            {importResult.shows} {t('nav.series').toLowerCase()} | {importResult.episodes}{' '}
            {t('common.episodes')} · {importResult.movies} {t('nav.movies').toLowerCase()}
            {importResult.skipped.length > 0 && (
              <div className="mt-1 text-xs text-ink3">
                {importResult.skipped.length} {t('tvtimport.skipped')}:{' '}
                {importResult.skipped.slice(0, 8).join(', ')}
                {importResult.skipped.length > 8 && '…'}
              </div>
            )}
          </div>
        )}
        <input
          ref={tvtimeRef}
          type="file"
          accept=".zip,application/zip"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0]
            if (f) onTvTimeZip(f)
            e.target.value = ''
          }}
        />
      </Section>

      <Section title={t('settings.data')}>
        <ActionRow
          label={t('settings.export')}
          icon={<Download size={18} />}
          onClick={() =>
            run('export', async () => {
              const where = await downloadBackup(await buildBackup())
              return where === 'saved' ? t('settings.exportSaved') : null
            })
          }
        />
        <ActionRow
          label={t('settings.import')}
          icon={<Upload size={18} />}
          onClick={() => fileRef.current?.click()}
        />
        <ActionRow
          label={t('settings.clear')}
          icon={<Trash2 size={18} />}
          danger
          onClick={() =>
            run('clear', async () => {
              if (!confirm(t('settings.clearConfirm'))) return null
              await Promise.all([
                db.items.clear(),
                db.episodes.clear(),
                db.episodeCache.clear(),
                db.clashes.clear(),
              ])
              // the offline artwork belongs to those items — it goes with them
              await clearImageCache()
              // a fresh start earns its medals again, pop-ups included
              resetAchievementState()
              return null
            })
          }
        />
        <input
          ref={fileRef}
          type="file"
          accept="application/json"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0]
            if (f) onImportFile(f)
            e.target.value = ''
          }}
        />
      </Section>

      {/* the providers' attribution now lives in full on the About screen,
          which is where TMDB's terms ask for it (an About/Credits section) */}
      <Section title={t('settings.help')} tour="help">
        <ActionRow label={t('help.entry')} icon={<LifeBuoy size={18} />} onClick={() => nav('/help')} />
        <ToggleRow
          label={t('help.toursOn')}
          checked={!settings.toursOff}
          onChange={(v) => updateSettings({ toursOff: !v })}
        />
      </Section>

      <Section title={t('about.title')}>
        <ActionRow
          label={t('settings.about')}
          icon={<Info size={18} />}
          onClick={() => nav('/about')}
        />
      </Section>

      <div className="mt-6 text-center font-mono text-xs text-ink4">v{version}</div>

      {toast && (
        <div className="fixed bottom-24 left-1/2 z-50 -translate-x-1/2 rounded-xl bg-brand px-5 py-2.5 text-sm font-bold text-black shadow-2xl md:bottom-10">
          {toast}
        </div>
      )}
    </div>
  )
}
