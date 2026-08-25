/**
 * Horizontally scrollable strip of stills (TMDB backdrops, IGDB/RAWG
 * screenshots, manga volume covers), with a full-screen carousel on tap.
 *
 * Two deliberate choices:
 * - the thumbnails keep each image's NATIVE aspect ratio (a 16:9 screenshot and
 *   a 2:3 volume cover sit side by side, each undistorted): the strip fixes the
 *   HEIGHT and lets the width follow, so nothing is cropped;
 * - if every image fails to load — e.g. a blocked CDN — the whole section
 *   disappears instead of leaving empty frames.
 */
import { ChevronLeft, ChevronRight, X } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'

export default function Gallery({ urls, title }: { urls: string[]; title: string }) {
  // images that failed to load are dropped entirely (no empty frames left)
  const [broken, setBroken] = useState<string[]>([])
  /** index of the image shown full screen, null when the carousel is closed */
  const [open, setOpen] = useState<number | null>(null)

  const shown = urls.filter((u) => !broken.includes(u))
  const count = shown.length

  const step = useCallback(
    (delta: number) => setOpen((i) => (i == null ? i : (i + delta + count) % count)),
    [count],
  )

  // keyboard support for the desktop web app
  useEffect(() => {
    if (open == null) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(null)
      if (e.key === 'ArrowRight') step(1)
      if (e.key === 'ArrowLeft') step(-1)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, step])

  if (count === 0) return null

  return (
    <section className="mt-6">
      <h2 className="mb-2 px-4 text-lg font-bold">{title}</h2>
      {/* fixed height, automatic width → every image keeps its own proportions */}
      <div className="no-scrollbar flex h-44 gap-3 overflow-x-auto px-4 pb-1 md:h-64">
        {shown.map((url, i) => (
          <button
            key={url}
            onClick={() => setOpen(i)}
            // min-width so the slot exists BEFORE the image loads: a zero-width
            // box would never enter the viewport, and lazy loading would then
            // never trigger. Once loaded, the width follows the real ratio.
            className="h-full w-auto min-w-[120px] shrink-0 overflow-hidden rounded-xl border border-line bg-card2 transition-transform active:scale-[0.98]"
          >
            <img
              src={url}
              alt=""
              loading="lazy"
              decoding="async"
              onError={() => setBroken((b) => (b.includes(url) ? b : [...b, url]))}
              className="h-full w-auto max-w-none object-contain"
            />
          </button>
        ))}
      </div>

      {open != null && (
        <div
          onClick={() => setOpen(null)}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/95 p-4"
        >
          <img
            src={shown[open]}
            alt=""
            // stopPropagation: tapping the picture itself shouldn't close it
            onClick={(e) => e.stopPropagation()}
            className="max-h-full max-w-full rounded-lg object-contain"
          />

          {count > 1 && (
            <>
              <button
                aria-label="previous image"
                onClick={(e) => {
                  e.stopPropagation()
                  step(-1)
                }}
                className="absolute left-3 grid h-12 w-12 place-items-center rounded-full bg-white/15 text-white backdrop-blur transition-colors hover:bg-white/25"
              >
                <ChevronLeft size={24} />
              </button>
              <button
                aria-label="next image"
                onClick={(e) => {
                  e.stopPropagation()
                  step(1)
                }}
                className="absolute right-3 grid h-12 w-12 place-items-center rounded-full bg-white/15 text-white backdrop-blur transition-colors hover:bg-white/25"
              >
                <ChevronRight size={24} />
              </button>
              <div className="absolute bottom-6 rounded-full bg-black/60 px-3 py-1 text-xs font-semibold text-white">
                {open + 1} / {count}
              </div>
            </>
          )}

          <button
            aria-label="close"
            onClick={() => setOpen(null)}
            className="absolute right-3 grid h-10 w-10 place-items-center rounded-full bg-white/15 text-white backdrop-blur top-safe"
          >
            <X size={18} />
          </button>
        </div>
      )}
    </section>
  )
}
