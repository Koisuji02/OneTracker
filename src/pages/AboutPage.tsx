/**
 * About / credits.
 *
 * This screen is a RELEASE REQUIREMENT, not decoration: TMDB's API terms make
 * the "not endorsed or certified" notice mandatory and ask for it in an
 * About-or-Credits section, and every other provider expects to be named. It
 * also states plainly where the user's data lives, which is the same answer the
 * Play data-safety form and the OAuth consent screen give — kept in one place
 * so the three can never drift apart.
 *
 * Brand marks are drawn inline (like the rating banners) rather than shipped as
 * image files: no binaries in the repo, no broken asset when a CDN moves.
 */
import { App as CapApp } from '@capacitor/app'
import { Browser } from '@capacitor/browser'
import { Capacitor } from '@capacitor/core'
import { ArrowLeft, Code2, ExternalLink, ShieldCheck } from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { useT } from '../i18n'

const REPO = 'https://github.com/Koisuji02/OneTracker'
/** The web app, which is also OneTracker's home page and hosts the published
 *  privacy policy — the same URLs given to Google's consent screen and to Play,
 *  so the app, the browser version and the store all say the same thing.
 *  Note `/privacy`, not `/privacy.html`: Workers Assets redirects the latter. */
const SITE = 'https://onetracker.onetracker.workers.dev'
const PRIVACY = `${SITE}/privacy`

/** Open outside the app — a custom tab on device, a new tab on the web. */
async function openExternal(url: string): Promise<void> {
  if (Capacitor.isNativePlatform()) {
    await Browser.open({ url }).catch(() => {})
    return
  }
  window.open(url, '_blank', 'noopener,noreferrer')
}

/**
 * TMDB's mark: their wordmark on the official gradient. Their brand asset can
 * be dropped in here later; the colours and shape are theirs either way.
 */
function TmdbMark() {
  return (
    <svg viewBox="0 0 64 24" className="h-6 w-16 shrink-0" aria-hidden>
      <defs>
        <linearGradient id="tmdb-g" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="#90CEA1" />
          <stop offset="100%" stopColor="#01B4E4" />
        </linearGradient>
      </defs>
      <rect width="64" height="24" rx="4" fill="url(#tmdb-g)" />
      <text
        x="32"
        y="17"
        textAnchor="middle"
        fontSize="13"
        fontWeight="900"
        fill="#0D253F"
        fontFamily="Inter, system-ui, sans-serif"
      >
        TMDB
      </text>
    </svg>
  )
}

/** Everyone else: their colour, their initials. Honest, and never stale. */
function Mark({ label, bg, fg = '#ffffff' }: { label: string; bg: string; fg?: string }) {
  return (
    <span
      className="grid h-6 w-16 shrink-0 place-items-center rounded text-[10px] font-black tracking-tight"
      style={{ background: bg, color: fg }}
    >
      {label}
    </span>
  )
}

function SourceRow({ mark, what }: { mark: ReactNode; what: string }) {
  return (
    <div className="flex items-center gap-3 px-4 py-3">
      {mark}
      <span className="min-w-0 flex-1 text-xs text-ink2">{what}</span>
    </div>
  )
}

function LinkRow({ icon, label, url }: { icon: ReactNode; label: string; url: string }) {
  return (
    <button
      onClick={() => void openExternal(url)}
      className="flex w-full items-center gap-3 px-4 py-3.5 text-left text-sm font-medium transition-colors hover:bg-card2"
    >
      <span className="text-accent">{icon}</span>
      <span className="flex-1">{label}</span>
      <ExternalLink size={14} className="text-ink4" />
    </button>
  )
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mt-6 px-4">
      <h2 className="mb-2 px-1 text-xs font-bold uppercase tracking-wider text-ink3">{title}</h2>
      <div className="divide-y divide-line overflow-hidden rounded-2xl border border-line bg-card">
        {children}
      </div>
    </section>
  )
}

export default function AboutPage() {
  const t = useT()
  const nav = useNavigate()
  // the build's own number on device; the .env-free build-time value on web
  const [version, setVersion] = useState(__APP_VERSION__)
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return
    CapApp.getInfo()
      .then((i) => setVersion(`${i.version} (${i.build})`))
      .catch(() => {})
  }, [])

  const sources: Array<{ mark: ReactNode; what: string }> = [
    {
      mark: <TmdbMark />,
      what: `${t('nav.series')}, ${t('nav.movies')}, ${t('about.artwork')}`,
    },
    { mark: <Mark label="IGDB" bg="#2A1B57" />, what: t('nav.games') },
    { mark: <Mark label="HLTB" bg="#12283C" fg="#5FA8E8" />, what: t('about.gameLengths') },
    { mark: <Mark label="RAWG" bg="#151515" />, what: `${t('nav.games')}, ${t('about.artwork')}` },
    { mark: <Mark label="AniList" bg="#02A9FF" />, what: `${t('about.anime')}, ${t('nav.books')}` },
    { mark: <Mark label="MangaDex" bg="#FF6740" />, what: t('about.chapters') },
    { mark: <Mark label="MAL" bg="#2E51A2" />, what: `${t('about.anime')}, ${t('about.ratings')}` },
    { mark: <Mark label="OpenLib" bg="#5B4636" />, what: t('nav.books') },
    { mark: <Mark label="ComicVine" bg="#1F1F1F" />, what: t('about.comics') },
    { mark: <Mark label="OMDb" bg="#333333" />, what: t('about.ratings') },
    { mark: <Mark label="Steam" bg="#1B2838" />, what: t('about.artwork') },
  ]

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
        <h1 className="flex-1 text-2xl font-extrabold tracking-tight">{t('about.title')}</h1>
      </header>

      <div className="mt-4 flex flex-col items-center px-4">
        <img src="/logo.svg" alt="OneTracker" className="h-16 w-16" />
        <div className="mt-2 text-lg font-extrabold">OneTracker</div>
        <div className="text-xs text-ink3">
          {t('about.version')} {version}
        </div>
      </div>

      <Section title={t('about.dataTitle')}>
        <div className="flex items-start gap-3 px-4 py-3.5">
          <ShieldCheck size={18} className="mt-0.5 shrink-0 text-accent" />
          <p className="text-xs leading-relaxed text-ink2">{t('about.dataBody')}</p>
        </div>
      </Section>

      <Section title={t('about.sourcesTitle')}>
        {sources.map((s, i) => (
          <SourceRow key={i} mark={s.mark} what={s.what} />
        ))}
      </Section>

      {/* wording fixed by TMDB's API terms — do not translate or reword */}
      <p className="mt-3 px-5 text-center text-[11px] leading-relaxed text-ink4">
        This product uses the TMDB API but is not endorsed or certified by TMDB.
      </p>

      <Section title={t('about.projectTitle')}>
        <LinkRow icon={<Code2 size={18} />} label={t('about.sourceCode')} url={REPO} />
        <LinkRow icon={<ShieldCheck size={18} />} label={t('about.privacy')} url={PRIVACY} />
      </Section>
    </div>
  )
}
