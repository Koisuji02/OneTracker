// Store screenshots, step 2: the raw captures (shoot.mjs) composed into the
// Play Store images — headline on top, the real screen inside a phone.
//
//   node scripts/store/compose.mjs it|en
//
// Output: builds/store/play/<lang>/screenshot-N.png (1080×1920), plus the
// feature graphic (1024×500) and, once, the 512 px icon.
import { chromium } from 'playwright'
import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import sharp from 'sharp'

const lang = process.argv[2] ?? 'it'
const RAW = resolve(`builds/store/raw/${lang}`)
const OUT = resolve(`builds/store/play/${lang}`)
const TMP = resolve('builds/store/compose')
mkdirSync(OUT, { recursive: true })
mkdirSync(TMP, { recursive: true })

const url = (p) => pathToFileURL(p).href
const FONT = url(resolve('node_modules/@fontsource-variable/figtree/files/figtree-latin-wght-normal.woff2'))
const FONT_EXT = url(resolve('node_modules/@fontsource-variable/figtree/files/figtree-latin-ext-wght-normal.woff2'))
const raw = (name) => url(`${RAW}/${name}.png`)

const T = {
  it: [
    { shot: '01-series', h: 'Serie, film, libri e giochi. <b>Un’unica app.</b>', s: 'Riprendi da dove eri rimasto, con un tocco.' },
    { shot: '05-detail', h: 'Ogni episodio, <b>ogni stagione.</b>', s: 'Segna, vota e salva tra i preferiti.' },
    { shot: '06-detail-game', h: 'I tuoi giochi, <b>con le ore vere.</b>', s: 'Durate da HowLongToBeat e il tempo di ogni partita.' },
    { shot: '03-books', h: 'Libri, manga e fumetti, <b>capitolo per capitolo.</b>', s: 'Sai sempre a che punto sei arrivato.' },
    { shot: '08-history', h: 'La tua cronologia, <b>mese per mese.</b>', s: 'Tutto quello che hai visto, letto e giocato.' },
    { share: ['11-recap-1', '13-share-card'], h: 'Il tuo recap del mese, <b>da condividere.</b>', s: 'Una storia a fine mese, pronta per Instagram.' },
    { shot: '07-account', h: 'Le tue statistiche, <b>a colpo d’occhio.</b>', s: 'Tempo totale, preferiti, liste e obiettivi.' },
    { trio: ['12-theme-amoled-blue', '12-theme-light', '12-theme-amoled-pink'], light: 1, h: 'Il tuo stile, <b>i tuoi colori.</b>', s: 'Temi AMOLED e chiari. I tuoi dati restano sul telefono.' },
  ],
  en: [
    { shot: '01-series', h: 'Shows, movies, books and games. <b>One app.</b>', s: 'Pick up where you left off, in one tap.' },
    { shot: '05-detail', h: 'Every episode, <b>every season.</b>', s: 'Mark it, rate it, add it to your favourites.' },
    { shot: '06-detail-game', h: 'Your games, <b>with real hours.</b>', s: 'HowLongToBeat lengths and the time of every playthrough.' },
    { shot: '03-books', h: 'Books, manga and comics, <b>chapter by chapter.</b>', s: 'Always know exactly where you are.' },
    { shot: '08-history', h: 'Your history, <b>month by month.</b>', s: 'Everything you watched, read and played.' },
    { share: ['11-recap-1', '13-share-card'], h: 'Your monthly recap, <b>made to share.</b>', s: 'A story at the end of every month, ready for Instagram.' },
    { shot: '07-account', h: 'Your stats, <b>at a glance.</b>', s: 'Total time, favourites, lists and achievements.' },
    { trio: ['12-theme-amoled-blue', '12-theme-light', '12-theme-amoled-pink'], light: 1, h: 'Your style, <b>your colours.</b>', s: 'AMOLED and light themes. Your data stays on your phone.' },
  ],
}

const CSS = `
@font-face { font-family: Figtree; src: url(${FONT}) format('woff2'); font-weight: 300 900; unicode-range: U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD; }
@font-face { font-family: Figtree; src: url(${FONT_EXT}) format('woff2'); font-weight: 300 900; }
* { box-sizing: border-box; margin: 0; padding: 0; }
html, body { width: 1080px; height: 1920px; overflow: hidden; background: #0b0b0e; font-family: Figtree, sans-serif; color: #f4f4f5; -webkit-font-smoothing: antialiased; }
.top { position: absolute; top: 0; left: 0; right: 0; padding: 100px 80px 0; text-align: center; }
.mark { width: 72px; height: 10px; background: #ffd60a; margin: 0 auto 44px; }
h1 { font-size: 78px; line-height: 1.04; font-weight: 900; letter-spacing: -0.025em; text-wrap: balance; }
h1 b { color: #ffd60a; font-weight: 900; }
p { margin-top: 26px; font-size: 34px; line-height: 1.3; font-weight: 500; color: #a1a1aa; text-wrap: balance; }
.phone { position: absolute; background: #1b1b21; border-radius: 68px; padding: 14px; box-shadow: 0 0 0 2px #2c2c35, 0 40px 80px rgba(0,0,0,.55); }
.screen { border-radius: 54px; overflow: hidden; background: #000; position: relative; }
.status { height: 44px; display: flex; align-items: center; justify-content: space-between; padding: 0 34px; font-size: 21px; font-weight: 700; position: relative; }
.status .cam { position: absolute; left: 50%; top: 11px; width: 22px; height: 22px; margin-left: -11px; border-radius: 50%; background: #050507; box-shadow: 0 0 0 2px #121216; }
.status svg { display: block; }
.screen img { display: block; width: 100%; }
`

// Android status bar: time on the left, signal / wifi / battery on the right
const status = (light) => {
  const c = light ? '#17171a' : '#f4f4f5'
  return `<div class="status" style="background:${light ? '#f6f6f3' : '#000'};color:${c}">
  <span>9:41</span><span class="cam"></span>
  <span style="display:flex;gap:9px;align-items:center">
    <svg width="22" height="18" viewBox="0 0 22 18"><path d="M1 17h3v-4H1zM7 17h3V9H7zM13 17h3V5h-3zM19 17h3V1h-3z" fill="${c}"/></svg>
    <svg width="24" height="18" viewBox="0 0 24 18"><path d="M12 17.5 0.6 5.4a16.5 16.5 0 0 1 22.8 0z" fill="${c}"/></svg>
    <svg width="14" height="22" viewBox="0 0 14 22"><rect x="4" y="0" width="6" height="3" rx="1" fill="${c}"/><rect x="0.5" y="2.5" width="13" height="19" rx="3" fill="${c}"/></svg>
  </span></div>`
}

/** A phone `w` px wide at (x, y), showing `shot`. */
const phone = (shot, x, y, w, { light = false, z = 1 } = {}) =>
  `<div class="phone" style="left:${x}px;top:${y}px;width:${w}px;z-index:${z}">
     <div class="screen">${status(light)}<img src="${raw(shot)}"></div>
   </div>`

function page(slide) {
  let body = `<div class="top"><div class="mark"></div><h1>${slide.h}</h1><p>${slide.s}</p></div>`
  if (slide.shot) {
    // one phone, whole, under the headline
    // sized so the whole phone fits, bottom bar included
    const w = 636
    body += phone(slide.shot, (1080 - w) / 2, 452, w)
  } else if (slide.share) {
    // the recap on the phone, and the story image it shares, like a post
    const [shot, card] = slide.share
    body += phone(shot, 70, 520, 560)
    body += `<img src="${raw(card)}" style="position:absolute;left:610px;top:760px;width:420px;border-radius:22px;transform:rotate(5deg);box-shadow:0 0 0 2px #2c2c35,0 40px 80px rgba(0,0,0,.6);z-index:3">`
  } else {
    // three phones: the middle one in front, the sides lower and smaller
    const [a, b, c] = slide.trio
    const side = 500
    const mid = 600
    body += phone(a, -40, 640, side, { light: slide.light === 0 })
    body += phone(c, 1080 - side + 40, 640, side, { light: slide.light === 2 })
    body += phone(b, (1080 - mid) / 2, 540, mid, { light: slide.light === 1, z: 2 })
  }
  return `<!doctype html><html><head><meta charset="utf-8"><style>${CSS}</style></head><body>${body}</body></html>`
}

const FEATURE = {
  it: { h: 'Serie, film, libri e giochi.', b: 'Un’unica app.' },
  en: { h: 'Shows, movies, books and games.', b: 'One app.' },
}

function feature() {
  const f = FEATURE[lang]
  const logo = url(resolve('public/logo.svg'))
  return `<!doctype html><html><head><meta charset="utf-8"><style>${CSS}
  html, body { width: 1024px; height: 500px; }
  .left { position: absolute; left: 64px; top: 0; bottom: 0; width: 470px; display: flex; flex-direction: column; justify-content: center; }
  .brand { display: flex; align-items: center; gap: 18px; }
  .brand img { width: 72px; height: 72px; border-radius: 14px; box-shadow: 0 0 0 2px #2c2c35; }
  .brand span { font-size: 44px; font-weight: 900; letter-spacing: -0.02em; }
  .tag { margin-top: 34px; font-size: 40px; line-height: 1.08; font-weight: 900; letter-spacing: -0.02em; }
  .tag b { color: #ffd60a; }
  .phone { border-radius: 40px; padding: 9px; }
  .screen { border-radius: 32px; }
  .status { height: 0; padding: 0; }
  .status * { display: none; }
  </style></head><body>
  <div class="left">
    <div class="brand"><img src="${logo}"><span>OneTracker</span></div>
    <div class="tag">${f.h}<br><b>${f.b}</b></div>
  </div>
  ${phone('04-games', 560, 120, 180)}
  ${phone('11-recap-0', 810, 120, 180)}
  ${phone('01-series', 680, 56, 200, { z: 2 })}
  </body></html>`
}

const browser = await chromium.launch()
const render = async (html, w, h, out) => {
  const file = `${TMP}/${lang}-${Date.now()}.html`
  writeFileSync(file, html)
  const p = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1 })
  await p.goto(url(file))
  await p.evaluate(() => document.fonts.ready)
  await p.waitForTimeout(300)
  await p.screenshot({ path: out })
  await p.close()
}

for (const [i, slide] of T[lang].entries()) {
  await render(page(slide), 1080, 1920, `${OUT}/screenshot-${i + 1}.png`)
}
await render(feature(), 1024, 500, `${OUT}/feature-graphic.png`)
await browser.close()

// the 512 px store icon, from the same SVG as the launcher icons
await sharp(resolve('public/logo.svg')).resize(512, 512).png().toFile(resolve('builds/store/play/icon-512.png'))
console.log(`done: ${OUT}`)
