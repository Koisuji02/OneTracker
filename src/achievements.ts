/**
 * Achievements — the medals of the "Medagliere".
 *
 * Everything here is DERIVED from the library (items, watched units, finished
 * clashes); the only thing stored is which unlocks this device has already
 * announced and shown. So the medals are retroactive by construction: what was
 * watched before this existed already counts, and so does whatever a Drive
 * merge brings in from the other device.
 *
 * Two families of rows, four medals each (bronze → silver → gold → diamond):
 * - MEDIA + TAG ("Anime | Shōnen", "Videogiochi | Azione"): a fixed taxonomy
 *   per media, matched against the genres/tags the providers send. Fixed on
 *   purpose — every row is visible from day one (locked medals are shadows),
 *   and raw provider tags ("Single player", "Great Soundtrack") would make
 *   junk rows. Matching is language-blind because TMDB answers in whatever
 *   language the app had when the title was fetched: "Azione" and "Action"
 *   must land in the same row.
 * - FEATS ("Imprese"): habits across the whole library — marathons, late
 *   nights, ratings, favourites, clashes…
 *
 * Labels travel as `{ it, en }` pairs, like the theme names: this is data
 * (120+ rows), not UI chrome, so it lives here rather than in i18n.ts.
 */
import type { LucideIcon } from 'lucide-react'
import {
  BookImage,
  BookOpen,
  BookText,
  Bot,
  Car,
  Castle,
  Clapperboard,
  Coffee,
  Compass,
  Crosshair,
  DoorOpen,
  Drama,
  Eye,
  EyeOff,
  Feather,
  Fingerprint,
  Flag,
  Flame,
  Flower,
  Flower2,
  Footprints,
  Gamepad2,
  Ghost,
  GraduationCap,
  HandFist,
  Heart,
  Hourglass,
  Key,
  Landmark,
  Laugh,
  Library,
  Lightbulb,
  ListTodo,
  Map as MapIcon,
  Medal,
  Mic,
  Moon,
  Music,
  Palette,
  PenLine,
  Plane,
  Puzzle,
  Rocket,
  RotateCcw,
  Search,
  Shield,
  Skull,
  Sparkles,
  Sprout,
  Star,
  Sunset,
  Sword,
  Swords,
  Tent,
  Trophy,
  Tv,
  UserRound,
  Users,
  Utensils,
  Video,
  WandSparkles,
  Zap,
} from 'lucide-react'
import { useLiveQuery } from 'dexie-react-hooks'
import { useMemo, useSyncExternalStore } from 'react'
import { db, finishedViews, gamePlaythroughs, statsOf } from './db'
import type { MetalName } from './metals'
import type { Language } from './settings'
import type { ClashResult, LibraryItem, MediaType, WatchedEpisode } from './types'

// ------------------------------------------------------------------ basics

/** A label in both languages. */
export interface Bi {
  it: string
  en: string
}

/** Resolve a label for the current language (same fallback as i18n: English). */
export const pickLang = (b: Bi, lang: Language | null): string => (lang === 'it' ? b.it : b.en)

type Quad<T> = readonly [T, T, T, T]

export type Metal = MetalName
/** Tier index → metal: 0 bronze, 1 silver, 2 gold, 3 diamond. */
export const METALS: Quad<Metal> = ['bronze', 'silver', 'gold', 'diamond']
export const METAL_NAMES: Record<Metal, Bi> = {
  bronze: { it: 'Bronzo', en: 'Bronze' },
  silver: { it: 'Argento', en: 'Silver' },
  gold: { it: 'Oro', en: 'Gold' },
  diamond: { it: 'Diamante', en: 'Diamond' },
}

export type SectionKey = 'feats' | MediaType

/** A requirement sentence; `{n}` is the threshold, `{tag}` the row's label. */
interface Phrase {
  one?: Bi
  other: Bi
}

function phrase(p: Phrase, n: number, lang: Language | null, tag?: string): string {
  const pickFrom = n === 1 && p.one ? p.one : p.other
  return pickLang(pickFrom, lang)
    .replace('{n}', n.toLocaleString(lang === 'it' ? 'it-IT' : 'en-US'))
    .replace('{tag}', tag ?? '')
}

// ---------------------------------------------------------- tag matching

/**
 * Lowercase, accents stripped (ō → o), anything that isn't a letter/digit
 * becomes a space. "Sci-Fi & Fantasy" → "sci fi fantasy", "Shōnen" → "shonen".
 */
export function normalizeTag(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

const pad = (s: string) => ` ${s} `

interface TagDef {
  id: string
  label: Bi
  icon: LucideIcon
  /** normalized words/phrases; a hit anywhere in a genre/tag string counts */
  match: string[]
  /** phrases that disqualify THAT string ("mahou shoujo" is not the shōjo target) */
  not?: string[]
}

const tag = (
  id: string,
  it: string,
  en: string,
  icon: LucideIcon,
  match: string[],
  not?: string[],
): TagDef => ({
  id,
  label: { it, en },
  icon,
  match: match.map((m) => pad(normalizeTag(m))),
  not: not?.map((m) => pad(normalizeTag(m))),
})

// ------------------------------------------------------------- taxonomy

interface Family {
  key: MediaType
  label: Bi
  icon: LucideIcon
  /** ribbon colour of this media's medals */
  color: string
  /** the four grade nicknames, bronze → diamond */
  tiers: Quad<Bi>
  /** thresholds of the "all genres" row and of each tag row */
  all: Quad<number>
  each: Quad<number>
  reqAll: Phrase
  reqTag: Phrase
  tags: TagDef[]
}

const ALL_GENRES: Bi = { it: 'Tutti i generi', en: 'All genres' }

/*
 * THRESHOLDS (recalibrated 2026-09-28: the first set was unlocked almost
 * entirely by a real imported library). The ladder aims at:
 *   bronze  → a few months of real use
 *   silver  → about a year of steady tracking
 *   gold    → years of heavy use
 *   diamond → the top few percent of trackers
 * Reference points: Letterboxd's 26M users logged 700M films in 2024 (≈27 a
 * user) while enthusiasts log 1,000+ a year; Goodreads challenge pledges
 * average 47–61 books a year; active MyAnimeList profiles sit between 40 and
 * 450 "days watched" (≈2,400–27,000 episodes); manga profiles run from a few
 * hundred to 22,000+ chapters. A tag row counts only that genre's share, so
 * its ladder is a fraction of the "all genres" one.
 */
const FAMILIES: Family[] = [
  {
    key: 'tv',
    label: { it: 'Serie TV', en: 'TV Series' },
    icon: Tv,
    color: '#e5484d',
    tiers: [
      { it: 'Spettatore', en: 'Viewer' },
      { it: 'Bingewatcher', en: 'Binge-watcher' },
      { it: 'Teledipendente', en: 'Couch Potato' },
      { it: 'Showrunner', en: 'Showrunner' },
    ],
    all: [500, 2500, 7500, 15000],
    each: [150, 600, 2000, 5000],
    reqAll: { other: { it: 'Guarda {n} episodi di serie TV', en: 'Watch {n} TV series episodes' } },
    reqTag: {
      other: {
        it: 'Guarda {n} episodi di serie TV del genere {tag}',
        en: 'Watch {n} episodes of {tag} TV series',
      },
    },
    tags: [
      tag('action', 'Azione', 'Action', Zap, ['action', 'azione', 'martial arts', 'arti marziali', 'superhero', 'supereroi', 'spy', 'spionaggio', 'combat', 'swordplay', 'fight', 'fighting', 'gunfight']),
      tag('adventure', 'Avventura', 'Adventure', Compass, ['adventure', 'avventura']),
      tag('comedy', 'Commedia', 'Comedy', Laugh, ['comedy', 'commedia', 'sitcom', 'humor', 'umorismo', 'parody', 'parodia']),
      tag('drama', 'Dramma', 'Drama', Drama, ['drama', 'dramma', 'drammatico', 'melodrama']),
      tag('crime', 'Crime', 'Crime', Fingerprint, ['crime', 'crimine', 'poliziesco', 'police', 'polizia', 'detective', 'noir', 'mafia', 'gangster', 'heist', 'serial killer', 'investigation']),
      tag('mystery', 'Mistero', 'Mystery', Search, ['mystery', 'mistero', 'whodunit', 'conspiracy', 'cospirazione']),
      tag('thriller', 'Thriller', 'Thriller', Eye, ['thriller', 'suspense']),
      tag('scifi', 'Fantascienza', 'Sci-Fi', Rocket, ['sci fi', 'science fiction', 'fantascienza', 'space', 'spazio', 'dystopia', 'distopia', 'cyberpunk', 'time travel', 'alien', 'aliens']),
      tag('fantasy', 'Fantasy', 'Fantasy', WandSparkles, ['fantasy', 'magic', 'magia', 'sword and sorcery', 'dragon', 'dragons', 'fairy tale', 'fiaba']),
      tag('horror', 'Horror', 'Horror', Skull, ['horror', 'orrore', 'zombie', 'zombies', 'vampire', 'vampires', 'vampiri', 'slasher', 'ghost', 'haunted', 'possession', 'demon']),
      tag('animation', 'Animazione', 'Animation', Palette, ['animation', 'animazione', 'cartoon', 'adult animation']),
      tag('family', 'Famiglia', 'Family', Users, ['family', 'famiglia', 'kids', 'bambini', 'children']),
      tag('documentary', 'Documentario', 'Documentary', Video, ['documentary', 'documentario', 'docuseries', 'true crime']),
      tag('reality', 'Reality e show', 'Reality & Shows', Mic, ['reality', 'talk', 'talk show', 'game show', 'talent show', 'soap', 'news', 'competition']),
      tag('war', 'Guerra e politica', 'War & Politics', Shield, ['war', 'guerra', 'politics', 'politica', 'military', 'militare']),
      tag('romance', 'Romance', 'Romance', Heart, ['romance', 'romantic', 'romantico', 'romantica', 'love', 'amore', 'love triangle']),
      tag('history', 'Storico', 'Historical', Landmark, ['history', 'storia', 'historical', 'storico', 'period drama', 'period piece', 'costume drama', 'biography', 'biografia', 'medieval', 'ancient']),
      tag('western', 'Western', 'Western', Sunset, ['western', 'cowboy']),
    ],
  },
  {
    key: 'anime',
    label: { it: 'Anime', en: 'Anime' },
    icon: Sparkles,
    color: '#e93d82',
    tiers: [
      { it: 'Weeb', en: 'Weeb' },
      { it: 'Otaku', en: 'Otaku' },
      { it: 'Sensei', en: 'Sensei' },
      { it: 'Hokage', en: 'Hokage' },
    ],
    all: [300, 1500, 5000, 12000],
    each: [100, 500, 1500, 4000],
    reqAll: { other: { it: 'Guarda {n} episodi di anime', en: 'Watch {n} anime episodes' } },
    reqTag: {
      other: { it: 'Guarda {n} episodi di anime del genere {tag}', en: 'Watch {n} episodes of {tag} anime' },
    },
    tags: [
      tag('shonen', 'Shōnen', 'Shōnen', Flame, ['shonen', 'shounen']),
      tag('seinen', 'Seinen', 'Seinen', Moon, ['seinen']),
      tag('shojo', 'Shōjo', 'Shōjo', Flower2, ['shojo', 'shoujo'], ['mahou shoujo', 'mahou shojo', 'shoujo ai', 'shojo ai']),
      tag('josei', 'Josei', 'Josei', Flower, ['josei']),
      tag('action', 'Azione', 'Action', Zap, ['action', 'azione', 'martial arts', 'arti marziali', 'super power', 'superpower', 'superhero', 'battle', 'combat', 'swordplay', 'fight', 'fighting']),
      tag('adventure', 'Avventura', 'Adventure', Compass, ['adventure', 'avventura']),
      tag('comedy', 'Commedia', 'Comedy', Laugh, ['comedy', 'commedia', 'parody', 'parodia', 'gag humor']),
      tag('drama', 'Dramma', 'Drama', Drama, ['drama', 'dramma', 'tragedy', 'tragedia']),
      tag('fantasy', 'Fantasy', 'Fantasy', WandSparkles, ['fantasy', 'magic', 'magia', 'sword and sorcery', 'dragons', 'elf', 'elves', 'mahou shoujo', 'magical girl']),
      tag('isekai', 'Isekai', 'Isekai', DoorOpen, ['isekai', 'another world', 'reincarnation', 'reincarnazione', 'transported to another world', 'summoned into another world']),
      tag('scifi', 'Fantascienza', 'Sci-Fi', Rocket, ['sci fi', 'science fiction', 'fantascienza', 'space', 'cyberpunk', 'dystopia', 'time travel', 'aliens', 'post apocalyptic']),
      tag('mecha', 'Mecha', 'Mecha', Bot, ['mecha', 'robot', 'robots', 'giant robot', 'real robot', 'super robot']),
      tag('romance', 'Romance', 'Romance', Heart, ['romance', 'romantic', 'romantico', 'love', 'boys love', 'girls love', 'shoujo ai', 'shounen ai', 'harem']),
      tag('sliceoflife', 'Slice of life', 'Slice of Life', Coffee, ['slice of life', 'iyashikei', 'school', 'school life', 'cgdct', 'cute girls doing cute things', 'daily life']),
      tag('sports', 'Sport', 'Sports', Trophy, ['sports', 'sport', 'baseball', 'basketball', 'football', 'soccer', 'calcio', 'volleyball', 'tennis', 'boxing', 'swimming', 'cycling']),
      tag('supernatural', 'Horror e soprannaturale', 'Horror & Supernatural', Ghost, ['horror', 'supernatural', 'soprannaturale', 'ghost', 'ghosts', 'demons', 'demoni', 'vampire', 'vampires', 'zombie', 'youkai', 'yokai', 'curse']),
      tag('mystery', 'Mistero e thriller', 'Mystery & Thriller', Search, ['mystery', 'mistero', 'thriller', 'psychological', 'psicologico', 'detective', 'suspense', 'crime']),
      tag('music', 'Musica e idol', 'Music & Idols', Music, ['music', 'musica', 'idol', 'idols', 'band']),
    ],
  },
  {
    key: 'movie',
    label: { it: 'Film', en: 'Movies' },
    icon: Clapperboard,
    color: '#8e4ec6',
    tiers: [
      { it: 'Mangiapopcorn', en: 'Popcorn Eater' },
      { it: 'Cinefilo', en: 'Cinephile' },
      { it: 'Regista', en: 'Director' },
      { it: 'Premio Oscar', en: 'Oscar Winner' },
    ],
    all: [100, 500, 1500, 3000],
    each: [25, 100, 300, 750],
    reqAll: {
      one: { it: 'Guarda {n} film', en: 'Watch {n} movie' },
      other: { it: 'Guarda {n} film', en: 'Watch {n} movies' },
    },
    reqTag: {
      one: { it: 'Guarda {n} film del genere {tag}', en: 'Watch {n} {tag} movie' },
      other: { it: 'Guarda {n} film del genere {tag}', en: 'Watch {n} {tag} movies' },
    },
    tags: [
      tag('action', 'Azione', 'Action', Zap, ['action', 'azione', 'martial arts', 'arti marziali', 'superhero', 'supereroi', 'spy', 'spionaggio', 'car chase']),
      tag('adventure', 'Avventura', 'Adventure', Compass, ['adventure', 'avventura', 'treasure hunt', 'quest']),
      tag('animation', 'Animazione', 'Animation', Palette, ['animation', 'animazione', 'cartoon', 'anime', 'stop motion']),
      tag('comedy', 'Commedia', 'Comedy', Laugh, ['comedy', 'commedia', 'parody', 'parodia', 'satire', 'satira', 'humor', 'romcom']),
      tag('crime', 'Crime', 'Crime', Fingerprint, ['crime', 'crimine', 'gangster', 'mafia', 'heist', 'rapina', 'poliziesco', 'noir', 'neo noir', 'police', 'polizia', 'serial killer', 'organized crime']),
      tag('documentary', 'Documentario', 'Documentary', Video, ['documentary', 'documentario', 'docudrama']),
      tag('drama', 'Dramma', 'Drama', Drama, ['drama', 'dramma', 'drammatico', 'melodrama', 'tragedy', 'tragedia']),
      tag('family', 'Famiglia', 'Family', Users, ['family', 'famiglia', 'kids', 'bambini', 'children']),
      tag('fantasy', 'Fantasy', 'Fantasy', WandSparkles, ['fantasy', 'magic', 'magia', 'sword and sorcery', 'dragon', 'fairy tale', 'fiaba']),
      tag('history', 'Storico', 'Historical', Landmark, ['history', 'storia', 'historical', 'storico', 'biography', 'biografia', 'biopic', 'period drama', 'ancient', 'medieval']),
      tag('horror', 'Horror', 'Horror', Skull, ['horror', 'orrore', 'zombie', 'vampire', 'slasher', 'ghost', 'haunted', 'possession', 'found footage', 'body horror']),
      tag('music', 'Musica', 'Music', Music, ['music', 'musica', 'musical', 'concert', 'concerto']),
      tag('mystery', 'Mistero', 'Mystery', Search, ['mystery', 'mistero', 'whodunit', 'detective', 'giallo', 'investigation']),
      tag('romance', 'Romance', 'Romance', Heart, ['romance', 'romantic', 'romantico', 'romantica', 'love', 'amore', 'romantic comedy']),
      tag('scifi', 'Fantascienza', 'Sci-Fi', Rocket, ['science fiction', 'sci fi', 'fantascienza', 'space', 'dystopia', 'cyberpunk', 'time travel', 'alien', 'artificial intelligence']),
      tag('thriller', 'Thriller', 'Thriller', Eye, ['thriller', 'suspense', 'psychological thriller', 'conspiracy']),
      tag('war', 'Guerra', 'War', Shield, ['war', 'guerra', 'military', 'militare', 'world war ii']),
      tag('western', 'Western', 'Western', Sunset, ['western', 'spaghetti western', 'cowboy']),
    ],
  },
  {
    key: 'book',
    label: { it: 'Libri', en: 'Books' },
    icon: BookOpen,
    color: '#30a46c',
    tiers: [
      { it: 'Sfogliatore', en: 'Skimmer' },
      { it: 'Bibliofilo', en: 'Bibliophile' },
      { it: 'Divoralibri', en: 'Bookworm' },
      { it: 'Bibliotecario', en: 'Librarian' },
    ],
    all: [25, 100, 300, 750],
    each: [10, 30, 90, 200],
    reqAll: {
      one: { it: 'Leggi {n} libro', en: 'Read {n} book' },
      other: { it: 'Leggi {n} libri', en: 'Read {n} books' },
    },
    reqTag: {
      one: { it: 'Leggi {n} libro del genere {tag}', en: 'Read {n} {tag} book' },
      other: { it: 'Leggi {n} libri del genere {tag}', en: 'Read {n} {tag} books' },
    },
    // Open Library "subjects" are free text ("Detective and mystery stories",
    // "Juvenile fiction"), so these lean on the words inside them
    tags: [
      tag('fiction', 'Narrativa', 'Fiction', BookText, ['fiction', 'narrativa', 'novel', 'novels', 'romanzo', 'romanzi', 'literature', 'letteratura', 'short stories', 'racconti'], ['nonfiction', 'non fiction']),
      tag('fantasy', 'Fantasy', 'Fantasy', WandSparkles, ['fantasy', 'magic', 'wizards', 'witches', 'dragons', 'fairy tales', 'elves']),
      tag('scifi', 'Fantascienza', 'Sci-Fi', Rocket, ['science fiction', 'sci fi', 'fantascienza', 'dystopias', 'dystopia', 'space', 'time travel', 'robots', 'cyberpunk']),
      tag('mystery', 'Gialli e thriller', 'Mystery & Thriller', Search, ['mystery', 'mysteries', 'detective', 'detectives', 'crime', 'thriller', 'thrillers', 'suspense', 'giallo', 'gialli', 'noir', 'murder']),
      tag('horror', 'Horror', 'Horror', Skull, ['horror', 'ghost', 'ghosts', 'vampires', 'zombies', 'supernatural', 'occult']),
      tag('romance', 'Romance', 'Romance', Heart, ['romance', 'love stories', 'love', 'romantic', 'romantico']),
      tag('history', 'Storici', 'Historical', Landmark, ['historical fiction', 'history', 'storia', 'historical', 'storico', 'world war', 'medieval', 'ancient']),
      tag('classics', 'Classici', 'Classics', Library, ['classics', 'classic', 'classic literature', 'classici', 'classico']),
      tag('youngadult', 'Ragazzi', 'Young Adult', GraduationCap, ['juvenile fiction', 'juvenile', 'children', 'childrens', 'young adult', 'teen', 'ragazzi', 'bambini', 'school stories']),
      tag('biography', 'Biografie', 'Biographies', UserRound, ['biography', 'autobiography', 'memoir', 'memoirs', 'biografia', 'autobiografia']),
      tag('nonfiction', 'Saggistica', 'Non-fiction', Lightbulb, ['nonfiction', 'non fiction', 'saggistica', 'saggio', 'essays', 'philosophy', 'filosofia', 'psychology', 'psicologia', 'science', 'scienza', 'self help', 'economics'], ['science fiction']),
      tag('poetry', 'Poesia', 'Poetry', Feather, ['poetry', 'poesia', 'poems', 'poesie']),
      tag('humor', 'Umorismo', 'Humor', Laugh, ['humor', 'humour', 'humorous', 'comedy', 'satire', 'umorismo']),
    ],
  },
  {
    key: 'manga',
    label: { it: 'Manga e fumetti', en: 'Manga & Comics' },
    icon: BookImage,
    color: '#f76b15',
    tiers: [
      { it: 'Lettore', en: 'Reader' },
      { it: 'Fumettaro', en: 'Comics Nerd' },
      { it: 'Senpai', en: 'Senpai' },
      { it: 'Mangaka', en: 'Mangaka' },
    ],
    all: [1000, 5000, 15000, 40000],
    each: [300, 1500, 5000, 12000],
    reqAll: {
      other: { it: 'Leggi {n} capitoli di manga o fumetti', en: 'Read {n} manga or comic chapters' },
    },
    reqTag: {
      other: {
        it: 'Leggi {n} capitoli di manga o fumetti del genere {tag}',
        en: 'Read {n} chapters of {tag} manga or comics',
      },
    },
    tags: [
      tag('shonen', 'Shōnen', 'Shōnen', Flame, ['shonen', 'shounen']),
      tag('seinen', 'Seinen', 'Seinen', Moon, ['seinen']),
      tag('shojo', 'Shōjo', 'Shōjo', Flower2, ['shojo', 'shoujo'], ['mahou shoujo', 'mahou shojo', 'shoujo ai', 'shojo ai']),
      tag('josei', 'Josei', 'Josei', Flower, ['josei']),
      tag('action', 'Azione', 'Action', Zap, ['action', 'azione', 'martial arts', 'super power', 'superhero', 'battle']),
      tag('adventure', 'Avventura', 'Adventure', Compass, ['adventure', 'avventura']),
      tag('comedy', 'Commedia', 'Comedy', Laugh, ['comedy', 'commedia', 'gag humor', 'parody']),
      tag('drama', 'Dramma', 'Drama', Drama, ['drama', 'dramma', 'tragedy', 'tragedia']),
      tag('fantasy', 'Fantasy', 'Fantasy', WandSparkles, ['fantasy', 'magic', 'magia', 'magical girls', 'mahou shoujo', 'dragons', 'elves']),
      tag('isekai', 'Isekai', 'Isekai', DoorOpen, ['isekai', 'reincarnation', 'another world', 'villainess', 'transmigration']),
      tag('romance', 'Romance', 'Romance', Heart, ['romance', 'romantic', 'boys love', 'girls love', 'shoujo ai', 'shounen ai', 'harem', 'reverse harem', 'love']),
      tag('sliceoflife', 'Slice of life', 'Slice of Life', Coffee, ['slice of life', 'school life', 'iyashikei', 'cooking', 'office workers', 'daily life']),
      tag('sports', 'Sport', 'Sports', Trophy, ['sports', 'sport']),
      tag('supernatural', 'Horror e soprannaturale', 'Horror & Supernatural', Ghost, ['horror', 'supernatural', 'ghosts', 'vampires', 'zombies', 'monsters', 'demons', 'monster girls']),
      tag('mystery', 'Mistero e thriller', 'Mystery & Thriller', Search, ['mystery', 'thriller', 'psychological', 'crime', 'detective', 'suspense']),
      tag('scifi', 'Sci-fi e mecha', 'Sci-Fi & Mecha', Rocket, ['sci fi', 'science fiction', 'mecha', 'post apocalyptic', 'cyberpunk', 'aliens', 'virtual reality', 'time travel', 'robots']),
      tag('superhero', 'Supereroi', 'Superheroes', Shield, ['superhero', 'superheroes', 'supereroi', 'super hero']),
      tag('historical', 'Storico', 'Historical', Landmark, ['historical', 'history', 'samurai', 'wuxia', 'ninja', 'medieval']),
    ],
  },
  {
    key: 'game',
    label: { it: 'Videogiochi', en: 'Video Games' },
    icon: Gamepad2,
    color: '#0090ff',
    tiers: [
      { it: 'Niubbo', en: 'Noob' },
      { it: 'Enjoyer', en: 'Enjoyer' },
      { it: 'Tryhard', en: 'Tryhard' },
      { it: 'Boss finale', en: 'Final Boss' },
    ],
    all: [20, 75, 200, 400],
    each: [5, 20, 60, 120],
    reqAll: {
      one: { it: 'Completa {n} videogioco', en: 'Finish {n} video game' },
      other: { it: 'Completa {n} videogiochi', en: 'Finish {n} video games' },
    },
    reqTag: {
      one: { it: 'Completa {n} videogioco del genere {tag}', en: 'Finish {n} {tag} game' },
      other: { it: 'Completa {n} videogiochi del genere {tag}', en: 'Finish {n} {tag} games' },
    },
    // IGDB genres ("Role-playing (RPG)", "Hack and slash/Beat 'em up") and
    // themes ("Action", "Open world") plus RAWG's plain genres ("Action", "RPG")
    tags: [
      tag('action', 'Azione', 'Action', Zap, ['action', 'azione', 'hack and slash', 'beat em up']),
      tag('adventure', 'Avventura', 'Adventure', Compass, ['adventure', 'avventura', 'point and click']),
      tag('rpg', 'GDR', 'RPG', Sword, ['rpg', 'role playing', 'roleplaying', 'jrpg', 'arpg', 'gdr']),
      tag('shooter', 'Sparatutto', 'Shooter', Crosshair, ['shooter', 'fps', 'first person shooter', 'third person shooter', 'sparatutto', 'shoot em up', 'bullet hell']),
      tag('strategy', 'Strategia', 'Strategy', Castle, ['strategy', 'strategia', 'rts', 'tbs', '4x', 'tactical', 'tattico', 'tower defense', 'moba']),
      tag('puzzle', 'Puzzle', 'Puzzle', Puzzle, ['puzzle', 'rompicapo', 'quiz', 'trivia', 'logic']),
      tag('platform', 'Piattaforme', 'Platformer', Footprints, ['platform', 'platformer', 'metroidvania', 'piattaforme']),
      tag('racing', 'Corse', 'Racing', Car, ['racing', 'corse', 'driving', 'kart']),
      tag('sports', 'Sport', 'Sports', Trophy, ['sport', 'sports']),
      tag('simulation', 'Simulazione', 'Simulation', Plane, ['simulator', 'simulation', 'simulazione', 'management', 'business', 'farming', 'city builder']),
      tag('fighting', 'Picchiaduro', 'Fighting', HandFist, ['fighting', 'picchiaduro', 'fighter']),
      tag('horror', 'Horror', 'Horror', Skull, ['horror', 'survival horror', 'psychological horror']),
      tag('fantasy', 'Fantasy', 'Fantasy', WandSparkles, ['fantasy', 'dark fantasy', 'magic']),
      tag('scifi', 'Fantascienza', 'Sci-Fi', Rocket, ['science fiction', 'sci fi', 'fantascienza', 'space', 'cyberpunk', 'futuristic']),
      tag('openworld', 'Open world', 'Open World', MapIcon, ['open world', 'sandbox', 'exploration']),
      tag('survival', 'Sopravvivenza', 'Survival', Tent, ['survival', 'sopravvivenza', 'crafting', 'base building']),
      tag('stealth', 'Stealth', 'Stealth', EyeOff, ['stealth']),
      tag('story', 'Narrativi', 'Story-rich', PenLine, ['story rich', 'visual novel', 'interactive fiction', 'narrative', 'choices matter']),
      tag('multiplayer', 'Multigiocatore', 'Multiplayer', Users, ['multiplayer', 'co operative', 'co op', 'coop', 'mmo', 'mmorpg', 'massively multiplayer', 'battle royale', 'split screen', 'pvp']),
      tag('indie', 'Indie', 'Indie', Sprout, ['indie']),
    ],
  },
]

const FAMILY_OF = new Map<MediaType, Family>(FAMILIES.map((f) => [f.key, f]))

// --------------------------------------------------------------- feats

/** Everything a feat can measure, computed once per report. */
interface Signals {
  marathon: number
  nightMarks: number
  owned: number
  favorites: number
  rated: number
  rewatches: number
  seriesFinished: number
  mediaKinds: number
  hours: number
  backlog: number
  clashes: number
  genresUnlocked: number
}

interface Feat {
  id: string
  label: Bi
  icon: LucideIcon
  tiers: Quad<Bi>
  thresholds: Quad<number>
  req: Phrase
  measure: (s: Signals) => number
}

const FEATS: Feat[] = [
  {
    id: 'marathon',
    label: { it: 'Maratona', en: 'Marathon' },
    icon: Footprints,
    tiers: [
      { it: 'Jogger', en: 'Jogger' },
      { it: 'Podista', en: 'Runner' },
      { it: 'Maratoneta', en: 'Marathoner' },
      { it: 'Ultramaratoneta', en: 'Ultramarathoner' },
    ],
    thresholds: [15, 30, 60, 120],
    req: {
      other: {
        it: 'Segna {n} episodi nello stesso giorno',
        en: 'Check off {n} episodes on the same day',
      },
    },
    measure: (s) => s.marathon,
  },
  {
    id: 'time',
    label: { it: 'Tempo media', en: 'Media Time' },
    icon: Hourglass,
    tiers: [
      { it: 'Pantofolaio', en: 'Homebody' },
      { it: 'Sedentario', en: 'Lounger' },
      { it: 'Eremita', en: 'Hermit' },
      { it: 'Immortale', en: 'Immortal' },
    ],
    thresholds: [500, 2000, 5000, 10000],
    req: {
      other: {
        it: 'Accumula {n} ore tra serie, anime, film e giochi',
        en: 'Rack up {n} hours across series, anime, movies and games',
      },
    },
    measure: (s) => s.hours,
  },
  {
    id: 'finisher',
    label: { it: 'Serie finite', en: 'Finished Series' },
    icon: Flag,
    tiers: [
      { it: 'Costante', en: 'Steady' },
      { it: 'Tenace', en: 'Tenacious' },
      { it: 'Completista', en: 'Completionist' },
      { it: 'Platino', en: 'Platinum' },
    ],
    thresholds: [15, 60, 150, 300],
    req: {
      one: { it: 'Finisci {n} serie o anime', en: 'Finish {n} series or anime' },
      other: { it: 'Finisci {n} serie o anime', en: 'Finish {n} series or anime' },
    },
    measure: (s) => s.seriesFinished,
  },
  {
    id: 'rewatch',
    label: { it: 'Rewatch', en: 'Rewatches' },
    icon: RotateCcw,
    tiers: [
      { it: 'Déjà vu', en: 'Déjà Vu' },
      { it: 'Nostalgico', en: 'Nostalgic' },
      { it: 'Loop', en: 'Loop' },
      { it: 'Marmotta', en: 'Groundhog' },
    ],
    thresholds: [50, 250, 750, 2000],
    req: {
      one: {
        it: 'Rivedi o rileggi {n} volta qualcosa che avevi già finito',
        en: 'See {n} thing you had already finished again',
      },
      other: {
        it: 'Accumula {n} rewatch (episodi, capitoli o titoli rivisti)',
        en: 'Rack up {n} rewatches (episodes, chapters or titles seen again)',
      },
    },
    measure: (s) => s.rewatches,
  },
  {
    id: 'night',
    label: { it: 'Notte fonda', en: 'Late Nights' },
    icon: Moon,
    tiers: [
      { it: 'Insonne', en: 'Insomniac' },
      { it: 'Gufo', en: 'Night Owl' },
      { it: 'Vampiro', en: 'Vampire' },
      { it: 'Nosferatu', en: 'Nosferatu' },
    ],
    thresholds: [100, 500, 1500, 4000],
    req: {
      other: {
        it: 'Segna {n} episodi, capitoli o titoli tra mezzanotte e le 5',
        en: 'Check off {n} episodes, chapters or titles between midnight and 5 AM',
      },
    },
    measure: (s) => s.nightMarks,
  },
  {
    id: 'favorites',
    label: { it: 'Preferiti', en: 'Favorites' },
    icon: Heart,
    tiers: [
      { it: 'Innamorato', en: 'In Love' },
      { it: 'Tenerone', en: 'Softie' },
      { it: 'Romanticone', en: 'Romantic' },
      { it: 'Cupido', en: 'Cupid' },
    ],
    thresholds: [15, 50, 120, 250],
    req: { other: { it: 'Aggiungi {n} titoli ai preferiti', en: 'Add {n} titles to your favorites' } },
    measure: (s) => s.favorites,
  },
  {
    id: 'ratings',
    label: { it: 'Voti', en: 'Ratings' },
    icon: Star,
    tiers: [
      { it: 'Opinionista', en: 'Pundit' },
      { it: 'Recensore', en: 'Reviewer' },
      { it: 'Critico', en: 'Critic' },
      { it: 'Giurato', en: 'Juror' },
    ],
    thresholds: [50, 250, 750, 1500],
    req: { other: { it: 'Dai un voto a {n} titoli', en: 'Rate {n} titles' } },
    measure: (s) => s.rated,
  },
  {
    id: 'owned',
    label: { it: 'Collezione', en: 'Collection' },
    icon: Key,
    tiers: [
      { it: 'Raccoglitore', en: 'Gatherer' },
      { it: 'Collezionista', en: 'Collector' },
      { it: 'Accumulatore', en: 'Hoarder' },
      { it: 'Curatore', en: 'Curator' },
    ],
    thresholds: [25, 100, 250, 500],
    req: { other: { it: 'Segna come posseduti {n} titoli', en: 'Mark {n} titles as owned' } },
    measure: (s) => s.owned,
  },
  {
    id: 'backlog',
    label: { it: 'Da iniziare', en: 'Backlog' },
    icon: ListTodo,
    tiers: [
      { it: 'Sognatore', en: 'Dreamer' },
      { it: 'Ottimista', en: 'Optimist' },
      { it: 'Procrastinatore', en: 'Procrastinator' },
      { it: 'Utopista', en: 'Utopian' },
    ],
    thresholds: [50, 200, 500, 1000],
    req: {
      other: { it: 'Tieni {n} titoli in lista da iniziare', en: 'Keep {n} titles waiting to be started' },
    },
    measure: (s) => s.backlog,
  },
  {
    id: 'variety',
    label: { it: 'Varietà', en: 'Variety' },
    icon: Utensils,
    tiers: [
      { it: 'Assaggiatore', en: 'Taster' },
      { it: 'Buongustaio', en: 'Gourmet' },
      { it: 'Onnivoro', en: 'Omnivore' },
      { it: 'Divoratutto', en: 'Devourer' },
    ],
    thresholds: [2, 3, 5, 6],
    req: {
      other: {
        it: 'Arriva ad almeno 20 titoli in {n} media diversi (serie, anime, film, libri, manga, giochi)',
        en: 'Reach at least 20 titles in {n} different media (series, anime, movies, books, manga, games)',
      },
    },
    measure: (s) => s.mediaKinds,
  },
  {
    id: 'explorer',
    label: { it: 'Generi esplorati', en: 'Genres Explored' },
    icon: Compass,
    tiers: [
      { it: 'Turista', en: 'Tourist' },
      { it: 'Esploratore', en: 'Explorer' },
      { it: 'Cartografo', en: 'Cartographer' },
      { it: 'Marco Polo', en: 'Marco Polo' },
    ],
    thresholds: [10, 25, 50, 80],
    req: {
      other: {
        it: 'Sblocca almeno il bronzo in {n} generi diversi',
        en: 'Earn at least bronze in {n} different genres',
      },
    },
    measure: (s) => s.genresUnlocked,
  },
  {
    id: 'clash',
    label: { it: 'Scontri', en: 'Clashes' },
    icon: Swords,
    tiers: [
      { it: 'Arbitro', en: 'Referee' },
      { it: 'Giudice', en: 'Judge' },
      { it: 'Gladiatore', en: 'Gladiator' },
      { it: 'Imperatore', en: 'Emperor' },
    ],
    thresholds: [5, 20, 60, 150],
    req: {
      one: { it: 'Completa {n} scontro tra preferiti', en: 'Finish {n} clash of favorites' },
      other: { it: 'Completa {n} scontri tra preferiti', en: 'Finish {n} clashes of favorites' },
    },
    measure: (s) => s.clashes,
  },
]

// ------------------------------------------------------------- sections

export interface SectionInfo {
  key: SectionKey
  label: Bi
  icon: LucideIcon
  /** ribbon colour of every medal in the section */
  color: string
}

export const SECTIONS: SectionInfo[] = [
  { key: 'feats', label: { it: 'Imprese', en: 'Feats' }, icon: Medal, color: 'var(--brand)' },
  ...FAMILIES.map((f) => ({ key: f.key, label: f.label, icon: f.icon, color: f.color })),
]

/** Sections of media whose tab is switched off stay out of sight. */
export function sectionVisible(
  key: SectionKey,
  opts: { showBooks: boolean; showGames: boolean },
): boolean {
  if (key === 'book' || key === 'manga') return opts.showBooks
  if (key === 'game') return opts.showGames
  return true
}

// ------------------------------------------------------------------ rows

export interface AchievementRow {
  /** 'anime:shonen' · 'anime:all' · 'feats:marathon' */
  key: string
  section: SectionKey
  /** the row's own name: the tag, "All genres" or the feat */
  label: Bi
  icon: LucideIcon
  color: string
  /** the measured progress (episodes, titles, hours…) */
  value: number
  thresholds: Quad<number>
  /** highest medal reached: -1 none, 0 bronze … 3 diamond */
  tier: number
  /** grade nicknames, bronze → diamond */
  tierNames: Quad<Bi>
  /** a media+tag row (what the explorer feat counts) */
  isTag: boolean
  /** "Guarda 150 episodi di anime del genere Shōnen" */
  requirement: (n: number, lang: Language | null) => string
}

/** One medal: a row at one metal. The key is what the unlock state remembers. */
export const medalKey = (row: AchievementRow, tier: number) => `${row.key}:${METALS[tier]}`

function tierOf(value: number, thresholds: Quad<number>): number {
  let tier = -1
  thresholds.forEach((t, i) => {
    if (value >= t) tier = i
  })
  return tier
}

/**
 * TMDB's TV genres come in PAIRS — "Action & Adventure", "Sci-Fi & Fantasy" —
 * which only say "one of the two": counted literally, every shōnen was also an
 * adventure and every fantasy also sci-fi. A half counts when the title's
 * other genres/keywords confirm it; with no hint either way, both count.
 */
const PAIRED_GENRES: Array<{ text: string; halves: string[] }> = [
  { text: pad('action adventure'), halves: ['action', 'adventure'] },
  { text: pad('sci fi fantasy'), halves: ['scifi', 'fantasy'] },
]

/** The tag ids of one family an item belongs to. */
function tagsOf(item: LibraryItem, family: Family): string[] {
  const texts = [...(item.genres ?? []), ...(item.tags ?? [])].map((s) => pad(normalizeTag(s)))
  if (texts.length === 0) return []
  const pairs = PAIRED_GENRES.filter((p) => texts.includes(p.text))
  const plain = texts.filter((text) => !pairs.some((p) => p.text === text))
  const ids = new Set(
    family.tags
      .filter((t) =>
        plain.some(
          (text) => t.match.some((m) => text.includes(m)) && !t.not?.some((n) => text.includes(n)),
        ),
      )
      .map((t) => t.id),
  )
  for (const pair of pairs) {
    const halves = pair.halves.filter((h) => family.tags.some((t) => t.id === h))
    if (!halves.some((h) => ids.has(h))) halves.forEach((h) => ids.add(h))
  }
  return [...ids]
}

/** Local calendar day of a timestamp (the marathon is "on the same day"). */
const dayOf = (ms: number) => {
  const d = new Date(ms)
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`
}

const isNight = (ms: number) => new Date(ms).getHours() < 5

/**
 * The whole medagliere, from the library as it is right now.
 *
 * Units are counted DISTINCT (an episode seen three times is one episode): the
 * media rows measure how much of a genre you've covered, while going round
 * again has its own feat. The same goes for one-shot media — a film counts
 * once it has been finished at least once.
 */
export function computeAchievements(
  items: LibraryItem[],
  episodes: WatchedEpisode[],
  clashes: ClashResult[],
): AchievementRow[] {
  const byId = new Map(items.map((i) => [i.id, i]))
  const units = new Map<string, number>()
  let rewatches = 0
  // every episode marked counts, one by one OR all together: forgetting to tick
  // a binge as it happens and marking the whole season afterwards (one cascade,
  // one timestamp) is still that many episodes watched that day
  const marksPerDay = new Map<string, number>()
  let nightMarks = 0

  for (const e of episodes) {
    const item = byId.get(e.itemId)
    if (!item) continue
    units.set(e.itemId, (units.get(e.itemId) ?? 0) + 1)
    rewatches += Math.max(0, (e.count ?? 1) - 1)
    const at = e.watchedAt
    if (!at || at <= 0) continue
    if (item.mediaType === 'tv' || item.mediaType === 'anime') {
      const day = dayOf(at)
      marksPerDay.set(day, (marksPerDay.get(day) ?? 0) + 1)
    }
    if (isNight(at)) nightMarks++
  }

  // titles actually consumed per media type — "Varietà" wants 20+ in each
  const titlesPerKind = new Map<MediaType, number>()
  const values = new Map<string, number>()
  const add = (key: string, n: number) => values.set(key, (values.get(key) ?? 0) + n)

  for (const item of items) {
    const family = FAMILY_OF.get(item.mediaType)
    if (!family) continue
    let amount = 0
    if (item.mediaType === 'movie' || item.mediaType === 'book') {
      const views = finishedViews(item)
      amount = views > 0 ? 1 : 0
      rewatches += Math.max(0, views - 1)
      if (views > 0 && item.completedAt && isNight(item.completedAt)) nightMarks++
    } else if (item.mediaType === 'game') {
      const runs = gamePlaythroughs(item)
      amount = runs.length > 0 ? 1 : 0
      rewatches += Math.max(0, runs.length - 1)
      for (const run of runs) if (run.at > 0 && isNight(run.at)) nightMarks++
    } else {
      amount = units.get(item.id) ?? 0
    }
    if (amount <= 0) continue
    titlesPerKind.set(item.mediaType, (titlesPerKind.get(item.mediaType) ?? 0) + 1)
    add(`${family.key}:all`, amount)
    for (const id of tagsOf(item, family)) add(`${family.key}:${id}`, amount)
  }

  const rows: AchievementRow[] = []
  for (const family of FAMILIES) {
    const make = (key: string, label: Bi, icon: LucideIcon, thresholds: Quad<number>, isTag: boolean) => {
      const value = values.get(key) ?? 0
      rows.push({
        key,
        section: family.key,
        label,
        icon,
        color: family.color,
        value,
        thresholds,
        tier: tierOf(value, thresholds),
        tierNames: family.tiers,
        isTag,
        requirement: (n, lang) =>
          isTag ? phrase(family.reqTag, n, lang, pickLang(label, lang)) : phrase(family.reqAll, n, lang),
      })
    }
    make(`${family.key}:all`, ALL_GENRES, family.icon, family.all, false)
    for (const t of family.tags) make(`${family.key}:${t.id}`, t.label, t.icon, family.each, true)
  }

  const stats = statsOf(items, episodes)
  const signals: Signals = {
    marathon: Math.max(0, ...marksPerDay.values()),
    nightMarks,
    owned: items.filter((i) => i.owned).length,
    favorites: items.filter((i) => i.favorite).length,
    rated: items.filter((i) => i.rating != null).length,
    rewatches,
    seriesFinished: items.filter(
      (i) => (i.mediaType === 'tv' || i.mediaType === 'anime') && i.status === 'completed',
    ).length,
    mediaKinds: [...titlesPerKind.values()].filter((n) => n >= 20).length,
    hours: Math.floor(stats.totalMin / 60),
    backlog: items.filter((i) => i.status === 'planned' && !i.archived).length,
    clashes: clashes.length,
    genresUnlocked: rows.filter((r) => r.isTag && r.tier >= 0).length,
  }
  const feats = FEATS.map((f): AchievementRow => {
    const value = f.measure(signals)
    return {
      key: `feats:${f.id}`,
      section: 'feats',
      label: f.label,
      icon: f.icon,
      color: 'var(--brand)',
      value,
      thresholds: f.thresholds,
      tier: tierOf(value, f.thresholds),
      tierNames: f.tiers,
      isTag: false,
      requirement: (n, lang) => phrase(f.req, n, lang),
    }
  })
  return [...feats, ...rows]
}

/** Every medal earned in these rows, as keys ('anime:shonen:gold'). */
export function unlockedKeys(rows: AchievementRow[]): string[] {
  const keys: string[] = []
  for (const row of rows) for (let t = 0; t <= row.tier; t++) keys.push(medalKey(row, t))
  return keys
}

/** Live rows for a screen, recomputed whenever the library or the clashes change. */
export function useAchievementRows(): AchievementRow[] | undefined {
  const items = useLiveQuery(() => db.items.toArray(), [])
  const episodes = useLiveQuery(() => db.episodes.toArray(), [])
  const clashes = useLiveQuery(() => db.clashes.toArray(), [])
  return useMemo(
    () => (items && episodes && clashes ? computeAchievements(items, episodes, clashes) : undefined),
    [items, episodes, clashes],
  )
}

// ------------------------------------------------------- per-device state

/**
 * What THIS device has already announced (the top-of-screen pop-up) and shown
 * (the "new" mark in the medagliere). Deliberately per device and outside the
 * backup: it's about what this screen has told you, not about your library.
 */
export interface AchievementState {
  /**
   * false until the first computation. That pass records everything already
   * earned as announced WITHOUT a pop-up — a first launch after this update
   * would otherwise fire dozens of them — and leaves it unseen, so the
   * medagliere presents it as new instead.
   */
  ready: boolean
  /** medal keys the top-of-screen pop-up has already announced */
  notified: string[]
  /** medal keys already looked at in the medagliere */
  seen: string[]
  /** the medagliere has been opened at least once (drives the retro banner) */
  visited: boolean
}

const STATE_KEY = 'onetracker.achievements'
/**
 * Bump when the thresholds change. Raising them takes medals AWAY, and a
 * medal remembered as "announced" would be earned again later in silence:
 * a new calibration starts the per-device record over (the first pass then
 * records what's still earned, without pop-ups, as usual).
 */
const CALIBRATION = 3
const EMPTY: AchievementState = { ready: false, notified: [], seen: [], visited: false }

function loadState(): AchievementState {
  try {
    const raw = localStorage.getItem(STATE_KEY)
    if (raw) {
      const stored = JSON.parse(raw) as Partial<AchievementState> & { calibration?: number }
      if (stored.calibration === CALIBRATION) return { ...EMPTY, ...stored }
    }
  } catch {
    // unreadable → start over
  }
  return { ...EMPTY }
}

let achState: AchievementState = loadState()
const achListeners = new Set<() => void>()

export function getAchievementState(): AchievementState {
  return achState
}

export function updateAchievementState(patch: Partial<AchievementState>): void {
  achState = { ...achState, ...patch }
  try {
    localStorage.setItem(STATE_KEY, JSON.stringify({ ...achState, calibration: CALIBRATION }))
  } catch {
    // storage full or blocked: the state just won't survive a restart
  }
  achListeners.forEach((l) => l())
}

/** Forget everything announced/seen — used when the library is wiped. */
export function resetAchievementState(): void {
  updateAchievementState({ ...EMPTY })
}

export function useAchievementState(): AchievementState {
  return useSyncExternalStore(
    (l) => {
      achListeners.add(l)
      return () => achListeners.delete(l)
    },
    getAchievementState,
  )
}
