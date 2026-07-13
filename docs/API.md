# OneTracker — internal API reference

OneTracker has no backend: the "API" is the TypeScript service layer that pages call.
This document is the contract of that layer. External HTTP endpoints consumed by the
app are described in [`openapi.yaml`](openapi.yaml).

## Identifiers

Every media item has a stable id: **`${provider}:${providerId}`**
(e.g. `tmdb:1396`, `anilist:105310`). For AniList anime, the id always points to the
**root season** of a PREQUEL/SEQUEL chain, so every season resolves to one item.

Watched units (episodes/chapters) have id **`${itemId}:${season}:${episode}`**.
Manga/comic chapters are stored as season `1`.

## Data tables (IndexedDB, Dexie — `src/db.ts`)

| Table | Key | Contents |
|---|---|---|
| `items` | `id` | one row per tracked media (metadata snapshot + library state) |
| `episodes` | `id` | one row per watched unit, `count` = times watched (rewatch grade) |
| `lists` | `id` | user lists: `name`, `color`, `itemIds[]` |
| `episodeCache` | `${itemId}:${season}` | cached episode metadata (7-day TTL) |

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
| `setMyPlaytime` | `(id, hours\|null) → void` | games: personal hours (overrides RAWG average in stats) |
| `recomputeStatus` | `(itemId) → void` | re-derives status from progress (internal, exported for metadata refresh) |
| `refreshItemMetadata` | `(details) → void` | overwrites the metadata snapshot with fresh provider data, keeps library state, re-derives status. Called on every detail-page open |
| `computeNextEpisode` | `(item, watchedKeys) → {season, episode}\|null` | first unwatched unit in watch order |
| `isCaughtUp` | `(item, watchedCount) → boolean` | ongoing + everything released watched |
| `computeStats` | `() → Stats` | totals: tv/anime/movie/game minutes (rewatches multiply), episodes, chapters, counts |
| `createList` / `deleteList` / `toggleListItem` | — | user lists CRUD |
| `getCachedEpisodes` / `putCachedEpisodes` | — | episode metadata cache |

## Provider dispatcher (`src/api/index.ts`)

| Function | Returns | Notes |
|---|---|---|
| `searchTv(q)` | `SearchResult[]` | TMDB; **anime filtered out**: Animation genre AND (ja/zh/ko language OR AniList anime-title match) |
| `searchMovies(q)` | `SearchResult[]` | TMDB (anime movies included by design) |
| `searchAnime(q)` / `searchManga(q)` | `SearchResult[]` | AniList (responses memoized 60s, shared with the cross-filters) |
| `searchBooks(q)` | `SearchResult[]` | Open Library; **manga filtered out** (subject + AniList title match incl. "Vol. N" editions) |
| `searchComics(q)` | `SearchResult[]` | Comic Vine volumes (JSONP); manga publishers + AniList title match filtered |
| `searchGames(q)` | `SearchResult[]` | RAWG |

Cross-filter helpers (`src/api/anilist.ts`): `mangaTitleKeys(q)` / `animeTitleKeys(q)`
return normalized AniList titles for a query (memoized — zero extra requests when the
Anime/Manga rows already searched it); `matchesTitleSet(title, keys)` also matches
volume-stripped bases ("Berserk, Vol. 3" → "berserk").
| `getDetails(provider, mediaType, providerId)` | `MediaDetails` | routes to the right provider; includes cast, seasons, ongoing flag, release dates and `externalRatings` |
| `getEpisodes(item, season)` | `EpisodeInfo[]` | TMDB real episodes; AniList/Comic Vine generated 1..N; 7-day cache |

Providers throw `ApiKeyMissingError('tmdb'|'rawg'|'omdb'|'comicvine')` when their key
is missing — the UI turns that into a "add your key in Settings" banner.

### AniList season-chain aggregation (`src/api/anilist.ts`)

`animeDetails(id)`:
1. fetch the entry node (`format`, `relations`)
2. if it is TV-like (`TV`/`ONA`/`TV_SHORT`): walk `PREQUEL` edges to the root,
   then walk `SEQUEL` edges building one season per node
3. fetch full info of the root (title, cover, characters, scores)
4. return one `MediaDetails` with `seasons[]`, id = `anilist:<rootId>`

Movies/specials are never aggregated. Nodes are memory-cached per session.

### MangaDex enrichment (`src/api/mangadex.ts`)

For RELEASING manga, AniList's `chapters` is null. `mangadexLatest(anilistId, title)`
searches MangaDex, matches `attributes.links.al === anilistId`, then reads the highest
released chapter number + its publish date.

### External ratings (`src/api/ratings.ts`)

| Media | Sources |
|---|---|
| movies / TV | OMDb → IMDb, Rotten Tomatoes, Metacritic (needs free OMDb key) |
| anime / manga | AniList `averageScore` + MyAnimeList via Jikan (keyless) |
| books | Open Library community rating (keyless) |
| games | Metacritic + RAWG score (inside the RAWG payload) |

### Game box art (`src/api/steamgriddb.ts`)

RAWG's `background_image` is promo art without the title. `gameDetails()` resolves
the poster as: **SteamGridDB** 600×900 titled box art (any platform, free key) →
Steam CDN vertical capsule (appid parsed from the RAWG store link) → RAWG art.
RAWG `parent_platforms` slugs are stored on items and shown as platform chips.

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
