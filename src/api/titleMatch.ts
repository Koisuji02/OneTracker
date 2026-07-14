/** Provider-neutral title normalization + matching, shared by search rows. */

export function normalizeTitle(t: string): string {
  return t
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

/**
 * Script-preserving variant for non-latin titles (kanji/hangul): TMDB's
 * `original_name` is native script while AniList's romaji is romanized, so
 * cross-source dedup also compares native titles with this key.
 */
export function looseTitleKey(t: string): string {
  return t.toLowerCase().normalize('NFKC').replace(/[^\p{L}\p{N}]+/gu, '')
}

/** Volume/tome suffixes stripped before matching ("Berserk, Vol. 3" → "berserk"). */
const VOLUME_TAIL = /\b(vol(ume)?s?|volumen|tome|tomo|band|omnibus|deluxe|book)\b.*$|\s+\d+$/

/** True when a title (or its volume-stripped base) matches a title set. */
export function matchesTitleSet(title: string, keys: Set<string>): boolean {
  const norm = normalizeTitle(title)
  if (keys.has(norm)) return true
  const base = norm.replace(VOLUME_TAIL, '').trim()
  return base.length > 2 && keys.has(base)
}
