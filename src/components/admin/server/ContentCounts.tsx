import { useQueries } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { actuatorApi } from '@/lib/api/settings'
import { Section } from '@/components/account/Section'

const METRICS = [
  { name: 'komga.libraries', labelKey: 'content.libraries' },
  { name: 'komga.series', labelKey: 'content.series' },
  { name: 'komga.books', labelKey: 'content.books' },
  { name: 'komga.collections', labelKey: 'content.collections' },
  { name: 'komga.readlists', labelKey: 'content.readLists' },
] as const

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
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-5">
        {METRICS.map((m, i) => {
          const q = results[i]
          const value = q.data?.measurements.find((x) => x.statistic === 'VALUE')?.value
          return (
            <div key={m.name}>
              <p className="text-2xl font-semibold text-ink">{q.isLoading ? '…' : (value ?? '—')}</p>
              <p className="mt-0.5 text-xs text-ink-3">{t(m.labelKey)}</p>
            </div>
          )
        })}
      </div>
    </Section>
  )
}
