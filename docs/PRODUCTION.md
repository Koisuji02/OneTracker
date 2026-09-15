# Shipping OneTracker — cost, limits and what actually breaks first

Goal: OneTracker on the Play Store (iOS optional), **no revenue**, and no bill
that grows with users. This documents what that costs, where the ceiling is,
and what has to be done before a public release.

Figures checked on 2026-09-14; providers change terms, so re-check the ones
marked ⚠ before submitting.

## 1. The good news: there is no backend to pay for

The library lives in IndexedDB on the device and the backup goes to the user's
OWN Google Drive (`appDataFolder`). OneTracker stores **nothing** server-side:
no accounts, no database, no per-user storage that grows. The only running
piece is the stateless gateway Worker, and it exists to hide API keys and to
reach hosts that block browsers (see `worker/README.md`).

That is what makes "free forever" realistic. Anything that would add a database
of users (social features, shared lists, a web account) changes this analysis
completely.

## 2. Hosting cost

| | Free tier | When it runs out | Then |
|---|---|---|---|
| Cloudflare Worker (gateway) | 100,000 requests/day, 10 ms CPU per request | see the estimate below | Workers Paid **$5/month** → 10M requests/month, then $0.30/million |
| Privacy policy + site | GitHub Pages, free | never | — |
| Play Store | **$25 once** | never | — |
| Apple | — | — | **$99/year** + a Mac to build on |

The Worker is pure I/O (fetch → fetch), so the 10 ms CPU limit is not a
concern; only the request count is.

### Two different ceilings, and they scale differently

This is the part worth understanding properly, because the two limits behave in
opposite ways:

- **Cloudflare's 100k requests/day counts EVERY request that reaches the
  Worker**, cache hit or not. Caching does not buy a single request here. This
  ceiling scales with *how many people use the app*.
- **Provider quotas are only spent on cache MISSES.** This ceiling scales with
  *how many distinct titles the whole user base opens*, which grows far more
  slowly: the 200th person to open *Dune* costs nothing upstream.

**Per user**: images never touch the gateway (except MangaDex covers), the app
keeps details for 6 h and episode lists for 7 days locally, and marking
episodes is entirely local. What is left is the catch-up pass at launch (up to
20 stale items, 3 at a time) plus ~2 requests per title opened. A realistic
active day is **20–60 gateway requests per user**.

100,000 ÷ ~40 → **roughly 2,000–2,500 daily active users on the free plan**,
and $5/month raises that ceiling about 8× (10M/month ≈ 333k/day). There is no
middle step where it gets expensive.

**Measured, not assumed** (15 Sep 2026, against the live gateway): a repeat
request to every provider path returns `X-OT-Cache: HIT` — TMDB details and
season lists, RAWG, MangaDex, Comic Vine, IGDB (POST bodies are hashed into the
key) and HLTB.

OMDb did NOT, and that was a real bug: it answers with `Vary: *`, which makes a
response permanently uncacheable, so every ratings lookup went upstream — on the
provider with the tightest quota of the lot. The Worker now strips `Vary`
(along with `Expires`/`Age`) before storing, since it builds the cache key
itself. That one line is worth more capacity than everything else on this page.

## 3. The real ceiling is the provider quotas, not Cloudflare

Every user shares ONE key per provider. This is where a public release hurts,
in the order things break:

| Provider | Free limit | Used for | Risk |
|---|---|---|---|
| **OMDb** ⚠ | ~1,000 requests/**day** per key | IMDb/RT/Metacritic banners | Tightest of all. Now cached 7 days, so it is 1,000 *distinct titles* a day, not 1,000 page opens |
| **Comic Vine** ⚠ | ~200 requests/**hour** | western comics only | Narrow feature, tight limit |
| **RAWG** | 20,000 requests/**month**, free for commercial use under 100k MAU | game fallback + Steam box art | Secondary since IGDB became primary |
| **IGDB** | 4 requests/**second**, free for **non-commercial** use | games (primary) | Fine with caching; commercial needs a Twitch agreement |
| **TMDB** | no hard published cap, free for **non-commercial** use | tv, anime, movies | Attribution is mandatory (§5) |
| **MangaDex** | ~5 requests/second, keyless | manga chapters | Fine |
| **HowLongToBeat** | no public API at all | game lengths | Unofficial. Can break or be blocked any day |
| **Google Drive** | per-user quota | backup | Costs us nothing, it is the user's own storage |

### What to do about it

1. **Cache at the edge** — done for the two that matter: HLTB and OMDb answers
   are kept 7 days (`TTL_STATIC`), searches 1 h, everything else 24 h. Episode
   and chapter lists deliberately stay at 24 h: a new episode has to show up
   the day it airs, which is the whole point of the Continue list.
2. **Let the tight providers degrade.** Ratings (OMDb) and comics (Comic Vine)
   already fail silently. Keep it that way — a missing IMDb banner is not an
   outage.
3. **Bring-your-own-key already exists.** Settings accepts a user's own TMDB /
   RAWG / OMDb / Comic Vine keys, and `ENV_DEFAULTS` hides the shipped ones.
   If a provider's shared key ever gets exhausted, power users have an escape
   hatch without an app update.
4. **Ask, don't guess.** TMDB and IGDB both grant free non-commercial use to
   apps like this; if usage grows, write to them rather than silently
   exceeding a limit. A free tracker with attribution is exactly their case.

## 4. Do NOT monetise

Not just because the author doesn't want to: **IGDB's free tier is
non-commercial only**, and TMDB's non-commercial licence is what the app runs
on. Ads or a paid tier would require commercial agreements with both.

If the project ever needs money, the sustainable form is a **donation link on
the GitHub page or the website — not inside the app** (Play's payments policy
restricts in-app donation links for non-charities).

## 5. Blockers before a public release

### Done

- [x] **TMDB attribution.** `src/pages/AboutPage.tsx` (Settings → About) carries
      the mandatory notice verbatim and credits every provider. The wording is
      fixed by TMDB's terms — there is a comment in the file saying so.
- [x] **Web app, home page and privacy policy, all on one domain.** The web
      build is deployed (`npm run deploy`, root `wrangler.jsonc`) at
      **https://onetracker.onetracker.workers.dev** — it had never been
      deployed before, and it doubles as the browser version users can pick
      instead of the APK.
      - `/` the app · `/home` the page for Google · `/privacy` the policy
      - Google rejected the ROOT as a home page ("protetta da una pagina di
        accesso"): the app opens on its first-run wizard, which reads as a
        login gate. `/home` (public/home.html) explains the app with nothing to
        dismiss, so give Google **that** URL.
      - Workers Assets 307s `/privacy.html` → `/privacy`; always hand out the
        extensionless one, which answers 200.
      - The app's About screen links to the same policy, so app, browser
        version and store never disagree. `docs/PRIVACY.md` keeps the text
        readable in the repo.
- [x] **Domain verification file online** (Google: "non è registrato a tuo
      nome"). Search Console's HTML-file method:
      `public/google5e4c3f5a0fcf9a7f.html` ships at the root and answers
      **200** at
      `https://onetracker.onetracker.workers.dev/google5e4c3f5a0fcf9a7f.html`.
      It needed a trick: Workers Assets serves every `.html` file at its
      extensionless path and **307s the `.html` URL there** — the same rule
      that makes `/privacy` work made the verification URL a redirect, which
      Search Console rejects. `site/worker.js` sits in front of the assets for
      that ONE path (`assets.run_worker_first`) and returns a flat 200; every
      other request never reaches it. Pressing *Verifica* in Search Console and
      adding `onetracker.workers.dev` to the consent screen's authorised
      domains are yours to do.
- [x] **Target API 36.** Play has required it for every publish since
      **31 Aug 2026** — the project was on 35, which would have been rejected
      outright. Now compileSdk/targetSdk 36 with AGP 8.9.1; the
      `androidx.browser:1.8.0` pin that existed only to stay on 35 is gone.
- [x] **Release signing.** `android/app/build.gradle` reads
      `android/keystore.properties` (gitignored, see the `.example`) and signs
      `bundleRelease`. Without that file the release build comes out unsigned
      rather than failing, so a fresh clone still works.
- [x] **Gateway rate limiting.** Two Cloudflare rate-limit bindings, per client
      IP: `RL_API` 120/60s on everything, `RL_HEAVY` 40/60s for HowLongToBeat
      alone — a separate bucket so a game backfill can't eat the allowance a
      Drive token refresh needs. `/health` stays exempt so the app can always
      diagnose itself, and a missing binding fails OPEN (a shield must not be a
      single point of failure). Note the limiter is approximate and per-colo: it
      lets a few through past the threshold before biting.
- [x] **Longer cache for the tightest upstreams.** HLTB and OMDb answers are
      kept 7 days at the edge instead of 24 h — those two are exactly the
      fragile one and the 1,000-a-day one.

### Left, and only you can do them

- [ ] **Add the release SHA-1 to the Google OAuth *Android* client**
      (`com.onetracker.app`), keeping the debug one for local builds:
      `C0:8B:C0:C5:92:80:C9:38:A6:FD:C5:37:1C:C9:79:69:B6:0C:A6:89`.
      Miss this and Google sign-in fails in the release build with
      `DEVELOPER_ERROR`.
      Once Play App Signing is on, Google re-signs the app with ITS key, so the
      **Play app-signing SHA-1 from the console must be added too** — otherwise
      sign-in works in your test APK and breaks for everyone who installs from
      the store. This is the single easiest way to ship a broken login.
- [ ] **Authorised JavaScript origin** for the browser version: the WEB OAuth
      client needs `https://onetracker.onetracker.workers.dev`, or Google
      sign-in fails in the browser (the Android flow is unaffected).
- [ ] **Publish the OAuth consent screen to Production.** In *Testing*, refresh
      tokens expire after 7 days and the background backup dies silently.
- [ ] **Play: 12 testers for 14 consecutive days** (personal accounts created
      after 13 Nov 2023). The long pole — start it the day the account exists.
- [ ] **Store listing**: icon, feature graphic, screenshots, description, and
      the Data safety form (answer it from `docs/PRIVACY.md`: no data
      collected, no data shared).
- [ ] **Back up the upload key.** `android/keystore/onetracker-upload.jks` plus
      its password, somewhere that is not this machine. With Play App Signing a
      lost upload key can be reset by Google, but only while you can still get
      into the Play Console.

### Good news on Google verification

The app requests `drive.appdata`, `userinfo.email` and `userinfo.profile`.
`drive.appdata` is a **non-sensitive** scope (it only reaches data the app
itself wrote), so there is **no unverified-app warning, no 100-user cap and no
security assessment** — the heavy OAuth verification that restricted Drive
scopes require does not apply here. Keep it that way: switching to a broader
Drive scope would drag in an annual third-party audit.

## 6. iOS

The only genuinely recurring cost: **$99/year** for the Apple Developer
Program, plus a Mac (or a rented cloud Mac) to build and sign. Capacitor
already supports it, so the work is mostly signing and review, not code.

If the point is reviews and reach, Android alone gets you there at $25 once.
Adding iOS later is a money decision, not a technical one.

## 7. Summary

| Scenario | Recurring cost |
|---|---|
| Android only, up to ~1,000 daily actives | **€0** (after $25 once) |
| Android, beyond that | **$5/month** |
| iOS as well | **+$99/year** |

Nothing here scales with the number of users' *data*, only with their
*requests* — and those are cacheable. The project is self-sustaining by
construction; the parts that could cost money (a user database, commercial API
licences, ads infrastructure) are exactly the ones it doesn't have.

## Sources

- [Cloudflare Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/)
- [Play Console: testing requirements for new personal accounts](https://support.google.com/googleplay/android-developer/answer/14151465)
- [TMDB API terms of use](https://www.themoviedb.org/api-terms-of-use)
- [Google Drive API scopes and their classification](https://developers.google.com/drive/api/guides/api-specific-auth)
- [Google OAuth: app audience, user caps and verification](https://support.google.com/cloud/answer/15549945)
- [IGDB API docs (rate limit, non-commercial use)](https://api-docs.igdb.com/)
- [RAWG API terms](https://rawg.io/tos_api)
