import i18n from '@/lib/i18n'

export function formatBytes(bytes?: number): string {
  if (bytes === undefined || bytes === null) return ''
  if (bytes < 1024) return `${bytes} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let v = bytes / 1024
  let i = 0
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024
    i++
  }
  return `${v >= 100 ? Math.round(v) : v.toFixed(1)} ${units[i]}`
}

export function formatDate(iso?: string): string {
  if (!iso) return ''
  const d = new Date(iso)
  return d.toLocaleDateString(i18n.language, { year: 'numeric', month: 'short', day: 'numeric' })
}

export function relativeTime(iso?: string): string {
  if (!iso) return ''
  const diff = Date.now() - new Date(iso).getTime()
  const rtf = new Intl.RelativeTimeFormat(i18n.language, { numeric: 'auto' })
  const min = Math.floor(diff / 60000)
  if (min < 1) return i18n.t('time.justNow')
  if (min < 60) return rtf.format(-min, 'minute')
  const h = Math.floor(min / 60)
  if (h < 24) return rtf.format(-h, 'hour')
  const d = Math.floor(h / 24)
  if (d < 30) return rtf.format(-d, 'day')
  const mo = Math.floor(d / 30)
  if (mo < 12) return rtf.format(-mo, 'month')
  return rtf.format(-Math.floor(mo / 12), 'year')
}

// book urls are `file:/…` URLs; display the decoded plain path, falling back to the raw value
export function filePathFromUrl(url: string): string {
  const path = url.replace(/^file:(\/\/)?/, '')
  try {
    return decodeURIComponent(path)
  } catch {
    return path
  }
}

export function fileNameFromUrl(url: string): string {
  const path = filePathFromUrl(url)
  return path.split('/').pop() || path
}

export function readingDirectionLabel(dir?: string): string {
  switch (dir) {
    case 'LEFT_TO_RIGHT':
      return i18n.t('readingDirection.leftToRight')
    case 'RIGHT_TO_LEFT':
      return i18n.t('readingDirection.rightToLeft')
    case 'VERTICAL':
      return i18n.t('readingDirection.vertical')
    case 'WEBTOON':
      return i18n.t('readingDirection.webtoon')
    default:
      return ''
  }
}

export function seriesStatusLabel(status?: string): string {
  switch (status) {
    case 'ONGOING':
      return i18n.t('seriesStatus.ongoing')
    case 'ENDED':
      return i18n.t('seriesStatus.ended')
    case 'ABANDONED':
      return i18n.t('seriesStatus.abandoned')
    case 'HIATUS':
      return i18n.t('seriesStatus.hiatus')
    default:
      return ''
  }
}

// metadata languages are BCP-47 tags; fall back to the raw tag when Intl can't parse it
export function languageDisplayName(tag?: string): string {
  if (!tag) return ''
  try {
    return new Intl.DisplayNames([i18n.language], { type: 'language' }).of(tag) ?? tag
  } catch {
    return tag
  }
}
