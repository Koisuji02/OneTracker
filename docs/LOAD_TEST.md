# Load test — how far the gateway + cache carry OneTracker

Run on 2026-10-18, app 1.0.44, gateway as deployed (TMDB and IGDB on the app's
own keys behind a cache shared by every user).

```
node scripts/stress/simulate.mjs                  # every tier, 2 days, report the warm one
node scripts/stress/simulate.mjs --burst 5000     # N users in the same 5 minutes
node scripts/stress/simulate.mjs --colos 3        # users split over 3 edge caches
node scripts/stress/simulate.mjs --cache 20000    # an edge cache capped at N entries
node scripts/stress/simulate.mjs --arch snapshot  # current | direct | snapshot | byok (below)
```

Results land in `builds/stress/*.json` (gitignored).

## Method

- **The real gateway code** (`worker/src/index.js`, `edge.js`) runs in Node:
  its cache policies, key handling, stale answers, per-IP rate limits, on a
  virtual clock. The edge cache is an LRU with the same expiry rules.
- **Fake providers**, never the real ones (hammering TMDB/IGDB would burn their
  quotas and break their terms). IGDB answers 429 above **4 requests/second**,
  like the real one; HowLongToBeat costs two calls per lookup, like the real one.
- **One user's day** is what the app actually does, measured in the browser with
  a fetch logger on every action (below): ~3 app opens (each a background sync of
  the series/manga still airing, at most every 30 min, an item only when its copy
  is older than 6 h), ~2.5 searches typed as ~1.4 queries, ~6 detail pages
  (35% series, 20% films, 10% anime, 15% games, 15% manga, 5% books); 10% of users
  have a Comic Vine key, 15% an OMDb key.
- **Popularity** follows a Zipf curve over realistic catalogue sizes (60k series,
  200k films, 80k games, 40k manga, 40k distinct queries): a few titles everyone
  opens, a very long tail. **Time of day** follows an Italian day (quiet nights,
  the 21:00 peak at ~4× the night).

## What each action costs (measured)

Calls through the gateway (they count against the Worker's requests) and calls
the phone makes directly (they cost the gateway nothing and hit each user's IP).

| Action | Through the gateway | Direct from the phone |
|---|---|---|
| Search ("dune") | 4: TMDB series + films, IGDB **1**, MangaDex | AniList 3, Open Library 1 |
| Search with a thin first IGDB hit ("elden ring") | 5: IGDB **2** (the fuzzy query only then) | same |
| Series page | 2: TMDB details + season | — |
| Film page | 1: TMDB | — |
| Anime page | 1: TMDB | AniList, Jikan |
| Game page | 2: IGDB **1** (details + time-to-beat in one `/multiquery`) + HowLongToBeat | — |
| Manga page | 5: MangaDex (manga, stats, cover, chapters, feed) | AniList, Jikan |
| Book page | 0 | Open Library 3 |

Before 1.0.44 a game search was always 2 IGDB requests and a game page 2–3, and
a game search also made one Wikipedia request per result (14) to replace IGDB's
covers, which already carry the logo.

## Results — a normal day (warm cache)

| Users/day | Worker requests/day | Free plan (100k/day) | Edge cache hits | Upstream TMDB | Upstream IGDB | IGDB peak | IGDB 429s | Failed |
|---|---|---|---|---|---|---|---|---|
| 100 | 3,946 | 4% | 44% | 1,186 | 380 | 2/s | 0 | 0% |
| 1,000 | 40,755 | 41% | 62% | 9,135 | 2,871 | 4/s | 0 | 0% |
| 2,500 | 103,557 | **104%** | 69% | 19,593 | 6,005 | 4/s | 0 | 0% |
| 5,000 | 207,467 | 207% | 74% | 35,099 | 10,733 | 5/s | 3 | 0% |
| 10,000 | 418,943 | 419% | 79% | 60,953 | 18,157 | 5/s | 22 | 0.01% |
| 25,000 | 1,037,485 | 1,038% | 85% | 119,752 | 34,869 | 5/s | 118 | 0.02% |
| 50,000 | 2,083,891 | 2,084% | 89% | 196,500 | 55,551 | 5/s | 434 | 0.03% |

~41 gateway requests per user per day, whatever the size: **TMDB 47%, MangaDex
35%, IGDB 13%, HowLongToBeat 2%, OMDb + Comic Vine 2%**. The busiest second at
50k users is 113 gateway requests, TMDB upstream 23/s (its limit is ~40/s).

## Results — a burst (an episode drop)

N users open the app in the same 5 minutes: each syncs, everyone opens the hot
series, half search, 30% open a game.

| Users in 5 min | Gateway requests | Edge cache hits | Peak gateway | TMDB upstream peak | IGDB requests failed |
|---|---|---|---|---|---|
| 5,000 | 43,597 | 65% | 203/s | 36/s | 2,749 of 4,733 (58%) |
| 20,000 | 175,129 | 72% | 734/s | 116/s | 12,552 of 19,085 (66%) |

## What it means

1. **The only limit that costs money is the Worker's free 100k requests a day:
   ~2,400 daily users.** Cache hits count as requests too. Past it, today, TMDB
   and IGDB calls fail until midnight UTC (the library, marking and the widget
   keep working: they are local). Workers Paid is $5/month for 10M requests.
2. **The cache works**: from 44% hits at 100 users to 89% at 50k, so the
   providers see a fraction of the traffic (50k users → ~200k TMDB and ~56k
   IGDB calls a day).
3. **IGDB holds a normal day** even at 50k users (0.03% failed), thanks to the
   cache and the one-request pages. **It does not hold a burst**: thousands of
   people searching/opening games in the same minutes are 15–60 IGDB misses a
   second against a limit of 4, and most of those fail.
4. **A latent risk on TMDB**: the gateway rests a key for 60 s after a 429. With
   ONE key, a TMDB 429 in a burst would stop every uncached TMDB answer for a
   minute. The bursts above stay at 36–116 TMDB calls/s spread over Cloudflare's
   egress, so it may never trigger, but it should rest seconds, not a minute.

## Levers, by how much they save

| Lever | Effect | Cost / risk |
|---|---|---|
| **MangaDex direct first**, gateway only when the network blocks it | −35% gateway requests | Where an ISP blocks MangaDex with a hang instead of a refusal, the first manga page waits for the timeout before falling back |
| **TMDB direct from the phone** with the app's key in the app | −47% gateway requests; TMDB's per-IP limit then applies per phone | The key ships inside the APK (extractable). TMDB's terms don't forbid it and most apps do it; a user key in Settings keeps working if it were ever revoked |
| Both | ~7 requests/user/day → **free plan ≈ 13,000 daily users** | the two above |
| **IGDB: wait and retry on 429** in the gateway (instead of failing at once) | Smooths short bursts at 4/s | Slower answers during a burst; sustained bursts still queue |
| **TMDB: rest seconds, not 60 s, on a 429** | Removes the one-minute outage risk | None |
| Workers Paid ($5/month) | 10M requests/month ≈ 8,000 daily users at today's ~41/user | A monthly cost |

Caveats: one edge cache is assumed (users in Italy mostly hit one or two
Cloudflare colos; `--colos 3` shows the cost of more), users are independent
(real ones cluster even more on hits, which helps the cache), and the fakes
answer instantly (real latency only makes bursts spread out).

## Architectures compared (where each call goes)

`--arch` routes every call of the same simulated users differently:

- **current** — everything keyed through the gateway (1.0.44).
- **direct** — the phone calls TMDB (the app's key inside the app), HowLongToBeat,
  OMDb, Comic Vine and MangaDex itself; the gateway keeps IGDB and MangaDex for
  the ~15% of users whose ISP blocks it.
- **snapshot** — direct + a daily static snapshot of the ~20k most popular games
  (their pages and a search index) built by a scheduled job and served as static
  files, which Cloudflare serves free and unlimited; the gateway keeps IGDB for
  the long tail.
- **byok** — every quota-limited service on the user's own key (games on RAWG,
  whose key is "sign in and copy"), no gateway for data.

Gateway requests per user per day, plus ~1.5 for the Google Drive token (an
access token lives an hour, in memory; ~half the users back up):

| Architecture | Gateway req/user/day | Free plan carries | IGDB failed (normal day) | 20k-user burst: requests failed |
|---|---|---|---|---|
| current | 41.5 + 1.5 | **~2,300 users/day** | 0.03% at 50k | 66% of IGDB |
| direct | 7.7 + 1.5 | **~11,000** | 0.04% at 10k → 0.42% at 250k | 47% of gateway requests |
| snapshot | 2.9 + 1.5 | **~23,000** | 0.01% at 10k → 0.2% at 1M | 17% of gateway requests |
| byok | ~2.2 (MangaDex for blocked ISPs) + 1.5 | ~27,000 — **unlimited** without those two | no IGDB | none (each user's own limits) |

Past the free plan, Workers Paid is $5/month for 10M requests, then $0.30 per
million: **snapshot** at 100k users/day ≈ $6/month, at 1M users/day ≈ $42/month;
**current** at 100k users/day ≈ $40/month.

IGDB is the only shared limit left in direct/snapshot: at 1M users/day it gets
~143k calls (1.7/s average, capped at its 4/s), 0.2% fail on a normal day, and
bursts of thousands of people searching games at once still fail partly. The
ways round it are IGDB's partner programme (a higher limit), a user's own Twitch
app (Settings), or byok with RAWG.

RAWG (checked live): Metacritic out of 100 on the known games (Elden Ring 95,
Zelda TotK 96) and its own score out of 5; a landscape background, a second
image and 6 screenshots; NO portrait cover with the logo — those would come
from Steam (PC games) and Wikipedia (console games), as before IGDB.

## Applied in 1.0.45 (the "no downside" step)

- **TMDB rests 2 s after a 429**, not 60 (`edge.js` `classify`): with one key,
  a burst can no longer stop TMDB for a minute.
- **IGDB waits and retries on a 429** (up to 3 times, ~2.5 s in all, with jitter)
  instead of failing at once. Measured with the simulator (exact per-second
  accounting): a 5,000-user burst goes from 58% to 44% of IGDB requests failed,
  a 20,000-user burst from 66% to 60%; a normal day stays at 0%. It smooths short
  spikes; a sustained burst above 4/s is still beyond IGDB's limit.
- **Usage alarm**: the gateway counts one request in 50 (Cache API, per edge,
  resets at midnight UTC) and `/health` reports `usage` — requests today and the
  share of the free 100k — with an `advice` line from 70%. The app shows both in
  Settings → provider check → Gateway. That line is the signal for the next step
  (TMDB direct + MangaDex direct + the games snapshot).
