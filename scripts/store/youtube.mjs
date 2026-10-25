// Store images, step 4: the YouTube material, in the store images' style and
// from the same raw captures (shoot.mjs).
//
//   node scripts/store/youtube.mjs trailer it|en   -> builds/store/youtube/OneTracker-trailer-<lang>.webm
//   node scripts/store/youtube.mjs art it|en       -> builds/store/youtube/banner-<lang>.png, avatar.png
//   node scripts/store/youtube.mjs music          -> the soundtrack alone (WebM + WAV)
//   node scripts/store/youtube.mjs preview en 2 7  -> stills at those seconds, to check a layout
//
// The trailer is motion design in a web page whose scenes are a pure function
// of the time (`render(t)`): every frame is set, screenshotted and piped into
// the ffmpeg Playwright already installs for its own screen recordings (VP8 in
// WebM, which YouTube takes as is). The same frames every run, nothing to
// download. The music is composed in code on the same cue sheet
// (trailer-music.js), so the cuts land on the beat.
import { chromium } from 'playwright'
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import sharp from 'sharp'

const [mode = 'trailer', lang = 'en'] = process.argv.slice(2)
const RAW = resolve(`builds/store/raw/${lang}`)
const OUT = resolve('builds/store/youtube')
mkdirSync(OUT, { recursive: true })

const url = (p) => pathToFileURL(p).href
const raw = (name) => url(`${RAW}/${name}.png`)
const LOGO = url(resolve('public/logo.svg'))
const FONT = url(resolve('node_modules/@fontsource-variable/figtree/files/figtree-latin-wght-normal.woff2'))
const FONT_EXT = url(resolve('node_modules/@fontsource-variable/figtree/files/figtree-latin-ext-wght-normal.woff2'))

const T = {
  en: {
    words: ['Shows', 'Anime', 'Movies', 'Books', 'Manga', 'Comics', 'Games'],
    oneApp: 'One app.',
    series: 'Pick up where <b>you left off.</b>',
    detail: 'Every episode, <b>every season.</b>',
    games: 'Your games, <b>with real hours.</b>',
    books: 'Books, manga and comics, <b>chapter by chapter.</b>',
    month: 'Your month, <b>made to share.</b>',
    widget: 'Right from <b>your home screen.</b>',
    themes: 'Your style, <b>your colours.</b>',
    tvtime: 'Coming from <b>TV Time?</b>',
    kinds: ['Shows', 'Anime', 'Movies', 'Books', 'Manga', 'Games'],
    pitch: ['Free', 'No ads', 'No account'],
    soon: 'Coming soon to',
    banner: 'Shows, movies, books and games. <b>One app.</b>',
  },
  it: {
    words: ['Serie', 'Anime', 'Film', 'Libri', 'Manga', 'Fumetti', 'Giochi'],
    oneApp: 'Un’unica app.',
    series: 'Riprendi da dove <b>eri rimasto.</b>',
    detail: 'Ogni episodio, <b>ogni stagione.</b>',
    games: 'I tuoi giochi, <b>con le ore vere.</b>',
    books: 'Libri, manga e fumetti, <b>capitolo per capitolo.</b>',
    month: 'Il tuo mese, <b>da condividere.</b>',
    widget: 'Direttamente <b>dalla Home.</b>',
    themes: 'Il tuo stile, <b>i tuoi colori.</b>',
    tvtime: 'Arrivi da <b>TV Time?</b>',
    kinds: ['Serie', 'Anime', 'Film', 'Libri', 'Manga', 'Giochi'],
    pitch: ['Gratis', 'Senza pubblicità', 'Senza account'],
    soon: 'Presto su',
    banner: 'Serie, film, libri e giochi. <b>Un’unica app.</b>',
  },
}[lang]

const CSS = `
@font-face { font-family: Figtree; src: url(${FONT}) format('woff2'); font-weight: 300 900; unicode-range: U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD; }
@font-face { font-family: Figtree; src: url(${FONT_EXT}) format('woff2'); font-weight: 300 900; }
* { box-sizing: border-box; margin: 0; padding: 0; }
body { position: relative; overflow: hidden; background: #0b0b0e; font-family: Figtree, sans-serif; color: #f4f4f5; -webkit-font-smoothing: antialiased; }
b { color: #ffd60a; font-weight: 900; }
.el { position: absolute; will-change: transform, opacity; }
.h { font-size: 96px; line-height: 1.02; font-weight: 900; letter-spacing: -0.03em; text-wrap: balance; }
.chips { display: flex; flex-wrap: wrap; gap: 14px; margin-top: 40px; }
.phone { position: absolute; left: 0; top: 0; width: 636px; background: #1b1b21; border-radius: 68px; padding: 14px; box-shadow: 0 0 0 2px #2c2c35, 0 40px 90px rgba(0,0,0,.6); transform-origin: 0 0; }
.screen { border-radius: 54px; overflow: hidden; background: #000; position: relative; }
.status { height: 44px; display: flex; align-items: center; justify-content: space-between; padding: 0 34px; font-size: 21px; font-weight: 700; position: relative; background: #000; }
.status .cam { position: absolute; left: 50%; top: 11px; width: 22px; height: 22px; margin-left: -11px; border-radius: 50%; background: #050507; box-shadow: 0 0 0 2px #121216; }
.screen img { display: block; width: 100%; }
`

const STATUS = (light, overlay) => {
  const c = light ? '#17171a' : '#f4f4f5'
  const bg = overlay ? 'transparent;position:absolute;top:0;left:0;right:0;z-index:2' : light ? '#f6f6f3' : '#000'
  return `<div class="status" style="background:${bg};color:${c}"><span>9:41</span><span class="cam"></span>
  <span style="display:flex;gap:9px;align-items:center">
  <svg width="22" height="18" viewBox="0 0 22 18"><path d="M1 17h3v-4H1zM7 17h3V9H7zM13 17h3V5h-3zM19 17h3V1h-3z" fill="${c}"/></svg>
  <svg width="24" height="18" viewBox="0 0 24 18"><path d="M12 17.5 0.6 5.4a16.5 16.5 0 0 1 22.8 0z" fill="${c}"/></svg>
  <svg width="14" height="22" viewBox="0 0 14 22"><rect x="4" y="0" width="6" height="3" rx="1" fill="${c}"/><rect x="0.5" y="2.5" width="13" height="19" rx="3" fill="${c}"/></svg>
  </span></div>`
}

/** A phone `w` px wide showing `shot`: built at the store size (636), scaled. */
function phone(shot, w, { light = false, overlay = false } = {}) {
  return `<div style="position:relative;width:${w}px;height:${Math.round((w / 636) * (608 * (shot === '14-widget-home' ? 2616 : 2532) / 1170 + 72))}px">
    <div class="phone" style="transform:scale(${w / 636})"><div class="screen">${STATUS(light, overlay)}<img src="${raw(shot)}"></div></div></div>`
}

/** A scene's title; the services behind it go under it as their own marks. */
const title = (h, services = []) =>
  `<div style="width:870px"><div class="h">${h}</div>${services.length ? `<div class="chips">${services.map((k) => MARKS[k]).join('')}</div>` : ''}</div>`

// The services' marks, as the app draws them (RatingsBanners, About): their
// colours and simplified logos, no image files.
const chip = (bg, fg, inner) =>
  `<span style="display:inline-flex;align-items:center;gap:14px;height:66px;padding:0 22px;border-radius:12px;background:${bg};color:${fg};border:1px solid rgba(255,255,255,.14);box-shadow:0 12px 30px rgba(0,0,0,.45);font-size:27px;font-weight:800;white-space:nowrap">${inner}</span>`
const word = (t) => `<span style="font-size:34px;font-weight:900;font-style:italic;letter-spacing:-0.02em">${t}</span>`
const MARKS = {
  tmdb: chip('linear-gradient(90deg,#90CEA1,#01B4E4)', '#0D253F', '<span style="font-size:32px;font-weight:900">TMDB</span>'),
  imdb: chip('#F5C518', '#000', word('IMDb')),
  rt: chip('#2A0A03', '#fff', `<svg viewBox="0 0 24 24" width="38" height="38"><circle cx="12" cy="13.5" r="8.5" fill="#FA320A" stroke="#fff" stroke-width="1.2"/><path d="M12 5.5 C10 3 7.5 3.5 7.5 3.5 c1 1.8 2.6 2.4 2.6 2.4 C7 5.6 5.8 7.2 5.8 7.2 c2.8 1 4.8-.3 6.2-.3 1.4 0 3.4 1.3 6.2.3 0 0-1.2-1.6-4.3-1.3 0 0 1.6-.6 2.6-2.4 0 0-2.5-.5-4.5 2z" fill="#00912D"/></svg>Rotten Tomatoes`),
  metacritic: chip('#0F2B41', '#fff', `<svg viewBox="0 0 24 24" width="38" height="38"><defs><linearGradient id="mcg" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="#FFCC33"/><stop offset="50%" stop-color="#66CC33"/><stop offset="100%" stop-color="#00AEEF"/></linearGradient></defs><circle cx="12" cy="12" r="10" fill="url(#mcg)"/><text x="12" y="16.5" text-anchor="middle" font-size="13" font-weight="900" fill="#0F1B2A" font-family="Figtree">m</text></svg>Metacritic`),
  mal: chip('#2E51A2', '#fff', `<svg viewBox="0 0 24 24" width="38" height="38"><rect width="24" height="24" rx="4" fill="#fff"/><text x="12" y="16" text-anchor="middle" font-size="9" font-weight="900" fill="#2E51A2" font-family="Figtree">MAL</text></svg>MyAnimeList`),
  anilist: chip('#0B1622', '#fff', `<svg viewBox="0 0 24 24" width="38" height="38"><rect width="24" height="24" rx="5" fill="#02A9FF"/><path d="M13.4 5.5 h3.2 v10 H21 v3 h-7.6 z" fill="#fff"/><path d="M9.4 5.5 L4 18.5 h3.4 l.9-2.5 h3.4 l.9 2.5 H16 L10.9 5.5 z M9.2 13.2 l1-3 1 3 z" fill="#152232" opacity=".85"/></svg>AniList`),
  mangadex: chip('#191A1C', '#fff', `<svg viewBox="0 0 24 24" width="38" height="38"><rect width="24" height="24" rx="5" fill="#fff"/><path d="M5 19 V9 l3-4 2.5 3.5 h3 L16 5 l3 4 v10 z" fill="#FF6740"/><circle cx="9.5" cy="13.5" r="1.3" fill="#fff"/><circle cx="14.5" cy="13.5" r="1.3" fill="#fff"/></svg>MangaDex`),
  openlibrary: chip('#5B4636', '#fff', `<svg viewBox="0 0 24 24" width="36" height="36" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round"><path d="M12 6 C10 4.5 7 4.5 4 5.5 v13 c3-1 6-1 8 .5 2-1.5 5-1.5 8-.5 v-13 c-3-1-6-1-8 .5 z"/><path d="M12 6 v13"/></svg>Open Library`),
  comicvine: chip('#1F1F1F', '#fff', word('Comic Vine')),
  igdb: chip('#2A1B57', '#fff', word('IGDB')),
  hltb: chip('#12283C', '#5FA8E8', '<span style="font-size:29px;font-weight:900">HowLongToBeat</span>'),
}

/** Google Play's mark: the four-colour play triangle. */
const PLAY = `<svg viewBox="0 0 100 110" width="58" height="64"><polygon points="12,6 55,55 12,104" fill="#4285F4"/><polygon points="12,6 68,40.3 55,55" fill="#34A853"/><polygon points="68,40.3 92,55 68,69.7 55,55" fill="#FBBC04"/><polygon points="55,55 68,69.7 12,104" fill="#EA4335"/></svg>`

// ---------------------------------------------------------------- the trailer

/**
 * Each element: html, position, the window it lives in [in, out], how it
 * enters (`from`: offset, scale, rotation it eases out of) and a slow `drift`
 * over its life. Scenes are just elements sharing a window.
 */
const BEAT = 0.6
const BAR = 4 * BEAT
/** when each scene starts: two bars each, so every cut lands on a downbeat */
const CUE = {
  logoAt: 0.3,
  nameAt: 1.2,
  words: [0, 1, 2, 3, 4, 5, 6].map((i) => 2 * BAR + i * (BEAT / 2)),
  hit: 3 * BAR,
  scenes: [
    { t: 4 * BAR, chord: 'Am', level: 1 },
    { t: 6 * BAR, chord: 'F', level: 1 },
    { t: 8 * BAR, chord: 'C', level: 2 },
    { t: 10 * BAR, chord: 'G', level: 2 },
    { t: 12 * BAR, chord: 'Am', level: 3 },
    { t: 14 * BAR, chord: 'F', level: 3 },
    { t: 16 * BAR, chord: 'C', level: 4 },
    { t: 18 * BAR, chord: 'G', level: 0 },
  ],
  end: 20 * BAR,
  duration: 23 * BAR,
  bar: BAR,
}

/**
 * Each element: html, position, the window it lives in [in, out], how it
 * enters (`from`: offset, scale, rotation it eases out of) and a slow `drift`
 * over its life. Scenes are just elements sharing a window.
 */
function scenes() {
  const els = []
  const add = (o) => els.push(o)
  const P = 412 // phone width: ~900 px tall in the 1080 frame
  const at = CUE.scenes.map((x) => x.t).concat(CUE.end)
  const scene = (n, left, right) => {
    for (const part of [left, right].flat().filter(Boolean)) add({ in: at[n] + (part.delay ?? 0), out: at[n + 1], ...part })
  }
  const big = (txt, size, color = '#f4f4f5') =>
    `<div style="width:1920px;text-align:center;font-size:${size}px;font-weight:900;letter-spacing:-0.035em;color:${color}">${txt}</div>`

  // 0 — the logo
  add({ html: `<img src="${LOGO}" style="width:220px;height:220px;border-radius:44px;box-shadow:0 0 0 3px #2c2c35,0 30px 80px rgba(255,214,10,.18)">`, x: 850, y: 300, in: CUE.logoAt, out: CUE.words[0], from: { s: 0.6 }, enter: 0.9 })
  add({ html: big('OneTracker', 120), x: 0, y: 580, in: CUE.nameAt, out: CUE.words[0], from: { y: 50 } })

  // 1 — what it tracks, one word per eighth note, then the hit
  T.words.forEach((w, i) => {
    add({ html: big(w, 220), x: 0, y: 380, in: CUE.words[i], out: i < 6 ? CUE.words[i + 1] : CUE.hit, from: { s: 1.18 }, enter: 0.25, cut: true })
  })
  add({ html: big(T.oneApp, 220, '#ffd60a'), x: 0, y: 380, in: CUE.hit, out: at[0], from: { s: 0.85 }, enter: 0.3 })

  const left = (h, svc, y = 380) => ({ html: title(h, svc), x: 150, y, from: { x: -60 }, delay: BEAT / 2 })
  const right = (h, svc, y = 380) => ({ html: title(h, svc), x: 1000, y, from: { x: 60 }, delay: BEAT / 2 })
  const rising = (shot, x, r, extra = {}) => ({ html: phone(shot, P), x, y: 90, from: { y: 260, r }, drift: { y: -30 }, ...extra })

  scene(0, left(T.series, ['tmdb', 'imdb', 'rt', 'metacritic'], 340), rising('01-series', 1180, 6))
  scene(1, [
    rising('05-detail', 170, -5),
    { ...rising('05b-detail-episodes', 470, 6), y: 150, from: { x: 220, r: 6 }, drift: { y: -36 }, delay: 2 * BEAT, z: 2, rot: 4 },
  ], right(T.detail, ['tmdb', 'anilist', 'mal'], 360))
  scene(2, left(T.games, ['igdb', 'hltb'], 360), rising('06-detail-game', 1180, 6))
  scene(3, rising('03-books', 320, -6), right(T.books, ['openlibrary', 'mangadex', 'comicvine'], 300))
  scene(4, left(T.month, [], 420), [
    rising('08-history', 1010, 5),
    { ...rising('11-recap-1', 1370, 10), y: 140, from: { x: 240, r: 10 }, drift: { y: -36 }, delay: 2 * BEAT, z: 2, rot: 5 },
  ])
  scene(5, left(T.widget, [], 420), { html: phone('14-widget-home', 400, { overlay: true }), x: 1190, y: 80, from: { y: 260, r: 6 }, drift: { y: -26 } })
  // themes: four phones rising one per eighth note
  add({ html: `<div style="width:1920px;text-align:center"><div class="h">${T.themes}</div></div>`, x: 0, y: 70, in: at[6], out: at[7], from: { y: -40 } })
  ;['12-theme-amoled-blue', '12-theme-light', '12-theme-amoled-pink', '12-theme-amoled-green'].forEach((shot, i) => {
    add({ html: phone(shot, 330, { light: shot === '12-theme-light' }), x: 240 + i * 370, y: 250, in: at[6] + BEAT / 2 + (i * BEAT) / 2, out: at[7], from: { y: 420 }, drift: { y: -20 } })
  })
  // TV Time, over the breakdown
  add({ html: big(T.tvtime, 150), x: 0, y: 440, in: at[7], out: at[8], from: { s: 0.9 }, enter: 0.9 })

  // the end card, on the last hit
  const E = CUE.end
  const row = (items, size, color, weight = 800) =>
    `<div style="width:1920px;display:flex;justify-content:center;gap:42px;font-size:${size}px;font-weight:${weight};color:${color}">${items.map((x) => `<span>${x}</span>`).join('')}</div>`
  const ends = (o) => add({ out: CUE.duration, exit: 1.2, ...o })
  ends({ html: `<img src="${LOGO}" style="width:170px;height:170px;border-radius:34px;box-shadow:0 0 0 3px #2c2c35">`, x: 875, y: 150, in: E, from: { s: 0.7 } })
  ends({ html: big('OneTracker', 110), x: 0, y: 350, in: E + BEAT / 2, from: { y: 40 } })
  ends({ html: row(T.kinds, 40, '#ffd60a'), x: 0, y: 505, in: E + BEAT, from: { y: 30 } })
  ends({ html: row(T.pitch, 36, '#f4f4f5', 600), x: 0, y: 580, in: E + 2 * BEAT, from: { y: 30 } })
  ends({
    html: `<div style="width:1920px;text-align:center"><span style="display:inline-flex;align-items:center;gap:22px;padding:22px 40px;border-radius:16px;background:#000;border:2px solid #3a3a44;font-size:40px;font-weight:700">${T.soon}${PLAY}<span style="font-weight:800">Google Play</span></span></div>`,
    x: 0, y: 700, in: E + 3 * BEAT, from: { y: 30 },
  })
  return els
}

const DURATION = CUE.duration
const FPS = 30

function trailerPage() {
  const els = scenes()
  const body = els
    .map((e, i) => `<div class="el" id="e${i}" style="left:${e.x}px;top:${e.y}px;z-index:${e.z ?? 1};visibility:hidden">${e.html}</div>`)
    .join('\n')
  const spec = els.map(({ html: _h, ...rest }) => rest)
  return `<!doctype html><html><head><meta charset="utf-8"><style>${CSS}
  html, body { width: 1920px; height: 1080px; }
  #glow { position: absolute; width: 1400px; height: 1400px; border-radius: 50%; background: radial-gradient(closest-side, rgba(255,214,10,.10), rgba(255,214,10,0)); }
  #fade { position: absolute; inset: 0; background: #000; z-index: 50; pointer-events: none; }
  </style></head><body><div id="glow"></div>${body}<div id="fade"></div>
  <script>
  const SPEC = ${JSON.stringify(spec)}
  const clamp = (v) => Math.max(0, Math.min(1, v))
  const ease = (p) => 1 - Math.pow(1 - p, 3)
  const nodes = SPEC.map((_, i) => document.getElementById('e' + i))
  window.render = (t) => {
    // the glow wanders slowly behind everything
    const g = document.getElementById('glow')
    g.style.transform = 'translate(' + (260 + 420 * Math.sin(t / 7)) + 'px,' + (-300 + 160 * Math.cos(t / 5)) + 'px)'
    // fade from black at the start, to black at the end
    document.getElementById('fade').style.opacity = String(Math.max(1 - t / 0.4, clamp((t - (${DURATION} - 1)) / 1)))
    SPEC.forEach((e, i) => {
      const n = nodes[i]
      if (t < e.in || t >= e.out) { n.style.visibility = 'hidden'; return }
      const enter = ease(clamp((t - e.in) / (e.enter ?? 0.6)))
      const exit = ease(clamp((e.out - t) / (e.exit ?? 0.35)))
      const life = clamp((t - e.in) / (e.out - e.in))
      const f = e.from ?? {}, d = e.drift ?? {}
      const x = (f.x ?? 0) * (1 - enter) + (d.x ?? 0) * life
      const y = (f.y ?? 0) * (1 - enter) + (d.y ?? 0) * life - 24 * (1 - exit)
      const s = 1 + ((f.s ?? 1) - 1) * (1 - enter)
      const r = (f.r ?? 0) * (1 - enter) + (e.rot ?? 0)
      n.style.visibility = 'visible'
      // a cut swaps in and out at once (no blank frame between two words)
      n.style.opacity = String(e.cut ? 1 : Math.min(enter, exit))
      n.style.transform = 'translate(' + x + 'px,' + y + 'px) rotate(' + r + 'deg) scale(' + s + ')'
    })
  }
  </script></body></html>`
}

/** Playwright's own ffmpeg build (VP8 + WebM), installed with its browsers. */
function playwrightFfmpeg() {
  const root =
    process.env.PLAYWRIGHT_BROWSERS_PATH ??
    (process.platform === 'win32'
      ? resolve(process.env.LOCALAPPDATA ?? resolve(homedir(), 'AppData/Local'), 'ms-playwright')
      : process.platform === 'darwin'
        ? resolve(homedir(), 'Library/Caches/ms-playwright')
        : resolve(homedir(), '.cache/ms-playwright'))
  const dir = readdirSync(root).filter((d) => d.startsWith('ffmpeg-')).sort().pop()
  const exe = { win32: 'ffmpeg-win64.exe', darwin: 'ffmpeg-mac', linux: 'ffmpeg-linux' }[process.platform]
  const path = dir && resolve(root, dir, exe)
  if (!path || !existsSync(path)) throw new Error('no Playwright ffmpeg: run `npx playwright install ffmpeg`')
  return path
}

async function trailer() {
  for (const shot of ['01-series', '05-detail', '05b-detail-episodes', '06-detail-game', '03-books', '08-history', '11-recap-1', '14-widget-home', '12-theme-light']) {
    if (!existsSync(`${RAW}/${shot}.png`)) throw new Error(`missing ${RAW}/${shot}.png — run shoot.mjs first`)
  }
  const TMP = resolve('builds/store/compose')
  mkdirSync(TMP, { recursive: true })
  const scenePath = `${TMP}/trailer-${lang}.html`
  writeFileSync(scenePath, trailerPage())

  const browser = await chromium.launch()
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } })
  await page.goto(url(scenePath))
  await page.evaluate(async () => {
    await document.fonts.ready
    await Promise.all([...document.images].map((i) => (i.complete ? null : new Promise((r) => (i.onload = i.onerror = r)))))
  })

  const silent = `${TMP}/trailer-${lang}-video.webm`
  // JPEG frames in, VP8 out: constrained quality at a generous bitrate, so text
  // and covers stay sharp before YouTube re-encodes it
  const ff = spawn(playwrightFfmpeg(), [
    '-y', '-loglevel', 'error',
    // this build knows the `pipe:` protocol only, not the bare `-`
    '-f', 'image2pipe', '-framerate', String(FPS), '-c:v', 'mjpeg', '-i', 'pipe:0',
    '-c:v', 'libvpx', '-b:v', '20M', '-crf', '6', '-qmin', '0', '-qmax', '28',
    '-deadline', 'good', '-cpu-used', '1', '-auto-alt-ref', '0', '-g', String(FPS * 2),
    '-pix_fmt', 'yuv420p', silent,
  ], { stdio: ['pipe', 'inherit', 'inherit'] })
  const done = new Promise((ok, fail) => ff.on('close', (code) => (code === 0 ? ok() : fail(new Error(`ffmpeg exit ${code}`)))))

  const total = Math.round(DURATION * FPS)
  for (let i = 0; i < total; i++) {
    await page.evaluate((t) => window.render(t), i / FPS)
    const frame = await page.screenshot({ type: 'jpeg', quality: 95 })
    if (!ff.stdin.write(frame)) await new Promise((r) => ff.stdin.once('drain', r))
    if (i % 150 === 0) console.log(`frame ${i}/${total}`)
  }
  ff.stdin.end()
  await done
  // a still of the end card, handy as the YouTube thumbnail
  await page.evaluate((t) => window.render(t), CUE.end + 3)
  await page.screenshot({ path: `${OUT}/thumbnail-${lang}.png` })
  await browser.close()

  // the soundtrack (the same for both languages), then pictures + sound, both
  // streams copied as they are
  const sound = `${OUT}/OneTracker-trailer-music.webm`
  if (!existsSync(sound)) await music()
  const file = `${OUT}/OneTracker-trailer-${lang}.webm`
  await run(['-y', '-loglevel', 'error', '-i', silent, '-i', sound, '-map', '0:v:0', '-map', '1:a:0', '-c', 'copy', file])
  console.log(`${file} (${DURATION.toFixed(1)}s, ${FPS} fps, with music)`)
}

const run = (args) =>
  new Promise((ok, fail) =>
    spawn(playwrightFfmpeg(), args, { stdio: 'inherit' }).on('close', (code) => (code === 0 ? ok() : fail(new Error(`ffmpeg exit ${code}`)))),
  )

/**
 * The soundtrack (trailer-music.js): rendered offline on the trailer's cue
 * sheet, encoded to Opus with WebCodecs and muxed into WebM (webm-muxer), plus
 * a WAV of the same take.
 */
async function music() {
  const TMP = resolve('builds/store/compose')
  mkdirSync(TMP, { recursive: true })
  const blank = `${TMP}/music.html`
  // a file:// page is a secure context: WebCodecs needs one
  writeFileSync(blank, '<!doctype html><meta charset="utf-8"><title>music</title>')
  const browser = await chromium.launch()
  const page = await browser.newPage()
  await page.goto(url(blank))
  await page.addScriptTag({ path: resolve('node_modules/webm-muxer/build/webm-muxer.js') })
  await page.addScriptTag({ path: resolve('scripts/store/trailer-music.js') })
  const sizes = await page.evaluate(async (cue) => {
    const buf = await window.composeTrailerMusic(cue)
    const SR = buf.sampleRate
    const L = buf.getChannelData(0)
    const R = buf.getChannelData(1)
    // Opus in WebM, for the video
    const { Muxer, ArrayBufferTarget } = window.WebMMuxer
    const muxer = new Muxer({ target: new ArrayBufferTarget(), audio: { codec: 'A_OPUS', numberOfChannels: 2, sampleRate: SR } })
    let failure = null
    const enc = new AudioEncoder({ output: (c, m) => muxer.addAudioChunk(c, m), error: (e) => (failure = String(e)) })
    enc.configure({ codec: 'opus', sampleRate: SR, numberOfChannels: 2, bitrate: 192000 })
    const STEP = 4800
    for (let i = 0; i < buf.length; i += STEP) {
      const n = Math.min(STEP, buf.length - i)
      const data = new Float32Array(n * 2)
      data.set(L.subarray(i, i + n), 0)
      data.set(R.subarray(i, i + n), n)
      enc.encode(new AudioData({ format: 'f32-planar', sampleRate: SR, numberOfFrames: n, numberOfChannels: 2, timestamp: Math.round((i / SR) * 1e6), data }))
    }
    await enc.flush()
    if (failure) throw new Error(failure)
    muxer.finalize()
    window.webm = new Uint8Array(muxer.target.buffer)
    // 16-bit WAV, for anything else
    const wav = new DataView(new ArrayBuffer(44 + buf.length * 4))
    const str = (o, t) => [...t].forEach((c, k) => wav.setUint8(o + k, c.charCodeAt(0)))
    str(0, 'RIFF'); wav.setUint32(4, 36 + buf.length * 4, true); str(8, 'WAVEfmt ')
    wav.setUint32(16, 16, true); wav.setUint16(20, 1, true); wav.setUint16(22, 2, true)
    wav.setUint32(24, SR, true); wav.setUint32(28, SR * 4, true); wav.setUint16(32, 4, true); wav.setUint16(34, 16, true)
    str(36, 'data'); wav.setUint32(40, buf.length * 4, true)
    for (let i = 0, o = 44; i < buf.length; i++, o += 4) {
      wav.setInt16(o, Math.max(-1, Math.min(1, L[i])) * 32767, true)
      wav.setInt16(o + 2, Math.max(-1, Math.min(1, R[i])) * 32767, true)
    }
    window.wav = new Uint8Array(wav.buffer)
    window.slice = (name, from, to) =>
      new Promise((r) => {
        const fr = new FileReader()
        fr.onload = () => r(String(fr.result).split(',')[1])
        fr.readAsDataURL(new Blob([window[name].subarray(from, to)]))
      })
    return { webm: window.webm.length, wav: window.wav.length }
  }, CUE)
  for (const [name, ext] of [['webm', 'webm'], ['wav', 'wav']]) {
    const parts = []
    const STEP = 4 * 1024 * 1024
    for (let from = 0; from < sizes[name]; from += STEP) {
      parts.push(Buffer.from(await page.evaluate(([n, a, b]) => window.slice(n, a, b), [name, from, Math.min(sizes[name], from + STEP)]), 'base64'))
    }
    writeFileSync(`${OUT}/OneTracker-trailer-music.${ext}`, Buffer.concat(parts))
  }
  await browser.close()
  console.log(`${OUT}/OneTracker-trailer-music.webm / .wav`)
}

// ---------------------------------------------------------- the channel art

/**
 * YouTube banner, 2560×1440: a tilted wall of phones fills the whole image (TVs
 * show all of it), and everything that matters sits in the 1546×423 safe area
 * in the middle — the only part every device shows.
 */
function bannerPage() {
  const shots = ['01-series', '06-detail-game', '03-books', '08-history', '05-detail', '11-recap-1', '04-games', '07-account', '02-movies']
  let wall = ''
  for (let row = 0; row < 4; row++) {
    for (let col = 0; col < 12; col++) {
      const shot = shots[(row * 5 + col * 2) % shots.length]
      wall += `<div style="position:absolute;left:${col * 300 - 260 + (row % 2) * 150}px;top:${row * 640 - 420}px">${phone(shot, 260)}</div>`
    }
  }
  return `<!doctype html><html><head><meta charset="utf-8"><style>${CSS}
  html, body { width: 2560px; height: 1440px; }
  .wall { position: absolute; left: -200px; top: -200px; width: 3200px; height: 2000px; transform: rotate(-12deg); opacity: .55; }
  .shade { position: absolute; inset: 0; background: radial-gradient(ellipse 1050px 420px at 50% 50%, rgba(11,11,14,.97) 55%, rgba(11,11,14,.55) 100%); }
  .center { position: absolute; left: 507px; top: 508px; width: 1546px; height: 423px; display: flex; align-items: center; justify-content: center; gap: 48px; }
  .center img { width: 200px; height: 200px; border-radius: 40px; box-shadow: 0 0 0 3px #2c2c35, 0 24px 60px rgba(0,0,0,.6); }
  .name { font-size: 132px; font-weight: 900; letter-spacing: -0.035em; line-height: 1; }
  .tag { margin-top: 18px; font-size: 44px; font-weight: 700; color: #f4f4f5; }
  </style></head><body>
  <div class="wall">${wall}</div><div class="shade"></div>
  <div class="center"><img src="${LOGO}"><div><div class="name">OneTracker</div><div class="tag">${T.banner}</div></div></div>
  </body></html>`
}

async function art() {
  const TMP = resolve('builds/store/compose')
  mkdirSync(TMP, { recursive: true })
  const path = `${TMP}/banner-${lang}.html`
  writeFileSync(path, bannerPage())
  const browser = await chromium.launch()
  const page = await browser.newPage({ viewport: { width: 2560, height: 1440 } })
  await page.goto(url(path))
  await page.evaluate(async () => {
    await document.fonts.ready
    await Promise.all([...document.images].map((i) => (i.complete ? null : new Promise((r) => (i.onload = i.onerror = r)))))
  })
  await page.screenshot({ path: `${OUT}/banner-${lang}.png` })
  await browser.close()
  // the channel picture: the app icon, 800×800 (YouTube shows it as a circle)
  await sharp(resolve('public/logo.svg'), { density: 300 }).resize(800, 800).png().toFile(`${OUT}/avatar.png`)
  console.log(`${OUT}/banner-${lang}.png, ${OUT}/avatar.png`)
}

/** Stills of the trailer at a few moments, to check the layout without encoding. */
async function preview(times) {
  const TMP = resolve('builds/store/compose')
  mkdirSync(TMP, { recursive: true })
  const scenePath = `${TMP}/trailer-${lang}.html`
  writeFileSync(scenePath, trailerPage())
  const browser = await chromium.launch()
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } })
  await page.goto(url(scenePath))
  await page.evaluate(() => document.fonts.ready)
  for (const t of times) {
    await page.evaluate((x) => window.render(x), t)
    await page.screenshot({ path: `${OUT}/preview-${lang}-${String(t).replace('.', '_')}.png` })
  }
  await browser.close()
}

if (mode === 'trailer') await trailer()
else if (mode === 'music') await music()
else if (mode === 'art') await art()
else if (mode === 'preview') await preview(process.argv.slice(4).map(Number))
else throw new Error('usage: youtube.mjs trailer|music|art|preview it|en [seconds…]')
