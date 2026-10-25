// Store images, step 4: the YouTube material, in the store images' style and
// from the same raw captures (shoot.mjs).
//
//   node scripts/store/youtube.mjs trailer it|en   -> builds/store/youtube/OneTracker-trailer-<lang>.webm
//   node scripts/store/youtube.mjs art it|en       -> builds/store/youtube/banner-<lang>.png, avatar.png
//   node scripts/store/youtube.mjs preview en 2 7  -> stills at those seconds, to check a layout
//
// The trailer is motion design in a web page whose scenes are a pure function
// of the time (`render(t)`): every frame is set, screenshotted and piped into
// the ffmpeg Playwright already installs for its own screen recordings (VP8 in
// WebM, which YouTube takes as is). The same frames every run, nothing to
// download. No audio: add a track from YouTube Studio's Audio Library after
// uploading.
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
    tagline: 'Your shows, movies, books and games.<br><b>One app.</b>',
    words: ['Shows', 'Anime', 'Movies', 'Books', 'Manga', 'Comics', 'Games'],
    oneApp: 'One app.',
    series: ['Pick up where <b>you left off.</b>', 'Tap ✓ and you’re on the next episode.'],
    detail: ['Every episode, <b>every season.</b>', 'Mark it, rate it, add it to your favourites.'],
    games: ['Your games, <b>with real hours.</b>', 'HowLongToBeat lengths and the time of every playthrough.'],
    books: ['Books, manga and comics, <b>chapter by chapter.</b>', 'Always know exactly where you are.'],
    month: ['Your month, <b>made to share.</b>', 'Your history month by month, and a recap ready for Instagram.'],
    widget: ['Right from <b>your home screen.</b>', 'The Android widget: one tap on ✓, next episode.'],
    themes: 'Your style, <b>your colours.</b>',
    tvtime: ['Coming from <b>TV Time?</b>', 'Bring your whole history with you.'],
    kinds: 'Shows | Anime | Movies | Books | Manga | Games',
    pitch: 'Free | No ads | No account',
    where: 'Android | Web',
    soon: 'Coming soon to Google Play',
    banner: 'Shows, movies, books and games. <b>One app.</b>',
  },
  it: {
    tagline: 'Le tue serie, i film, i libri e i giochi.<br><b>Un’unica app.</b>',
    words: ['Serie', 'Anime', 'Film', 'Libri', 'Manga', 'Fumetti', 'Giochi'],
    oneApp: 'Un’unica app.',
    series: ['Riprendi da dove <b>eri rimasto.</b>', 'Tocca ✓ e passi all’episodio dopo.'],
    detail: ['Ogni episodio, <b>ogni stagione.</b>', 'Segna, vota e salva tra i preferiti.'],
    games: ['I tuoi giochi, <b>con le ore vere.</b>', 'Durate da HowLongToBeat e il tempo di ogni partita.'],
    books: ['Libri, manga e fumetti, <b>capitolo per capitolo.</b>', 'Sai sempre a che punto sei arrivato.'],
    month: ['Il tuo mese, <b>da condividere.</b>', 'La cronologia mese per mese e un recap pronto per Instagram.'],
    widget: ['Direttamente <b>dalla Home.</b>', 'Il widget Android: un tocco su ✓, episodio successivo.'],
    themes: 'Il tuo stile, <b>i tuoi colori.</b>',
    tvtime: ['Arrivi da <b>TV Time?</b>', 'Porta con te tutta la tua cronologia.'],
    kinds: 'Serie | Anime | Film | Libri | Manga | Giochi',
    pitch: 'Gratis | Senza pubblicità | Senza account',
    where: 'Android | Web',
    soon: 'Presto su Google Play',
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
.mark { width: 64px; height: 9px; background: #ffd60a; margin-bottom: 36px; }
.h { font-size: 92px; line-height: 1.02; font-weight: 900; letter-spacing: -0.03em; text-wrap: balance; }
.s { margin-top: 28px; font-size: 38px; line-height: 1.3; font-weight: 500; color: #a1a1aa; text-wrap: balance; }
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

const text = ([h, s], align = 'left') =>
  `<div style="width:780px;text-align:${align}"><div class="mark" style="${align === 'center' ? 'margin:0 auto 36px' : ''}"></div><div class="h">${h}</div>${s ? `<div class="s">${s}</div>` : ''}</div>`

// ---------------------------------------------------------------- the trailer

/**
 * Each element: html, position, the window it lives in [in, out], how it
 * enters (`from`: offset, scale, rotation it eases out of) and a slow `drift`
 * over its life. Scenes are just elements sharing a window.
 */
function scenes() {
  const els = []
  const add = (o) => els.push(o)
  const P = 412 // phone width: ~900 px tall in the 1080 frame
  const scene = (t0, t1, left, right) => {
    // left/right: { html, x, y, from, drift, delay }
    for (const part of [left, right].flat().filter(Boolean)) {
      add({ in: t0 + (part.delay ?? 0), out: t1, ...part })
    }
  }

  // 0 — the logo
  add({ html: `<img src="${LOGO}" style="width:220px;height:220px;border-radius:44px;box-shadow:0 0 0 3px #2c2c35,0 30px 80px rgba(255,214,10,.18)">`, x: 850, y: 250, in: 0.2, out: 3.4, from: { s: 0.6 }, enter: 0.7 })
  add({ html: `<div style="width:1920px;text-align:center;font-size:120px;font-weight:900;letter-spacing:-0.035em">OneTracker</div>`, x: 0, y: 520, in: 0.8, out: 3.4, from: { y: 50 } })
  add({ html: `<div style="width:1920px;text-align:center;font-size:44px;font-weight:600;color:#a1a1aa;line-height:1.3">${T.tagline}</div>`, x: 0, y: 690, in: 1.4, out: 3.4, from: { y: 30 } })

  // 1 — what it tracks, one word at a time
  T.words.forEach((w, i) => {
    const t0 = 3.4 + i * 0.45
    add({ html: `<div style="width:1920px;text-align:center;font-size:220px;font-weight:900;letter-spacing:-0.04em">${w}</div>`, x: 0, y: 380, in: t0, out: t0 + 0.45, from: { s: 1.18 }, enter: 0.25, cut: true })
  })
  add({ html: `<div style="width:1920px;text-align:center;font-size:220px;font-weight:900;letter-spacing:-0.04em;color:#ffd60a">${T.oneApp}</div>`, x: 0, y: 380, in: 6.55, out: 7.6, from: { s: 0.85 }, enter: 0.3 })

  // 2 — Continue
  scene(7.6, 12.0, { html: text(T.series), x: 150, y: 330, from: { x: -60 }, delay: 0.25 }, { html: phone('01-series', P), x: 1180, y: 90, from: { y: 260, r: 6 }, drift: { y: -30 } })
  // 3 — a show's page, then its episodes
  scene(12.0, 16.4, [
    { html: phone('05-detail', P), x: 170, y: 90, from: { y: 260, r: -5 }, drift: { y: -24 } },
    { html: phone('05b-detail-episodes', P), x: 470, y: 150, from: { x: 220, r: 6 }, drift: { y: -36 }, delay: 0.7, z: 2, rot: 4 },
  ], { html: text(T.detail), x: 1000, y: 340, from: { x: 60 }, delay: 0.25 })
  // 4 — games
  scene(16.4, 20.6, { html: text(T.games), x: 150, y: 330, from: { x: -60 }, delay: 0.25 }, { html: phone('06-detail-game', P), x: 1180, y: 90, from: { y: 260, r: 6 }, drift: { y: -30 } })
  // 5 — books
  scene(20.6, 24.8, { html: phone('03-books', P), x: 320, y: 90, from: { y: 260, r: -6 }, drift: { y: -30 } }, { html: text(T.books), x: 1000, y: 330, from: { x: 60 }, delay: 0.25 })
  // 6 — the month: history, then the recap story on top
  scene(24.8, 29.6, { html: text(T.month), x: 150, y: 330, from: { x: -60 }, delay: 0.25 }, [
    { html: phone('08-history', P), x: 1010, y: 90, from: { y: 260, r: 5 }, drift: { y: -24 } },
    { html: phone('11-recap-1', P), x: 1370, y: 140, from: { x: 240, r: 10 }, drift: { y: -36 }, delay: 0.8, z: 2, rot: 5 },
  ])
  // 7 — the widget
  scene(29.6, 34.0, { html: text(T.widget), x: 150, y: 330, from: { x: -60 }, delay: 0.25 }, { html: phone('14-widget-home', 400, { overlay: true }), x: 1190, y: 80, from: { y: 260, r: 6 }, drift: { y: -26 } })
  // 8 — themes: four phones rising one after the other
  add({ html: `<div style="width:1920px;text-align:center"><div class="h">${T.themes}</div></div>`, x: 0, y: 70, in: 34.0, out: 38.6, from: { y: -40 } })
  ;['12-theme-amoled-blue', '12-theme-light', '12-theme-amoled-pink', '12-theme-amoled-green'].forEach((shot, i) => {
    add({ html: phone(shot, 330, { light: shot === '12-theme-light' }), x: 240 + i * 370, y: 250, in: 34.25 + i * 0.18, out: 38.6, from: { y: 420 }, drift: { y: -20 } })
  })
  // 9 — TV Time
  add({ html: `<div style="width:1920px;text-align:center;font-size:140px;font-weight:900;letter-spacing:-0.035em">${T.tvtime[0]}</div>`, x: 0, y: 360, in: 38.6, out: 42.2, from: { s: 0.9 } })
  add({ html: `<div style="width:1920px;text-align:center;font-size:52px;font-weight:600;color:#a1a1aa">${T.tvtime[1]}</div>`, x: 0, y: 560, in: 39.3, out: 42.2, from: { y: 30 } })
  // 10 — the end card
  add({ html: `<img src="${LOGO}" style="width:170px;height:170px;border-radius:34px;box-shadow:0 0 0 3px #2c2c35">`, x: 875, y: 150, in: 42.2, out: 48.0, from: { s: 0.7 }, exit: 0.8 })
  add({ html: `<div style="width:1920px;text-align:center;font-size:110px;font-weight:900;letter-spacing:-0.035em">OneTracker</div>`, x: 0, y: 350, in: 42.5, out: 48.0, from: { y: 40 }, exit: 0.8 })
  add({ html: `<div style="width:1920px;text-align:center;font-size:40px;font-weight:700;color:#ffd60a">${T.kinds}</div>`, x: 0, y: 505, in: 42.9, out: 48.0, from: { y: 30 }, exit: 0.8 })
  add({ html: `<div style="width:1920px;text-align:center;font-size:40px;font-weight:600;color:#a1a1aa">${T.pitch}</div>`, x: 0, y: 580, in: 43.2, out: 48.0, from: { y: 30 }, exit: 0.8 })
  add({ html: `<div style="width:1920px;text-align:center"><span style="display:inline-block;padding:22px 44px;border-radius:14px;background:#ffd60a;color:#000;font-size:40px;font-weight:900">${T.soon}</span></div>`, x: 0, y: 700, in: 43.6, out: 48.0, from: { y: 30 }, exit: 0.8 })
  add({ html: `<div style="width:1920px;text-align:center;font-size:34px;font-weight:600;color:#a1a1aa">${T.where} | onetracker.onetracker.workers.dev</div>`, x: 0, y: 850, in: 43.9, out: 48.0, from: { y: 30 }, exit: 0.8 })
  return els
}

const DURATION = 48
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
    document.getElementById('fade').style.opacity = String(Math.max(1 - t / 0.4, clamp((t - (${DURATION} - 0.7)) / 0.7)))
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

  const file = `${OUT}/OneTracker-trailer-${lang}.webm`
  // JPEG frames in, VP8 out: constrained quality at a generous bitrate, so text
  // and covers stay sharp before YouTube re-encodes it
  const ff = spawn(playwrightFfmpeg(), [
    '-y', '-loglevel', 'error',
    // this build knows the `pipe:` protocol only, not the bare `-`
    '-f', 'image2pipe', '-framerate', String(FPS), '-c:v', 'mjpeg', '-i', 'pipe:0',
    '-c:v', 'libvpx', '-b:v', '20M', '-crf', '6', '-qmin', '0', '-qmax', '28',
    '-deadline', 'good', '-cpu-used', '1', '-auto-alt-ref', '0', '-g', String(FPS * 2),
    '-pix_fmt', 'yuv420p', file,
  ], { stdio: ['pipe', 'inherit', 'inherit'] })
  const done = new Promise((ok, fail) => ff.on('close', (code) => (code === 0 ? ok() : fail(new Error(`ffmpeg exit ${code}`)))))

  const total = DURATION * FPS
  for (let i = 0; i < total; i++) {
    await page.evaluate((t) => window.render(t), i / FPS)
    const frame = await page.screenshot({ type: 'jpeg', quality: 95 })
    if (!ff.stdin.write(frame)) await new Promise((r) => ff.stdin.once('drain', r))
    if (i % 150 === 0) console.log(`frame ${i}/${total}`)
  }
  ff.stdin.end()
  await done
  // a still of the end card, handy as the YouTube thumbnail
  await page.evaluate((t) => window.render(t), 45.5)
  await page.screenshot({ path: `${OUT}/thumbnail-${lang}.png` })
  await browser.close()
  console.log(`${file} (${DURATION}s, ${FPS} fps)`)
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
else if (mode === 'art') await art()
else if (mode === 'preview') await preview(process.argv.slice(4).map(Number))
else throw new Error('usage: youtube.mjs trailer|art|preview it|en [seconds…]')
