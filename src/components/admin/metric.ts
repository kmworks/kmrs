import type { MetricDto } from '@/lib/api/types'

export function metricStat(metric: MetricDto | undefined, statistic: string): number | undefined {
  return metric?.measurements.find((m) => m.statistic === statistic)?.value
}
