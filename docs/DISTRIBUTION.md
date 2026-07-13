# Distributing OneTracker (APK) and handling API keys

## Building the APK

Requirements (already on this machine): JDK 17+ (`JAVA_HOME`) and the Android SDK
(`ANDROID_HOME`, platform 35 + build-tools 35).

```bash
npm run android:apk
# → android/app/build/outputs/apk/debug/app-debug.apk
```

Copy `app-debug.apk` to the phone (USB, Drive, Telegram "saved messages"…) and open
it — Android asks to allow installs from unknown sources the first time. The debug
APK is fine for personal use; a Play-Store release would need a signing key and
`assembleRelease`, not needed for private distribution.

## How API keys work

There are two layers, both already wired:

1. **Baked at build time** — keys in `.env` (`VITE_TMDB_KEY`, `VITE_RAWG_KEY`,
   `VITE_OMDB_KEY`, `VITE_COMICVINE_KEY`) are embedded in
   the JS bundle when you run the build. An APK built this way **works out of the box**.
2. **Per-user in Settings** — anyone can enter/override keys in Settings → API keys
   (stored in localStorage on their device). Baked keys act as defaults; a non-empty
   value in Settings wins.

AniList, MangaDex, Open Library and Jikan need **no key at all**, so an APK without
any keys still tracks anime, manga and books fully.

## "Encrypting" keys — honest answer

True encryption of API keys inside a client app is **impossible**: the app must be
able to use the key, so a determined person can always extract it from the bundle
(true for every mobile app in existence — obfuscation only raises the bar).
For free-tier keys this is an accepted risk **as long as distribution is private**
(family/friends). Don't publish an APK with baked keys on a public store or repo —
note that `.env` is gitignored precisely for this.

## Your keys vs. per-user keys

| Approach | Effort | Trade-off |
|---|---|---|
| **Bake your keys** in the APK you hand out | zero for your users | shared rate limits: OMDb 1,000 req/day total, RAWG 20k/month, Comic Vine ~200/h. Fine for a handful of trusted people |
| **Each user enters their own** in Settings | 5 min per user, no script needed | independent limits, key revocable per person |
| Per-user custom builds (one `.env` each) | pointless at this scale | only worth it for dozens of users |

**Recommendation** for cousin/friends: hand out the APK with your keys baked in.
If OMDb rate limits ever bite (it has the lowest ceiling and one request per
detail-page view), that user creates their own free key and pastes it in Settings —
no rebuild needed.
