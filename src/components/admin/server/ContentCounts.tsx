import { useQueries } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { actuatorApi } from '@/lib/api/settings'
import { formatBytes } from '@/lib/utils/format'
import { Section } from '@/components/account/Section'
import { metricStat } from '../metric'

interface ContentMetric {
  name: string
  labelKey: string
  format?: (value: number) => string
}

const METRICS: ContentMetric[] = [
  { name: 'komga.libraries', labelKey: 'content.libraries' },
  { name: 'komga.series', labelKey: 'content.series' },
  { name: 'komga.books', labelKey: 'content.books' },
  { name: 'komga.collections', labelKey: 'content.collections' },
  { name: 'komga.readlists', labelKey: 'content.readLists' },
  { name: 'komga.books.filesize', labelKey: 'content.totalSize', format: formatBytes },
]

export function ContentCounts() {
  const { t } = useTranslation('admin-settings')
  const results = useQueries({
    queries: METRICS.map((m) => ({
      queryKey: ['admin', 'metric', m.name],
      queryFn: () => actuatorApi.metric(m.name),
      refetchInterval: 30_000,
    })),
  })

  return (
    <Section title={t('sections.content')}>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 xl:grid-cols-6">
        {METRICS.map((m, i) => {
          const q = results[i]
          const value = metricStat(q.data, 'VALUE')
          return (
            <div key={m.name}>
              <p className="text-2xl font-semibold text-ink">
                {q.isLoading ? '…' : value === undefined ? '—' : (m.format?.(value) ?? value)}
              </p>
              <p className="mt-0.5 text-xs text-ink-3">{t(m.labelKey)}</p>
            </div>
          )
        })}
      </div>
    </Section>
  )
}
