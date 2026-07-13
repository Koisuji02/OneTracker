/**
 * First-run wizard, 4 steps:
 * 1. language (EN default / IT)
 * 2. Books opt-in (tracks novels, comics, manga — changeable later)
 * 3. Games opt-in
 * 4. account: continue as Guest (local-only data) or connect Google —
 *    the library is backed up to Drive and, on a new device, automatically
 *    restored right here when a saved profile is found.
 */
import { BookOpen, Cloud, Gamepad2, Loader2, UserRound } from 'lucide-react'
import { useState } from 'react'
import type { ReactNode } from 'react'
import { applyBackup, buildBackup } from '../backup'
import { connectGoogle, restoreFromDrive, saveToDrive } from '../drive'
import { translate, useT } from '../i18n'
import { updateSettings, useSettings, type Language } from '../settings'
import { cn } from '../util'

function StepDots({ step }: { step: number }) {
  return (
    <div className="flex justify-center gap-2">
      {[0, 1, 2, 3].map((i) => (
        <span
          key={i}
          className={cn(
            'h-1.5 rounded-full transition-all',
            i === step ? 'w-6 bg-brand' : 'w-1.5 bg-line',
          )}
        />
      ))}
    </div>
  )
}

/** Decorated hero icon for the opt-in pages (proper icon, not an emoji). */
function HeroIcon({ children }: { children: ReactNode }) {
  return (
    <div className="relative">
      <div
        className="absolute inset-0 scale-150 rounded-full opacity-30 blur-2xl"
        style={{ background: 'var(--brand)' }}
      />
      <div className="relative grid h-28 w-28 place-items-center rounded-[2rem] border border-line bg-card">
        <span className="text-accent">{children}</span>
      </div>
    </div>
  )
}

function OptInStep({
  icon,
  title,
  body,
  onChoice,
}: {
  icon: ReactNode
  title: string
  body: string
  onChoice: (enabled: boolean) => void
}) {
  const t = useT()
  return (
    <>
      <HeroIcon>{icon}</HeroIcon>
      <div className="px-2">
        <h1 className="text-2xl font-extrabold tracking-tight">{title}</h1>
        <p className="mt-2 text-sm leading-relaxed text-ink3">{body}</p>
      </div>
      <div className="flex w-full max-w-xs flex-col gap-3">
        <button
          onClick={() => onChoice(true)}
          className="rounded-full bg-brand py-3.5 font-bold text-black transition-transform active:scale-95"
        >
          {t('wizard.enable')}
        </button>
        <button
          onClick={() => onChoice(false)}
          className="rounded-full border border-line py-3.5 font-bold text-ink2 transition-colors hover:border-accent hover:text-accent"
        >
          {t('wizard.skip')}
        </button>
        <p className="text-xs text-ink4">{t('wizard.changeLater')}</p>
      </div>
    </>
  )
}

export default function OnboardingPage() {
  const t = useT()
  const settings = useSettings()
  const [step, setStep] = useState(settings.language ? 1 : 0)
  const [googleState, setGoogleState] = useState<'idle' | 'busy' | 'restored' | 'error'>('idle')

  const finish = () => updateSettings({ onboarded: true })

  const onGoogle = async () => {
    setGoogleState('busy')
    try {
      await connectGoogle()
      const saved = await restoreFromDrive()
      if (saved) {
        await applyBackup(saved)
        setGoogleState('restored')
        setTimeout(finish, 1200)
        return
      }
      // no cloud profile yet: create it right away (best-effort)
      saveToDrive(await buildBackup()).catch(() => {})
      finish()
    } catch {
      setGoogleState('error')
    }
  }

  return (
    <div className="flex min-h-full flex-col items-center justify-center gap-8 px-6 py-10 text-center">
      {step === 0 && (
        <>
          <HeroIcon>
            <svg viewBox="0 0 64 64" className="h-14 w-14">
              <rect x="10" y="16" width="44" height="30" rx="6" fill="none" stroke="currentColor" strokeWidth="4" />
              <path d="M22 52h20" stroke="currentColor" strokeWidth="4" strokeLinecap="round" />
              <path d="M27 25l12 6-12 6z" fill="currentColor" />
            </svg>
          </HeroIcon>
          <div>
            <h1 className="text-3xl font-extrabold tracking-tight">
              {translate('en', 'firstRun.welcome')}
            </h1>
            <p className="mt-2 text-ink3">{translate('en', 'firstRun.subtitle')}</p>
          </div>
          <div className="w-full max-w-xs">
            <p className="mb-3 text-xs font-bold uppercase tracking-wider text-ink3">
              {translate('en', 'firstRun.choose')} / {translate('it', 'firstRun.choose')}
            </p>
            <div className="flex flex-col gap-3">
              {(
                [
                  ['en', 'English', '🇬🇧'],
                  ['it', 'Italiano', '🇮🇹'],
                ] as Array<[Language, string, string]>
              ).map(([lang, label, flag]) => (
                <button
                  key={lang}
                  onClick={() => {
                    updateSettings({ language: lang })
                    setStep(1)
                  }}
                  className="flex items-center justify-center gap-2.5 rounded-full border border-line bg-card py-3.5 font-bold transition-colors hover:border-accent hover:text-accent"
                >
                  <span className="text-lg">{flag}</span> {label}
                </button>
              ))}
            </div>
          </div>
        </>
      )}

      {step === 1 && (
        <OptInStep
          icon={<BookOpen size={56} strokeWidth={1.8} />}
          title={t('wizard.booksTitle')}
          body={t('wizard.booksBody')}
          onChoice={(enabled) => {
            updateSettings({ showBooks: enabled })
            setStep(2)
          }}
        />
      )}

      {step === 2 && (
        <OptInStep
          icon={<Gamepad2 size={56} strokeWidth={1.8} />}
          title={t('wizard.gamesTitle')}
          body={t('wizard.gamesBody')}
          onChoice={(enabled) => {
            updateSettings({ showGames: enabled })
            setStep(3)
          }}
        />
      )}

      {step === 3 && (
        <>
          <HeroIcon>
            <Cloud size={56} strokeWidth={1.8} />
          </HeroIcon>
          <div className="px-2">
            <h1 className="text-2xl font-extrabold tracking-tight">{t('wizard.accountTitle')}</h1>
          </div>
          {googleState === 'busy' ? (
            <div className="flex flex-col items-center gap-3">
              <Loader2 size={28} className="animate-spin text-accent" />
              <p className="text-sm text-ink3">{t('wizard.restoring')}</p>
            </div>
          ) : googleState === 'restored' ? (
            <p className="font-bold text-accent">{t('wizard.restored')}</p>
          ) : (
            <div className="flex w-full max-w-xs flex-col gap-3">
              <button
                onClick={onGoogle}
                className="rounded-2xl bg-brand p-4 text-left transition-transform active:scale-95"
              >
                <span className="flex items-center gap-2 font-bold text-black">
                  <Cloud size={18} /> {t('wizard.google')}
                </span>
                <span className="mt-1 block text-xs leading-relaxed text-black/70">
                  {t('wizard.googleBody')}
                </span>
              </button>
              <button
                onClick={finish}
                className="rounded-2xl border border-line bg-card p-4 text-left transition-colors hover:border-accent"
              >
                <span className="flex items-center gap-2 font-bold">
                  <UserRound size={18} className="text-accent" /> {t('wizard.guest')}
                </span>
                <span className="mt-1 block text-xs leading-relaxed text-ink3">
                  {t('wizard.guestBody')}
                </span>
              </button>
              {googleState === 'error' && (
                <p className="text-xs text-red-400">{t('common.error')}</p>
              )}
            </div>
          )}
        </>
      )}

      <StepDots step={step} />
    </div>
  )
}
