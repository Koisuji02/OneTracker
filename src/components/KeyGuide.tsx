/**
 * The guide that gets a user their own key for one service (src/keys.ts).
 *
 * Shown where the key is needed — on top of Serie TV / Film (TMDB), Giochi
 * (IGDB), Libri (Comic Vine, optional), in Settings (OMDb, optional) and on a
 * detail page that can't load — and as the editor of each key in Settings.
 *
 * The flow, all from the phone: a few numbered steps, then a button in the
 * SERVICE's colours (so it is clear where it goes) that opens the key page.
 * Back in the app the button has turned into the field to paste the key in;
 * "Collega" checks it against the service before saving. "Apri dal computer"
 * is the extra help for the forms that are easier on a computer: a QR code,
 * the link, and a way to send the link to yourself.
 */
import { Share } from '@capacitor/share'
import { Check, Copy, ExternalLink, KeyRound, Loader2, Monitor, Share2, X } from 'lucide-react'
import { useMemo, useState } from 'react'
import { renderSVG } from 'uqr'
import { verifyKey } from '../api/keys'
import { useT } from '../i18n'
import { KEY_SERVICES, hasKey, type KeyService } from '../keys'
import { getSettings, updateSettings, useSettings } from '../settings'
import { cn, openExternal } from '../util'

const OPENED_KEY = 'onetracker.keyGuides'

/** Guides whose site was opened: back in the app they show the field at once. */
function wasOpened(service: KeyService): boolean {
  try {
    return (JSON.parse(localStorage.getItem(OPENED_KEY) ?? '[]') as string[]).includes(service)
  } catch {
    return false
  }
}

function markOpened(service: KeyService): void {
  try {
    const list = JSON.parse(localStorage.getItem(OPENED_KEY) ?? '[]') as string[]
    localStorage.setItem(OPENED_KEY, JSON.stringify([...new Set([...list, service])]))
  } catch {
    // storage blocked: the field simply shows after the tap, as usual
  }
}

/** The service's colours on a small square, the same chip in guide and Settings. */
export function KeyMark({ service, size = 40 }: { service: KeyService; size?: number }) {
  const def = KEY_SERVICES[service]
  return (
    <span
      className="grid shrink-0 place-items-center rounded-xl"
      style={{ width: size, height: size, background: def.bg, color: def.fg }}
    >
      <KeyRound size={Math.round(size * 0.45)} strokeWidth={2.4} />
    </span>
  )
}

interface KeyGuideProps {
  service: KeyService
  /** Settings: start on the field, filled with the saved key, with "Scollega" */
  editing?: boolean
  /** called once the key is saved (Settings closes its row) */
  onSaved?: () => void
  /** "Non ora" for an optional service; off where the key is the only way on */
  dismissable?: boolean
  className?: string
}

export default function KeyGuide({ service, editing = false, onSaved, dismissable, className }: KeyGuideProps) {
  const t = useT()
  const settings = useSettings()
  const def = KEY_SERVICES[service]
  const [entering, setEntering] = useState(() => editing || wasOpened(service))
  const [values, setValues] = useState(() => def.fields.map((f) => (editing ? settings[f.field] : '')))
  const [state, setState] = useState<'idle' | 'checking' | 'bad' | 'unverified' | 'saved'>('idle')
  const [desk, setDesk] = useState(false)
  const [copied, setCopied] = useState(false)
  const qr = useMemo(() => (desk ? renderSVG(def.url, { border: 1 }) : ''), [desk, def.url])

  const filled = values.every((v) => v.trim().length > 0)

  const save = () => {
    updateSettings(Object.fromEntries(def.fields.map((f, i) => [f.field, values[i].trim()])))
    setState('saved')
    onSaved?.()
  }

  const apply = async () => {
    if (!filled || state === 'checking') return
    setState('checking')
    const result = await verifyKey(service, values)
    if (result === 'ok') save()
    else setState(result === 'badkey' ? 'bad' : 'unverified')
  }

  const open = () => {
    markOpened(service)
    setEntering(true)
    void openExternal(def.url)
  }

  const shareLink = async () => {
    try {
      await Share.share({ url: def.url })
    } catch {
      // closed the sheet, or no share target: copying is right next to it
    }
  }

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(def.url)
      setCopied(true)
      setTimeout(() => setCopied(false), 1600)
    } catch {
      // no clipboard access: the link is on screen to type
    }
  }

  const remove = () => {
    updateSettings(Object.fromEntries(def.fields.map((f) => [f.field, ''])))
    setValues(def.fields.map(() => ''))
    setState('idle')
  }

  const linkBtn = 'flex items-center gap-1.5 text-xs font-semibold text-ink3 transition-colors hover:text-accent'

  return (
    <div className={cn('rounded-2xl border border-line bg-card p-4', className)}>
      <div className="flex items-start gap-3">
        <KeyMark service={service} />
        <div className="min-w-0 flex-1">
          <div className="text-base font-extrabold leading-tight">{t(`keys.${service}.title`)}</div>
          <div className="mt-0.5 text-xs text-ink3">{t(`keys.${service}.what`)}</div>
        </div>
        {(dismissable ?? def.optional) && !editing && (
          <button
            onClick={() => updateSettings({ dismissedGuides: [...getSettings().dismissedGuides, service] })}
            aria-label={t('keys.later')}
            className="-mr-1 -mt-1 flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-semibold text-ink3 hover:text-ink"
          >
            {t('keys.later')} <X size={14} />
          </button>
        )}
      </div>

      {!editing && <p className="mt-3 text-sm leading-relaxed text-ink2">{t(`keys.${service}.lead`)}</p>}

      <ol className="mt-3 space-y-2">
        {Array.from({ length: def.steps }, (_, i) => (
          <li key={i} className="flex gap-2.5 text-sm leading-snug text-ink2">
            <span className="grid h-5 w-5 shrink-0 place-items-center rounded-md bg-card2 text-[11px] font-bold text-ink">
              {i + 1}
            </span>
            <span>{t(`keys.${service}.step${i + 1}`)}</span>
          </li>
        ))}
      </ol>

      {!entering ? (
        <>
          <button
            onClick={open}
            className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl py-3 text-sm font-bold transition-transform active:scale-[0.99]"
            style={{ background: def.bg, color: def.fg }}
          >
            <ExternalLink size={16} /> {t('keys.open').replace('{name}', def.name)}
          </button>
          <div className="mt-3 flex items-center justify-between">
            <button onClick={() => setEntering(true)} className={linkBtn}>
              <KeyRound size={14} /> {t('keys.haveIt')}
            </button>
            <button onClick={() => setDesk((d) => !d)} className={linkBtn}>
              <Monitor size={14} /> {t('keys.desktop')}
            </button>
          </div>
        </>
      ) : (
        <>
          <div className="mt-4 space-y-2.5">
            {def.fields.map((f, i) => (
              <label key={f.field} className="block">
                <span className="text-xs font-semibold text-ink3">{t(f.label)}</span>
                <input
                  value={values[i]}
                  onChange={(e) => {
                    const next = [...values]
                    next[i] = e.target.value
                    setValues(next)
                    if (state !== 'checking') setState('idle')
                  }}
                  placeholder={f.placeholder}
                  spellCheck={false}
                  autoCapitalize="off"
                  autoCorrect="off"
                  className="mt-1 w-full rounded-xl border border-line bg-surface px-3 py-2.5 font-mono text-xs outline-none transition-colors placeholder:text-ink4 focus:border-accent"
                />
              </label>
            ))}
          </div>

          {state === 'bad' && <p className="mt-2 text-xs font-semibold text-red-400">{t(`keys.${service}.bad`)}</p>}
          {state === 'unverified' && (
            <p className="mt-2 text-xs text-ink2">
              {t('keys.unverified')}{' '}
              <button onClick={save} className="font-bold text-accent">
                {t('keys.saveAnyway')}
              </button>
            </p>
          )}
          {state === 'saved' && editing && (
            <p className="mt-2 flex items-center gap-1.5 text-xs font-semibold text-accent">
              <Check size={14} /> {t('keys.saved')}
            </p>
          )}

          <button
            onClick={() => void apply()}
            disabled={!filled || state === 'checking'}
            className={cn(
              'mt-3 flex w-full items-center justify-center gap-2 rounded-xl py-3 text-sm font-bold transition-transform active:scale-[0.99]',
              filled ? 'bg-brand text-black' : 'bg-card2 text-ink4',
            )}
          >
            {state === 'checking' ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />}
            {t(state === 'checking' ? 'keys.checking' : 'keys.apply')}
          </button>

          <div className="mt-3 flex items-center justify-between">
            <button onClick={open} className={linkBtn}>
              <ExternalLink size={14} /> {t('keys.reopen').replace('{name}', def.name)}
            </button>
            {editing && hasKey(service, settings) ? (
              <button onClick={remove} className="text-xs font-semibold text-red-400">
                {t('keys.remove')}
              </button>
            ) : (
              <button onClick={() => setDesk((d) => !d)} className={linkBtn}>
                <Monitor size={14} /> {t('keys.desktop')}
              </button>
            )}
          </div>
        </>
      )}

      {desk && (
        <div className="mt-4 flex items-center gap-4 rounded-xl border border-line bg-surface p-3">
          {/* a QR needs a light field to scan, whatever the theme */}
          <div className="h-28 w-28 shrink-0 rounded-lg bg-white p-1.5" dangerouslySetInnerHTML={{ __html: qr }} />
          <div className="min-w-0 flex-1">
            <p className="text-xs leading-snug text-ink2">{t('keys.desktopHint')}</p>
            <p className="mt-1.5 break-all font-mono text-[11px] text-ink3">{def.url}</p>
            <div className="mt-2 flex gap-3">
              <button onClick={() => void copyLink()} className={linkBtn}>
                {copied ? <Check size={14} /> : <Copy size={14} />} {t(copied ? 'keys.copied' : 'keys.copy')}
              </button>
              <button onClick={() => void shareLink()} className={linkBtn}>
                <Share2 size={14} /> {t('keys.send')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
