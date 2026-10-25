# First-visit tutorials, Help page, README — plan

> **Status: shipped in 1.0.52 (2026-10-25).** The code is the reference now —
> `src/tours.ts` (steps per screen), `src/pages/HelpPage.tsx`, Settings → Widget /
> Aiuto, `scripts/store/docs-images.mjs`. The `history` / `clash` /
> `achievements` / `lists` one-step tours (phase 2) were not done.

Tester feedback (2026-10-24): the first time the user opens each screen, explain it
with a highlight on the thing being explained (series, books + the Comic Vine key,
profile, settings + the widget with a preview, the detail page). Seen once, then
off; a Help section in Settings keeps the whole guide. Also: a shorter README,
written for users.

## Approach

- **Library: [driver.js](https://driverjs.com) 1.x** — MIT, ~5 kB gzipped, no
  dependencies, framework-agnostic (no React 19 peer issues). Dims the page with a
  cut-out around the target, scrolls it into view, popover with steps; a step with
  no element is a centred card.
  - Rejected: Shepherd.js and Intro.js (AGPL-3.0). react-joyride 3 (MIT) is the
    fallback if driver.js misbehaves in the Android WebView.
- **Patterns from proven apps** (YouTube's first-visit hints, Material "feature
  discovery", Apple TipKit):
  - one element per step, one or two sentences;
  - at most 4–5 steps per screen;
  - "Salta" always visible;
  - shown on the first arrival to that screen, never again;
  - replayable from Help.

## Architecture

- **`src/tours.ts`** — the registry `TOURS: Record<TourId, (ctx) => Step[]>`.
  - Steps point at `data-tour="…"` anchors added to the pages.
  - Texts are i18n keys `tour.<id>.<n>.title` / `.body`.
  - When the tour starts, steps are dropped if their anchor is not in the DOM (empty
    library) or does not apply (platform, `showBooks` / `showGames`).
- **`useTour(id, ready)`** — a hook in each page.
  - Starts once `ready` is true (data loaded), the tour is unseen and tours are on,
    after ~400 ms.
  - Marks the tour seen on finish **or** skip.
  - Registers `useBackInterceptor` (`src/back.ts`) so Android back closes it.
  - Never starts over another overlay: MonthRecap, RatingModal, dialogs,
    achievement toast.
- **Settings**:
  - `seenTours: string[]`;
  - `toursOff: boolean` ("Non mostrare più i tutorial", offered in each popover's
    footer and in Help).
  - Both go into the backup's `settings`, so a restored phone does not replay them.
- **Look**:
  - Import `driver.js/dist/driver.css`, then override it in `src/index.css` with
    the app tokens: card background, `line` border, `ink` text, the squared radius
    scale, buttons like the app's (brand primary, ghost secondary).
  - Progress reads `2 / 4`. No pills, no `•`.
  - Overlay `rgba(0,0,0,.72)`, `stagePadding` 6, small `stageRadius`.
  - Buttons: Avanti / Indietro / Fine / Salta (EN: Next / Back / Done / Skip).
  - Steps anchored to the bottom nav open upwards, clear of the safe areas.

## Tours (draft — finalise against the real UI)

| Tour | When | Steps |
|---|---|---|
| `series` | first Serie TV visit (the screen after onboarding) | bottom nav = the sections; Cerca = how to add; Continua (✓ marks the next episode, tap = detail); Da vedere; In attesa (caught up); sort / view controls |
| `movies` | first Film visit | statuses to start → in progress → finished; rewatches |
| `books` | first Libri visit | books, manga and comics in one place; chapters; **Comic Vine key only for western comics** (points at the KeyGuide card if shown, else says where it is in Settings) |
| `games` | first Giochi visit | HowLongToBeat lengths; hours per playthrough; in-progress games show in Cronologia |
| `search` | first Cerca visit | type filter; add to the library |
| `account` | first Profilo visit | stats; Cronologia + monthly recap; Obiettivi; Preferiti / Archiviati / Posseduti / Da prendere; Liste; Scontro; name + avatar; the gear → Settings |
| `settings` | first Impostazioni visit | theme; sections on/off; keys (Comic Vine, OMDb, personal); Google backup + sync; TV Time import; **widget** (Android only); Guida |
| `detail` | first detail page | status / ✓; rating; favourite, lists, owned; seasons and episodes (or chapters, or game times); ratings |
| `history`, `clash`, `achievements`, `lists` | first visit | one step each (phase 2, if time allows) |

## Widget step (Android only)

- **Preview**: a static image of the real widget, made by the store-shot script
  (`scripts/store/`), shipped as `public/help/widget-it.webp` and
  `public/help/widget-en.webp`.
- **"Aggiungi alla Home" button**:
  - a new `OneWidget.requestPin()` in `OneWidgetPlugin.java`, calling
    `AppWidgetManager.requestPinAppWidget` (Android 8+);
  - when the launcher can't pin (`isRequestPinAppWidgetSupported() == false`), show
    the manual way instead: long-press the Home → Widget → OneTracker.
- **Web and iOS**: the step is hidden.

## Help page (Settings → Guida, route `/help`)

- One card per area, each with:
  - an icon in the section's colour;
  - 2–3 lines of text;
  - "Mostra il tutorial", which opens that screen and starts its tour even if seen.
- Static topics: keys (Comic Vine, OMDb), backup and sync, TV Time import, widget
  (with the preview), the monthly recap.
- "Rivedi tutti i tutorial" (clears `seenTours`) and a "Mostra i tutorial" switch.

## Housekeeping

- `scripts/store/shoot.mjs` seed and the CLAUDE.md preview tip: add
  `toursOff: true`, or the store screenshots and the preview tests get tours on top.
- Existing users see each tour once after the update. That's fine: it is how the
  testers find the feature.
- Verify in the browser preview:
  - phone width;
  - light, dark and AMOLED themes;
  - IT and EN;
  - empty and full library;
  - back closes the tour.
- Then build 1.0.52 for the closed track. It is also the "update after feedback"
  that Play's production questions ask about.

## README rewrite

- **Now**: 156 lines, mostly for developers (repo layout, how it works).
- **New**: user-first and short.
  - What it is, in 2 lines, plus 2–3 screenshots (small webp in `docs/img/`).
  - Get it: Play (once public), web version, iPhone status.
  - What it does: a short list.
  - Your data: on the phone, optional Drive backup, no ads, no tracking.
  - Optional keys: Comic Vine and OMDb, one line each.
  - Build it yourself: a few commands, then a link to `docs/CODEBASE.md`.
  - Credits: the TMDB notice is mandatory.
  - Licence: MPL-2.0.
- Developer detail moves to `docs/CODEBASE.md` where it isn't there already.

## Order of work

1. driver.js + `tours.ts` + `useTour` + theme, the `series` tour. Check in the
   preview.
2. The other screen tours and `detail`.
3. The Help page and the Settings entries.
4. Widget preview and pin (native).
5. README.
6. Build 1.0.52, upload to the closed track.
