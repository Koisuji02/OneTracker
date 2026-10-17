# Handoff — where OneTracker stands, and what's next

Last updated: **2026-10-16**. Read this first when the user says "ripartiamo".

## 1. Snapshot

| | |
|---|---|
| Version | **1.0.41** (versionCode 41) — `android/app/build.gradle` is the single source |
| Branches | work on `release/store-launch`; `main` is fast-forwarded to it (both pushed, in sync) |
| Repo | `github.com/Koisuji02/OneTracker` — **public** (never commit secrets) |
| Web app | https://onetracker.onetracker.workers.dev — `/` app, `/home` page for Google, `/privacy` policy |
| Gateway | `onetracker-api` Worker (`worker/`), `/health` reports keys, pools and advice |
| Builds | gitignored `builds/<version>/` up to `builds/1.0.41/` (debug + release APK, AAB, unsigned IPA) |
| Phone status | 1.0.37 release confirmed working on the user's Android. 1.0.39 approved by the user (recap share image refined in 1.0.40). **1.0.41 handed over, no feedback yet** |

## 2. What has been done (in order)

**Core app (Aug–Sep 2026).** Tracker for tv/anime/movie/book/manga/game with Continue
lists ordered by activity, rewatch rounds (x2, x3…) on units and on one-shot media
("Ri-inizia xN"), collections (Favourites, Archive, Owned, "Da prendere" with a dollar
icon), user lists, catalogue, TV Time import, Android home-screen widget (RemoteViews,
no wobble/pop), 8+ AMOLED themes, squared Stash-like UI (radius scale in `index.css`),
` | ` separator everywhere.

**Games.** Length from HowLongToBeat (via the gateway), IGDB as primary data source,
per-playthrough time (db v8): every finished run has its own hours (typed on a 5-digit
roller or "use HLTB"), removing a run removes its time. DLC/expansions on the base game's
page; scenic key-art backdrops.

**Stats and fun.** Rating medals bronze ≥8 / silver ≥8.5 / gold ≥9 / diamond 10. Clash
(knockout tournament between favourites, `/clash`). Achievements = **"Obiettivi"** in
Italian (`/achievements`, 123 rows × 4 medals, derived and retroactive, toast pop-ups).
**Cronologia** (`/history?m=YYYY-MM`, 2026-10-11): month by month, covers by media,
totals as tiles, ← stops at the first month with data, → at the current month.
**Monthly recap** (Spotify-Wrapped style, centred slides, tiles on the closing card):
opens by itself once per device on the last day of the month (or at the first opening
after it), and on demand from Cronologia.

**1.0.39 (2026-10-16).** Recap **share button** (top bar + closing card): a 1080×1920
image drawn on a canvas (`src/recapShare.ts`) goes to the system share sheet
(`@capacitor/share` + `@capacitor/filesystem`) — Instagram, WhatsApp… — with no text or
link attached. **Font Figtree** (bundled via `@fontsource-variable/figtree`, a free
Circular-like face) replaces the Inter/system stack. **Games in progress** now show in
Cronologia/recap in every month from their start to the month they're beaten in
(`playStartedAt` on the item, `startedAt` on each run; older games fall back to
`lastReadAt`), with a "giochi in corso" tile.

**1.0.40 (2026-10-16).** The share image shows EVERY title of the month, up to 18, in
an adaptive grid (≤ 3 rows × 6 columns, the shape with the biggest covers wins); covers
a canvas can't read (CDNs without CORS) go through `CapacitorHttp`, and one that still
fails is skipped instead of leaving a hole.

**1.0.41 (2026-10-17).** The Android widget uses Figtree too (`res/font`, styles in
`values-v26/widget_text.xml`), the last item before the Play Store work.

**Accounts and sync.** Google sign-in on Android (offline mode → refresh token minted by
the gateway, so the Drive backup runs in the background forever), web (GIS) and iOS (its
own OAuth client). **Multi-device sync**: `drive.syncDrive()` pulls, MERGES
(`backup.mergeBackup`, idempotent and convergent, tested) and pushes; manual "Ripristina"
still replaces.

**Store readiness.** About screen with TMDB's mandatory notice and every provider
credit; privacy policy (`public/privacy.html`, `docs/PRIVACY.md`); target API 36;
release signing (upload key SHA-1 `C0:8B:C0:C5:92:80:C9:38:A6:FD:C5:37:1C:C9:79:69:B6:0C:A6:89`,
debug `82:C9:0E:82:FE:4D:54:A7:62:69:58:12:C8:8A:86:4C:B4:55:FE:10`); web app deployed
with `/home` (Google refused the root, which shows the onboarding) and Search Console
domain verification (passed; `site/worker.js` serves the `.html` file with a 200).
Pinch/double-tap zoom blocked (viewport, `touch-action`, Safari gesture events).

**iOS without a Mac (2026-09-29).** `ios/` (Capacitor, Swift Package Manager), built by
GitHub Actions on every push (`ios.yml`, unsigned IPA artifact) and a manual TestFlight
workflow (`ios-testflight.yml`) waiting for the Apple secrets. iOS OAuth client created
and wired (secret `VITE_GOOGLE_CLIENT_ID_IOS`, variable `GOOGLE_IOS_URL_SCHEME`).

**Gateway on autopilot (2026-09-29).** `worker/src/edge.js`: comma-separated **key pools**
per provider (a spent key rests, the next one answers), responses kept 30 days past
freshness (`STALE` / `STALE-ERROR` instead of errors), per-IP rate limits, `/health`
with `pools` + `advice` (also shown in the app: Settings → provider check → Gateway).
Unit-tested (`npm run test:worker`), verified live.

**Docs.** `docs/CODEBASE.md` (every file), `docs/PRODUCTION.md` (costs, limits,
checklists, iOS recipe), `worker/README.md` (gateway, §7 autopilot).

## 3. What's next — in the user's order

The user's stated plan: **Play Store first, then check the user load, then iOS**.

### 3a. Things only the user can do (guide them step by step, in Italian)

1. **Google Cloud** (free) — confirm these are done; the release login working on
   1.0.37 suggests the first one is:
   - Android OAuth client for the **release** SHA-1 (one client per signing key).
   - Web client → authorised JavaScript origin `https://onetracker.onetracker.workers.dev`.
   - OAuth consent screen **published to Production** (in Testing, refresh tokens die
     after 7 days and only listed test users can sign in). Non-sensitive scopes only →
     no review, no 100-user cap.
2. **Play Store** ($25 once):
   - developer account (identity check), create the app (free).
   - store listing: icon 512², feature graphic 1024×500, phone screenshots, short/long
     description (Claude can write the texts IT/EN and make the graphics from the logo),
     privacy URL `/privacy`, content rating questionnaire, target audience 13+, **Data
     safety: no data collected, none shared**.
   - **closed test with ≥12 testers for 14 consecutive days** (the long pole: start it as
     soon as the account exists), uploading the latest `builds/<v>/OneTracker-<v>-release.aab`.
   - after the upload: add the **Play App Signing SHA-1** (Play Console → App integrity)
     as a further Android OAuth client, or sign-in breaks for store installs.
   - after 14 days: apply for production → review → publish.
   - back up `android/keystore/onetracker-upload.jks` + `android/keystore.properties`
     somewhere off this PC.
3. **iPhone test** (free): Sideloadly + iTunes (from apple.com) on Windows, install
   the latest `builds/<v>/OneTracker-<v>-ios-unsigned.ipa` with a free Apple ID, keeping the
   bundle id `com.onetracker.app`; trust the profile + Developer Mode on the phone.
   Check onboarding, notch/safe areas, edge-swipe back, Google sign-in → same library.
4. **Apple** (optional, $99/year — the project's only recurring cost): only after the
   iPhone test is good. Steps in `docs/PRODUCTION.md` §6 (certificate via OpenSSL on
   Windows, profile, App Store Connect API key, then run "iOS TestFlight").
5. **API keys at launch**: one key per provider is enough today; when going public add a
   2nd OMDb key and a 2nd Twitch/IGDB app (`wrangler secret put … ` with a
   comma-separated list, no deploy). Afterwards only when `/health` `advice` says so.

### 3b. Claude's next tasks

1. **Get feedback on 1.0.38–1.0.39** (Cronologia, recap, no zoom, share on Instagram,
   the new font, games in progress) and fix whatever comes up. Sharing and "Save image"
   can only be checked on the phones.
2. **Play Store support**: write the listing texts (IT + EN), produce icon 512 and
   feature graphic 1024×500 from `public/logo.png`, list the exact Data safety / content
   rating answers, walk the user through the console.
3. **"Controllare la questione carico utenti"** (the user's words): review real capacity
   before going public — Cloudflare free = 100k requests/day ≈ 2,000–2,500 daily users
   (every request counts, cached or not), then $5/month; provider quotas only count cache
   MISSES (OMDb ~1k distinct titles/day is the first ceiling). Ideas: check Cloudflare
   analytics, a careful load test against a `wrangler dev` copy (NOT production — it
   would burn the shared quotas), make sure the app degrades quietly (it does: stale
   answers, silent ratings/comics).
4. **Code walkthrough, file by file** — promised and started. The user asks about each
   file and we comment together. **Done: Tappa 1** (`main.tsx`, `App.tsx`). Next, in this
   order: 2 `settings.ts`, `themes.ts`, `i18n.ts`, `index.css` · 3 `types.ts`, `db.ts`,
   `backup.ts`, `sync.ts`, `drive.ts`, `achievements.ts`, `clash.ts`, `history.ts` ·
   4 `api/` (index, gateway, tmdb, igdb, hltb, mangadex…) · 5 components · 6 pages ·
   7 Android widget (Java) · 8 gateway (`worker/`) · 9 iOS and CI. Use
   `docs/CODEBASE.md` as the map.

## 4. Infrastructure map (names only — values live in `.env`, Worker secrets, GitHub secrets)

- **Cloudflare**: Worker `onetracker` (web app, root `wrangler.jsonc`, plus the one-path
  `site/worker.js`), Worker `onetracker-api` (gateway, `worker/wrangler.toml`). Gateway
  secrets: `APP_TOKEN`, `TMDB_KEY`, `RAWG_KEY`, `OMDB_KEY`, `COMICVINE_KEY`,
  `IGDB_CLIENT_ID`, `IGDB_CLIENT_SECRET`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`;
  rate-limit bindings `RL_API` (120/60 s) and `RL_HEAVY` (40/60 s, HLTB).
- **App build-time config** (`.env`, gitignored): `VITE_GATEWAY_URL`,
  `VITE_GATEWAY_TOKEN`, `VITE_GOOGLE_CLIENT_ID_WEB`, `VITE_GOOGLE_CLIENT_ID_ANDROID`,
  `VITE_GOOGLE_CLIENT_ID_IOS`, `VITE_STEAMGRIDDB_KEY`.
- **GitHub** (repo secrets for CI): the same `VITE_*` values; variable
  `GOOGLE_IOS_URL_SCHEME`. TestFlight still needs the `APPLE_*` / `ASC_*` secrets.
- **Google Cloud** project `1084495191593`: OAuth clients Web, Android (debug + release
  SHA-1; Play App Signing one still to add), iOS. Scopes: `drive.appdata`, email, profile.
- **Signing**: `android/keystore/onetracker-upload.jks` + `android/keystore.properties`
  (both gitignored; the password is in the properties file — never copy it into a doc).

## 5. Known limits and open decisions

- Cronologia keeps only an episode's or film's **latest** date: a rewatch moves it to the
  rewatch's month (games keep every run's date). By design: history is derived, nothing
  new is stored.
- "Da prendere" excludes archived items (a two-word change if the user wants them).
- The Android widget has no iOS counterpart (would be a WidgetKit extension in Swift).
- The login plugin bundles the Facebook SDK on iOS (unused); it may show in App Store
  Connect's privacy report — exclude it if review complains.
- `npm run android:apk` is still broken on Windows (see CLAUDE.md for the working
  command); fixing the script was offered and never answered.
