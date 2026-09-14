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

**How many users fit in 100k requests/day?** Images are NOT proxied (only
MangaDex covers), and the app caches details locally for 6 h and episode lists
for 7 days, so the gateway only sees first-opens and background refreshes.
A realistic active user costs roughly 50–150 gateway requests/day → **around
700–2,000 daily active users on the free tier**. The edge cache in the Worker
(1 h for searches, 24 h for details) makes this better than linear: the 200th
person to open *Dune* costs zero upstream requests.

So: free up to ~1,000 daily actives, then $5/month up to a size this app will
almost certainly never reach.

## 3. The real ceiling is the provider quotas, not Cloudflare

Every user shares ONE key per provider. This is where a public release hurts,
in the order things break:

| Provider | Free limit | Used for | Risk |
|---|---|---|---|
| **OMDb** ⚠ | ~1,000 requests/**day** per key | IMDb/RT/Metacritic banners | **Breaks first.** Every detail page hits it |
| **Comic Vine** ⚠ | ~200 requests/**hour** | western comics only | Narrow feature, tight limit |
| **RAWG** | 20,000 requests/**month**, free for commercial use under 100k MAU | game fallback + Steam box art | Secondary since IGDB became primary |
| **IGDB** | 4 requests/**second**, free for **non-commercial** use | games (primary) | Fine with caching; commercial needs a Twitch agreement |
| **TMDB** | no hard published cap, free for **non-commercial** use | tv, anime, movies | Attribution is mandatory (§5) |
| **MangaDex** | ~5 requests/second, keyless | manga chapters | Fine |
| **HowLongToBeat** | no public API at all | game lengths | Unofficial. Can break or be blocked any day |
| **Google Drive** | per-user quota | backup | Costs us nothing, it is the user's own storage |

### What to do about it

1. **Cache harder at the edge.** Today: 1 h searches, 24 h details. A finished
   film's metadata does not change — 7 days for details and 30 days for
   ratings would cut upstream calls by an order of magnitude. This is the
   single highest-value change and it is ~3 lines in `worker/src/index.js`.
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

These are hard requirements, not nice-to-haves.

- [ ] **TMDB attribution.** The notice *"This product uses the TMDB API but is
      not endorsed or certified by TMDB"* plus their logo must appear in an
      About/Credits section. **The app has no About screen yet — one is
      needed.** Add RAWG/IGDB/MangaDex/HLTB credits in the same place.
- [ ] **Privacy policy URL**, hosted (GitHub Pages is fine). Required by the
      Play Data safety form and by the Google OAuth consent screen. It must say
      what the app stores locally, that the backup goes to the user's own
      Drive, and that no data reaches the developer.
- [ ] **Release keystore** + Play App Signing. The app is debug-signed today.
- [ ] **Add the RELEASE SHA-1 to the Google OAuth Android client**, alongside
      the debug one. Miss this and Google sign-in fails in production with
      `DEVELOPER_ERROR` — the exact failure already hit once after a machine
      change.
- [ ] **Publish the OAuth consent screen to Production.** While it is in
      *Testing*, refresh tokens expire after 7 days, which would quietly kill
      the background Drive backup built on them.
- [ ] **Play: 12 testers for 14 consecutive days** before production access
      (personal accounts created after 13 Nov 2023 — organisation accounts are
      exempt). Plan two weeks for this, it is the long pole.
- [ ] **Target API level** ⚠ — check Play's current requirement before
      submitting (API 36 is the 2026 deadline; the project targets 35).
- [ ] **Rate-limit the gateway.** `APP_TOKEN` ships inside the APK, so anyone
      who unzips it can use the Worker as a free proxy. A per-IP counter in the
      Worker (or a Cloudflare rate-limiting rule) keeps one abuser from eating
      the daily quota for everyone.

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
