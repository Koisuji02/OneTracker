// Store screenshots, step 1: real app screens with a real-looking library.
//
//   node scripts/store/shoot.mjs seed it     fill the library (real titles, via the gateway)
//   node scripts/store/shoot.mjs shots it    capture the screens in Italian
//   node scripts/store/shoot.mjs shots en    … and in English
//
// Needs the dev server (`npm run dev`, port 5173). Uses its own browser
// profile per language under builds/store/profile-<lang> (titles and
// metadata come localised), so the library survives between runs
// and nothing else is touched. Raw captures land in builds/store/raw/<lang>/.
import { chromium } from 'playwright'
import { mkdirSync, writeFileSync } from 'node:fs'

const BASE = 'http://localhost:5173/'
const OUT = 'builds/store'
const [stage = 'shots', lang = 'it'] = process.argv.slice(2)

const ctx = await chromium.launchPersistentContext(`${OUT}/profile-${lang}`, {
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 3,
  isMobile: true,
  hasTouch: true,
  locale: lang === 'it' ? 'it-IT' : 'en-US',
})
const page = ctx.pages()[0] ?? (await ctx.newPage())
page.on('pageerror', (e) => console.log(`PAGEERROR ${e.message}`))

const settings = (language) => ({
  language,
  onboarded: true,
  showBooks: true,
  showGames: true,
  profileName: 'Alex',
  avatar: null,
})

async function boot(language) {
  await page.goto(BASE)
  await page.evaluate((s) => {
    const prev = JSON.parse(localStorage.getItem('onetracker.settings') ?? '{}')
    localStorage.setItem('onetracker.settings', JSON.stringify({ ...prev, ...s }))
    // no recap popping up over the screens
    localStorage.setItem('onetracker.recaps', JSON.stringify(['2026-09', '2026-10']))
  }, settings(language))
  await page.reload()
  await page.waitForTimeout(1500)
}

if (stage === 'seed') {
  await boot(lang)
  const log = await page.evaluate(async () => (await import('/scripts/store/seed-browser.js')).default())
  console.log(log.join('\n'))
  // achievements earned by the seed are recorded silently on the next start
  await page.evaluate(() => localStorage.removeItem('onetracker.achievements'))
  await page.reload()
  await page.waitForTimeout(4000)
  await ctx.close()
  process.exit(0)
}

// ------------------------------------------------------------------ shots
const dir = `${OUT}/raw/${lang}`
mkdirSync(dir, { recursive: true })
await boot(lang)

async function go(hash, wait = 1800) {
  await page.evaluate((h) => (location.hash = h), hash)
  await page.waitForTimeout(wait)
  // every screen from its top, whatever the previous one was scrolled to
  await page.evaluate(() => window.scrollTo(0, 0))
  // let every cover finish loading
  await page.evaluate(async () => {
    const imgs = [...document.images].filter((i) => !i.complete)
    await Promise.race([
      Promise.all(imgs.map((i) => new Promise((r) => i.addEventListener('load', r, { once: true }) || i.addEventListener('error', r, { once: true })))),
      new Promise((r) => setTimeout(r, 6000)),
    ])
  })
  await page.waitForTimeout(400)
}
const shot = (name) => page.screenshot({ path: `${dir}/${name}.png` })

const ids = await page.evaluate(async () => {
  const { db } = await import('/src/db.ts')
  const items = await db.items.toArray()
  const find = (re) => {
    const i = items.find((x) => re.test(x.title))
    return i ? `/media/${i.provider}/${i.mediaType}/${i.providerId}` : null
  }
  return { severance: find(/Severance|Scissione/), elden: find(/Elden Ring/), frieren: find(/Frieren/) }
})

await go('#/series')
await shot('01-series')
await go('#/movies')
await shot('02-movies')
await go('#/books')
await shot('03-books')
await go('#/games')
await shot('04-games')
if (ids.severance) {
  await go(`#${ids.severance}`, 3000)
  await shot('05-detail')
  await page.mouse.wheel(0, 700)
  await page.waitForTimeout(800)
  await shot('05b-detail-episodes')
}
if (ids.elden) {
  await go(`#${ids.elden}`, 3000)
  await shot('06-detail-game')
}
await go('#/account', 2500)
await shot('07-account')
await page.mouse.wheel(0, 800)
await page.waitForTimeout(800)
await shot('07b-account-scroll')
await go('#/history?m=2026-10', 2500)
await shot('08-history')
await go('#/achievements', 2500)
await shot('09-achievements')
await go('#/lists', 1500)
await shot('10-lists')

// the recap: open it from History and stop on a few slides
await go('#/history?m=2026-10', 2000)
await page.getByRole('button', { name: /recap/i }).first().click()
await page.waitForTimeout(1200)
const dialog = page.locator('[role=dialog]')
const box = await dialog.boundingBox()
const tapRight = async () => {
  await page.mouse.click(box.x + box.width - 30, box.y + box.height / 2)
  await page.waitForTimeout(900)
}
for (let i = 0; i < 9; i++) {
  // hold the slide still while capturing: the story pauses on pointer down
  await shot(`11-recap-${i}`)
  await tapRight()
}

// the image the share button sends, built exactly as MonthRecap builds it
const card = await page.evaluate(async (language) => {
  const { db } = await import('/src/db.ts')
  const h = await import('/src/history.ts')
  const { monthTiles, shortTime } = await import('/src/components/MonthRecap.tsx')
  const { renderRecapCard } = await import('/src/recapShare.ts')
  const { translate } = await import('/src/i18n.ts')
  const t = (k) => translate(language, k)
  const [items, eps] = await Promise.all([db.items.toArray(), db.episodes.toArray()])
  const recap = h.monthRecap(h.monthHistory(items, eps, '2026-10'), { showBooks: true, showGames: true })
  const blob = await renderRecapCard({
    ym: recap.ym,
    lang: language,
    lead: t('recap.your'),
    timeLabel: t('history.time'),
    time: recap.stats.totalMin > 0 ? shortTime(recap.stats.totalMin) : null,
    tiles: monthTiles(recap.stats, t).map((x) => ({ value: Number(x.value), label: String(x.label) })),
    covers: recap.covers.map((c) => c.poster).filter(Boolean),
  })
  const buf = new Uint8Array(await blob.arrayBuffer())
  let bin = ''
  for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000))
  return btoa(bin)
}, lang)
writeFileSync(`${dir}/13-share-card.png`, Buffer.from(card, 'base64'))

// the same screen in other themes, for the "your colours" shot
await page.keyboard.press('Escape')
for (const theme of ['amoled-blue', 'light', 'amoled-pink', 'amoled-green']) {
  await page.evaluate((th) => {
    const prev = JSON.parse(localStorage.getItem('onetracker.settings') ?? '{}')
    localStorage.setItem('onetracker.settings', JSON.stringify({ ...prev, theme: th }))
  }, theme)
  await page.evaluate(() => (location.hash = '#/series'))
  await page.reload()
  await go('#/series', 2000)
  await shot(`12-theme-${theme}`)
}
await page.evaluate(() => {
  const prev = JSON.parse(localStorage.getItem('onetracker.settings') ?? '{}')
  localStorage.setItem('onetracker.settings', JSON.stringify({ ...prev, theme: 'amoled' }))
})
await ctx.close()
