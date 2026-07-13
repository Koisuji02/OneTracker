import type { MediaDetails, SearchResult } from '../types'
import { mangaTitleKeys, matchesTitleSet } from './anilist'
import { openLibraryRating } from './ratings'

const API = 'https://openlibrary.org'

function coverUrl(coverId: number | null | undefined, size: 'M' | 'L' = 'M'): string | null {
  return coverId ? `https://covers.openlibrary.org/b/id/${coverId}-${size}.jpg` : null
}

export async function searchBooks(query: string): Promise<SearchResult[]> {
  const url = new URL(`${API}/search.json`)
  url.searchParams.set('q', query)
  url.searchParams.set('limit', '20')
  url.searchParams.set('fields', 'key,title,first_publish_year,cover_i,author_name,subject')
  // manga lives in its own tab: filter by subject AND by AniList title match
  // (memoized, shared with the Manga row) so single manga volumes stay out too
  const [res, mangaTitles] = await Promise.all([fetch(url.toString()), mangaTitleKeys(query)])
  if (!res.ok) throw new Error(`Open Library error ${res.status}`)
  const data = await res.json()
  return ((data.docs ?? []) as any[])
    .filter(
      (d) =>
        !((d.subject ?? []) as string[]).some((s) => /manga/i.test(s)) &&
        !matchesTitleSet(d.title ?? '', mangaTitles),
    )
    .slice(0, 14)
    .map((d) => ({
    provider: 'openlibrary' as const,
    providerId: String(d.key).replace('/works/', ''),
    mediaType: 'book' as const,
    title: d.title,
    year: d.first_publish_year ?? null,
    poster: coverUrl(d.cover_i),
  }))
}

export async function bookDetails(id: string): Promise<MediaDetails> {
  const res = await fetch(`${API}/works/${id}.json`)
  if (!res.ok) throw new Error(`Open Library error ${res.status}`)
  const d = await res.json()
  const description =
    typeof d.description === 'string' ? d.description : (d.description?.value ?? null)

  // resolve up to two author names
  let authors: string[] = []
  try {
    const keys: string[] = ((d.authors ?? []) as any[])
      .map((a) => a.author?.key)
      .filter(Boolean)
      .slice(0, 2)
    authors = await Promise.all(
      keys.map(async (k) => {
        const r = await fetch(`${API}${k}.json`)
        if (!r.ok) return ''
        const a = await r.json()
        return (a.name as string) ?? ''
      }),
    )
    authors = authors.filter(Boolean)
  } catch {
    // authors are optional
  }

  return {
    id: `openlibrary:${id}`,
    provider: 'openlibrary',
    providerId: id,
    mediaType: 'book',
    title: d.title,
    overview: description,
    poster: coverUrl(d.covers?.[0], 'L'),
    backdrop: null,
    year: null,
    genres: ((d.subjects ?? []) as string[]).slice(0, 4),
    authors,
    externalRatings: await openLibraryRating(id),
  }
}
