import { useState } from 'react'
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { CaretLeft, CaretRight } from '@phosphor-icons/react'
import { usersApi } from '@/lib/api/users'
import { relativeTime } from '@/lib/utils/format'
import { Button } from '@/components/ui/Button'
import { Skeleton } from '@/components/ui/Skeleton'

const PAGE_SIZE = 20

export function SessionsSection() {
  const { t } = useTranslation('admin-users')
  const queryClient = useQueryClient()
  const [page, setPage] = useState(0)
  const query = useQuery({
    queryKey: ['admin', 'sessions', page],
    queryFn: () => usersApi.sessions({ page, size: PAGE_SIZE }),
    placeholderData: keepPreviousData,
  })

  const kick = useMutation({
    mutationFn: (id: string) => usersApi.deleteSession(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['admin', 'sessions'] }),
  })

  return (
    <section className="mt-10">
      <div className="mb-3 flex items-baseline justify-between gap-4">
        <h2 className="text-[15px] font-semibold text-ink">{t('sessions.title')}</h2>
      </div>

      {query.isLoading && (
        <div className="flex flex-col gap-2.5 rounded-xl border border-line bg-surface p-4">
          {Array.from({ length: 3 }, (_, i) => (
            <Skeleton key={i} className="h-7 w-full" />
          ))}
        </div>
      )}

      {query.isLoadingError && (
        <div className="flex items-center gap-3 rounded-xl border border-line bg-surface px-4 py-6">
          <p className="text-sm text-danger">
            {query.error instanceof Error ? query.error.message : t('account:security.sessions.failed')}
          </p>
          <Button size="sm" onClick={() => void query.refetch()}>
            {t('common:action.retry')}
          </Button>
        </div>
      )}

      {query.data && (
        <div className="overflow-hidden rounded-xl border border-line bg-surface">
          {query.data.content.length === 0 ? (
            <p className="px-4 py-10 text-center text-sm text-ink-3">{t('account:security.sessions.empty')}</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-sm">
                <thead>
                  <tr className="border-b border-line text-left text-xs text-ink-3">
                    <th className="px-4 py-3 font-medium">{t('account:security.sessions.session')}</th>
                    <th className="px-4 py-3 font-medium">{t('user')}</th>
                    <th className="px-4 py-3 font-medium">{t('account:security.sessions.created')}</th>
                    <th className="px-4 py-3 font-medium">{t('account:security.sessions.lastActive')}</th>
                    <th className="px-4 py-3 text-right font-medium">
                      <span className="sr-only">{t('account:security.sessions.actions')}</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {query.data.content.map((s) => (
                    <tr key={s.id} className="border-t border-line first:border-t-0">
                      <td className="px-4 py-2.5 font-mono text-xs whitespace-nowrap text-ink-2" title={s.id}>
                        {s.id.length > 12 ? `${s.id.slice(0, 12)}…` : s.id}
                      </td>
                      <td className="max-w-52 truncate px-4 py-2.5 text-ink-2">{s.email ?? s.userId}</td>
                      <td className="px-4 py-2.5 whitespace-nowrap text-ink-2">{relativeTime(s.creationTime)}</td>
                      <td className="px-4 py-2.5 whitespace-nowrap text-ink-2">{relativeTime(s.lastAccessedTime)}</td>
                      <td className="px-4 py-2.5 text-right">
                        <Button size="sm" variant="danger" onClick={() => kick.mutate(s.id)} disabled={kick.isPending}>
                          {t('sessions.kick')}
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div className="flex items-center justify-between border-t border-line px-4 py-3">
            <span className="font-mono text-xs text-ink-3">
              {t('account:security.sessions.page', {
                current: query.data.number + 1,
                total: Math.max(query.data.totalPages, 1),
              })}
            </span>
            <div className="flex gap-2">
              <Button size="sm" onClick={() => setPage((p) => p - 1)} disabled={page === 0 || query.isFetching}>
                <CaretLeft className="size-4" />
                {t('account:security.sessions.previous')}
              </Button>
              <Button
                size="sm"
                onClick={() => setPage((p) => p + 1)}
                disabled={query.data.last || query.isFetching}
              >
                {t('account:security.sessions.next')}
                <CaretRight className="size-4" />
              </Button>
            </div>
          </div>
        </div>
      )}
      {query.data && query.data.content.length > 0 && <p className="mt-3 text-xs text-ink-3">{t('sessions.kickHint')}</p>}
      {kick.isError && (
        <p className="mt-2 text-sm text-danger">
          {kick.error instanceof Error ? kick.error.message : t('sessions.kickFailed')}
        </p>
      )}
    </section>
  )
}
