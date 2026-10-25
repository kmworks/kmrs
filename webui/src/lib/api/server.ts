import { api } from './client'
import type { ServerInfoDto, ServerScheduledTaskDto } from './types'

export const serverApi = {
  info: () => api.get<ServerInfoDto>('/api/v1/server/info'),
  scheduledTasks: () => api.get<{ tasks: ServerScheduledTaskDto[] }>('/api/v1/server/scheduled-tasks'),
  logfileUrl: () => '/api/v1/server/logfile',
}
