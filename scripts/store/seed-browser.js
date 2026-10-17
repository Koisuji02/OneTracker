// Runs INSIDE the app page (dev server): fills the library with real titles
// through the app's own modules — search, details, addToLibrary, marking —
// then spreads the dates over the past months so History, stats and
// achievements look like a library that has been used for a while.
// Called by scripts/store/shoot.mjs; returns a log of what was added.
export default async function seed() {
  const api = await import('/src/api/index.ts')
  const m = await import('/src/db.ts')
  const db = m.db
  const log = []

  const DAY = 86400000
  const now = Date.now()
  const at = (y, mo, d, h = 21) => new Date(y, mo - 1, d, h, Math.floor(Math.random() * 50)).getTime()

  // [search, wanted type, plan]
  // plan: upTo [season, ep] | all | done (single) | play | beat | planned
  // window: [start, end] dates the activity is spread over
  const LIB = [
    { q: 'Severance', type: 'tv', upTo: [2, 7], win: [at(2026, 9, 12), at(2026, 10, 15)] },
    { q: 'The Bear', type: 'tv', upTo: [3, 5], win: [at(2026, 9, 1), at(2026, 10, 12)] },
    { q: 'Breaking Bad', type: 'tv', all: true, rating: 10, fav: true, win: [at(2026, 1, 10), at(2026, 4, 2)] },
    { q: 'The Last of Us', type: 'tv', all: true, rating: 9, win: [at(2026, 4, 10), at(2026, 6, 1)] },
    { q: 'Shogun', type: 'tv', all: true, rating: 9.5, fav: true, win: [at(2026, 6, 5), at(2026, 7, 10)] },
    { q: 'Stranger Things', type: 'tv', upTo: [4, 4], win: [at(2026, 7, 15), at(2026, 10, 9)] },
    { q: 'Andor', type: 'tv', planned: true },
    { q: 'Frieren', type: 'anime', upTo: [1, 21], fav: true, win: [at(2026, 9, 20), at(2026, 10, 16)] },
    { q: 'Jujutsu Kaisen', type: 'anime', upTo: [2, 9], win: [at(2026, 8, 1), at(2026, 10, 14)] },
    { q: 'Attack on Titan', type: 'anime', all: true, rating: 9.5, fav: true, win: [at(2026, 2, 1), at(2026, 8, 20)] },
    { q: 'Dandadan', type: 'anime', planned: true },
    { q: 'Dune: Part Two', type: 'movie', done: at(2026, 10, 4), rating: 9 },
    { q: 'Interstellar', type: 'movie', done: at(2026, 3, 14), rating: 10, fav: true },
    { q: 'Oppenheimer', type: 'movie', done: at(2026, 8, 9), rating: 8.5 },
    { q: 'Past Lives', type: 'movie', done: at(2026, 10, 11), rating: 8 },
    { q: 'Spider-Man: Across the Spider-Verse', type: 'movie', done: at(2026, 5, 23), rating: 9 },
    { q: 'Perfect Days', type: 'movie', done: at(2026, 10, 1), rating: 8.5 },
    { q: 'Inside Out 2', type: 'movie', planned: true },
    { q: 'The Brutalist', type: 'movie', planned: true },
    { q: 'Project Hail Mary', type: 'book', done: at(2026, 9, 28), rating: 9 },
    { q: 'The Hobbit', type: 'book', done: at(2026, 5, 2), rating: 8.5 },
    { q: 'Dune Frank Herbert', type: 'book', reading: true },
    { q: 'Berserk', type: 'manga', ch: 140, fav: true, win: [at(2026, 6, 1), at(2026, 10, 13)] },
    { q: 'Chainsaw Man', type: 'manga', ch: 97, rating: 8.5, win: [at(2026, 4, 1), at(2026, 9, 1)] },
    { q: 'Vagabond', type: 'manga', ch: 180, win: [at(2026, 8, 10), at(2026, 10, 10)] },
    { q: 'Elden Ring', type: 'game', play: at(2026, 9, 25) },
    { q: 'The Witcher 3: Wild Hunt', type: 'game', beat: [at(2026, 2, 1), at(2026, 3, 30)], rating: 10, fav: true },
    { q: "Baldur's Gate 3", type: 'game', beat: [at(2026, 7, 1), at(2026, 9, 6)], rating: 9.5 },
    { q: 'Hollow Knight', type: 'game', beat: [at(2026, 9, 10), at(2026, 10, 8)], rating: 9 },
    { q: 'The Legend of Zelda: Tears of the Kingdom', type: 'game', play: at(2026, 10, 2) },
    { q: 'Red Dead Redemption 2', type: 'game', beat: [at(2026, 4, 5), at(2026, 6, 20)], rating: 9.5, fav: true },
    { q: 'Hades II', type: 'game', planned: true },
  ]

  const searchFor = (type, q) => {
    if (type === 'movie') return api.searchMovies(q)
    if (type === 'tv' || type === 'anime') return api.searchShows(q)
    if (type === 'game') return api.searchGames(q)
    return api.searchReading(q)
  }

  for (const spec of LIB) {
    try {
      const results = await searchFor(spec.type, spec.q)
      const hit = results.find((r) => r.mediaType === spec.type && r.poster) ?? results.find((r) => r.mediaType === spec.type)
      if (!hit) {
        log.push(`MISS ${spec.q}`)
        continue
      }
      const details = await api.getDetails(hit.provider, hit.mediaType, hit.providerId)
      if (details.mediaType === 'game' && details.gameKind) {
        log.push(`SKIP addon ${spec.q}`)
        continue
      }
      await m.addToLibrary(details)
      const item = await db.items.get(details.id)
      const id = item.id

      if (spec.upTo || spec.all || spec.ch) {
        let season, ep
        if (spec.ch) {
          season = 1
          ep = spec.ch
        } else if (spec.all) {
          const ss = m.seasonsOf(item).filter((s) => s.number > 0 && s.episodeCount > 0)
          const last = ss[ss.length - 1]
          season = last.number
          ep = last.episodeCount
        } else {
          ;[season, ep] = spec.upTo
        }
        await m.markUpTo(item, season, ep)
        // spread the units evenly over the window, in viewing order
        const rows = (await db.episodes.where('itemId').equals(id).toArray()).sort(
          (a, b) => a.season - b.season || a.episode - b.episode,
        )
        const [s0, s1] = spec.win
        const step = rows.length > 1 ? (s1 - s0) / (rows.length - 1) : 0
        rows.forEach((r, i) => (r.watchedAt = Math.round(s0 + step * i)))
        await db.episodes.bulkPut(rows)
        await m.recomputeStatus(id, false)
        const done = (await db.items.get(id)).status === 'completed'
        await db.items.update(id, { addedAt: s0 - 3 * DAY, lastReadAt: s1, completedAt: done ? s1 : null })
      } else if (spec.done) {
        await m.setSingleStatus(id, 'completed')
        await db.items.update(id, { completedAt: spec.done, lastReadAt: spec.done, addedAt: spec.done - 20 * DAY })
      } else if (spec.reading) {
        await m.setSingleStatus(id, 'watching')
        await db.items.update(id, { lastReadAt: now - 2 * DAY, addedAt: now - 30 * DAY })
      } else if (spec.play) {
        await m.setGameStatus(id, 'watching')
        await db.items.update(id, { playStartedAt: spec.play, lastReadAt: now - DAY, addedAt: spec.play - 10 * DAY })
      } else if (spec.beat) {
        await m.logGamePlaythrough(id, null)
        const [start, end] = spec.beat
        const it = await db.items.get(id)
        const runs = (it.playthroughs ?? []).map((r) => ({ ...r, at: end, startedAt: start }))
        await db.items.update(id, { playthroughs: runs, completedAt: end, lastReadAt: end, addedAt: start - 5 * DAY })
      } else if (spec.planned) {
        await db.items.update(id, { addedAt: now - Math.floor(Math.random() * 40) * DAY })
      }
      if (spec.rating) await m.setRating(id, spec.rating)
      if (spec.fav) await m.toggleFavorite(id)
      log.push(`OK   ${spec.q} -> ${details.title} (${details.id})`)
    } catch (err) {
      log.push(`ERR  ${spec.q}: ${err?.message ?? err}`)
    }
  }

  // a couple of lists, like a real user would have
  const all = await db.items.toArray()
  const byTitle = (re) => all.find((i) => re.test(i.title))?.id
  const list1 = await m.createList('Weekend', '#f97316')
  for (const re of [/Interstellar/, /Dune/, /Frieren/, /Hollow/]) {
    const id = byTitle(re)
    if (id) await m.toggleListItem(list1.id, id)
  }
  const list2 = await m.createList('Masterpieces', '#a855f7')
  for (const re of [/Breaking Bad/, /Witcher/, /Berserk/, /Attack on Titan|Shingeki/]) {
    const id = byTitle(re)
    if (id) await m.toggleListItem(list2.id, id)
  }
  return log
}
