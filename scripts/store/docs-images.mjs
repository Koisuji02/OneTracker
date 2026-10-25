// Store images, step 3: the light copies the repo itself ships, made from the
// Play images (compose.mjs) and the raw widget capture (shoot.mjs).
//
//   node scripts/store/docs-images.mjs
//
// Output:
// - docs/img/: icon, feature graphic and the 8 English screenshots, for the README
// - public/help/widget-<lang>.webp: the widget preview shown in Settings and Help
import { mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
import sharp from 'sharp'

const PLAY = resolve('builds/store/play')
const RAW = resolve('builds/store/raw')
const DOCS = resolve('docs/img')
const HELP = resolve('public/help')
mkdirSync(DOCS, { recursive: true })
mkdirSync(HELP, { recursive: true })

await sharp(`${PLAY}/icon-512.png`).resize(160).png().toFile(`${DOCS}/icon.png`)
await sharp(`${PLAY}/en/feature-graphic.png`).webp({ quality: 82 }).toFile(`${DOCS}/feature-graphic.webp`)
for (let n = 1; n <= 8; n++) {
  await sharp(`${PLAY}/en/screenshot-${n}.png`)
    .resize(540)
    .webp({ quality: 80 })
    .toFile(`${DOCS}/screenshot-${n}.webp`)
}

// the widget block of the home-screen capture (1170 px wide), with a little
// wallpaper around it so it still reads as "on your home screen"
for (const lang of ['it', 'en']) {
  await sharp(`${RAW}/${lang}/14-widget-home.png`)
    .extract({ left: 20, top: 320, width: 1130, height: 1380 })
    .resize(560)
    .webp({ quality: 82 })
    .toFile(`${HELP}/widget-${lang}.webp`)
}
console.log('docs/img and public/help updated')
