# OneTracker API gateway (Cloudflare Worker)

One endpoint in front of every metadata provider. It exists for three reasons:

1. **Nothing can be blocked by an ISP.** Some networks DNS-block MangaDex; the
   app can't change DNS from a WebView, but it can always reach this Worker,
   which fetches upstream from Cloudflare's network.
2. **API keys leave the APK.** They live in Worker secrets, injected server side.
3. **IGDB becomes usable** (the database Stash uses): it needs a server-to-server
   OAuth token and sends no CORS headers, so it only works behind a proxy.

Everything below is on Cloudflare's **free** plan: 100,000 requests/day, no
credit card, no KV/D1/paid add-ons. IGDB is free for non-commercial use.

## 1. Deploy (once, ~5 minutes)

```bash
cd worker
npx wrangler@4.86.0 login
npx wrangler@4.86.0 deploy -c wrangler.toml
```

Two details that WILL bite otherwise:

- **Pin the version** (`wrangler@4.86.0`). Plain `npx wrangler` pulls the latest,
  which requires Node 22; this project runs on Node 20 (Capacitor 7 constraint).
- **Always pass `-c wrangler.toml`.** The repo root also contains a
  `wrangler.jsonc` (the web-app deployment, Worker name `onetracker`), and
  wrangler will happily use THAT one instead — which silently sends your
  secrets to the wrong Worker. Every `secret put` below needs the same flag.

`wrangler login` opens the browser to authorise your Cloudflare account (create
a free one first at dash.cloudflare.com if you don't have it). `deploy` prints
the public URL, e.g. `https://onetracker-api.<your-subdomain>.workers.dev`.

## 2. Load the keys as secrets

Run each line and paste the value when prompted (nothing is written to disk):

```bash
npx wrangler@4.86.0 secret put -c wrangler.toml TMDB_KEY
npx wrangler@4.86.0 secret put -c wrangler.toml OMDB_KEY
npx wrangler@4.86.0 secret put -c wrangler.toml RAWG_KEY
npx wrangler@4.86.0 secret put -c wrangler.toml COMICVINE_KEY
npx wrangler@4.86.0 secret put -c wrangler.toml APP_TOKEN
```

`APP_TOKEN` is any random string you invent: it keeps strangers from using your
Worker as an open proxy. It ships inside the app, so treat it as friction rather
than real security — the important part is that provider keys stay server side.

**Any provider secret can hold several keys, comma-separated** (`k1,k2,k3`).
That is a key pool: the gateway spreads requests across them and rests a key
the moment its provider says it is spent, so quotas add up (three OMDb keys =
3,000 lookups a day). Adding a key later is just `secret put` again with the
longer list — no deploy, no app update. See §7.

## 3. IGDB (better game data than RAWG)

1. Sign in at <https://dev.twitch.tv/console/apps> (free Twitch account).
2. **Register Your Application**: any name, OAuth Redirect URL
   `http://localhost`, Category "Application Integration". Create.
3. Open it, copy the **Client ID**, then **New Secret** and copy that too.
4. Store both:

```bash
npx wrangler@4.86.0 secret put -c wrangler.toml IGDB_CLIENT_ID
npx wrangler@4.86.0 secret put -c wrangler.toml IGDB_CLIENT_SECRET
```

The Worker exchanges them for an access token itself and refreshes it when it
expires — nothing else to maintain.

## 4. Point the app at it

Put the URL and token in the app's `.env` (rebuild afterwards):

```
VITE_GATEWAY_URL=https://onetracker-api.<your-subdomain>.workers.dev
VITE_GATEWAY_TOKEN=<the APP_TOKEN you chose>
```

They can also be typed in **Settings → API keys** at runtime. Leave them empty
and the app keeps calling providers directly, exactly as before.

## Check it works

```bash
curl https://onetracker-api.<your-subdomain>.workers.dev/health?t=<APP_TOKEN>
```

Expected: `{"ok":true,"configured":{...},"pools":{...},"advice":[]}` with
`true` for every key you set. `pools` says how many keys each provider has and
which are resting right now (in the datacenter that answered); `advice` is
empty while everything is fine and otherwise tells you which key to add.

## Routes

| Route | Purpose |
|---|---|
| `/health` | which secrets are configured, key pools, which keys are resting, advice |
| `/p/{provider}/{path…}` | proxied JSON call, key injected (`tmdb`, `rawg`, `omdb`, `comicvine`, `mangadex`, `jikan`, `anilist`, `openlibrary`) |
| `/img/{provider}/{path…}` | proxied images for blocked CDNs (`mangadex`, `tmdb`, `igdb`) |
| `/igdb/{endpoint}` | IGDB v4 with a managed Twitch token (POST, APIcalypse body) |
| `/hltb/search` | HowLongToBeat game lengths (POST `{"query":"elden ring"}`) |
| `/google/token` | Google OAuth: code → refresh token, refresh → access token, revoke |

## 5. Game lengths (HowLongToBeat)

Nothing to configure — but the route only exists in a Worker deployed from this
version of the repo, so **redeploy** if yours is older:

```bash
cd worker && npx wrangler@4.86.0 deploy -c wrangler.toml
```

`/hltb/search` is what makes games count in the time stats. HowLongToBeat has
no public API: the Worker fetches a guard token from
`/api/search/site/init`, echoes it back on the search POST (`x-auth-token` +
`x-hp-key`/`x-hp-val`, the pair also inside the JSON body) and forwards the four
length figures. The token is bound to the caller's IP AND User-Agent, so both
hops send the same UA and no token is ever reused — a 403 just re-inits once.

Being an unofficial API, it will break the day HLTB changes shape. That is
expected and harmless: the app treats a failure as "no data" and falls back to
IGDB's own time-to-beat, so game pages and stats keep working.

```bash
curl -X POST -H "X-OT-Token: <APP_TOKEN>" -H 'Content-Type: application/json' -d '{"query":"elden ring"}' https://onetracker-api.<your-subdomain>.workers.dev/hltb/search
```

## 6. Background Drive backup (Google refresh tokens)

Without this the app can only hold Google's hour-long access token: after that
the automatic backup stops until the user taps "Backup su Drive" by hand. With
it, sign-in runs in the plugin's `offline` mode and the Worker turns the
returned authorization code into a REFRESH token, so the app mints access
tokens silently forever.

Two secrets, both from the **Web** OAuth client (`APIs & Services →
Credentials`) — the same client id the app uses as `VITE_GOOGLE_CLIENT_ID_WEB`:

```bash
npx wrangler@4.86.0 secret put -c wrangler.toml GOOGLE_CLIENT_ID
```

```bash
npx wrangler@4.86.0 secret put -c wrangler.toml GOOGLE_CLIENT_SECRET
```

`/health` then reports `"google": true`, which is exactly how the app decides
between offline and online mode — set them and redeploy, and no app change is
needed. The client secret is why this must live here: shipped in an APK it
would be readable by anyone who unzips it.

Notes:
- The refresh token itself is stored by the app in `localStorage`. It is a
  long-lived credential on the device; disconnecting the account revokes it
  through this same route. It is deliberately NOT part of the Drive backup.
- Android also needs the app's signing SHA-1 on the **Android** OAuth client
  (package `com.onetracker.app`), or the native sign-in fails with
  `DEVELOPER_ERROR` before any of this is reached. A new machine means a new
  debug keystore, hence a new fingerprint to add:
  `keytool -list -v -keystore ~/.android/debug.keystore -alias androiddebugkey -storepass android`

## 7. Keeping it up without you

Two mechanisms in `src/edge.js` make the gateway degrade instead of fail, with
nobody watching:

**Key pools.** Every keyed provider (`TMDB_KEY`, `RAWG_KEY`, `OMDB_KEY`,
`COMICVINE_KEY`, and the `IGDB_CLIENT_ID`/`IGDB_CLIENT_SECRET` pair) accepts a
comma-separated list. A request picks a key at random; when the provider
answers "spent" the key is **rested** and the request retried with the next
one. What counts as spent, and for how long:

| Provider says | Meaning | Key rests |
|---|---|---|
| OMDb `200` + `"Request limit reached!"` | daily quota gone | 1 h |
| OMDb `200` + `"Invalid API key!"`, Comic Vine `status_code: 100` | dead key | 24 h |
| Comic Vine `420` / `429` | 200/hour exceeded | 1 h |
| `401` / `403` (keyed providers) | dead key, or RAWG's monthly quota | 1 h |
| `429` (TMDB, RAWG) | burst limit | 60 s |
| IGDB `429` | 4 req/s per Twitch client | 2 s |

Rest markers live in the edge cache, so they are per datacenter and expire on
their own — a key that recovered is retried automatically, nothing to reset.
When **every** key of a provider is resting the gateway answers `503` with
`X-OT-Reason: quota` without calling upstream at all… unless it has a stale
copy, which brings us to:

**Stale answers beat no answers.** Successful responses are kept 30 days past
their freshness, and `X-OT-Cache` on every response says what happened:

| Kind | Fresh for | Past that |
|---|---|---|
| searches | 1 h | `STALE`: served at once, refreshed in the background (one refresh per 30 s per key) |
| HowLongToBeat, OMDb | 7 days | same — these are the upstreams to spare most |
| details, episode/chapter lists | 24 h | `MISS`: goes upstream and waits (a new episode must show up the day it airs); `STALE-ERROR` if the upstream fails or every key is resting |

So an outage, a blocked HowLongToBeat or an exhausted quota turns into
"slightly old data" for anything anyone has asked for before, and into a clean
`503` only for brand-new requests. Images (`/img`) are cached at the edge for a
week too (`cf.cacheTtl`).

**What to do when `advice` is not empty** (also shown in the app under
Settings → provider check → Gateway):

```bash
npx wrangler@4.86.0 secret put -c wrangler.toml OMDB_KEY   # paste: oldkey,newkey
```

That is the whole operation. The logic is unit-tested without a Worker runtime:

```bash
npm run test:worker
```

## Updating later

```bash
cd worker && npx wrangler@4.86.0 deploy -c wrangler.toml
```

Secrets survive deploys; you only re-run `secret put` to change a value.
