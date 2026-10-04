import { useQueries } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { actuatorApi } from '@/lib/api/settings'
import type { MetricDto } from '@/lib/api/types'
import { Skeleton } from '@/components/ui/Skeleton'
import { Section } from '@/components/account/Section'
import { formatDuration, taskTypeLabel } from './format'
import { useMetric } from './useMetric'
import { metricStat } from '../metric'

interface Row {
  label: string
  count: number
  total: number
  max: number
}

function toRow(label: string, metric: MetricDto): Row {
  return {
    label,
    count: metricStat(metric, 'COUNT') ?? 0,
    total: metricStat(metric, 'TOTAL_TIME') ?? 0,
    max: metricStat(metric, 'MAX') ?? 0,
  }
}

export function TaskExecutionPanel() {
  const { t } = useTranslation('admin-settings')
  const base = useMetric('komga.tasks.execution')
  const failure = useMetric('komga.tasks.failure')
  const types = base.data?.availableTags.find((tag) => tag.tag === 'type')?.values ?? []
  const perType = useQueries({
    queries: types.map((type) => ({
      queryKey: ['admin', 'metric', 'komga.tasks.execution', `type:${type}`],
      queryFn: () => actuatorApi.metric('komga.tasks.execution', [`type:${type}`]),
      // a type without executions yet 404s
      retry: false,
      refetchInterval: 30_000,
    })),
  })

  const typedRows = types.flatMap((type, i) => {
    const m = perType[i]?.data
    return m && (metricStat(m, 'COUNT') ?? 0) > 0 ? [toRow(taskTypeLabel(type), m)] : []
  })

  const aggregate = base.data && (metricStat(base.data, 'COUNT') ?? 0) > 0 ? toRow(t('taskExecution.allTasks'), base.data) : null
  const rows = typedRows.length > 0 ? typedRows : aggregate ? [aggregate] : []
  const failureCount = metricStat(failure.data, 'COUNT') ?? 0

  return (
    <Section title={t('taskExecution.title')}>
      {base.isLoading && (
        <div className="flex flex-col gap-2.5">
          <Skeleton className="h-7 w-full" />
          <Skeleton className="h-7 w-2/3" />
        </div>
      )}
      {!base.isLoading && rows.length === 0 && <p className="text-sm text-ink-3">{t('taskExecution.empty')}</p>}
      {rows.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-ink-3">
                <th className="pb-2 pr-4 font-medium">{t('taskExecution.type')}</th>
                <th className="pb-2 pr-4 text-right font-medium">{t('taskExecution.runs')}</th>
                <th className="pb-2 pr-4 text-right font-medium">{t('taskExecution.totalTime')}</th>
                <th className="pb-2 text-right font-medium">{t('taskExecution.longest')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.label} className="border-t border-line">
                  <td className="py-2 pr-4 whitespace-nowrap text-ink-2">{r.label}</td>
                  <td className="py-2 pr-4 text-right font-mono text-xs text-ink">{r.count}</td>
                  <td className="py-2 pr-4 text-right whitespace-nowrap text-ink-2">{formatDuration(r.total)}</td>
                  <td className="py-2 text-right whitespace-nowrap text-ink-2">{formatDuration(r.max)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {failureCount > 0 && <p className="mt-3 text-xs text-danger">{t('taskExecution.failures', { count: failureCount })}</p>}
    </Section>
  )
}
