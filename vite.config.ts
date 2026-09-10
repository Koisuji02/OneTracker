import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

import { cloudflare } from "@cloudflare/vite-plugin";

/**
 * Content-Security-Policy for the shipped app (APK / deployed build).
 *
 * Defense in depth: the UI renders provider text through React (escaped) and
 * the codebase has no innerHTML/eval sink, so there is no known injection path
 * — this is here so that if one ever appears, it can't load a remote script or
 * phone anything home over plain http.
 *
 * The loose parts are deliberate and not oversights:
 * - `img-src https:` — artwork comes from a dozen provider CDNs (TMDB, AniList,
 *   MangaDex, RAWG/IGDB, Open Library, Steam, Wikimedia…) and pinning that list
 *   would break covers the day a provider moves host. `blob:` is the offline
 *   cache, `data:` the avatars.
 * - `connect-src https:` — same reasoning for the APIs, plus the user's own
 *   gateway URL, which is configurable at runtime and unknowable at build time.
 * - `style-src 'unsafe-inline'` — React style props and the theme's CSS
 *   variables are style ATTRIBUTES.
 * What it does buy: no remote scripts beyond Google Identity, no plain-http
 * subresources, no plugins, no base-tag hijack, no form posts.
 *
 * Injected at BUILD time only: the dev server needs its HMR websocket, and a
 * meta tag in index.html would kill it.
 */
const CSP = [
  "default-src 'self'",
  "script-src 'self' https://accounts.google.com",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' https: data: blob:",
  "font-src 'self' data:",
  "connect-src 'self' https:",
  "frame-src https://accounts.google.com",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join('; ')

function cspMeta(): Plugin {
  return {
    name: 'onetracker-csp',
    apply: 'build',
    transformIndexHtml(html) {
      return html.replace(
        '<meta charset="UTF-8" />',
        `<meta charset="UTF-8" />\n    <meta http-equiv="Content-Security-Policy" content="${CSP}" />`,
      )
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss(), cloudflare(), cspMeta()],
})
