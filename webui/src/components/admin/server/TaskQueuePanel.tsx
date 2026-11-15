import { useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { Broom, WarningCircle } from '@phosphor-icons/react'
import { tasksApi } from '@/lib/api/settings'
import { useTaskQueue } from '@/lib/store/taskQueue'
import { Button } from '@/components/ui/Button'
import { Dialog } from '@/components/ui/Dialog'
import { Skeleton } from '@/components/ui/Skeleton'
import { Section } from '@/components/account/Section'
import { relativeTime } from '@/lib/utils/format'
import { taskTypeLabel } from './format'

export function TaskQueuePanel() {
  const { t } = useTranslation('admin-settings')
  const status = useTaskQueue((s) => s.status)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [cleared, setCleared] = useState<number | null>(null)
  const failedQuery = useQuery({
    queryKey: ['admin', 'tasks', 'failed'],
    queryFn: tasksApi.failed,
    refetchInterval: 10_000,
  })

  const clear = useMutation({
    mutationFn: tasksApi.clear,
    onSuccess: (n) => {
      setCleared(n)
      setConfirmOpen(false)
      void failedQuery.refetch()
    },
  })

  const count = status?.count ?? 0
  const entries = Object.entries(status?.countByType ?? {}).sort((a, b) => b[1] - a[1])
  const failures = failedQuery.data ?? []

  return (
    <Section title={t('taskQueue.title')}>
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <span className="font-display text-4xl font-semibold text-ink">{status ? count : '—'}</span>
          {count > 0 && (
            <span className="relative flex size-2.5" aria-label={t('taskQueue.active')}>
              <span className="absolute inline-flex size-full animate-ping rounded-full bg-accent opacity-60" />
              <span className="relative inline-flex size-2.5 rounded-full bg-accent" />
            </span>
          )}
        </div>
        <Button size="sm" onClick={() => setConfirmOpen(true)} disabled={count === 0 && failures.length === 0}>
          <Broom className="size-4" />
          {t('taskQueue.clear')}
        </Button>
      </div>
      <p className="mt-1 text-xs text-ink-3">{status ? t('taskQueue.status', { count }) : t('taskQueue.waiting')}</p>

      {entries.length > 0 && (
        <ul className="mt-3 flex flex-col divide-y divide-line border-t border-line">
          {entries.map(([type, n]) => (
            <li key={type} className="flex items-center justify-between py-2">
              <span className="text-sm text-ink-2">{taskTypeLabel(type)}</span>
              <span className="font-mono text-sm text-ink">{n}</span>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-4 border-t border-line pt-3">
        <h3 className="text-sm font-medium text-ink">{t('taskQueue.failedTitle')}</h3>
        {failedQuery.isLoading && (
          <div className="mt-2 flex flex-col gap-2.5">
            <Skeleton className="h-7 w-full" />
            <Skeleton className="h-7 w-2/3" />
          </div>
        )}
        {failedQuery.isLoadingError && (
          <div className="mt-2 flex items-center gap-3">
            <p className="text-sm text-danger">
              {failedQuery.error instanceof Error ? failedQuery.error.message : t('taskQueue.failedLoad')}
            </p>
            <Button size="sm" onClick={() => void failedQuery.refetch()}>
              {t('common:action.retry')}
            </Button>
          </div>
        )}
        {failedQuery.data && failures.length === 0 && (
          <p className="mt-2 text-sm text-ink-3">{t('taskQueue.failedEmpty')}</p>
        )}
        {failures.length > 0 && (
          <ul className="mt-1 flex flex-col divide-y divide-line">
            {failures.map((failure) => (
              <li key={failure.id} className="py-2.5">
                <div className="flex items-center justify-between gap-3 text-xs text-ink-3">
                  <span className="text-sm text-ink-2">{taskTypeLabel(failure.type)}</span>
                  <span className="shrink-0">
                    {t('taskQueue.retryCount', { count: failure.retryCount })} · {relativeTime(failure.failedAt)}
                  </span>
                </div>
                <p className="mt-1 text-sm break-words text-danger">{failure.error}</p>
              </li>
            ))}
          </ul>
        )}
      </div>

      {cleared !== null && <p className="mt-3 text-sm text-accent-strong">{t('taskQueue.cleared', { count: cleared })}</p>}
      {clear.isError && (
        <p className="mt-3 text-sm text-danger">
          {clear.error instanceof Error ? clear.error.message : t('taskQueue.clearFailed')}
        </p>
      )}

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen} title={t('taskQueue.clearTitle')} size="sm">
        <div className="flex flex-col gap-4 p-5">
          <p className="flex items-start gap-2 text-sm text-ink-2">
            <WarningCircle className="mt-0.5 size-4 shrink-0 text-danger" />
            {t('taskQueue.clearBody')}
          </p>
          {failures.length > 0 && <p className="text-sm text-ink-2">{t('taskQueue.clearFailuresBody')}</p>}
          <div className="flex justify-end gap-2">
            <Button onClick={() => setConfirmOpen(false)}>{t('common:action.cancel')}</Button>
            <Button variant="danger" loading={clear.isPending} onClick={() => clear.mutate()}>
              {t('taskQueue.clear')}
            </Button>
          </div>
        </div>
      </Dialog>
    </Section>
  )
}
