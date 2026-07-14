// Branch probe: detail pages of the new providers.
// - tmdb anime: seasons, AniList/MAL banners, lands in the Anime library tab
// - mangadex manga: chapters, MangaDex banner, chapter ticks work
import { chromium } from 'playwright'

const BASE = 'http://localhost:5173'
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 390, height: 844 } })
page.on('pageerror', (e) => console.log(`PAGEERROR ${e.message}`))
await page.addInitScript(() => {
  const cur = JSON.parse(localStorage.getItem('onetracker.settings') ?? '{}')
  localStorage.setItem(
    'onetracker.settings',
    JSON.stringify({ ...cur, onboarded: true, showBooks: true, language: 'it' }),
  )
})

await page.goto(`${BASE}/#/search`)
await page.getByPlaceholder(/Cerca/).waitFor({ timeout: 15000 })

// --- 1. tmdb anime detail
await page.getByPlaceholder(/Cerca/).fill('one piece')
const anime = page.locator('section', { hasText: 'Anime' }).first()
await anime.locator('img').first().waitFor({ timeout: 30000 })
await page.waitForTimeout(500)
await anime.locator('img').first().click()
await page.getByRole('heading', { level: 1 }).waitFor({ timeout: 30000 })
console.log('URL:', page.url())
console.log('title:', await page.getByRole('heading', { level: 1 }).textContent())
await page.getByText('Stagioni').waitFor({ timeout: 30000 })
const seasonsCount = await page.locator('section', { hasText: 'Stagioni' }).first().locator('button').count()
console.log('stagioni visibili (bottoni):', seasonsCount)
await page.waitForTimeout(2500) // banners load best-effort
for (const b of ['IMDb', 'AniList', 'MyAnimeList']) {
  console.log(`banner ${b}:`, (await page.getByText(b, { exact: false }).count()) > 0 ? 'OK' : 'assente')
}
await page.screenshot({ path: 'scripts/shots/rework-anime-detail.png', fullPage: true })
// add to library
const addBtn = page.getByRole('button', { name: /Aggiungi|Inizia/ }).first()
await addBtn.click()
await page.waitForTimeout(800)

// --- 2. mangadex manga detail
await page.goto(`${BASE}/#/search`)
await page.getByPlaceholder(/Cerca/).fill('berserk')
const manga = page.locator('section', { hasText: 'Manga' }).first()
await manga.locator('img').first().waitFor({ timeout: 30000 })
await page.waitForTimeout(500)
await manga.locator('img').first().click()
await page.getByRole('heading', { level: 1 }).waitFor({ timeout: 40000 })
console.log('\nURL:', page.url())
console.log('title:', await page.getByRole('heading', { level: 1 }).textContent())
await page.getByText(/Capitoli/).first().waitFor({ timeout: 40000 })
await page.waitForTimeout(2500)
for (const b of ['MangaDex', 'AniList', 'MyAnimeList']) {
  console.log(`banner ${b}:`, (await page.getByText(b, { exact: false }).count()) > 0 ? 'OK' : 'assente')
}
await page.screenshot({ path: 'scripts/shots/rework-manga-detail.png', fullPage: true })
await page.getByRole('button', { name: /Aggiungi|Inizia/ }).first().click()
await page.waitForTimeout(800)

// --- 3. library placement
await page.goto(`${BASE}/#/`)
await page.waitForTimeout(1200)
const seriesBody = await page.textContent('body')
console.log('\nHome Serie contiene One Piece:', /one piece/i.test(seriesBody ?? '') ? 'SI' : 'no')
await page.goto(`${BASE}/#/books`)
await page.waitForTimeout(1200)
const booksBody = await page.textContent('body')
console.log('Libri/Manga contiene Berserk:', /berserk/i.test(booksBody ?? '') ? 'SI' : 'no')

// item ids in db
const ids = await page.evaluate(async () => {
  const req = indexedDB.open('onetracker')
  return new Promise((resolve) => {
    req.onsuccess = () => {
      const tx = req.result.transaction('items', 'readonly')
      const all = tx.objectStore('items').getAll()
      all.onsuccess = () =>
        resolve(all.result.map((i) => `${i.id} [${i.mediaType}] ${i.title}`))
    }
  })
})
console.log('items in db:', ids)

await browser.close()
