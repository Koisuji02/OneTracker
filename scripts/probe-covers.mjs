// Probe alternatives for titled game box art from the browser:
// 1. Twitch/IGDB token endpoint CORS (a 4xx response still proves CORS is open)
// 2. the RAWG → Steam CDN chain for a multi-platform game (NUNS)
// Usage: RAWG_KEY=... node scripts/probe-covers.mjs
import { chromium } from 'playwright'

const rawgKey = process.env.RAWG_KEY ?? ''
const browser = await chromium.launch()
const page = await browser.newPage()
await page.goto('http://localhost:5173')
const result = await page.evaluate(async (rk) => {
  const out = {}
  // --- Twitch token endpoint (IGDB auth) — CORS check only
  try {
    const r = await fetch('https://id.twitch.tv/oauth2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'client_id=x&client_secret=y&grant_type=client_credentials',
    })
    out.twitch = { corsOpen: true, status: r.status }
  } catch (e) {
    out.twitch = { corsOpen: false, error: String(e).slice(0, 80) }
  }
  // --- IGDB api endpoint CORS check (would need a real token, expect 401 if CORS open)
  try {
    const r = await fetch('https://api.igdb.com/v4/games', {
      method: 'POST',
      headers: { 'Client-ID': 'x', Authorization: 'Bearer y' },
      body: 'fields name; limit 1;',
    })
    out.igdb = { corsOpen: true, status: r.status }
  } catch (e) {
    out.igdb = { corsOpen: false, error: String(e).slice(0, 80) }
  }
  // --- RAWG → Steam chain for NARUTO: Ultimate Ninja Storm
  try {
    const s = await fetch(`https://api.rawg.io/api/games?key=${rk}&search=naruto ultimate ninja storm&page_size=3`)
    const sd = await s.json()
    const game = sd.results?.[0]
    out.rawgGame = { id: game?.id, name: game?.name }
    const d = await fetch(`https://api.rawg.io/api/games/${game.id}?key=${rk}`)
    const dd = await d.json()
    out.detailStores = (dd.stores ?? []).map((x) => ({ store: x.store?.slug, url: (x.url ?? '').slice(0, 60) }))
    const st = await fetch(`https://api.rawg.io/api/games/${game.id}/stores?key=${rk}`)
    const std = await st.json()
    out.storesEndpoint = (std.results ?? []).map((x) => ({ store_id: x.store_id, url: (x.url ?? '').slice(0, 70) }))
  } catch (e) {
    out.rawgError = String(e).slice(0, 100)
  }
  return out
}, rawgKey)
console.log(JSON.stringify(result, null, 2))
await browser.close()
