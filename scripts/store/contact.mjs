// Contact sheet of a folder of PNGs (for reviewing captures at a glance).
// Usage: node scripts/store/contact.mjs <dir> <out.png> [thumbWidth] [cols]
import sharp from 'sharp'
import { readdirSync } from 'node:fs'

const [dir, out, tw = '300', colsArg = '6'] = process.argv.slice(2)
const files = readdirSync(dir).filter((f) => f.endsWith('.png')).sort()
const w = Number(tw)
const cols = Number(colsArg)
const thumbs = await Promise.all(files.map((f) => sharp(`${dir}/${f}`).resize({ width: w }).png().toBuffer({ resolveWithObject: true })))
const h = Math.max(...thumbs.map((t) => t.info.height))
const rows = Math.ceil(files.length / cols)
await sharp({ create: { width: cols * (w + 10) + 10, height: rows * (h + 10) + 10, channels: 3, background: '#555' } })
  .composite(thumbs.map((t, i) => ({ input: t.data, left: 10 + (i % cols) * (w + 10), top: 10 + Math.floor(i / cols) * (h + 10) })))
  .png()
  .toFile(out)
console.log(files.join(' '))
