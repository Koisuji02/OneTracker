# Play Store listing — texts, assets and console answers

Everything the Play Console asks for, ready to paste. Italian is the default
language of the listing, English the added translation.

The images are generated, not hand-made, so they can be redone after any UI
change (real app, real library, real covers):

```
# TMDB and IGDB answer through the gateway's own keys; optionally export
# OT_COMICVINE_KEY / OT_OMDB_KEY to show comics and IMDb/RT ratings too
npm run dev                                   # the dev server, port 5173
node scripts/store/shoot.mjs seed it          # once per language: fills a library
node scripts/store/shoot.mjs seed en          #   (real titles, through the gateway)
node scripts/store/shoot.mjs shots it         # raw screens  -> builds/store/raw/<lang>/
node scripts/store/shoot.mjs shots en
node scripts/store/compose.mjs it             # Play images  -> builds/store/play/<lang>/
node scripts/store/compose.mjs en
node scripts/store/docs-images.mjs            # README images -> docs/img/, widget preview -> public/help/
```

| Asset | File | Play requirement |
|---|---|---|
| App icon | `builds/store/play/icon-512.png` | 512×512 PNG, Play applies the rounded mask |
| Feature graphic | `builds/store/play/<lang>/feature-graphic.png` | 1024×500 |
| Phone screenshots | `builds/store/play/<lang>/screenshot-1…8.png` | 2–8, 1080×1920 (9:16) |

## 1. Texts — Italiano (default)

**App name** (max 30): `OneTracker: Media Tracker`
(alternative: `OneTracker: serie, film, libri` — exactly 30)

**Short description** (max 80):

```
Serie, anime, film, libri, manga e giochi: tieni il conto di tutto in un'app.
```

**Full description** (max 4000):

```
OneTracker tiene il conto di quello che guardi, leggi e giochi: serie TV, anime, film, libri, manga, fumetti e videogiochi, nella stessa app.

SERIE E ANIME
– Segni un episodio con un tocco, e quelli prima si segnano da soli.
– In "Continua" trovi il prossimo episodio di ogni serie, in ordine di attività.
– Stagioni ed episodi con titoli e date di uscita; i rewatch vengono contati (x2, x3…).
– Le serie in pari aspettano in una sezione a parte, finché non esce un episodio nuovo.

FILM, LIBRI, MANGA E FUMETTI
– Film e libri passano da "da iniziare" a "in corso" a "finiti", con le rivisioni.
– Manga e fumetti capitolo per capitolo, con il numero di capitoli aggiornato.

VIDEOGIOCHI
– Durate da HowLongToBeat: storia, storia + extra, completista.
– Ogni partita finita ha le sue ore: le scrivi tu o usi quelle di HowLongToBeat.
– DLC ed espansioni nella pagina del gioco.

IL TUO MESE
– La cronologia, mese per mese, di quello che hai visto, letto e giocato.
– A fine mese un recap a storie, con un'immagine da condividere su Instagram o dove vuoi.

STATISTICHE E COLLEZIONI
– Tempo totale per serie, film e giochi, voti con medaglie, obiettivi da sbloccare.
– Preferiti, Archiviati, Posseduti, Da prendere e liste create da te.
– Scontro: un torneo a eliminazione diretta tra i tuoi preferiti.

I TUOI DATI RESTANO TUOI
– Nessun account obbligatorio: la libreria sta sul telefono e si consulta anche offline.
– Backup facoltativo sul tuo Google Drive, in una cartella privata dell'app, con la sincronizzazione tra più dispositivi.
– Niente pubblicità, niente tracciamento.
– Puoi importare la tua libreria da TV Time.

E POI
– Un widget per la schermata Home con quello che stai seguendo.
– Temi AMOLED in otto colori, un tema chiaro e altri ancora.
– In italiano e in inglese.

Dati e immagini da TMDB, IGDB, HowLongToBeat, AniList, MangaDex, Open Library, Comic Vine e altri servizi. Questo prodotto usa l'API di TMDB ma non è approvato né certificato da TMDB.
```

## 2. Texts — English

**App name** (max 30): `OneTracker: Media Tracker`
(alternative: `OneTracker: TV, movies, games` — 29)

**Short description** (max 80):

```
Track shows, anime, movies, books, manga and games, all in one app.
```

**Full description** (max 4000):

```
OneTracker keeps track of what you watch, read and play: TV shows, anime, movies, books, manga, comics and video games, in one app.

SHOWS AND ANIME
– Mark an episode in one tap, and the ones before it are marked too.
– "Continue" shows the next episode of every show, ordered by what you watched last.
– Seasons and episodes with titles and air dates; rewatches are counted (x2, x3…).
– Shows you're caught up on wait in their own section until a new episode is out.

MOVIES, BOOKS, MANGA AND COMICS
– Movies and books go from "to start" to "in progress" to "finished", rewatches included.
– Manga and comics chapter by chapter, with an up-to-date chapter count.

VIDEO GAMES
– Lengths from HowLongToBeat: main story, main + extras, completionist.
– Every finished playthrough has its own hours: type them, or use HowLongToBeat's.
– DLCs and expansions on the game's page.

YOUR MONTH
– Your history, month by month: everything you watched, read and played.
– At the end of each month, a story-style recap with an image to share on Instagram or anywhere else.

STATS AND COLLECTIONS
– Total time for shows, movies and games, ratings with medals, achievements to unlock.
– Favourites, Archived, Owned, To buy and lists of your own.
– Clash: a knockout tournament between your favourites.

YOUR DATA STAYS YOURS
– No account needed: your library lives on your phone, and you can browse it offline.
– Optional backup to your own Google Drive, in a private app folder, with sync across devices.
– No ads, no tracking.
– Import your library from TV Time.

ALSO
– A home-screen widget with what you're following.
– AMOLED themes in eight colours, a light theme and more.
– In English and Italian.

Data and images from TMDB, IGDB, HowLongToBeat, AniList, MangaDex, Open Library, Comic Vine and other services. This product uses the TMDB API but is not endorsed or certified by TMDB.
```

## 3. Store settings

| Field | Answer |
|---|---|
| App or game | App |
| Free or paid | Free (this can never be changed back to paid) |
| Category | Entertainment |
| Tags (up to 5) | Movies & TV, Books, Games / Video games, Anime, Entertainment — pick the closest ones the console offers |
| Contact e-mail | the developer address (it is public on the listing) |
| Website | `https://onetracker.onetracker.workers.dev/home` |
| Privacy policy | `https://onetracker.onetracker.workers.dev/privacy` |

## 4. App content (Policy → App content)

| Section | Answer |
|---|---|
| Privacy policy | the URL above |
| Ads | **No**, the app contains no ads |
| Advertising ID | **No** (from 1.0.51 the manifest has no `AD_ID` permission: Facebook's SDK is off, see `capacitor.config.ts`) |
| App access | **All functionality is available without special access** (Google sign-in is optional and only enables the Drive backup; the Comic Vine and OMDb keys only add western comics and extra ratings) |
| Content rating | see §5 |
| Target audience | **13+** only (13–15, 16–17, 18+). Not for children: it avoids the Families policy, and the catalogue includes titles for adults |
| News app | No |
| COVID-19 apps | No |
| Data safety | see §6 |
| Government app | No |
| Financial features | None |
| Health | None |
| Advertising ID | **No** (no SDK uses it) |

## 5. Content rating questionnaire (IARC)

- **Category:** "All other app types" (it is a tracking utility, not a game,
  store or social network).
- **Violence, sexuality, language, drugs, gambling:** **No** to every question.
  The app does not depict any of it itself; it only shows titles, posters and
  synopses of works from public catalogues.
- **Users interact / share content with each other:** **No** (no chat, no
  profiles, no public content; the recap image is shared through the system
  share sheet, outside the app).
- **Shares the user's location:** No. **Digital purchases:** No.
- Expected result: PEGI 3 / Everyone (IARC may give it slightly higher because
  of the "unrestricted internet" question if asked: answer honestly — the app
  only reaches its own catalogue services, it has no browser).

## 6. Data safety

What actually leaves the phone (see `docs/PRIVACY.md`):

- **Searches and the titles opened** go to the gateway (Cloudflare Worker) and,
  through it, to the catalogue services. They carry no identity; the gateway
  keeps a cache of the public answers keyed by the query, never who asked.
- **The Drive backup** goes from the phone to the user's own Google Drive
  (`drive.appdata`), only if they sign in. The developer never receives it.
- **Name, e-mail and photo** of the Google account are read from Google and
  kept on the device only.

Google's definition counts *any* transfer off the device as "collected", even
anonymous and not stored, so the safe, honest declaration is:

| Question | Answer |
|---|---|
| Does your app collect or share any of the required user data types? | **Yes** |
| Is all of the user data collected by your app encrypted in transit? | **Yes** (HTTPS everywhere) |
| Do you provide a way for users to request that their data is deleted? | **Yes** — everything is on the device (Settings → clear the library, or uninstall); the Drive backup can be deleted from Google Drive |
| Data types | **App activity → In-app search history**: *Collected* yes, *Shared* no (the catalogue services are service providers working for the app), *Processed ephemerally* **no** (the gateway caches the public answers keyed by the query), *Required* (search can't be turned off), *Purpose*: **App functionality** |
| Everything else (location, personal info, financial, messages, photos, contacts, device IDs…) | **Not collected** |
| Account creation | **No account**: the app has no accounts of its own; Google sign-in only authorises the backup into the user's own Drive, and nothing is stored on the developer's side, so no account-deletion URL is needed |

(The earlier note "no data collected, none shared" is defensible too, since the
searches are anonymous; declaring the search history is the version no reviewer
can contest.)

## 7. After the first upload

- Play Console → **Test and release → App integrity → App signing**: copy the
  **App signing key certificate SHA-1** and add it as one more **Android OAuth
  client** in Google Cloud, or Google sign-in breaks for installs from the store.
- Closed test: **at least 12 testers for 14 consecutive days**, then apply for
  production.

## 8. Note on the screenshots

Order: 1 Continue list · 2 the home-screen widget · 3 a series page · 4 a game
page · 5 books/manga · 6 History · 7 the recap and its share image · 8 themes
(Play takes 8 at most; the profile/stats screen made way for the widget).

The widget is native, so it can't be captured in a browser: screenshot 2 is a
faithful rebuild (`scripts/store/widget-home.html`) of `widget_root.xml` /
`widget_row.xml` — same dp sizes, Figtree, AMOLED colours, icons and ✓ — filled
with the rows `widget.ts` would push, on an abstract home-screen wallpaper.

They show real posters and box art (TMDB, IGDB…), as every tracker on the store
does. If a reviewer ever objects to third-party artwork, the fix is cheap:
re-run the scripts with a library of public-domain or self-made covers.
