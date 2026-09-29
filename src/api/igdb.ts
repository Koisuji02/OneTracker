/**
 * IGDB (api.igdb.com) — the database Stash and Backloggd use: richer game data
 * than RAWG (proper cover art with the logo, artworks, screenshots, themes,
 * companies, per-platform release dates).
 *
 * It can only be reached through the API gateway: IGDB needs a server-to-server
 * Twitch token and sends no CORS headers, so the Worker holds the credentials
 * and forwards APIcalypse queries (see worker/README.md). Without a gateway the
 * app keeps using RAWG.
 */
import type { GameAddon, GameKind, GameLength, MediaDetails, SearchResult } from '../types'
import { gatewayEnabled, igdbQuery } from './gateway'

/**
 * IGDB image ids expand into any of its named sizes, and appending `_2x` gives
 * the retina variant.
 *
 * Sizes matter here: `t_cover_big` is only 264×374, which is FEWER pixels than
 * the poster occupies on a phone (and less than TMDB's w342 for series/films),
 * so game covers arrived visibly soft while everything else was crisp. The
 * detail page therefore asks for `t_cover_big_2x` (528×748) and full-bleed art
 * for `t_1080p`; search rows keep the small cover, where 14 retina posters per
 * query would be paid for nothing.
 */
const IMG = (
  hash: string,
  size: 't_cover_big' | 't_cover_big_2x' | 't_720p' | 't_1080p' | 't_screenshot_med',
) => `https://images.igdb.com/igdb/image/upload/${size}/${hash}.jpg`

/** True when games should come from IGDB (gateway configured). */
export const igdbAvailable = (): boolean => gatewayEnabled()

/**
 * `game_type` (0 main game, 8 remake, 9 remaster, 10 expanded, 11 port) keeps
 * DLC/bundles/mods out of the row. NOTE: this used to be called `category` —
 * IGDB renamed it, and the old name still resolves but is always empty, so
 * filtering on `category` silently returns zero results.
 */
const SEARCH_FIELDS =
  'fields name,first_release_date,cover.image_id; where version_parent = null & game_type = (0,8,9,10,11);'

const toResult = (g: any): SearchResult => ({
  provider: 'igdb' as const,
  providerId: String(g.id),
  mediaType: 'game' as const,
  title: g.name as string,
  year: g.first_release_date ? new Date(g.first_release_date * 1000).getUTCFullYear() : null,
  poster: g.cover?.image_id ? IMG(g.cover.image_id, 't_cover_big') : null,
})

/**
 * Search that puts the games people actually mean first.
 *
 * IGDB's `search` sorts by text relevance only, which buries famous titles
 * under obscure ones ("uncharted" → Uncharted Ocean, Uncharted World… while
 * Uncharted 4 never appears). So we run TWO queries in parallel:
 * 1. name-contains sorted by `total_rating_count` — the popularity signal, and
 * 2. IGDB's own `search` — keeps typo tolerance and matches on subtitles.
 * Results merge with the popular ones first, then anything only `search` found.
 */
export async function searchGamesIgdb(query: string): Promise<SearchResult[]> {
  const escaped = query.replace(/"/g, '\\"')
  const [popular, relevant] = await Promise.all([
    igdbQuery(
      'games',
      `fields name,first_release_date,cover.image_id,total_rating_count;` +
        ` where name ~ *"${escaped}"* & version_parent = null & game_type = (0,8,9,10,11);` +
        ` sort total_rating_count desc; limit 14;`,
    ).catch(() => [] as any[]),
    igdbQuery('games', `search "${escaped}"; ${SEARCH_FIELDS} limit 14;`).catch(() => [] as any[]),
  ])

  const seen = new Set<number>()
  const out: SearchResult[] = []
  for (const g of [...popular, ...relevant]) {
    if (seen.has(g.id)) continue
    seen.add(g.id)
    out.push(toResult(g))
  }
  return out.slice(0, 14)
}

/** An add-on's card: enough to draw it and open its own page. */
const ADDON_FIELDS = (list: string) =>
  [`${list}.name`, `${list}.cover.image_id`, `${list}.first_release_date`].join(',')

const DETAIL_FIELDS = [
  'name',
  'summary',
  'storyline',
  'first_release_date',
  'total_rating',
  'total_rating_count',
  'game_type',
  'parent_game.name',
  'cover.image_id',
  'artworks.image_id',
  'artworks.artwork_type',
  'artworks.width',
  'artworks.height',
  'screenshots.image_id',
  ADDON_FIELDS('expansions'),
  ADDON_FIELDS('standalone_expansions'),
  ADDON_FIELDS('dlcs'),
  'genres.name',
  'themes.name',
  'game_modes.name',
  'player_perspectives.name',
  'platforms.slug',
  'involved_companies.company.name',
  'involved_companies.developer',
  'involved_companies.publisher',
  'status',
].join(',')

/**
 * IGDB's own time-to-beat — the fallback when HowLongToBeat has no confident
 * match for a title. Same idea, far fewer submissions (tens, where HLTB has
 * thousands), which is exactly why it comes second.
 *
 * Values arrive in SECONDS as `hastily` (rushed), `normally` (a typical
 * playthrough) and `completely` (everything), so `normally` is what feeds the
 * stats. NOTE the endpoint is `game_time_to_beats` and its key is `game_id`,
 * not `id`.
 */
export async function igdbTimeToBeat(id: string): Promise<GameLength | null> {
  if (!igdbAvailable()) return null
  const hours = (sec: unknown): number | null => {
    const n = Number(sec)
    return Number.isFinite(n) && n > 0 ? Math.max(1, Math.round(n / 3600)) : null
  }
  try {
    const rows = await igdbQuery(
      'game_time_to_beats',
      `fields hastily,normally,completely,count; where game_id = ${Number(id)};`,
    )
    const r = rows[0]
    if (!r) return null
    const main = hours(r.normally) ?? hours(r.hastily)
    const full = hours(r.completely)
    if (main == null && full == null) return null
    return { main: main ?? full, plus: null, full, source: 'igdb', samples: r.count || null }
  } catch {
    return null // no gateway, no data, endpoint renamed — the caller degrades
  }
}

/**
 * IGDB `artwork_type`s (the `/artwork_types` endpoint): 1 artwork, 2 key art
 * without logo, 3 key art with logo, 4 concept art — and then the ones that
 * make terrible backgrounds: 5/6/7 the game LOGO (white/black/colour, often a
 * 6:1 strip on black), 8 infographic, 9–11 covers, 12 icon, 13/14 historical
 * logo/icon, 15 historical artwork.
 *
 * The backdrop used to be `artworks[0]` whatever it was, so the scenic detail
 * page often showed a logo on black (Elden Ring, God of War), an app icon
 * (The Witcher 3) or a second box cover (Hollow Knight) behind the poster.
 */
const BACKDROP_TYPES = [2, 1, 3, 4] // key art first, never a logo/icon/cover
const NOT_ART = new Set([5, 6, 7, 8, 9, 10, 11, 12, 13, 14])

/** Landscape enough to fill the hero without cropping to a sliver. */
const landscape = (a: any) => {
  const r = a.width && a.height ? a.width / a.height : 16 / 9
  return r >= 1.25 && r <= 2.4
}

/**
 * The art behind the page: key art without logo, then plain artwork, key art
 * with logo, concept art — in a sane landscape shape — then an in-game
 * screenshot. An odd-shaped key art is still better than nothing at the end.
 */
function pickBackdrop(g: any): string | null {
  const arts = ((g.artworks ?? []) as any[]).filter((a) => a.image_id)
  const typeOf = (a: any) => (a.artwork_type as number | undefined) ?? 1
  for (const type of BACKDROP_TYPES) {
    const hit = arts
      .filter((a) => typeOf(a) === type && landscape(a))
      .sort((x, y) => (y.width ?? 0) - (x.width ?? 0))[0]
    if (hit) return IMG(hit.image_id, 't_1080p')
  }
  const shot = (g.screenshots ?? [])[0]?.image_id as string | undefined
  if (shot) return IMG(shot, 't_1080p')
  const any = arts.find((a) => !NOT_ART.has(typeOf(a)))
  return any ? IMG(any.image_id, 't_1080p') : null
}

/** IGDB `game_type` → the add-on kinds the app shows (null = a full game). */
function kindOf(gameType: unknown): GameKind | null {
  switch (gameType) {
    case 1: // DLC
    case 13: // pack / add-on
      return 'dlc'
    case 2:
      return 'expansion'
    case 4:
      return 'standalone'
    default:
      return null
  }
}

/** The base game's DLCs and expansions, biggest first, each by release date. */
function addonsOf(g: any): GameAddon[] {
  const list = (rows: any[] | undefined, kind: GameKind): GameAddon[] =>
    ((rows ?? []) as any[])
      .filter((x) => x?.id && x.name)
      .sort((a, b) => (a.first_release_date ?? Infinity) - (b.first_release_date ?? Infinity))
      .map((x) => ({
        providerId: String(x.id),
        title: x.name as string,
        poster: x.cover?.image_id ? IMG(x.cover.image_id, 't_cover_big') : null,
        year: x.first_release_date ? new Date(x.first_release_date * 1000).getUTCFullYear() : null,
        kind,
      }))
  return [
    ...list(g.expansions, 'expansion'),
    ...list(g.standalone_expansions, 'standalone'),
    ...list(g.dlcs, 'dlc'),
  ]
}

export async function igdbDetails(id: string): Promise<MediaDetails> {
  const rows = await igdbQuery('games', `fields ${DETAIL_FIELDS}; where id = ${Number(id)};`)
  const g = rows[0]
  if (!g) throw new Error('IGDB game not found')

  const developers = ((g.involved_companies ?? []) as any[])
    .filter((c) => c.developer)
    .map((c) => c.company?.name as string)
    .filter(Boolean)
  // the gallery skips logos, icons and alternative covers too
  const screenshots = [
    ...((g.screenshots ?? []) as any[]).map((s) => IMG(s.image_id, 't_720p')),
    ...((g.artworks ?? []) as any[])
      .filter((a) => a.image_id && !NOT_ART.has(a.artwork_type))
      .map((a) => IMG(a.image_id, 't_720p')),
  ].slice(0, 5)

  return {
    id: `igdb:${id}`,
    provider: 'igdb',
    providerId: id,
    mediaType: 'game',
    title: g.name,
    overview: (g.summary as string | undefined) || (g.storyline as string | undefined) || null,
    // IGDB covers are the real box art with the logo (what Stash shows)
    poster: g.cover?.image_id ? IMG(g.cover.image_id, 't_cover_big_2x') : null,
    // the backdrop is stretched full-bleed behind the whole page, so it gets
    // the largest sane size — 720p was being upscaled on any modern phone
    backdrop: pickBackdrop(g),
    year: g.first_release_date
      ? new Date(g.first_release_date * 1000).getUTCFullYear()
      : null,
    releaseDate: g.first_release_date
      ? new Date(g.first_release_date * 1000).toISOString().slice(0, 10)
      : null,
    genres: ((g.genres ?? []) as any[]).map((x) => x.name as string).filter(Boolean),
    // the Stash-style descriptors: Singleplayer, Co-op, Third person, Sci-fi…
    tags: [
      ...((g.game_modes ?? []) as any[]).map((x) => x.name as string),
      ...((g.player_perspectives ?? []) as any[]).map((x) => x.name as string),
      ...((g.themes ?? []) as any[]).map((x) => x.name as string),
    ]
      .filter(Boolean)
      .slice(0, 8),
    screenshots,
    platforms: ((g.platforms ?? []) as any[]).map((p) => p.slug as string).filter(Boolean),
    authors: developers.slice(0, 3),
    gameKind: kindOf(g.game_type),
    // the link back, for add-ons only (mods and episodes have a parent too)
    parentGame:
      kindOf(g.game_type) && g.parent_game?.id
        ? { providerId: String(g.parent_game.id), title: g.parent_game.name as string }
        : null,
    addons: addonsOf(g),
    externalRatings:
      g.total_rating && (g.total_rating_count ?? 0) > 0
        ? [{ source: 'igdb', label: 'IGDB', score: `${Math.round(g.total_rating)}%` }]
        : [],
  }
}
