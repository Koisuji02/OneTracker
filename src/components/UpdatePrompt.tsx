/**
 * "Nuova versione disponibile": when Google Play has a newer build than the one
 * running, a sheet offers it each time the app is opened.
 *
 * - Aggiorna: Play's own full-screen update when it allows one, otherwise the
 *   app's page on the Play Store.
 * - Ricordamelo: closes the sheet; it comes back on the next opening (a cold
 *   start, or a return after half an hour in the background).
 *
 * Android only, and only for a copy installed from Play: the check fails
 * quietly on a sideloaded APK, on the web (always the latest build) and on
 * iPhone (not on the App Store yet).
 */
import { App as CapApp } from '@capacitor/app'
import { Capacitor } from '@capacitor/core'
import { AppUpdate, AppUpdateAvailability } from '@capawesome/capacitor-app-update'
import { Download } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useBackInterceptor } from '../back'
import { useT } from '../i18n'

/** a return to the app after this long in the background counts as a new opening */
const REOPEN_MS = 30 * 60 * 1000

async function updateReady(): Promise<{ immediate: boolean } | null> {
  try {
    const info = await AppUpdate.getAppUpdateInfo()
    if (info.updateAvailability !== AppUpdateAvailability.UPDATE_AVAILABLE) return null
    return { immediate: !!info.immediateUpdateAllowed }
  } catch {
    // not installed from Play (debug APK, sideload) or Play unreachable
    return null
  }
}

export default function UpdatePrompt() {
  const t = useT()
  const [update, setUpdate] = useState<{ immediate: boolean } | null>(null)
  const hiddenAt = useRef(0)

  useEffect(() => {
    if (Capacitor.getPlatform() !== 'android') return
    const check = () => void updateReady().then(setUpdate)
    check()
    const sub = CapApp.addListener('appStateChange', ({ isActive }) => {
      if (!isActive) hiddenAt.current = Date.now()
      else if (hiddenAt.current && Date.now() - hiddenAt.current >= REOPEN_MS) check()
    })
    return () => {
      sub.then((s) => s.remove())
    }
  }, [])

  const later = () => setUpdate(null)
  useBackInterceptor(update != null, later)

  if (!update) return null

  const install = async () => {
    const immediate = update.immediate
    setUpdate(null)
    try {
      if (immediate) await AppUpdate.performImmediateUpdate()
      else await AppUpdate.openAppStore()
    } catch {
      // Play's flow refused (or was cancelled): the store page always works
      await AppUpdate.openAppStore().catch(() => {})
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-[110] flex items-end justify-center bg-black/60 sm:items-center"
      onClick={later}
    >
      <div
        className="fade-up pb-safe-sheet w-full max-w-sm rounded-t-3xl border border-line bg-card p-5 text-center sm:rounded-3xl"
        onClick={(e) => e.stopPropagation()}
      >
        <span className="mx-auto grid h-12 w-12 place-items-center rounded-xl bg-brand text-black">
          <Download size={22} strokeWidth={2.5} />
        </span>
        <div className="mt-3 text-lg font-extrabold">{t('update.title')}</div>
        <p className="mt-1 text-sm leading-relaxed text-ink2">{t('update.body')}</p>
        <div className="mt-5 flex flex-col gap-2.5">
          <button
            onClick={() => void install()}
            className="rounded-2xl bg-brand py-3 text-sm font-bold text-black transition-transform active:scale-95"
          >
            {t('update.install')}
          </button>
          <button
            onClick={later}
            className="rounded-2xl border border-line py-3 text-sm font-bold text-ink2 transition-colors hover:border-accent hover:text-accent"
          >
            {t('update.later')}
          </button>
        </div>
      </div>
    </div>
  )
}
