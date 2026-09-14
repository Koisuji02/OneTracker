# OneTracker — internal API reference

OneTracker has no backend: the "API" is the TypeScript service layer that pages call.
This document is the contract of that layer. External HTTP endpoints consumed by the
app are described in [`openapi.yaml`](openapi.yaml).

## Identifiers

Every media item has a stable id: **`${provider}:${providerId}`**
(e.g. `tmdb:1396`, `mangadex:801513ba-…`). Anime found via search are **TMDB
entries** (`tmdb:` ids, `mediaType: 'anime'`) — the same ids the TV Time importer
produces, so imports and searches land on the same item. Legacy `anilist:` anime ids
keep working: their id points to the root season of a PREQUEL/SEQUEL chain.

Watched units (episodes/chapters) have id **`${itemId}:${season}:${episode}`**.
Manga/comic chapters are stored as season `1`.

## Data tables (IndexedDB, Dexie — `src/db.ts`)

| Table | Key | Contents |
|---|---|---|
| `items` | `id` | one row per tracked media (metadata snapshot + library state) |
| `episodes` | `id` | one row per watched unit, `count` = times watched (rewatch grade) |
| `lists` | `id` | user lists: `name`, `color`, `itemIds[]` |
| `episodeCache` | `${itemId}:${season}` | cached episode metadata (revalidated after 12h for ongoing works, 7 days otherwise) |
| `detailsCache` | `id` | cached `MediaDetails` payloads (stale-while-revalidate, 6h) |
| `covers` | `key` | resolved cover URLs shared by search rows and detail pages |
| `images` / `imageMeta` | `url` | downloaded artwork (blob + LRU bookkeeping) — see *Offline* below |

Status is always **derived**: `planned` (0 units) → `watching` (some) →
`completed` (all units *and* the work is finished). Ongoing works never auto-complete.

## Library service (`src/db.ts`)

| Function | Signature | Behavior |
|---|---|---|
| `addToLibrary` | `(details: MediaDetails) → LibraryItem` | insert as `planned`; no-op if present |
| `removeFromLibrary` | `(id) → void` | deletes item + progress + cache + list references |
| `toggleFavorite` | `(id) → void` | flips the heart |
| `setRating` | `(id, rating: number\|null) → void` | personal 0–10 (1 decimal), null removes |
| `markUpTo` | `(item, season, episode, runtime?) → void` | **cascade watch**: marks the unit and every unwatched unit before it |
| `unmarkUnit` | `(item, season, episode) → void` | removes one check (no cascade) |
| `rewatchUpTo` | `(item, season, episode) → void` | **rewatch cascade**: clicked unit goes to grade `count+1`; every earlier unit below that grade is raised to it |
| `setSeasonWatched` | `(item, season, eps[], watched) → void` | mark/unmark a whole season |
| `setSingleWatched` | `(id, watched) → void` | movies/books: completed ⇄ planned |
| `rewatchSingle` | `(id) → void` | movies/books/games: `watchCount + 1` |
| `setGameStatus` | `(id, status) → void` | games: planned / watching ("Playing") / completed |
| `logGamePlaythrough` | `(id, hours\|null) → void` | games: record a finished run — typed hours, or `null` to count the how-long-to-beat time |
| `startGameReplay` | `(id) → void` | games: "Ri-inizia xN" — back to Continue for another run, recorded runs untouched |
| `rewatchSingle` | `(id) → void` | movies/books: "Ri-inizia xN" — back to Continue; the ✓ there closes the round |
| `logSingleView` | `(id) → void` | movies/books: "Rivisto xN" — one more finished viewing straight away |
| `removeGamePlaythrough` | `(id, index) → void` | games: drop one recorded run and the time it contributed |
| `setGameStatus` | `(id, 'planned'\|'watching') → void` | games: 3-state picker; leaving `completed` un-records the most recent run |
| `gamePlaythroughs` | `(item) → GamePlaythrough[]` | games: the finished runs (derives them for pre-v8 rows and old backups) |
| `recomputeStatus` | `(itemId, touch = true) → void` | re-derives status from progress (internal, exported for metadata refresh). `touch` stamps `lastReadAt` — background refreshes pass `false` so they don't reorder "Continue" |
| `refreshItemMetadata` | `(details) → void` | merges fresh provider data into the metadata snapshot, keeps library state, re-derives status. Writes NOTHING when the payload brings no change. Called on every detail-page open and by the background sync |
| `computeNextEpisode` | `(item, watchedKeys) → {season, episode}\|null` | first unwatched unit in watch order |
| `unitAired` | `(item, season, episode, airDate?) → boolean` | is this unit out? The unit's own `airDate` decides when known, otherwise the show-level `lastAired` boundary |
| `isWaiting` | `(item, watchedKeys, airDateOf?) → boolean` | item with nothing to do right now (unreleased, or caught up on everything aired). `airDateOf(season, slot)` supplies the next unit's own air date so an episode released **today** leaves "Waiting" immediately instead of waiting for the next metadata refresh |
| `isCaughtUp` | `(item, watchedCount) → boolean` | ongoing + everything released watched |
| `computeStats` | `() → Stats` | totals: tv/anime/movie/game minutes (rewatches multiply), episodes, chapters, counts |
| `gameBaseHours` | `(item) → number` | one playthrough of a game in hours — the how-long-to-beat main story |
| `gameHoursOf` | `(item) → number` | what a game adds to the totals: the sum of its runs, each at its own chosen time |
| `createList` / `deleteList` / `toggleListItem` | — | user lists CRUD |
| `putCachedEpisodes` | `(itemId, season, episodes) → void` | episode metadata cache write (reads go through `getEpisodes`) |

## Offline (`src/net.ts`, `src/imageCache.ts`, `src/sync.ts`)

The library, the progress and the artwork of everything tracked work with no
network. Only genuine lookups (search, a title never opened before, Drive) need
a connection, and they say so instead of failing silently.

| Function | Signature | Behavior |
|---|---|---|
| `isOnline` / `useOnline` | `() → boolean` | `navigator.onLine` + its events. Used to pick a message and skip pointless work, never to block a request that might still succeed |
| `onReconnect` | `(fn) → unsubscribe` | runs `fn` when the device comes back online |
| `resolveImage` | `(url, persist) → string` | the src to render: a `blob:` URL when the bytes are cached, otherwise `url` — and, if `persist`, the bytes are picked up in the background so the next render works offline |
| `forget` | `(urls[]) → void` | drops cached bytes (an item leaving the library takes its artwork with it) |
| `evict` | `() → void` | LRU trim to the 48 MB budget, reading only `imageMeta` |
| `clearImageCache` | `() → void` | wipes every cached image (Settings → delete all data) |
| `syncLibrary` | `(force = false) → void` | catch-up pass: refresh the items that can have changed (still releasing, or an announced date that has arrived — 20 at a time, 3 at a time in flight, throttled to 30 min) then push the Drive backup (resuming the Google session silently first, never with a sign-in sheet). Runs at startup, on reconnect and on foreground |

`<Cover>` (`src/components/Cover.tsx`) is the `<img>` every cover goes through;
`persist` marks the library artwork worth keeping. Search results, cast photos
and galleries are browsing, not library, and stay online-only.

## Provider dispatcher (`src/api/index.ts`)

| Function | Returns | Notes |
|---|---|---|
| `searchTv(q)` | `SearchResult[]` | TMDB `/search/tv` (memoized 60s, one request shared with the Anime row); anime split out by **Animation genre + ja/zh/ko original language** — western animation (Arcane, Castlevania…) stays here |
| `searchMovies(q)` | `SearchResult[]` | TMDB (anime movies included by design) |
| `searchAnime(q)` | `SearchResult[]` | **TMDB-first** (same memoized search, `mediaType: 'anime'`) + AniList tail for titles TMDB doesn't index (deduped by localized/original/native titles; movies and per-season entries dropped). Keyless fallback: pure AniList when no TMDB key |
| `searchManga(q)` | `SearchResult[]` | **MangaDex** (keyless; matches localized alt-titles, so Italian queries work; memoized 60s, shared with the cross-filters) |
| `searchBooks(q)` | `SearchResult[]` | Open Library; **manga filtered out** (subject + MangaDex title match incl. "Vol. N" editions) |
| `searchComics(q)` | `SearchResult[]` | Comic Vine volumes (JSONP, memoized 60s — the API allows ~200 req/h); manga publishers + MangaDex title match filtered |
| `searchGames(q)` | `SearchResult[]` | RAWG |
| `getDetails(provider, mediaType, providerId)` | `MediaDetails` | routes to the right provider; includes cast, seasons, ongoing flag, release dates and `externalRatings` |
| `getEpisodes(item, season)` | `EpisodeInfo[]` | TMDB real episodes; anime titles via Jikan, manga via MangaDex, comics via Comic Vine issues. Answers from the cache instantly and revalidates in the background when the list is old — 12h for a work still airing (a new episode has to show up on its own), 7 days otherwise |

Cross-filter helpers: `mangadexTitleKeys(q)` (`src/api/mangadex.ts`) returns
normalized MangaDex titles + alt-titles (all languages, Italian editions included)
for a query — memoized, zero extra requests when the Manga row already searched it.
`matchesTitleSet(title, keys)` (`src/api/titleMatch.ts`) also matches
volume-stripped bases ("Berserk, Vol. 3" → "berserk"); `looseTitleKey` compares
native-script titles (kanji/hangul) across TMDB and AniList for dedup.

Providers throw `ApiKeyMissingError('tmdb'|'rawg'|'omdb'|'comicvine')` when their key
is missing — the UI turns that into a "add your key in Settings" banner.

### Anime via TMDB (`src/api/tmdb.ts`)

`tvDetails(id)` auto-detects anime (genre id 16 + ja/zh/ko original language,
language-independent) and returns `mediaType: 'anime'`: search results, detail
pages AND TV Time imports classify into the Anime tab with real TMDB seasons
(saga names, localized overviews, per-episode titles). Anime also get AniList +
MAL score banners via a single cached title lookup (`animeRatingsByTitle`).

### AniList season-chain aggregation (`src/api/anilist.ts`) — legacy items

`animeDetails(id)`:
1. fetch the entry node (`format`, `relations`)
2. if it is TV-like (`TV`/`ONA`/`TV_SHORT`): walk `PREQUEL` edges to the root,
   then walk `SEQUEL` edges building one season per node
3. fetch full info of the root (title, cover, characters, scores)
4. return one `MediaDetails` with `seasons[]`, id = `anilist:<rootId>`

Movies/specials are never aggregated. Nodes are memory-cached per session.

### MangaDex as the manga source (`src/api/mangadex.ts`)

`mangadexDetails(id)` returns full manga details keyless: title, description
(Italian preferred), cover art, year, genres (tags), authors/artists, ongoing
status, released-chapter count (`lastChapter` + highest chapter in the feed) and
`externalRatings` = MangaDex community rating + AniList/MAL scores grafted via
`attributes.links.al`. Legacy `anilist:` manga items still use `mangadexFind` /
`mangadexLatest` for chapter counts and titles.

### External ratings (`src/api/ratings.ts`)

| Media | Sources |
|---|---|
| movies / TV | OMDb → IMDb, Rotten Tomatoes, Metacritic (needs free OMDb key) |
| anime / manga | AniList `averageScore` + MyAnimeList via Jikan (keyless); manga also MangaDex bayesian rating |
| books | Open Library community rating (keyless) |
| games | Metacritic + RAWG score (inside the RAWG payload) |

### Titled artwork (`src/api/wikipedia.ts`, `src/api/tmdbPoster.ts`)

RAWG's `background_image` is promo art without the title. `gameDetails()` resolves
the poster as: Steam CDN vertical capsule (appid from the RAWG store link) →
**Wikipedia infobox box art** (`pilicense=any`, keyless, any platform) → RAWG art.
(SteamGridDB and IGDB were evaluated and rejected: both APIs block browser CORS.)
Anime posters upgrade to the classic TMDB poster (with logo) matched by
title+year, falling back to AniList artwork. RAWG `parent_platforms` slugs are
stored on items and shown as platform chips.

### TV Time import (`src/importTvTime.ts`)

`importTvTimeZip(file, onProgress)` auto-detects the zip format (GDPR CSVs or
plugin JSON), resolves TVDB→TMDB via `/find`, movies via IMDb id or title+year,
and merges episode rows keeping the highest rewatch count (idempotent re-import).

## Backup (`src/backup.ts`)

`buildBackup()` → JSON v2: settings (language, toggles, theme, profile name) +
`items` + `episodes` + `lists`. `applyBackup(json)` replaces the whole library.
Same format is used for file export and the Google Drive appDataFolder copy
(`src/drive.ts`).

## Settings (`src/settings.ts`)

localStorage-backed store (`useSettings()` hook). Keys: `language`, `theme` (preset id
from `src/themes.ts`), `profileName`, `avatar` (null | `emoji:<c>:<bg>` | image URL),
`showBooks`, `showGames`, `tmdbKey`, `rawgKey`, `omdbKey`, `comicvineKey`,
`googleClientId`, Google profile fields.
