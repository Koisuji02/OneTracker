# OneTracker, file by file

A map of the whole codebase: what each file is for, and the one thing about it
that isn't obvious from its name. Read §1–§3 once and the rest becomes a
reference you can jump around in.

Companion docs: [API.md](API.md) (the service layer's contract),
[PRODUCTION.md](PRODUCTION.md) (cost, limits, release checklist),
[worker/README.md](../worker/README.md) (the gateway).

---

## 1. What the app IS, in one paragraph

A React + Vite web app, wrapped by Capacitor to become an Android app, whose
database is IndexedDB **on the device**. There is no backend and no account:
the library never leaves the phone except as a backup the user writes to their
own Google Drive. External catalogue data (TMDB, IGDB, …) is fetched directly
from the browser, optionally through a Cloudflare Worker that holds the API
keys. Everything you see is rendered from local data; the network only enriches
it.

That single fact explains most of the design: aggressive caching, "never let a
provider failure break a screen", and a service layer (`db.ts`) that pages call
instead of touching the database themselves.

## 2. The four layers

```
pages/ + components/     what you see        React, Tailwind
      ↓ calls
db.ts (+ settings, i18n) what is true        Dexie/IndexedDB, the service layer
      ↓ asks
api/                     what the world says providers, each behind one module
      ↓ optionally via
worker/                  the gateway         hides keys, unblocks hosts
```

Rules that hold everywhere:

- **Pages never write to Dexie directly.** They call functions from `db.ts`.
  That is what keeps status, counts and times consistent (see §5).
- **Status is derived, never typed in.** `recomputeStatus` decides
  planned/watching/completed from the units actually marked.
- **A provider failure is never fatal.** Every `api/` call has a timeout and a
  fallback; the worst case is a missing banner or an older cached answer.
- **The UI reads live data.** `useLiveQuery` (dexie-react-hooks) re-renders
  every affected screen when the database changes. Nothing is refreshed by hand.

## 3. Three flows that explain the rest

**Marking an episode.** `SeriesPage` renders the next unit from
`computeNextEpisode`. The ✓ calls `markUpTo(item, season, episode)`, which
writes the episode rows (cascading backwards over everything earlier),
recomputes the item's status, and stamps `lastReadAt`. Every list watching that
data re-renders: the card moves, the Profile stats change, the widget is
re-pushed. No page "knows" about the others.

**Opening a detail page.** `DetailPage` asks `getDetails(provider, type, id)`.
That is stale-while-revalidate: a cached payload renders instantly, and if it
is older than 6 h a background refetch updates it. The fresh result is merged
into the stored library item **conservatively** (`refreshItemMetadata`): a
provider that answers with nulls can never erase what you already had.

**The backup.** `buildBackup()` serialises items + episodes + lists + a few
settings to JSON. `drive.ts` gets an access token (silently if it can) and
PUTs it into the app's private Drive folder. `App.tsx` triggers this at launch,
every 10 minutes, and when the app goes to the background.

---

## 4. Every file

### Root / build

| File | What it is |
|---|---|
| `package.json` | Scripts. `android:sync` = build + copy into the Android project; `android:apk` is broken on Windows (see PRODUCTION.md), use `./gradlew.bat` |
| `vite.config.ts` | Build config, the CSP injected into the shipped HTML, and `__APP_VERSION__` read from `build.gradle` so the About screen can't show a stale version |
| `capacitor.config.ts` | App id `com.onetracker.app` and the WebView settings |
| `wrangler.jsonc` | Deploys the **web app** as a Worker. Not the gateway — that one is `worker/wrangler.toml`, and confusing the two sends secrets to the wrong place |
| `tsconfig*.json` | Strict TypeScript, `noUnusedLocals` on — an unused import fails the build |
| `src/vite-env.d.ts` | Vite's client types plus the `__APP_VERSION__` declaration |

### Shell and cross-cutting state

| File | What it is |
|---|---|
| `src/main.tsx` | Mounts React. Ten lines |
| `src/App.tsx` | Routes (HashRouter), the bottom nav, and four invisible workers: `NetworkSync` (catch-up pass), `DriveAutoSync` (backup timer), the widget drain, and the Android back-button handler |
| `src/index.css` | Theme variables, the **radius scale** (tightened to 3/5/7/9/11 px — change corner rounding HERE, not at call sites), safe-area helpers, two animations |
| `src/themes.ts` | The theme presets, including the AMOLED family built by the `amoled()` helper. `applyTheme` writes the CSS variables on `<html>` |
| `src/settings.ts` | All preferences in one localStorage object, with a `useSettings()` hook. Build-time `.env` keys act as defaults so a shipped APK works out of the box while a user can still override them |
| `src/i18n.ts` | Two flat dictionaries (en/it) and `useT()`. No interpolation by design: values are composed in JSX |
| `src/net.ts` | Online/offline state in one place, so screens can degrade instead of erroring |
| `src/util.ts` | `formatWatchTime`, `seasonEpisodeLabel` (the `S01 \| E04` format that sets the app's separator), `cn`, image error helpers |
| `src/types.ts` | Every shared shape. `MediaBase` → `MediaDetails` (provider data) → `LibraryItem` (adds your state). Read this file first when something is unclear |

### Data layer

| File | What it is |
|---|---|
| `src/db.ts` | **The heart, 1200 lines.** Dexie schema + migrations (v8 = per-playthrough game times) and every mutation. Status derivation, rewatch grades, game playthroughs, the stats, the sort helpers. If behaviour is wrong, it is almost always here |
| `src/backup.ts` | Backup/restore format (`version: 4`) and the file export. Deliberately excludes API keys and the Google refresh token |
| `src/sync.ts` | The catch-up pass: refresh the items that can have changed (still airing, date arrived), fill in missing game lengths and low-res game art, then push the Drive backup. Bounded, throttled to 30 min, silent on failure |
| `src/imageCache.ts` | Artwork stored as blobs in IndexedDB so the library still looks like itself offline, with an eviction budget |
| `src/importTvTime.ts` | TV Time importers, two zip formats auto-detected, matching by TVDB/IMDb id where possible |
| `src/drive.ts` | Google sign-in + Drive backup. The subtle part is the session: the access token lives in memory only, so `resumeGoogleSession()` re-mints it with no UI, and with the gateway configured the offline sign-in yields a **refresh token** that makes background backup work indefinitely |

### Providers (`src/api/`)

| File | What it is |
|---|---|
| `index.ts` | The dispatcher every page uses: `getDetails` (stale-while-revalidate + cache version), `getEpisodes` (cached per season), and the search rows that merge several providers into one list. Also `withGameLength`, which decides HLTB → IGDB → RAWG |
| `gateway.ts` | Rewrites provider URLs onto the Worker when one is configured. With no gateway, every function here is a no-op and the app calls providers directly |
| `http.ts` | `fetchTimeout` — the single place a provider URL becomes a gateway URL, and the hard timeout that stopped hung detail pages |
| `errors.ts` | `ApiKeyMissingError`, so the UI can say "add a key" instead of "something failed" |
| `titleMatch.ts` | Title normalisation and dedupe keys, shared by every cross-provider merge |
| `tmdb.ts` | TV, anime and films. One `/search/tv` feeds both rows, split client-side by genre + original language |
| `anilist.ts` | Anime/manga reference data. Aggregates AniList's season-per-entry model into one item with real seasons |
| `mangadex.ts` | Manga search, chapter counts, dates and chapter titles |
| `comicvine.ts` | Western comics. No CORS, so it loads via JSONP `<script>` when there is no gateway |
| `openlibrary.ts` | Books |
| `igdb.ts` | Games (primary). Needs the gateway: server-to-server Twitch token, no CORS. Also `igdbTimeToBeat`, the fallback game length |
| `rawg.ts` | Games fallback + Steam/Wikipedia box-art resolution |
| `hltb.ts` | HowLongToBeat lengths. No public API: goes through the gateway and matches by title + year, dropping anything it isn't sure about — a wrong match would silently corrupt the time stats |
| `ratings.ts` | The critic banners (OMDb, Jikan/MAL, AniList, MangaDex). All best-effort |
| `jikan.ts` | Keyless MAL mirror for real anime episode titles |
| `covers.ts` | Shared cover cache so a title looks the same in search and on its page |
| `tmdbPoster.ts` | TMDB poster lookup for anime, in its own module to avoid a circular import |
| `wikipedia.ts` | Infobox image fallback for game box art |
| `health.ts` | The Settings diagnostics: probes every provider and classifies the failure (down / bad key / blocked) |

### Components

| File | What it is |
|---|---|
| `Cover.tsx` | Every image in the app goes through it; serves bytes from the offline cache when it has them |
| `TrackCard.tsx` / `GridCard.tsx` | The list and grid forms of the same card. **Same props on purpose** — a page computes its state once and renders either |
| `PosterCard.tsx` | The library grid cover (rating badge, status icon, favourite) |
| `PosterGrid.tsx`, `MediaRow.tsx`, `PageHeader.tsx`, `EmptyState.tsx` | Layout primitives |
| `CheckButton.tsx` | The ✓. Unchecked = hollow outline, a rewatch round shows `xN` instead of the tick |
| `RatingBadge.tsx` | Your 0–10 score as a metal tile: bronze ≥8, silver ≥8.5, gold ≥9, diamond 10 |
| `RatingModal.tsx` | The rating sheet, with an emoji that follows the value |
| `RewatchDialog.tsx` | Tapping something already done: un-mark, log another time, or — for one-shot media — start a new round (`onRestart`) |
| `GameTimeDialog.tsx` | The game-completion sheet: type hours on the endless 5-digit roller, or take HowLongToBeat's time. The **only** place game hours are entered |
| `RatingsBanners.tsx` | Critic scores in each service's own colours, logos drawn inline as SVG |
| `PlatformChips.tsx` | Platform slugs → short labels (PS3, XSX…) |
| `Gallery.tsx` | Fullscreen screenshot viewer |
| `Avatar.tsx`, `ViewToggle.tsx`, `SortMenu.tsx`, `BottomNav.tsx`, `OfflineNotice.tsx` | Small, self-explanatory |

### Pages

| File | What it is |
|---|---|
| `SeriesPage.tsx` | Series/anime: Continue (next episode per show), rewatch rounds, Start, Waiting |
| `SinglesPages.tsx` | Films (and the shared single-media card) |
| `BooksPage.tsx` | Manga/comics chapter cards + one-shot books |
| `GamesPage.tsx` | Games, with the completion sheet wired to the ✓ |
| `DetailPage.tsx` | **The biggest page, 1250 lines.** Three layouts (classic/poster/immersive), every media type, the episode and chapter checklists, ratings, the game state picker with its recorded playthroughs |
| `SearchPage.tsx` | The four search rows |
| `AccountPage.tsx` | Profile: stats, favourites, lists, catalog rows |
| `CatalogPage.tsx`, `FavoritesPage.tsx`, `ArchivedPage.tsx`, `OwnedPage.tsx`, `ToBuyPage.tsx` | Library grids over the same components, differing only in the filter |
| `ListsPage.tsx`, `ListDetailPage.tsx` | User lists |
| `SettingsPage.tsx` | Language, theme, layout, API keys, diagnostics, Google/Drive, TV Time import, export/clear |
| `AboutPage.tsx` | Credits and the mandatory TMDB notice — a release requirement, not decoration |
| `OnboardingPage.tsx` | First-run wizard |
| `AvatarPage.tsx` | Avatar picker |

### Widget (home screen)

| File | What it is |
|---|---|
| `src/widget.ts` | Computes the same "Continue" list as the app, plus the theme colours, and pushes it to the native side. Also drains the ✓ taps queued while the app was closed |
| `OneWidgetPlugin.java` | The Capacitor bridge: receives that JSON, stores it, refreshes the widgets |
| `OneWidgetProvider.java` | Draws the widget with RemoteViews: rounded background, the media bar, the theme tints |
| `OneWidgetService.java` | The list adapter. Reads the selected medium from SharedPreferences **on every refresh** — that is what lets a category switch rebind rows instead of rebuilding the ListView (which looked like a "pop") |
| `OneWidgetActionReceiver.java` | Handles taps: open the app on an item, queue a ✓, switch category |
| `MainActivity.java` | Registers the widget plugin and forwards the Google authorisation result the social-login plugin needs |
| `res/layout/widget_*.xml` | The widget layouts. `overScrollMode="never"` on the list is what stops the stretch wobble |

### Gateway

| File | What it is |
|---|---|
| `worker/src/index.js` | One Worker: `/p/{provider}` proxies with the key injected, `/igdb`, `/hltb/search`, `/google/token` (the OAuth exchange that needs the client secret), `/img`, `/health`. Plus the edge cache and the per-IP rate limits |
| `worker/wrangler.toml` | Its config and the rate-limit bindings. Always deploy with `-c wrangler.toml` |

---

## 5. Invariants — break these and things go subtly wrong

1. **Never write `status` by hand for episodic media.** Call `markUpTo` /
   `unmarkUnit` and let `recomputeStatus` decide.
2. **Game time goes through `logGamePlaythrough` / `removeGamePlaythrough` /
   `setGameStatus`.** `item.playthroughs` is the source of truth and
   `watchCount` is derived from it; writing either directly desynchronises the
   stats from the badge.
3. **A metadata refresh must never destroy stored data.** `refreshItemMetadata`
   keeps what it has when a fetch comes back empty. Adding a field? Add it to
   `KEEP_IF_NULLISH` too if an empty value would be a regression.
4. **Corner radii live in `index.css`**, times in `db.ts`, strings in `i18n.ts`.
   Changing any of them at a call site creates the drift the last cleanup
   removed.
5. **The app must work with no gateway and no keys.** Every provider module
   degrades; keep it that way, it is also the "user brought their own key" path.
6. **Nothing secret in the repo.** `.env`, `worker/.dev.vars`,
   `android/keystore*` are gitignored. Check before committing.

## 6. "I want to change X" → touch Y

| Change | Where |
|---|---|
| A wording, in either language | `src/i18n.ts` |
| Corner rounding, colours, themes | `src/index.css`, `src/themes.ts` |
| What counts in the time stats | `computeStats` / `gameHoursOf` / `finishedViews` in `db.ts` |
| How a card looks | `TrackCard.tsx` + `GridCard.tsx` (both, they are one component in two shapes) |
| A new provider | a module in `src/api/`, wired in `api/index.ts`, and a route in the Worker if it needs a key or blocks browsers |
| Cache lifetimes | `REVALIDATE_TTL` (app side, `api/index.ts`) and `TTL_*` (edge, `worker/src/index.js`) |
| Anything about the widget | `src/widget.ts` for the data, the Java + `res/layout` for the look |
