// Debug the "imported episodes show no ticks" report: run a real import in a
// fresh browser, dump episode rows from IndexedDB, then open a detail page
// and count checked episode buttons.
// Usage: node scripts/debug-import.mjs <path-to-zip>
import { chromium } from 'playwright'

const zip = process.argv[2]
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 390, height: 844 } })
page.on('pageerror', (e) => console.log(`PAGEERROR ${e.message}`))
await page.goto('http://localhost:5173')

// wizard
await page.getByRole('button', { name: /Italiano/ }).click()
await page.getByRole('button', { name: 'Sì, attiva' }).click()
await page.getByRole('button', { name: 'Non ora' }).click()
await page.getByText('Continua come Ospite').click()
await page.getByRole('heading', { name: 'Serie' }).waitFor()

// import
await page.goto('http://localhost:5173/#/settings')
await page.locator('input[accept*="zip"]').setInputFiles(zip)
await page.getByText(/Importati:/).waitFor({ timeout: 420000 })
console.log('import done:', (await page.getByText(/Importati:/).textContent())?.trim())

// dump: find Evangelion item + its episode rows straight from IndexedDB
const dump = await page.evaluate(async () => {
  const openDb = () =>
    new Promise((res, rej) => {
      const r = indexedDB.open('onetracker')
      r.onsuccess = () => res(r.result)
      r.onerror = () => rej(r.error)
    })
  const db = await openDb()
  const getAll = (store) =>
    new Promise((res, rej) => {
      const tx = db.transaction(store).objectStore(store).getAll()
      tx.onsuccess = () => res(tx.result)
      tx.onerror = () => rej(tx.error)
    })
  const items = await getAll('items')
  const eps = await getAll('episodes')
  const byItem = new Map()
  for (const e of eps) byItem.set(e.itemId, (byItem.get(e.itemId) ?? 0) + 1)
  // pick 3 TV shows with episode rows and compare rows vs season snapshot
  const tvShows = items.filter((i) => i.mediaType === 'tv' && byItem.get(i.id))
  const report = tvShows.slice(0, 3).map((i) => {
    const rows = eps.filter((e) => e.itemId === i.id)
    return {
      id: i.id,
      title: i.title,
      status: i.status,
      total: i.totalEpisodes,
      seasons: (i.seasons ?? []).map((s) => `${s.number}:${s.episodeCount}`),
      rowCount: rows.length,
      rowSample: rows.slice(0, 4).map((e) => e.id),
    }
  })
  const tvNoRows = items.filter((i) => i.mediaType === 'tv' && i.status !== 'planned' && !byItem.get(i.id)).length
  return { totalItems: items.length, totalEps: eps.length, tvNoRows, report }
})
console.log(JSON.stringify(dump, null, 2))

// open the detail page and count checked buttons
if (dump.report?.[0]) {
  const providerId = dump.report[0].id.split(':')[1]
  await page.goto(`http://localhost:5173/#/media/tmdb/tv/${providerId}`)
  await page.getByText('Stagioni').waitFor({ timeout: 40000 })
  await page.waitForTimeout(1000)
  await page.locator('section', { hasText: 'Stagioni' }).locator('[role="button"]').first().click()
  await page.locator('[aria-label="mark watched"]').first().waitFor({ timeout: 20000 })
  const total = await page.locator('[aria-label="mark watched"]').count()
  const checked = await page.locator('[aria-label="mark watched"].bg-brand').count()
  const seasonHeader = await page
    .locator('section', { hasText: 'Stagioni' })
    .locator('[role="button"]')
    .first()
    .textContent()
  console.log(`detail: season header="${seasonHeader?.trim()}" buttons=${total} checked=${checked}`)
  await page.screenshot({ path: process.env.SHOT ?? 'scripts/debug-import.png' })
}
await browser.close()
