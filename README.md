# OneTracker

A modern, local-first tracker for **TV series, anime, movies, manga/comics, books and games**, built as a personal replacement for TV Time (shut down July 15, 2026). Yellow-and-black UI inspired by TV Time and Stash, 8 switchable themes, English/Italian. Runs as a web app on PC and as a native Android app via Capacitor. All data stays on your device, with JSON export/import and optional Google Drive backup — no server anywhere.

## What it does

**Tracking**
- **Series & anime** — per-episode check-off with **cascade marking** (checking ep. 4 marks 1–3 too), "Continue watching" with next-episode card, remaining count `+N` and progress bar. AniList season chains (Fire Force, Fire Force 2…) are **aggregated into one entry with real seasons**.
- **Ongoing works never auto-complete**: when you're caught up they stay in "Continue" with a waiting badge and the **next episode air date** (TMDB/AniList).
- **Manga & comics** — chapter checklists (blocks of 100), same cascade rules. Chapter counts of ongoing manga come from **MangaDex**; western comics runs (with issue counts) from **Comic Vine**.
- **Movies & books** — one-tap watched/read.
- **Games** — three states (*To play / Playing / Completed*) plus personal hours played.
- **Rewatch** — tapping an already-checked unit opens a dialog: *unmark* or *mark as rewatched* (x2, x3…). Rewatching ep. N raises every earlier episode below that grade to the same grade. Rewatches count as extra watch time.

**Profile**
- Hero header with **rotating favorite artwork** (every 30 min), custom display name and a customizable **avatar** (uploaded photo, poster from your library, or built-in character presets).
- **Watch time** total + expandable breakdown (TV / anime / movies / games, episode & chapter counts). Game time uses your tracked hours, or the expected average until you set them.
- **Personal ratings 0–10** (decimal slider with emoji face). Badges on covers: white circle up to 8.4, then bronze / silver / gold trophies, pulsing diamond for 10.
- **Critic ratings** on detail pages: IMDb + Rotten Tomatoes/Metacritic (via OMDb), AniList + MyAnimeList, Metacritic + RAWG, Open Library.
- **Catalog** rows (Series / Movies / Books / Games) with everything started or finished — hourglass = in progress/ongoing, flag = completed — expandable to **full grid views**.
- **Custom lists** with a name and color, preview box on the profile, dedicated pages with a library picker.

**Search** — live search-as-you-type in horizontal bands per catalog, with quick-add. Results are kept when you navigate into an item and back. Bands are exclusive: anime are filtered out of the TV band (they have their own), manga out of the Books band (western comics stay).

## Data sources

| Catalog | Provider | API key |
|---|---|---|
| TV series & movies | [TMDB](https://www.themoviedb.org/) | required (free) |
| Anime & manga | [AniList](https://anilist.co/) | none |
| Manga chapter counts/dates | [MangaDex](https://mangadex.org/) | none |
| Books | [Open Library](https://openlibrary.org/) | none |
| Comics | [Comic Vine](https://comicvine.gamespot.com/api/) | required (free) |
| Games | [RAWG](https://rawg.io/apidocs) | required (free) |
| IMDb / Rotten Tomatoes scores | [OMDb](https://www.omdbapi.com/) | required (free) |
| MyAnimeList scores | [Jikan](https://jikan.moe/) | none |

Keys go in **Settings → API keys** (stored in localStorage) or in `.env` (see `.env.example`).

## Repo layout

```
src/
  api/            provider modules (one per external API) + dispatcher
    index.ts        getDetails()/getEpisodes() routing + episode cache
    tmdb.ts         TV/movies (+ anime filter, OMDb hook)
    anilist.ts      anime (season-chain aggregation) + manga
    mangadex.ts     latest-chapter lookup for ongoing manga
    comicvine.ts    comics via JSONP (no CORS on that API)
    openlibrary.ts  books (+ manga filter, community rating)
    rawg.ts         games (+ metacritic/rawg scores)
    ratings.ts      OMDb / Jikan / rating assembly helpers
    errors.ts       ApiKeyMissingError
  components/     shared UI (TrackCard, PosterCard, CheckButton, RatingBadge,
                  RatingModal, RewatchDialog, Avatar, MediaRow, BottomNav…)
  pages/          one file per screen (Series, Movies, Books, Games, Search,
                  Detail, Account, Favorites, Catalog, Lists, ListDetail,
                  Avatar, Settings)
  db.ts           Dexie schema + the whole library service layer
  backup.ts       JSON export/import (v2: items + episodes + lists)
  drive.ts        Google sign-in + Drive appDataFolder backup
  settings.ts     localStorage settings store (useSettings hook)
  themes.ts       8 theme presets applied as CSS variables
  i18n.ts         EN/IT dictionaries (flat keys) + useT hook
  types.ts        all shared TypeScript types
docs/
  API.md          internal service-layer reference (functions & contracts)
  openapi.yaml    every external endpoint the app consumes
scripts/
  smoke.mjs       end-to-end smoke test (Playwright, headless Chromium)
android/          Capacitor Android project (generated)
```

### How it works (short version)

1. **Search** calls one provider per band; results carry `(provider, mediaType, providerId)`.
2. **Detail** calls `getDetails()` → normalized `MediaDetails` (metadata + seasons + ongoing flag + release dates + critic ratings). Opening a detail also runs `refreshItemMetadata()`, so new episodes/chapters of tracked works are picked up.
3. **Adding** snapshots the metadata into the `items` table with `status: planned`.
4. **Checking units** writes rows into `episodes` (`count` = rewatch grade); status is re-derived after every change (`planned → watching → completed`, ongoing works capped at `watching`).
5. **Stats** aggregate runtime × rewatch count per media type; games add tracked or expected hours.
6. **Backup** serializes settings + items + episodes + lists to JSON — downloadable or synced to your own Google Drive appDataFolder.

Full function-level contract: [`docs/API.md`](docs/API.md).

## Development

```bash
npm install
npm run dev        # web app at http://localhost:5173
npm run build      # typecheck + production build in dist/
npm run smoke      # E2E smoke test (dev server must be running)
```

## Android (Capacitor)

Requires JDK 17+ and the Android SDK (Android Studio optional).

```bash
npm run android:apk    # build web assets + sync + assemble the debug APK
npm run android:sync   # build web assets + sync into android/
npm run android:open   # …and open the project in Android Studio
```

The APK lands in `android/app/build/outputs/apk/debug/app-debug.apk`.
See [docs/DISTRIBUTION.md](docs/DISTRIBUTION.md) for how API keys are baked/overridden
and how to share the app with other people.

Quick alternatives to test the mobile experience:
- **Browser responsive mode** (F12 → device toolbar / Ctrl+Shift+M in Firefox).
- **Real phone on the same Wi-Fi**: `npm run dev -- --host`, then open `http://<PC-IP>:5173` on the phone.
- **Debug APK**: `cd android && ./gradlew assembleDebug` → `android/app/build/outputs/apk/debug/app-debug.apk`.

## Google Drive backup

1. Google Cloud Console → new project → enable **Google Drive API**.
2. OAuth consent screen (External, add yourself as test user).
3. Create an **OAuth Client ID** (*Web application*) with your origins (e.g. `http://localhost:5173`).
4. Paste the client ID in **Settings → Google Drive sync** → *Connect Google account*.

Backups live in the app-private `appDataFolder` (invisible in your Drive UI, doesn't use your quota view).

## Stack

React 19 + TypeScript + Vite + Tailwind CSS v4 · Dexie (IndexedDB) · React Router (hash) · Capacitor 7 · lucide-react · Playwright (smoke tests).
