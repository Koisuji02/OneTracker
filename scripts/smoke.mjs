// End-to-end smoke test: drives the dev server with headless Chromium.
// Covers: first-run, search (keyless AniList/OpenLibrary), cascade marking,
// rewatch dialog, season-chain aggregation, manga chapter checklists +
// MangaDex totals, ratings, lists, search memory, avatar, themes, profile.
// Usage: node scripts/smoke.mjs [shots-dir]
import { chromium } from 'playwright'

const BASE = 'http://localhost:5173'
const SHOTS = process.argv[2] ?? 'scripts/shots'
const results = []

function ok(name) {
  results.push(`PASS  ${name}`)
  console.log(`PASS  ${name}`)
}
function fail(name, err) {
  results.push(`FAIL  ${name}: ${err?.message ?? err}`)
  console.log(`FAIL  ${name}: ${err?.message ?? err}`)
}

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 390, height: 844 } })
page.on('pageerror', (e) => console.log(`PAGEERROR ${e.message}`))

const shot = (name) => page.screenshot({ path: `${SHOTS}/${name}.png` })

try {
  // 1. first run — language picker
  await page.goto(BASE)
  await page.getByText('Welcome to OneTracker').waitFor({ timeout: 10000 })
  await shot('01-firstrun')
  ok('first-run language picker shown')

  // 2. pick Italiano → series page
  await page.getByRole('button', { name: /Italiano/ }).click()
  await page.getByRole('heading', { name: 'Serie' }).waitFor({ timeout: 5000 })
  ok('language set to Italian, series page rendered')

  // 3. search (AniList needs no key) + TMDB warning
  await page.goto(`${BASE}/#/search`)
  await page.getByPlaceholder(/Cerca serie/).fill('one piece')
  await page.waitForTimeout(3500)
  await shot('02-search')
  const animeSection = page.locator('section', { hasText: 'Anime' }).first()
  const posterCount = await animeSection.locator('img').count()
  if (posterCount > 0) ok(`anime search returned ${posterCount} posters`)
  else fail('anime search', 'no posters found')
  // with a baked TMDB key the row shows results; without it, the key warning
  const tvSection = page.locator('section', { hasText: 'Serie TV' }).first()
  const tvPosters = await tvSection.locator('img').count()
  const tvWarning = await page.getByText(/API key TMDB/).count()
  if (tvPosters > 0 || tvWarning > 0) ok(`tv row rendered (${tvPosters > 0 ? 'results' : 'key warning'})`)
  else fail('tv row', 'neither results nor key warning')

  // 4. open first anime detail (chain-aggregated) + add + favorite
  await animeSection.locator('img').first().click()
  await page.getByRole('heading', { level: 1 }).waitFor({ timeout: 15000 })
  await page.getByText('Stagioni').waitFor({ timeout: 15000 })
  const title = await page.getByRole('heading', { level: 1 }).textContent()
  await shot('03-detail')
  ok(`detail page loaded: ${title}`)
  await page.getByRole('button', { name: /Aggiungi a Da guardare/ }).click()
  await page.waitForTimeout(600)
  await page.locator('[aria-label="favorite"]').click()
  await page.waitForTimeout(400)
  ok('added to watchlist + favorite')

  // 5. CASCADE: open season 1, check episode 4 → episodes 1-4 all watched
  await page
    .locator('section', { hasText: 'Stagioni' })
    .locator('[role="button"]')
    .first()
    .click()
  await page.locator('[aria-label="mark watched"]').nth(3).waitFor({ timeout: 20000 })
  await page.locator('[aria-label="mark watched"]').nth(3).click() // episode 4
  await page.waitForTimeout(900)
  await shot('04-cascade')
  const progress = await page.getByText(/^4\/\d+/).count()
  if (progress > 0) ok('cascade: checking ep.4 marked 4 episodes')
  else fail('cascade', 'progress 4/N not found')

  // 6. REWATCH: tap watched episode 2 → dialog → mark as rewatched → x2
  await page.locator('[aria-label="mark watched"]').nth(1).click()
  await page.getByText(/Segna come rivisto/).waitFor({ timeout: 5000 })
  await shot('05-rewatch-dialog')
  await page.getByRole('button', { name: /Segna come rivisto/ }).click()
  await page.waitForTimeout(700)
  const x2 = await page.getByText('x2', { exact: true }).count()
  if (x2 > 0) ok('rewatch: episode shows x2 grade')
  else fail('rewatch', 'x2 badge not found')

  // 7. RATING: open the rating modal, set a value, expect the badge
  await page.locator('[aria-label="Vota"]').click()
  await page.locator('input[type="range"]').fill('9.3')
  await page.getByRole('button', { name: 'Salva' }).click()
  await page.waitForTimeout(500)
  if ((await page.getByText('9.3').count()) > 0) ok('personal rating 9.3 saved (silver tier)')
  else fail('rating', 'badge 9.3 not visible')
  await shot('06-rated')

  // 8. series page shows next episode S01|E05
  await page.goto(`${BASE}/#/series`)
  await page.waitForTimeout(1200)
  if ((await page.getByText(/S01 \| E05/).count()) > 0) ok('series page shows next episode S01|E05')
  else fail('series next episode', 'S01|E05 not found')
  await shot('07-series')

  // 9. SEASON-CHAIN AGGREGATION: fire force must show 2+ seasons in one entry
  await page.goto(`${BASE}/#/search`)
  await page.getByPlaceholder(/Cerca serie/).fill('fire force')
  await page.waitForTimeout(3500)
  await page.locator('section', { hasText: 'Anime' }).first().locator('img').first().click()
  await page.getByText('Stagioni').waitFor({ timeout: 25000 })
  await page.waitForTimeout(800)
  const seasonBlocks = await page
    .locator('section', { hasText: 'Stagioni' })
    .locator('[role="button"]')
    .count()
  await shot('08-fireforce')
  if (seasonBlocks >= 2) ok(`Fire Force aggregated into one entry with ${seasonBlocks} seasons`)
  else fail('season chain', `only ${seasonBlocks} season blocks`)

  // 10. profile: hero art, custom name, expanded stats
  await page.goto(`${BASE}/#/account`)
  await page.waitForTimeout(900)
  if ((await page.locator('div.h-64 img').count()) > 0) ok('profile hero shows favorite artwork')
  else fail('profile hero', 'no artwork')
  await page.locator('[aria-label="edit name"]').click()
  await page.locator('input[maxlength="30"]').fill('Matteo')
  await page.locator('[aria-label="save name"]').click()
  await page.waitForTimeout(300)
  if ((await page.getByText('Matteo').count()) > 0) ok('custom profile name saved')
  else fail('custom name', 'not shown')
  await page.getByText('Tempo di visione totale').click()
  await page.waitForTimeout(400)
  await shot('09-account')
  ok('stats panel expanded')

  // 11. avatar preset
  await page.goto(`${BASE}/#/avatar`)
  await page.getByText('🦊').click()
  await page.waitForTimeout(400)
  const hasEmoji = await page.evaluate(() =>
    (localStorage.getItem('onetracker.settings') ?? '').includes('emoji:'),
  )
  if (hasEmoji) ok('avatar preset selected')
  else fail('avatar', 'preset not stored')

  // 12. lists: create one and add an item from the library picker
  await page.goto(`${BASE}/#/lists`)
  await page.locator('[aria-label="Nuova lista"]').click()
  await page.getByPlaceholder('Nome lista').fill('Da rivedere')
  await page.getByRole('button', { name: 'Salva' }).click()
  await page.waitForTimeout(600)
  await page.locator('[aria-label="Aggiungi"]').click()
  await page.locator('button:has(img)').first().waitFor({ timeout: 5000 })
  await page.locator('button:has(img)').first().click()
  await page.waitForTimeout(400)
  await page.mouse.click(10, 100) // close picker
  await page.waitForTimeout(500)
  await shot('10-list')
  if ((await page.locator('.grid img').count()) > 0) ok('list created with one item')
  else fail('lists', 'no item in list grid')

  // 13. books + manga chapter checklist + MangaDex totals
  await page.goto(`${BASE}/#/settings`)
  await page.getByRole('switch').first().click() // enable books
  await page.goto(`${BASE}/#/search`)
  await page.getByPlaceholder(/Cerca serie/).fill('berserk')
  await page.waitForTimeout(3500)
  await page.locator('section', { hasText: 'Manga' }).first().locator('img').first().click()
  await page.getByText('Capitoli', { exact: true }).waitFor({ timeout: 20000 })
  await page.waitForTimeout(600)
  // chapter 2 check → cascade marks 1-2 (auto-adds to library)
  await page.locator('[aria-label="mark watched"]').nth(1).click()
  await page.waitForTimeout(900)
  await shot('11-manga')
  const mangaProgress = await page.getByText(/^2\/\d+ capitoli/).count()
  if (mangaProgress > 0) ok('manga: chapter checklist + cascade + MangaDex total')
  else fail('manga chapters', '2/N capitoli not found')
  await page.goto(`${BASE}/#/books`)
  await page.waitForTimeout(800)
  if ((await page.getByText(/Cap\. 3/).count()) > 0) ok('books page shows continue-reading at Cap. 3')
  else fail('books continue', 'Cap. 3 not found')

  // 14. search memory: back to search → berserk results still there
  await page.goto(`${BASE}/#/search`)
  await page.waitForTimeout(500)
  const remembered = await page.getByPlaceholder(/Cerca serie/).inputValue()
  const stillThere = await page.locator('section', { hasText: 'Manga' }).first().locator('img').count()
  if (remembered === 'berserk' && stillThere > 0) ok('search memory keeps query and results')
  else fail('search memory', `q="${remembered}", posters=${stillThere}`)

  // 15. themes
  await page.goto(`${BASE}/#/settings`)
  await page.getByRole('button', { name: /Chiaro/ }).click()
  await page.waitForTimeout(400)
  const isLight = await page.evaluate(() => document.documentElement.classList.contains('light'))
  if (isLight) ok('light theme applied')
  else fail('light theme', 'html.light missing')
  await page.getByRole('button', { name: /Oceano/ }).click()
  await page.waitForTimeout(400)
  const brand = await page.evaluate(() =>
    getComputedStyle(document.documentElement).getPropertyValue('--brand').trim(),
  )
  if (brand === '#4cc9f0') ok('ocean theme preset applied')
  else fail('ocean theme', `--brand=${brand}`)
  await page.goto(`${BASE}/#/account`)
  await page.waitForTimeout(700)
  await shot('12-ocean-account')

  // 16. desktop layout
  await page.setViewportSize({ width: 1280, height: 800 })
  await page.goto(`${BASE}/#/catalog/series`)
  await page.waitForTimeout(800)
  await shot('13-desktop-catalog')
  ok('desktop catalog grid rendered')
} catch (e) {
  fail('smoke test aborted', e)
  await shot('99-failure')
}

await browser.close()
console.log('\n--- SUMMARY ---')
for (const r of results) console.log(r)
const failures = results.filter((r) => r.startsWith('FAIL')).length
console.log(`${results.length - failures}/${results.length} passed`)
process.exit(failures > 0 ? 1 : 0)
