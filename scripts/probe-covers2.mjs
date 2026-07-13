// Probe #2: (a) does the Steam 600x900 box art load for NUNS? (b) Wikipedia
// pageimage as titled cover for console-only games, (c) TMDB poster for anime.
// Usage: TMDB_KEY=... node scripts/probe-covers2.mjs
import { chromium } from 'playwright'

const tmdbKey = process.env.TMDB_KEY ?? ''
const browser = await chromium.launch()
const page = await browser.newPage()
await page.goto('http://localhost:5173')
const result = await page.evaluate(async (tk) => {
  const out = {}
  const imageExists = (url) =>
    new Promise((resolve) => {
      const img = new Image()
      const t = setTimeout(() => resolve(false), 6000)
      img.onload = () => { clearTimeout(t); resolve(true) }
      img.onerror = () => { clearTimeout(t); resolve(false) }
      img.src = url
    })
  // (a) Steam box art for NUNS (app 495140)
  out.steamNuns = await imageExists(
    'https://cdn.cloudflare.steamstatic.com/steam/apps/495140/library_600x900_2x.jpg',
  )
  // (b) Wikipedia pageimage for a console-only game
  try {
    const u =
      'https://en.wikipedia.org/w/api.php?action=query&format=json&origin=*' +
      '&generator=search&gsrsearch=' + encodeURIComponent('Uncharted 4 video game') +
      '&gsrlimit=1&prop=pageimages&piprop=original'
    const r = await fetch(u)
    const d = await r.json()
    const pages = Object.values(d.query?.pages ?? {})
    out.wikiUncharted = pages[0]?.original?.source?.slice(0, 90) ?? null
  } catch (e) {
    out.wikiError = String(e).slice(0, 80)
  }
  // (c) TMDB poster for an anime title
  try {
    const r = await fetch(
      `https://api.themoviedb.org/3/search/tv?api_key=${tk}&query=${encodeURIComponent('Fire Force')}`,
    )
    const d = await r.json()
    out.tmdbFireForce = d.results?.[0]?.poster_path ?? null
  } catch (e) {
    out.tmdbError = String(e).slice(0, 80)
  }
  return out
}, tmdbKey)
console.log(JSON.stringify(result, null, 2))
await browser.close()
