// Branch probe: single-source rows — TMDB split (TV/Anime), MangaDex manga,
// Comic Vine comics, Open Library books. Dumps every row for key queries.
import { chromium } from 'playwright'

const BASE = 'http://localhost:5173'
const CASES = [
  { q: 'one piece', rows: ['Serie TV', 'Anime'] }, // anime + live action split
  { q: 'scott pilgrim', rows: ['Serie TV', 'Anime'] }, // dup killer check
  { q: 'arcane', rows: ['Serie TV', 'Anime'] }, // western animation stays in TV
  { q: 'frieren', rows: ['Anime'] }, // TMDB anime coverage
  { q: 'berserk', rows: ['Manga', 'Libri', 'Fumetti'] }, // MangaDex row + filters
  { q: "l'attacco dei giganti", rows: ['Manga'] }, // Italian-title manga search
  { q: 'guardiani della galassia', rows: ['Fumetti'] }, // Italian comics
]

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 390, height: 844 } })
page.on('pageerror', (e) => console.log(`  PAGEERROR ${e.message}`))
await page.addInitScript(() => {
  const cur = JSON.parse(localStorage.getItem('onetracker.settings') ?? '{}')
  localStorage.setItem(
    'onetracker.settings',
    JSON.stringify({ ...cur, onboarded: true, showBooks: true, language: 'it' }),
  )
})

await page.goto(`${BASE}/#/search`)
await page.getByPlaceholder(/Cerca/).waitFor({ timeout: 15000 })

for (const c of CASES) {
  console.log(`\n=== query: "${c.q}" ===`)
  await page.getByPlaceholder(/Cerca/).fill('')
  await page.waitForTimeout(300)
  await page.getByPlaceholder(/Cerca/).fill(c.q)
  await page.waitForTimeout(12000)
  for (const rowName of c.rows) {
    const section = page.locator('section', { hasText: rowName }).first()
    const titles = await section.locator('img').evaluateAll((imgs) => imgs.map((i) => i.alt))
    const noRes = await section.getByText(/Nessun risultato/).count()
    console.log(
      `  ${rowName}: ${titles.slice(0, 9).join(' | ') || (noRes ? 'NESSUN RISULTATO' : '(vuota)')}`,
    )
  }
}
await browser.close()
