import { api } from './client'
import type {
  KomfIdentifyRequest,
  KomfIntegrationDto,
  KomfIntegrationUpdateDto,
  KomfMetadataJobResponse,
  KomfSeriesSearchResult,
} from './types'

export const komfApi = {
  getIntegration: () => api.get<KomfIntegrationDto>('/api/v1/komf/integration'),
  updateIntegration: (body: KomfIntegrationUpdateDto) => api.put<KomfIntegrationDto>('/api/v1/komf/integration', body),
  disconnect: () => api.delete<void>('/api/v1/komf/integration'),
  search: (params: { name: string; libraryId?: string; seriesId?: string }) =>
    api.get<KomfSeriesSearchResult[]>('/api/v1/komf/search', params),
  identify: (body: KomfIdentifyRequest) => api.post<KomfMetadataJobResponse>('/api/v1/komf/identify', body),
  matchSeries: (libraryId: string, seriesId: string) =>
    api.post<KomfMetadataJobResponse>(`/api/v1/komf/match/library/${libraryId}/series/${seriesId}`),
}
