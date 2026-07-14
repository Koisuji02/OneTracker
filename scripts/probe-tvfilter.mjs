// Probe: does the TV-row anime filter wrongly drop western animation?
// Dumps Serie TV + Anime rows for animation-heavy queries.
import { chromium } from 'playwright'

const BASE = 'http://localhost:5173'
const queries = process.argv.slice(2)
if (queries.length === 0)
  queries.push('arcane', 'rick and morty', 'avatar', 'castlevania', 'scott pilgrim')

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 390, height: 844 } })
await page.addInitScript(() => {
  const cur = JSON.parse(localStorage.getItem('onetracker.settings') ?? '{}')
  localStorage.setItem(
    'onetracker.settings',
    JSON.stringify({ ...cur, onboarded: true, language: 'it' }),
  )
})

await page.goto(`${BASE}/#/search`)
await page.getByPlaceholder(/Cerca/).waitFor({ timeout: 15000 })

for (const q of queries) {
  console.log(`\n=== query: "${q}" ===`)
  await page.getByPlaceholder(/Cerca/).fill('')
  await page.waitForTimeout(300)
  await page.getByPlaceholder(/Cerca/).fill(q)
  await page.waitForTimeout(9000)
  for (const rowName of ['Serie TV', 'Anime']) {
    const section = page.locator('section', { hasText: rowName }).first()
    const titles = await section.locator('img').evaluateAll((imgs) => imgs.map((i) => i.alt))
    console.log(`  ${rowName}: ${titles.slice(0, 8).join(' | ') || '(niente)'}`)
  }
}
await browser.close()
