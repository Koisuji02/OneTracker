# OneTracker (repo: TVTimeRevamp) — instructions for Claude

**If the user says "ripartiamo" (or opens a session without context): read
[docs/HANDOFF.md](docs/HANDOFF.md) first.** It is the state of the project, what has
been done, and the ordered plan of what's next. Then answer in Italian with a short
recap and propose the next step from its "What's next" list. Keep HANDOFF.md updated
when a milestone lands, so the next session can start from it too.

## The project, in one line

OneTracker is a TV Time–style tracker for series, anime, films, books, manga/comics and
games: React + Vite + TypeScript + Dexie (IndexedDB) wrapped with Capacitor for Android
and iOS, a web version on Cloudflare Workers, and a Cloudflare Worker gateway (`worker/`):
a cache shared by all users in front of the providers (TMDB and IGDB on the app's own
keys; Comic Vine and OMDb, both optional, on the user's own, via in-app guides). No backend database:
the library lives on the device and backs up to the user's own Google Drive.

Map of the docs:
- [docs/HANDOFF.md](docs/HANDOFF.md) — where we are and what's next (start here)
- [docs/CODEBASE.md](docs/CODEBASE.md) — every file, the layers, the invariants
- [docs/PRODUCTION.md](docs/PRODUCTION.md) — costs, limits, store checklist, iOS without a Mac
- [docs/LOAD_TEST.md](docs/LOAD_TEST.md) — what each action costs, the load simulation (`scripts/stress/`) and its results
- [docs/STORE_LISTING.md](docs/STORE_LISTING.md) — Play listing texts IT/EN, console answers, how to regenerate the store images
- [worker/README.md](worker/README.md) — the gateway: deploy, secrets, key pools, stale cache

## Working with the user (Mattia)

- **Always reply in Italian.** Code, comments, docs and commit messages stay in English.
- **Commits carry only the user's name.** Never add a `Co-Authored-By` trailer or any
  mention of Claude; one-line, lean commit messages. Work on `release/store-launch`,
  then fast-forward `main` and push both.
- **After every feature or fix: build the APK and hand it over.** Finished builds go in
  the gitignored `builds/<version>/` folder (`OneTracker-<v>-debug.apk`, `-release.apk`,
  `-release.aab`, `-ios-unsigned.ipa`), never the Desktop. Bump `versionCode` /
  `versionName` in `android/app/build.gradle` (the single source of the version) and the
  mirrored `MARKETING_VERSION` / `CURRENT_PROJECT_VERSION` in
  `ios/App/App.xcodeproj/project.pbxproj` when a build goes to testers.
- **"Non rompere nulla"**: change only what was asked, and verify in the browser preview
  before building (see the testing notes below).
- UI conventions the user asked for: squared, Stash-like corners (the radius scale is
  overridden in `src/index.css` — change radii there, not at call sites); no pills; the
  separator is ` | `, never `•`; new screens centred, tidy, consistent with the app.
- The user has said the provider keys / OAuth values are a test environment and may be
  read from `.env` when needed. **The repo is public: never commit a secret**, never put
  one in a doc.

## Commands that actually work on this machine (Windows)

- Typecheck + web build: `npm run build` (`tsc -b && vite build`); lint: `npm run lint`.
- **APK**: `npm run android:apk` is broken (cmd can't find `gradlew`). Use
  `npm run android:sync`, then `cd android && ./gradlew.bat assembleDebug assembleRelease bundleRelease --console=plain`
  (run it in the background). Release signing reads the gitignored
  `android/keystore.properties` + `android/keystore/onetracker-upload.jks`.
- After building, check the APK carries the NEW web bundle (grep a string you just
  added in `android/app/src/main/assets/public/assets/*.js`). `capacitor.config.ts` must
  keep `webDir: 'dist/client'`.
- `npx cap sync` rewrites `ios/App/CapApp-SPM/Package.swift` with Windows backslashes:
  normalise them to `/` before committing.
- **iOS** is built by GitHub Actions (`.github/workflows/ios.yml`, every push) — there is
  no Mac. Get the IPA with `gh run download <run-id>`.
- Web app deploy: `npm run deploy` (root `wrangler.jsonc`, Worker `onetracker`).
- Gateway deploy: `cd worker && ../node_modules/.bin/wrangler deploy -c wrangler.toml`.
  Gateway tests: `npm run test:worker`. If wrangler's login expired, run
  `wrangler login` as a background task and let the user approve it in the browser.
- Live checks with `curl` (Cloudflare blocks Python's user agent on the gateway); the
  gateway wants the header `X-OT-Token` = `VITE_GATEWAY_TOKEN` from `.env`.
- Bash heredocs that contain backticks or mixed quotes break in this shell: write
  helper scripts with the Write tool, then run them.

## Testing in the browser preview

- `.claude/launch.json` → `vite-dev` on port 5173. The app uses a **HashRouter**
  (`location.hash = '#/account'`).
- Skip onboarding: `localStorage['onetracker.settings'] = {"language":"it","onboarded":true,"showBooks":true,"showGames":true}`, reload.
- Seed data through the app's own module: `const m = await import('/src/db.ts')`, then
  `m.db.items.bulkPut(...)` / `m.db.episodes.bulkPut(...)`. Use provider ids that don't
  exist (the sync pass overwrites real TMDB ids with real titles). Clear the tables and
  the settings key when done.
- The widget, Google sign-in and native plugins can't be checked in the browser: those
  are verified by the user on the phone.
