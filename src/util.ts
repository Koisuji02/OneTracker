/** Format minutes as "2 months 13 days 5 hours" using translated unit labels. */
export function formatWatchTime(totalMin: number, t: (k: string) => string): string {
  const min = Math.max(0, Math.round(totalMin))
  if (min < 60) return `${min} ${t('time.minutes')}`
  const months = Math.floor(min / (30 * 24 * 60))
  const days = Math.floor((min % (30 * 24 * 60)) / (24 * 60))
  const hours = Math.floor((min % (24 * 60)) / 60)
  const parts: string[] = []
  if (months > 0) parts.push(`${months} ${t('time.months')}`)
  if (days > 0) parts.push(`${days} ${t('time.days')}`)
  if (hours > 0) parts.push(`${hours} ${t('time.hours')}`)
  if (parts.length === 0) parts.push(`${Math.floor(min / 60)} ${t('time.hours')}`)
  return parts.join(' ')
}

export function seasonEpisodeLabel(season: number, episode: number): string {
  const s = String(season).padStart(2, '0')
  const e = String(episode).padStart(2, '0')
  return `S${s} | E${e}`
}

export function cn(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(' ')
}

export function formatDate(iso: string, language: 'en' | 'it' | null): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleDateString(language === 'it' ? 'it-IT' : 'en-US', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
}
