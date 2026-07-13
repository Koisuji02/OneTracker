/**
 * Wikipedia pageimages (keyless, CORS via origin=*) — fallback source for
 * TITLED game box art on any platform: the infobox image of a game's article
 * is almost always the official cover. `pilicense=any` is required because
 * box art is fair-use, which the default (free-only) filter would hide.
 */
export async function wikipediaBoxArt(title: string): Promise<string | null> {
  try {
    const u = new URL('https://en.wikipedia.org/w/api.php')
    u.search = new URLSearchParams({
      action: 'query',
      format: 'json',
      formatversion: '2',
      origin: '*',
      generator: 'search',
      gsrsearch: `${title} video game`,
      gsrlimit: '1',
      prop: 'pageimages',
      piprop: 'thumbnail',
      pithumbsize: '600',
      pilicense: 'any',
    }).toString()
    const res = await fetch(u.toString())
    if (!res.ok) return null
    const d = await res.json()
    return (d.query?.pages?.[0]?.thumbnail?.source as string | undefined) ?? null
  } catch {
    return null
  }
}
