// Quick CORS probe: can the browser call the SteamGridDB API directly?
// Usage: SGDB_KEY=... node scripts/probe-sgdb.mjs
import { chromium } from 'playwright'

const key = process.env.SGDB_KEY ?? ''
const browser = await chromium.launch()
const page = await browser.newPage()
await page.goto('http://localhost:5173')
const result = await page.evaluate(async (k) => {
  const out = {}
  try {
    const r = await fetch('https://www.steamgriddb.com/api/v2/search/autocomplete/hades', {
      headers: { Authorization: `Bearer ${k}` },
    })
    out.search = { ok: r.ok, status: r.status }
    if (r.ok) {
      const d = await r.json()
      out.firstGame = d.data?.[0]?.id ?? null
      if (out.firstGame) {
        const g = await fetch(
          `https://www.steamgriddb.com/api/v2/grids/game/${out.firstGame}?dimensions=600x900&limit=1`,
          { headers: { Authorization: `Bearer ${k}` } },
        )
        out.grids = { ok: g.ok, status: g.status }
        if (g.ok) {
          const gd = await g.json()
          out.coverUrl = gd.data?.[0]?.url?.slice(0, 60) ?? null
        }
      }
    }
  } catch (e) {
    out.error = String(e)
  }
  return out
}, key)
console.log(JSON.stringify(result, null, 2))
await browser.close()
