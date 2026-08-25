// Generate Android launcher icons from an app SVG logo.
// Usage: node scripts/gen-icons.mjs [public/logo.svg]
// - adaptive foreground: logo scaled into the safe zone on TRANSPARENT
// - legacy square + round: full logo on its own (black) background
// The adaptive background colour is set to black separately (Amoled look).
import sharp from 'sharp'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'

const src = process.argv[2] ?? 'public/logo.svg'
const RES = 'android/app/src/main/res'
const DENS = [
  ['mdpi', 48, 108],
  ['hdpi', 72, 162],
  ['xhdpi', 96, 216],
  ['xxhdpi', 144, 324],
  ['xxxhdpi', 192, 432],
]

const svg = readFileSync(src, 'utf8')
// foreground wants a transparent field: drop the full-canvas black backdrop
const svgNoBg = svg.replace(/<rect\s+width="(\d+(?:\.\d+)?)"\s+height="\1"\s+fill="black"\s*\/>/i, '')

const out = (p) => {
  mkdirSync(dirname(p), { recursive: true })
  return p
}

for (const [dpi, sq, fg] of DENS) {
  // legacy square + round: full logo (keeps its own black background)
  const square = await sharp(Buffer.from(svg))
    .resize(sq, sq, { fit: 'contain', background: '#000000' })
    .png()
    .toBuffer()
  writeFileSync(out(`${RES}/mipmap-${dpi}/ic_launcher.png`), square)
  writeFileSync(out(`${RES}/mipmap-${dpi}/ic_launcher_round.png`), square)

  // adaptive foreground: logo at ~72% centred on transparent (mask-safe)
  const inner = Math.round(fg * 0.72)
  const pad = Math.round((fg - inner) / 2)
  const foreground = await sharp(Buffer.from(svgNoBg))
    .resize(inner, inner, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .extend({ top: pad, bottom: pad, left: pad, right: pad, background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer()
  writeFileSync(out(`${RES}/mipmap-${dpi}/ic_launcher_foreground.png`), foreground)
}

// a 512px preview for eyeballing
await sharp(Buffer.from(svg)).resize(512, 512, { fit: 'contain', background: '#000000' })
  .png().toFile('scripts/icon-preview.png')

console.log('icons generated from', src)
