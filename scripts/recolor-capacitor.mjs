// Recolor the original Capacitor logo (blue mark on white) to yellow-on-black.
// The mark is darker than the white background and the faint grid, so a
// luminance threshold isolates it as a mask; we then paint that mask yellow on
// a black field. Output: yellow-on-transparent + a yellow-on-black preview.
import sharp from 'sharp'

const srcPng = process.argv[2]
const outYellowTransparent = process.argv[3]
const outPreview = process.argv[4]

const base = sharp(srcPng).flatten({ background: '#FFFFFF' })
const { width, height } = await base.metadata()

// mask: mark (dark) → 255, background + faint grid (light) → 0
const mask = await base
  .clone()
  .greyscale()
  .threshold(210) // >=210 white, else black
  .negate()
  .toBuffer()

const yellow = await sharp({
  create: { width, height, channels: 3, background: '#FFEA00' },
})
  .joinChannel(mask)
  .png()
  .toBuffer()

if (outYellowTransparent) await sharp(yellow).png().toFile(outYellowTransparent)
if (outPreview)
  await sharp({ create: { width, height, channels: 3, background: '#000000' } })
    .composite([{ input: yellow }])
    .png()
    .toFile(outPreview)

console.log('recolored', srcPng)
