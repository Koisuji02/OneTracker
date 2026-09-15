/**
 * The web app is a pile of static assets; this Worker exists for ONE path.
 *
 * Google Search Console proves ownership by fetching
 * /google<token>.html and expecting a flat 200 with the token inside.
 * Workers Assets serves every .html file at its extensionless path and 307s
 * the .html URL there — that is what makes /privacy and /home work, and it is
 * also what made the verification URL answer with a redirect instead of the
 * file. Google does not accept that.
 *
 * `assets.run_worker_first` in wrangler.jsonc routes that single path here;
 * everything else never reaches this code and is still served straight from
 * the asset store (so it stays free and fast). The file itself remains the
 * source of truth in public/ — this only strips the extension and hands back
 * what the asset store returns, so re-verifying later means dropping in a new
 * file and changing the path in two places.
 */
const VERIFICATION = '/google5e4c3f5a0fcf9a7f.html'

export default {
  async fetch(request, env) {
    const url = new URL(request.url)
    if (url.pathname !== VERIFICATION) return env.ASSETS.fetch(request)

    url.pathname = VERIFICATION.slice(0, -'.html'.length)
    const asset = await env.ASSETS.fetch(new Request(url, request))
    return new Response(asset.body, {
      status: asset.status,
      headers: {
        'content-type': 'text/html; charset=utf-8',
        'cache-control': 'public, max-age=3600',
      },
    })
  },
}
