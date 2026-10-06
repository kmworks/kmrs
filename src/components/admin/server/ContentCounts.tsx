import { useTranslation } from 'react-i18next'
import { formatBytes } from '@/lib/utils/format'
import { Section } from '@/components/account/Section'
import { useLibrariesStats, useServerStats } from '../stats'

interface ContentStat {
  labelKey: string
  value: number | undefined
  format?: (value: number) => string
}

export function ContentCounts() {
  const { t } = useTranslation('admin-settings')
  const server = useServerStats()
  const libraries = useLibrariesStats()

  const loading = server.isLoading || libraries.isLoading
  const stats: ContentStat[] = [
    { labelKey: 'content.libraries', value: server.data?.totals.libraries },
    { labelKey: 'content.series', value: libraries.data?.total.series },
    { labelKey: 'content.books', value: libraries.data?.total.books },
    { labelKey: 'content.collections', value: server.data?.totals.collections },
    { labelKey: 'content.readLists', value: server.data?.totals.readlists },
    { labelKey: 'content.totalSize', value: libraries.data?.total.fileSize, format: formatBytes },
  ]

  return (
    <Section title={t('sections.content')}>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 xl:grid-cols-6">
        {stats.map((s) => (
          <div key={s.labelKey}>
            <p className="text-2xl font-semibold text-ink">
              {loading ? '…' : s.value === undefined ? '—' : (s.format?.(s.value) ?? s.value)}
            </p>
            <p className="mt-0.5 text-xs text-ink-3">{t(s.labelKey)}</p>
          </div>
        ))}
      </div>
    </Section>
  )
}
