// Probe #3: Steam art variants, Wikipedia thumb, TMDB with proper v4 auth.
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
      const t = setTimeout(() => resolve(false), 8000)
      img.onload = () => { clearTimeout(t); resolve(true) }
      img.onerror = () => { clearTimeout(t); resolve(false) }
      img.src = url
    })
  out.steam_2x = await imageExists('https://cdn.cloudflare.steamstatic.com/steam/apps/495140/library_600x900_2x.jpg')
  out.steam_1x = await imageExists('https://cdn.cloudflare.steamstatic.com/steam/apps/495140/library_600x900.jpg')
  out.steam_akamai = await imageExists('https://steamcdn-a.akamaihd.net/steam/apps/495140/library_600x900.jpg')
  out.steam_shared = await imageExists('https://shared.cloudflare.steamstatic.com/store_item_assets/steam/apps/495140/library_600x900.jpg')
  // Wikipedia: thumbnail via pithumbsize (more reliable than piprop=original)
  try {
    const u =
      'https://en.wikipedia.org/w/api.php?action=query&format=json&formatversion=2&origin=*' +
      '&generator=search&gsrsearch=' + encodeURIComponent('Uncharted 4: A Thief\'s End') +
      '&gsrlimit=1&prop=pageimages&pithumbsize=600'
    const r = await fetch(u)
    const d = await r.json()
    out.wiki = d.query?.pages?.[0]?.thumbnail?.source?.slice(0, 100) ?? null
  } catch (e) {
    out.wikiError = String(e).slice(0, 80)
  }
  // TMDB: v4 token → Authorization header, v3 → api_key param
  try {
    const isV4 = tk.startsWith('ey')
    const url = 'https://api.themoviedb.org/3/search/tv?query=' + encodeURIComponent('Fire Force') + (isV4 ? '' : `&api_key=${tk}`)
    const r = await fetch(url, isV4 ? { headers: { Authorization: `Bearer ${tk}` } } : undefined)
    const d = await r.json()
    out.tmdbStatus = r.status
    out.tmdbPoster = d.results?.[0]?.poster_path ?? null
  } catch (e) {
    out.tmdbError = String(e).slice(0, 80)
  }
  return out
}, tmdbKey)
console.log(JSON.stringify(result, null, 2))
await browser.close()
