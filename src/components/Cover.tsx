/**
 * Every piece of artwork in the app goes through here.
 *
 * Drop-in replacement for `<img>` that first asks the offline cache
 * (see imageCache.ts) for the bytes: a cover the user has already seen renders
 * from IndexedDB, with no request and therefore no dependence on the network.
 * `persist` marks the images worth keeping — the ones belonging to the
 * library — and only those are ever stored.
 *
 * The src is resolved BEFORE the first paint of the <img>, so a cached cover
 * never flashes the network version first.
 */
import { useEffect, useState } from 'react'
import { cachedObjectUrl, resolveImage } from '../imageCache'
import { hideBrokenImg, showLoadedImg } from '../util'

interface CoverProps {
  src?: string | null
  alt?: string
  className?: string
  /** keep these bytes for offline use (library artwork only) */
  persist?: boolean
  loading?: 'lazy' | 'eager'
  decoding?: 'async' | 'auto' | 'sync'
  fetchPriority?: 'high' | 'low' | 'auto'
}

export default function Cover({
  src,
  alt = '',
  className,
  persist = false,
  loading = 'lazy',
  decoding,
  fetchPriority,
}: CoverProps) {
  // a cover resolved earlier this session is known synchronously: no flicker,
  // no empty frame when scrolling back through a long grid
  const [resolved, setResolved] = useState<string | null>(() =>
    src ? (cachedObjectUrl(src) ?? null) : null,
  )

  useEffect(() => {
    if (!src) {
      setResolved(null)
      return
    }
    const memo = cachedObjectUrl(src)
    if (memo) {
      setResolved(memo)
      return
    }
    let alive = true
    setResolved(null)
    resolveImage(src, persist).then((url) => {
      if (alive) setResolved(url)
    })
    return () => {
      alive = false
    }
  }, [src, persist])

  if (!src || !resolved) return null

  return (
    <img
      src={resolved}
      alt={alt}
      loading={loading}
      decoding={decoding}
      fetchPriority={fetchPriority}
      onError={hideBrokenImg}
      onLoad={showLoadedImg}
      className={className}
    />
  )
}
