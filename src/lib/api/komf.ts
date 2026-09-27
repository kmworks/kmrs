import { api } from './client'
import type {
  KomfConfig,
  KomfConfigPatch,
  KomfIdentifyRequest,
  KomfIntegrationDto,
  KomfIntegrationUpdateDto,
  KomfJob,
  KomfMetadataJobResponse,
  KomfSeriesSearchResult,
} from './types'

export const komfApi = {
  getIntegration: () => api.get<KomfIntegrationDto>('/api/v1/komf/integration'),
  updateIntegration: (body: KomfIntegrationUpdateDto) => api.put<KomfIntegrationDto>('/api/v1/komf/integration', body),
  disconnect: () => api.delete<void>('/api/v1/komf/integration'),
  getConfig: () => api.get<KomfConfig>('/api/v1/komf/config'),
  patchConfig: (body: KomfConfigPatch) => api.patch<void>('/api/v1/komf/config', body),
  search: (params: { name: string; libraryId?: string; seriesId?: string }) =>
    api.get<KomfSeriesSearchResult[]>('/api/v1/komf/search', params),
  identify: (body: KomfIdentifyRequest) => api.post<KomfMetadataJobResponse>('/api/v1/komf/identify', body),
  matchSeries: (libraryId: string, seriesId: string) =>
    api.post<KomfMetadataJobResponse>(`/api/v1/komf/match/library/${libraryId}/series/${seriesId}`),
  resetSeries: (libraryId: string, seriesId: string) =>
    api.post<void>(`/api/v1/komf/reset/library/${libraryId}/series/${seriesId}`),
  getJob: (jobId: string) => api.get<KomfJob>(`/api/v1/komf/jobs/${jobId}`),
}
