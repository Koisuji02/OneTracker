import {
  ArrowLeft,
  Check,
  Cloud,
  CloudDownload,
  CloudUpload,
  Download,
  KeyRound,
  Languages,
  Loader2,
  LogOut,
  Moon,
  Sun,
  Trash2,
  Tv,
  Upload,
} from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { applyBackup, buildBackup, downloadBackup } from '../backup'
import { db } from '../db'
import { connectGoogle, disconnectGoogle, restoreFromDrive, saveToDrive } from '../drive'
import { importTvTimeZip, type ImportProgress, type TvTimeImportResult } from '../importTvTime'
import { useT } from '../i18n'
import { ENV_DEFAULTS, updateSettings, useSettings, type Language } from '../settings'
import { THEMES } from '../themes'
import { cn } from '../util'

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mt-6 px-4">
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

function InputRow({
  label,
  hint,
  value,
  onChange,
  placeholder,
}: {
  label: string
  hint?: string
  value: string
  onChange: (v: string) => void
  placeholder?: string
}) {
  return (
    <div className="px-4 py-3.5">
      <div className="text-sm font-medium">{label}</div>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        spellCheck={false}
        className="mt-1.5 w-full rounded-xl border border-line bg-surface px-3 py-2 font-mono text-xs outline-none transition-colors placeholder:text-ink4 focus:border-accent"
      />
      {hint && <div className="mt-1.5 text-[11px] text-ink4">{hint}</div>}
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

export default function SettingsPage() {
  const t = useT()
  const nav = useNavigate()
  const settings = useSettings()
  const fileRef = useRef<HTMLInputElement>(null)
  const tvtimeRef = useRef<HTMLInputElement>(null)
  const [toast, setToast] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [importProg, setImportProg] = useState<ImportProgress | null>(null)
  const [importResult, setImportResult] = useState<TvTimeImportResult | null>(null)

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
      setToast(
        e instanceof Error && e.message === 'missing-client-id'
          ? t('settings.needClientId')
          : t('common.error'),
      )
    } finally {
      setBusy(null)
    }
  }

  /** Baked default keys stay hidden: empty field = default in use, typing overrides. */
  const keyProps = (field: keyof typeof ENV_DEFAULTS, ph: string) => ({
    value:
      ENV_DEFAULTS[field] && settings[field] === ENV_DEFAULTS[field] ? '' : settings[field],
    onChange: (v: string) => updateSettings({ [field]: v.trim() || ENV_DEFAULTS[field] }),
    placeholder: ENV_DEFAULTS[field] ? t('settings.defaultKeyActive') : ph,
  })

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
          className="grid h-10 w-10 place-items-center rounded-full border border-line text-ink2 transition-colors hover:border-accent hover:text-accent"
        >
          <ArrowLeft size={18} />
        </button>
        <h1 className="text-2xl font-extrabold tracking-tight">{t('settings.title')}</h1>
      </header>

      <Section title={t('settings.language')}>
        <div className="flex gap-2 px-4 py-3.5">
          {(['en', 'it'] as Language[]).map((lang) => (
            <button
              key={lang}
              onClick={() => updateSettings({ language: lang })}
              className={cn(
                'flex-1 rounded-full border py-2.5 text-sm font-bold transition-colors',
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

      <Section title={t('settings.theme')}>
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
                <span className="grid h-5 w-5 place-items-center rounded-full" style={{ background: th.vars.brand }}>
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

      <Section title={t('settings.sections')}>
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

      <Section title={t('settings.apiKeys')}>
        <InputRow
          label={t('settings.tmdbKey')}
          hint={t('settings.tmdbHint')}
          {...keyProps('tmdbKey', 'eyJhbGciOi… / 32-char v3 key')}
        />
        <InputRow
          label={t('settings.omdbKey')}
          hint={t('settings.omdbHint')}
          {...keyProps('omdbKey', 'abc12345')}
        />
        {settings.showGames && (
          <InputRow
            label={t('settings.rawgKey')}
            hint={t('settings.rawgHint')}
            {...keyProps('rawgKey', '0123456789abcdef…')}
          />
        )}
        {settings.showBooks && (
          <InputRow
            label={t('settings.comicvineKey')}
            hint={t('settings.comicvineHint')}
            {...keyProps('comicvineKey', '0123456789abcdef…')}
          />
        )}
      </Section>

      <Section title={t('settings.google')}>
        <InputRow
          label={t('settings.clientId')}
          hint={t('settings.clientIdHint')}
          {...keyProps('googleClientId', '1234567890-xxxx.apps.googleusercontent.com')}
        />
        {settings.googleEmail ? (
          <>
            <div className="flex items-center gap-3 px-4 py-3.5">
              {settings.googlePicture && (
                <img
                  src={settings.googlePicture}
                  alt=""
                  referrerPolicy="no-referrer"
                  className="h-8 w-8 rounded-full"
                />
              )}
              <div className="min-w-0 flex-1">
                <div className="text-[11px] text-ink3">{t('settings.connected')}</div>
                <div className="truncate text-sm font-medium">{settings.googleEmail}</div>
              </div>
              <button
                onClick={() => disconnectGoogle()}
                className="flex items-center gap-1.5 rounded-full border border-line px-3 py-1.5 text-xs font-semibold text-ink2 transition-colors hover:border-red-500 hover:text-red-400"
              >
                <LogOut size={13} /> {t('settings.disconnect')}
              </button>
            </div>
            <ActionRow
              label={t('settings.saveDrive')}
              icon={<CloudUpload size={18} />}
              busy={busy === 'save'}
              onClick={() =>
                run('save', async () => {
                  await saveToDrive(await buildBackup())
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
            {importResult.shows} {t('nav.series').toLowerCase()} · {importResult.episodes}{' '}
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
              downloadBackup(await buildBackup())
              return null
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
              await Promise.all([db.items.clear(), db.episodes.clear(), db.episodeCache.clear()])
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

      <div className="mt-8 flex items-center justify-center gap-1.5 text-xs text-ink4">
        <KeyRound size={12} />
        OneTracker — TMDB • AniList • Open Library • RAWG
      </div>

      {toast && (
        <div className="fixed bottom-24 left-1/2 z-50 -translate-x-1/2 rounded-full bg-brand px-5 py-2.5 text-sm font-bold text-black shadow-2xl md:bottom-10">
          {toast}
        </div>
      )}
    </div>
  )
}
