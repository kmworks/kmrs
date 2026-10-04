import { useQuery } from '@tanstack/react-query'
import { actuatorApi } from '@/lib/api/settings'

/** A metric with no recordings yet (e.g. komga.series on an empty library) 404s — callers render "—". */
export function useMetric(name: string) {
  return useQuery({
    queryKey: ['admin', 'metric', name],
    queryFn: () => actuatorApi.metric(name),
    refetchInterval: 30_000,
  })
}
