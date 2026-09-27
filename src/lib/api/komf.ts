import { api } from './client'
import type { KomfIntegrationDto, KomfIntegrationUpdateDto } from './types'

export const komfApi = {
  getIntegration: () => api.get<KomfIntegrationDto>('/api/v1/komf/integration'),
  updateIntegration: (body: KomfIntegrationUpdateDto) => api.put<KomfIntegrationDto>('/api/v1/komf/integration', body),
  disconnect: () => api.delete<void>('/api/v1/komf/integration'),
}
