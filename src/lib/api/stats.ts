import { api } from './client'
import type { ReadingActivityDto, ReadingSummaryDto, ReadingTopsDto } from './types'

/** Per-user reading statistics (kmrs-private); every endpoint takes an optional library filter. */
export const statsApi = {
  summary: (libraryId?: string) => api.get<ReadingSummaryDto>('/api/v1/stats/reading/summary', { libraryId }),
  activity: (libraryId: string | undefined, tzOffsetMinutes: number) =>
    api.get<ReadingActivityDto>('/api/v1/stats/reading/activity', { libraryId, tzOffsetMinutes }),
  tops: (libraryId?: string) => api.get<ReadingTopsDto>('/api/v1/stats/reading/tops', { libraryId }),
}
