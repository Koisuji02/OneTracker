/**
 * Settings → Guida: the whole app in one page, for whoever wants to look
 * something up later. One card per screen with "Mostra il tutorial" (it opens
 * that screen and its first-visit tour runs again, see src/tours.ts), then the
 * things worth knowing that live across screens (keys, backup, TV Time, the
 * monthly recap, the widget).
 */
import { Capacitor } from '@capacitor/core'
import {
  ArrowLeft,
  BookOpen,
  CalendarDays,
  CirclePlay,
  Clapperboard,
  Cloud,
  Gamepad2,
  Import,
  KeyRound,
  Layers,
  RotateCcw,
  Search,
  Settings,
  Smartphone,
  Tv,
  UserRound,
} from 'lucide-react'
import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { useT } from '../i18n'
import { useSettings } from '../settings'
import { replayAllTours, replayTour, type TourId } from '../tours'

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mt-6 px-4">
      <h2 className="mb-2 px-1 text-xs font-bold uppercase tracking-wider text-ink3">{title}</h2>
      <div className="space-y-2.5">{children}</div>
    </section>
  )
}

function Card({
  icon,
  title,
  body,
  children,
}: {
  icon: ReactNode
  title: string
  body: string
  children?: ReactNode
}) {
  return (
    <div className="rounded-2xl border border-line bg-card p-4">
      <div className="flex items-start gap-3">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-brand/10 text-accent">
          {icon}
        </span>
        <div className="min-w-0 flex-1">
          <div className="font-bold leading-tight">{title}</div>
          <p className="mt-1 text-xs leading-relaxed text-ink2">{body}</p>
        </div>
      </div>
      {children}
    </div>
  )
}

export default function HelpPage() {
  const t = useT()
  const nav = useNavigate()
  const { language, showBooks, showGames } = useSettings()
  const [toast, setToast] = useState<string | null>(null)

  useEffect(() => {
    if (!toast) return
    const h = setTimeout(() => setToast(null), 2600)
    return () => clearTimeout(h)
  }, [toast])

  const screens: Array<{ id: TourId; route: string | null; icon: ReactNode; show?: boolean }> = [
    { id: 'series', route: '/series', icon: <Tv size={18} /> },
    { id: 'movies', route: '/movies', icon: <Clapperboard size={18} /> },
    { id: 'books', route: '/books', icon: <BookOpen size={18} />, show: showBooks },
    { id: 'games', route: '/games', icon: <Gamepad2 size={18} />, show: showGames },
    { id: 'search', route: '/search', icon: <Search size={18} /> },
    { id: 'account', route: '/account', icon: <UserRound size={18} /> },
    // a title page needs a title: its tour waits for the next one opened
    { id: 'detail', route: null, icon: <Layers size={18} /> },
    { id: 'settings', route: '/settings', icon: <Settings size={18} /> },
  ]

  const show = (id: TourId, route: string | null) => {
    replayTour(id)
    if (route) nav(route)
    else setToast(t('help.detailNext'))
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
        <h1 className="flex-1 text-2xl font-extrabold tracking-tight">{t('help.title')}</h1>
      </header>

      <p className="mt-2 px-5 text-sm leading-relaxed text-ink2">{t('help.intro')}</p>

      <Section title={t('help.screens')}>
        {screens
          .filter((s) => s.show !== false)
          .map((s) => (
            <Card key={s.id} icon={s.icon} title={t(`help.${s.id}.title`)} body={t(`help.${s.id}.body`)}>
              <button
                onClick={() => show(s.id, s.route)}
                className="mt-3 flex items-center gap-1.5 text-xs font-bold text-accent"
              >
                <CirclePlay size={15} /> {t('help.show')}
              </button>
            </Card>
          ))}
      </Section>

      <Section title={t('help.topics')}>
        <Card icon={<KeyRound size={18} />} title={t('help.keys.title')} body={t('help.keys.body')} />
        <Card icon={<Cloud size={18} />} title={t('help.backup.title')} body={t('help.backup.body')} />
        <Card icon={<Import size={18} />} title={t('help.tvtime.title')} body={t('help.tvtime.body')} />
        <Card icon={<CalendarDays size={18} />} title={t('help.recap.title')} body={t('help.recap.body')} />
        {/* the widget is native Android: web and iPhone have none */}
        {Capacitor.getPlatform() === 'android' && (
          <Card icon={<Smartphone size={18} />} title={t('help.widget.title')} body={t('help.widget.body')}>
            <img
              src={`/help/widget-${language ?? 'en'}.webp`}
              alt=""
              className="mx-auto mt-3 w-48 rounded-lg"
            />
          </Card>
        )}
      </Section>

      <div className="mt-6 px-4">
        <button
          onClick={() => {
            replayAllTours()
            setToast(t('help.replayAllDone'))
          }}
          className="flex w-full items-center justify-center gap-2 rounded-xl border border-line py-3 text-sm font-bold text-ink2 transition-colors hover:border-accent hover:text-accent"
        >
          <RotateCcw size={16} /> {t('help.replayAll')}
        </button>
      </div>

      {toast && (
        <div className="fixed bottom-24 left-1/2 z-50 -translate-x-1/2 rounded-xl bg-brand px-5 py-2.5 text-sm font-bold text-black shadow-2xl md:bottom-10">
          {toast}
        </div>
      )}
    </div>
  )
}
