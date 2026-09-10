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
import type { MediaDetails, SearchResult } from '../types'
import { gatewayEnabled, igdbQuery } from './gateway'

/** IGDB image ids expand into any size; `t_cover_big` is 264×374, `t_720p` HD. */
const IMG = (hash: string, size: 't_cover_big' | 't_720p' | 't_screenshot_med') =>
  `https://images.igdb.com/igdb/image/upload/${size}/${hash}.jpg`

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

const DETAIL_FIELDS = [
  'name',
  'summary',
  'storyline',
  'first_release_date',
  'total_rating',
  'total_rating_count',
  'cover.image_id',
  'artworks.image_id',
  'screenshots.image_id',
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

export async function igdbDetails(id: string): Promise<MediaDetails> {
  const rows = await igdbQuery('games', `fields ${DETAIL_FIELDS}; where id = ${Number(id)};`)
  const g = rows[0]
  if (!g) throw new Error('IGDB game not found')

  const developers = ((g.involved_companies ?? []) as any[])
    .filter((c) => c.developer)
    .map((c) => c.company?.name as string)
    .filter(Boolean)
  const screenshots = [
    ...((g.screenshots ?? []) as any[]).map((s) => IMG(s.image_id, 't_720p')),
    ...((g.artworks ?? []) as any[]).map((a) => IMG(a.image_id, 't_720p')),
  ].slice(0, 5)

  return {
    id: `igdb:${id}`,
    provider: 'igdb',
    providerId: id,
    mediaType: 'game',
    title: g.name,
    overview: (g.summary as string | undefined) || (g.storyline as string | undefined) || null,
    // IGDB covers are the real box art with the logo (what Stash shows)
    poster: g.cover?.image_id ? IMG(g.cover.image_id, 't_cover_big') : null,
    backdrop: (g.artworks ?? [])[0]?.image_id
      ? IMG(g.artworks[0].image_id, 't_720p')
      : ((g.screenshots ?? [])[0]?.image_id ? IMG(g.screenshots[0].image_id, 't_720p') : null),
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
    externalRatings:
      g.total_rating && (g.total_rating_count ?? 0) > 0
        ? [{ source: 'igdb', label: 'IGDB', score: `${Math.round(g.total_rating)}%` }]
        : [],
  }
}
