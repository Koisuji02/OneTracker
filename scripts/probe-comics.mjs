// Probe: why don't Italian comics show up in the Comics search row?
// Drives the real app UI and dumps what each row renders + console errors.
// Usage: node scripts/probe-comics.mjs "guardiani della galassia" [more queries...]
import { chromium } from 'playwright'

const BASE = 'http://localhost:5173'
const queries = process.argv.slice(2)
if (queries.length === 0) queries.push('guardiani della galassia', 'dylan dog', 'tex')

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 390, height: 844 } })
page.on('pageerror', (e) => console.log(`  PAGEERROR ${e.message}`))
page.on('console', (m) => {
  if (m.type() === 'error') console.log(`  CONSOLE ${m.text().slice(0, 200)}`)
})
// requests to comicvine / anilist — see what actually goes out
page.on('request', (r) => {
  const u = r.url()
  if (u.includes('comicvine')) console.log(`  REQ CV: ${u.replace(/api_key=[^&]+/, 'api_key=***').slice(0, 180)}`)
})
page.on('response', async (r) => {
  const u = r.url()
  if (u.includes('comicvine')) console.log(`  RES CV: HTTP ${r.status()}`)
})

// skip the wizard: mark onboarded with books enabled before the app boots
await page.addInitScript(() => {
  const cur = JSON.parse(localStorage.getItem('onetracker.settings') ?? '{}')
  localStorage.setItem(
    'onetracker.settings',
    JSON.stringify({ ...cur, onboarded: true, showBooks: true, language: 'it' }),
  )
})

await page.goto(`${BASE}/#/search`)
await page.getByPlaceholder(/Cerca/).waitFor({ timeout: 15000 })

for (const q of queries) {
  console.log(`\n=== query: "${q}" ===`)
  await page.getByPlaceholder(/Cerca/).fill('')
  await page.waitForTimeout(300)
  await page.getByPlaceholder(/Cerca/).fill(q)
  // give all rows time to settle (CV JSONP timeout is 12s)
  await page.waitForTimeout(15000)
  for (const rowName of ['Fumetti', 'Manga', 'Libri']) {
    const section = page.locator('section', { hasText: rowName }).first()
    if ((await section.count()) === 0) {
      console.log(`  ${rowName}: (riga assente)`)
      continue
    }
    const titles = await section.locator('img').evaluateAll((imgs) => imgs.map((i) => i.alt))
    const noRes = await section.getByText(/Nessun risultato/).count()
    const errTxt = await section.getByText(/Errore|error/i).count()
    console.log(
      `  ${rowName}: ${titles.length ? titles.join(' | ') : noRes ? 'NESSUN RISULTATO' : errTxt ? 'ERRORE' : '(vuota/loading)'}`,
    )
  }
  await page.screenshot({ path: `scripts/shots/probe-${q.replace(/\W+/g, '-')}.png`, fullPage: true })
}

await browser.close()
