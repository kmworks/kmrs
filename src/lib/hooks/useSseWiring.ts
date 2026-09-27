import { useEffect } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { sse, type SseEventName } from '@/lib/api/sse'
import type { TaskQueueStatus } from '@/lib/api/types'
import { useAuthStore } from '@/lib/store/auth'
import { useTaskQueue } from '@/lib/store/taskQueue'
import { useThumbnailBust } from '@/lib/store/thumbnails'

const INVALIDATE: Partial<Record<SseEventName, string[][]>> = {
  LibraryAdded: [['libraries']],
  LibraryChanged: [['libraries']],
  LibraryDeleted: [['libraries']],
  SeriesAdded: [['series'], ['dashboard']],
  SeriesChanged: [['series'], ['dashboard']],
  SeriesDeleted: [['series'], ['dashboard']],
  BookAdded: [['books'], ['series'], ['dashboard']],
  BookChanged: [['books'], ['series'], ['dashboard']],
  BookDeleted: [['books'], ['series'], ['dashboard']],
  ReadProgressChanged: [['books'], ['series'], ['dashboard']],
  ReadProgressDeleted: [['books'], ['series'], ['dashboard']],
  ReadProgressSeriesChanged: [['series'], ['dashboard']],
  ReadProgressSeriesDeleted: [['series'], ['dashboard']],
  CollectionAdded: [['collections']],
  CollectionChanged: [['collections']],
  CollectionDeleted: [['collections']],
  ReadListAdded: [['readlists']],
  ReadListChanged: [['readlists']],
  ReadListDeleted: [['readlists']],
}

const THUMB_EVENTS: Record<string, (d: { seriesId?: string; bookId?: string; collectionId?: string; readListId?: string }) => string | undefined> = {
  ThumbnailSeriesAdded: (d) => d.seriesId,
  ThumbnailSeriesDeleted: (d) => d.seriesId,
  ThumbnailBookAdded: (d) => d.bookId,
  ThumbnailBookDeleted: (d) => d.bookId,
  ThumbnailSeriesCollectionAdded: (d) => d.collectionId,
  ThumbnailSeriesCollectionDeleted: (d) => d.collectionId,
  ThumbnailReadListAdded: (d) => d.readListId,
  ThumbnailReadListDeleted: (d) => d.readListId,
}

/** Wires the SSE stream to react-query invalidation while authenticated. */
export function useSseWiring() {
  const status = useAuthStore((s) => s.status)
  const queryClient = useQueryClient()
  const clear = useAuthStore((s) => s.clear)
  const bump = useThumbnailBust((s) => s.bump)
  const setTaskStatus = useTaskQueue((s) => s.setStatus)

  useEffect(() => {
    if (status !== 'authenticated') {
      sse.disconnect()
      return
    }
    sse.connect()

    const offs: Array<() => void> = []
    for (const [name, keys] of Object.entries(INVALIDATE)) {
      offs.push(
        sse.on(name as SseEventName, () => {
          for (const key of keys) queryClient.invalidateQueries({ queryKey: key })
        }),
      )
    }
    for (const [name, pick] of Object.entries(THUMB_EVENTS)) {
      offs.push(
        sse.on(name as SseEventName, (data) => {
          const id = pick(data as Parameters<typeof pick>[0])
          if (id) bump(id)
        }),
      )
    }
    offs.push(
      sse.on('SessionExpired', () => {
        clear()
        queryClient.clear()
      }),
    )
    offs.push(
      sse.on('TaskQueueStatus', (data) => {
        setTaskStatus(data as TaskQueueStatus)
      }),
    )
    return () => offs.forEach((off) => off())
  }, [status, queryClient, clear, bump, setTaskStatus])
}
