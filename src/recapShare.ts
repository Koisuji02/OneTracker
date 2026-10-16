/**
 * Sharing the month recap, Spotify-Wrapped style: the month is drawn as ONE
 * story-sized image (1080×1920, what Instagram Stories expects) and handed to
 * the system share sheet, so it goes wherever the phone can send a picture —
 * Instagram (story, feed, DM), WhatsApp, Telegram, the gallery…
 *
 * Only the image travels: no caption, no link, no text. The receiving app opens
 * with the picture and the user does the rest, exactly as when sharing a photo.
 *
 * The card is drawn on a canvas rather than screenshotted from the DOM: the
 * slides use blur filters and remote covers, which DOM-to-image tricks get
 * wrong (and taint the canvas). Covers come from the offline image cache when
 * they are there, so sharing works with no network too.
 */
import { Capacitor, CapacitorHttp } from '@capacitor/core'
import { Directory, Filesystem } from '@capacitor/filesystem'
import { Share } from '@capacitor/share'
import { db } from './db'
import { monthLabel } from './history'
import type { Language } from './settings'

const W = 1080
const H = 1920
const PAD = 90
const FONT = '"Figtree Variable", "Figtree", system-ui, sans-serif'
/** Covers on the card at most: 3 rows of 6. */
const MAX_COVERS = 18

export interface RecapCard {
  ym: string
  lang: Language | null
  /** "Il tuo" / "Your" */
  lead: string
  /** label over the time, e.g. "Tempo media" */
  timeLabel: string
  /** the month's time, already formatted ("38 h 20 min"), or null for none */
  time: string | null
  tiles: Array<{ value: number; label: string }>
  /** cover URLs, biggest first — every title of the month, the card keeps the first 18 that load */
  covers: string[]
}

// ----------------------------------------------------------------- images

/**
 * The bytes of a CDN that sends no CORS headers: an `<img>` shows it, a canvas
 * may not read it. In the app the native HTTP bridge fetches it anyway.
 */
async function nativeBlob(url: string): Promise<Blob | undefined> {
  if (!Capacitor.isNativePlatform()) return undefined
  const res = await CapacitorHttp.get({ url, responseType: 'blob' })
  if (res.status < 200 || res.status >= 300 || typeof res.data !== 'string') return undefined
  const bin = atob(res.data)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return new Blob([bytes])
}

/** The cover's bytes: the offline cache first, then the network, then the native bridge. */
async function loadImage(url: string): Promise<ImageBitmap | null> {
  let blob: Blob | undefined
  try {
    blob = (await db.images.get(url))?.blob
  } catch {
    // no IndexedDB: straight to the network
  }
  if (!blob) {
    try {
      const res = await fetch(url, { mode: 'cors', cache: 'force-cache' })
      if (res.ok) blob = await res.blob()
    } catch {
      // no CORS, or no network: the native bridge may still get it
    }
  }
  try {
    if (!blob) blob = await nativeBlob(url)
    return blob ? await createImageBitmap(blob) : null
  } catch {
    return null
  }
}

/**
 * The grid for `n` covers in a `width × height` box: at most 3 rows of 6, and
 * of all the shapes that fit, the one with the BIGGEST covers — 4 covers make
 * a 2×2, 7 a 4+3, 18 a full 6×3. Never wider than `maxW`, so one or two
 * covers don't swell to fill the card.
 */
function coverGrid(n: number, width: number, height: number, gap: number, maxW: number) {
  let best = { cols: 1, w: 0 }
  for (let cols = 1; cols <= 6; cols++) {
    const rows = Math.ceil(n / cols)
    if (rows > 3 || cols > n) continue
    const w = Math.min((width - gap * (cols - 1)) / cols, (height - gap * (rows - 1)) / rows / 1.5, maxW)
    if (w > best.w + 0.5) best = { cols, w }
  }
  return { cols: best.cols, rows: Math.ceil(n / best.cols), w: best.w, h: best.w * 1.5 }
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath()
  if (ctx.roundRect) ctx.roundRect(x, y, w, h, r)
  else ctx.rect(x, y, w, h)
}

/** object-fit: cover, clipped to the squared corners the app uses. */
function drawCover(ctx: CanvasRenderingContext2D, img: ImageBitmap | null, x: number, y: number, w: number, h: number) {
  ctx.save()
  roundRect(ctx, x, y, w, h, w < 160 ? 10 : 14)
  ctx.fillStyle = '#1f1f26'
  ctx.fill()
  if (img) {
    ctx.clip()
    const scale = Math.max(w / img.width, h / img.height)
    const dw = img.width * scale
    const dh = img.height * scale
    ctx.drawImage(img, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh)
  }
  ctx.restore()
}

/** The biggest size (≤ max) at which `text` fits in `width`. */
function fitFont(ctx: CanvasRenderingContext2D, text: string, weight: number, max: number, width: number): number {
  let size = max
  for (; size > 24; size -= 4) {
    ctx.font = `${weight} ${size}px ${FONT}`
    if (ctx.measureText(text).width <= width) break
  }
  return size
}

// ------------------------------------------------------------------- draw

export async function renderRecapCard(card: RecapCard): Promise<Blob> {
  // the canvas only uses a web font that is already loaded
  await Promise.all(
    [500, 700, 800, 900].map((w) => document.fonts?.load(`${w} 64px "Figtree Variable"`).catch(() => null)),
  )
  const css = getComputedStyle(document.documentElement)
  const brand = css.getPropertyValue('--brand').trim() || '#ffd60a'

  const canvas = document.createElement('canvas')
  canvas.width = W
  canvas.height = H
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('no-canvas')
  ctx.textAlign = 'center'
  ctx.textBaseline = 'alphabetic'

  ctx.fillStyle = '#0e0e12'
  ctx.fillRect(0, 0, W, H)

  // the month, on the theme's colour — the recap's opening slide, in short
  const top = card.time ? 720 : 560
  ctx.fillStyle = brand
  ctx.fillRect(0, 0, W, top)
  ctx.fillStyle = 'rgba(0,0,0,0.7)'
  ctx.font = `800 36px ${FONT}`
  ctx.letterSpacing = '8px'
  ctx.fillText(card.lead.toUpperCase(), W / 2, 170)
  ctx.letterSpacing = '0px'
  const month = monthLabel(card.ym, card.lang, false)
  ctx.fillStyle = '#000'
  ctx.font = `900 ${fitFont(ctx, month, 900, 170, W - PAD * 2)}px ${FONT}`
  ctx.fillText(month, W / 2, 335)
  ctx.fillStyle = 'rgba(0,0,0,0.45)'
  ctx.font = `800 64px ${FONT}`
  ctx.fillText(card.ym.slice(0, 4), W / 2, 425)
  if (card.time) {
    ctx.fillStyle = 'rgba(0,0,0,0.7)'
    ctx.font = `800 30px ${FONT}`
    ctx.letterSpacing = '6px'
    ctx.fillText(card.timeLabel.toUpperCase(), W / 2, 540)
    ctx.letterSpacing = '0px'
    ctx.fillStyle = '#000'
    ctx.font = `900 ${fitFont(ctx, card.time, 900, 110, W - PAD * 2)}px ${FONT}`
    ctx.fillText(card.time, W / 2, 650)
  }

  // every cover of the month (up to 18, in a grid shaped by how many there
  // are) and the totals as the app's tiles, centred together under the month.
  // A cover that can't be loaded is left out rather than drawn as a hole.
  const gap = 24
  const images: ImageBitmap[] = []
  for (let i = 0; i < card.covers.length && images.length < MAX_COVERS; i += MAX_COVERS) {
    const batch = await Promise.all(card.covers.slice(i, i + MAX_COVERS).map(loadImage))
    for (const img of batch) if (img && images.length < MAX_COVERS) images.push(img)
  }
  const tiles = card.tiles.slice(0, 6)
  const perRow = Math.min(3, tiles.length)
  const tw = perRow > 0 ? (W - PAD * 2 - gap * (perRow - 1)) / perRow : 0
  const th = 160
  const tileRows = perRow > 0 ? Math.ceil(tiles.length / perRow) : 0
  const tilesH = tileRows > 0 ? tileRows * th + (tileRows - 1) * gap : 0
  const cgap = 20
  const grid = coverGrid(images.length, W - PAD * 2, H - top - 120 - tilesH - (tilesH ? 50 : 0), cgap, 300)
  const coversH = images.length > 0 ? grid.rows * grid.h + (grid.rows - 1) * cgap : 0
  const blockH = coversH + (coversH && tilesH ? 50 : 0) + tilesH
  let y = top + Math.max(60, (H - top - blockH) / 2)

  if (images.length > 0) {
    const { cols, w, h } = grid
    for (let n = 0; n < images.length; n++) {
      const r = Math.floor(n / cols)
      const inRow = Math.min(cols, images.length - r * cols)
      // a short last row is centred, like the rest of the card
      const x0 = (W - (inRow * w + (inRow - 1) * cgap)) / 2
      drawCover(ctx, images[n], x0 + (n % cols) * (w + cgap), y + r * (h + cgap), w, h)
    }
    y += coversH + 50
  }

  for (let n = 0; n < tiles.length; n++) {
    const r = Math.floor(n / perRow)
    const inRow = Math.min(perRow, tiles.length - r * perRow)
    const x0 = (W - (inRow * tw + (inRow - 1) * gap)) / 2
    const x = x0 + (n % perRow) * (tw + gap)
    const ty = y + r * (th + gap)
    if (ty + th > H - 60) break
    roundRect(ctx, x, ty, tw, th, 14)
    ctx.fillStyle = '#17171c'
    ctx.fill()
    ctx.fillStyle = '#f4f4f5'
    ctx.font = `900 68px ${FONT}`
    ctx.fillText(String(tiles[n].value), x + tw / 2, ty + 82)
    ctx.fillStyle = '#a1a1aa'
    ctx.font = `700 ${fitFont(ctx, tiles[n].label, 700, 30, tw - 24)}px ${FONT}`
    ctx.fillText(tiles[n].label, x + tw / 2, ty + 128)
  }

  return await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('no-blob'))), 'image/png'),
  )
}

// ------------------------------------------------------------------ share

function toBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '')
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(blob)
  })
}

/** Closing the share sheet without picking anything is not an error. */
function cancelled(err: unknown): boolean {
  const msg = err instanceof Error ? `${err.name} ${err.message}` : String(err)
  return /cancel|abort/i.test(msg)
}

/**
 * Hand the image to the system share sheet. Native: written to the app's
 * cache (shared through the FileProvider), then Share. Web: the Web Share API
 * with a file where the browser has it, a plain download where it doesn't.
 * Resolves quietly when the user just closes the sheet.
 */
export async function shareImage(blob: Blob, name: string, dialogTitle: string): Promise<void> {
  try {
    if (Capacitor.isNativePlatform()) {
      const { uri } = await Filesystem.writeFile({
        path: name,
        data: await toBase64(blob),
        directory: Directory.Cache,
      })
      await Share.share({ files: [uri], dialogTitle })
      return
    }
    const file = new File([blob], name, { type: 'image/png' })
    if (navigator.canShare?.({ files: [file] })) {
      await navigator.share({ files: [file] })
      return
    }
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = name
    a.click()
    setTimeout(() => URL.revokeObjectURL(url), 10_000)
  } catch (err) {
    if (!cancelled(err)) throw err
  }
}
