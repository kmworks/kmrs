import { api } from './client'
import type { DirectoryListingDto, FailedTaskDto, SettingsDto, SettingsUpdateDto } from './types'

export const settingsApi = {
  get: () => api.get<SettingsDto>('/api/v1/settings'),
  update: (body: SettingsUpdateDto) => api.patch<void>('/api/v1/settings', body),
}

export const filesystemApi = {
  browse: (path?: string, showFiles = false) =>
    api.post<DirectoryListingDto>('/api/v1/filesystem', { path, showFiles }),
}

export const tasksApi = {
  failed: () => api.get<FailedTaskDto[]>('/api/v1/tasks/failed'),
  /** Purges queued tasks (not ones already claimed by a worker) and permanent failure records. */
  clear: () => api.delete<number>('/api/v1/tasks'),
}
