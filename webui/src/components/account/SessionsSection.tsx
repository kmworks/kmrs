import { useState } from 'react'
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { CaretLeft, CaretRight } from '@phosphor-icons/react'
import { usersApi } from '@/lib/api/users'
import { relativeTime } from '@/lib/utils/format'
import { Button } from '@/components/ui/Button'
import { Chip } from '@/components/ui/Chip'
import { Skeleton } from '@/components/ui/Skeleton'
import { Section } from './Section'

const PAGE_SIZE = 20

export function SessionsSection() {
  const { t } = useTranslation('account')
  const queryClient = useQueryClient()
  const [page, setPage] = useState(0)
  const query = useQuery({
    queryKey: ['account', 'sessions', page],
    queryFn: () => usersApi.mySessions({ page, size: PAGE_SIZE }),
    placeholderData: keepPreviousData,
  })

  const signOut = useMutation({
    mutationFn: (id: string) => usersApi.deleteMySession(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['account', 'sessions'] }),
  })

  return (
    <Section title={t('security.sessions.title')}>
      {query.isLoading && (
        <div className="flex flex-col gap-2.5">
          {Array.from({ length: 3 }, (_, i) => (
            <Skeleton key={i} className="h-7 w-full" />
          ))}
        </div>
      )}
      {query.isLoadingError && (
        <div className="flex items-center gap-3">
          <p className="text-sm text-danger">
            {query.error instanceof Error ? query.error.message : t('security.sessions.failed')}
          </p>
          <Button size="sm" onClick={() => void query.refetch()}>
            {t('common:action.retry')}
          </Button>
        </div>
      )}
      {query.data && (
        <>
          {query.data.content.length === 0 ? (
            <p className="text-sm text-ink-3">{t('security.sessions.empty')}</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[480px] text-sm">
                <thead>
                  <tr className="text-left text-xs text-ink-3">
                    <th className="pb-2 pr-4 font-medium">{t('security.sessions.session')}</th>
                    <th className="pb-2 pr-4 font-medium">{t('security.sessions.created')}</th>
                    <th className="pb-2 pr-4 font-medium">{t('security.sessions.lastActive')}</th>
                    <th className="pb-2 text-right font-medium">
                      <span className="sr-only">{t('security.sessions.actions')}</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {query.data.content.map((s) => (
                    <tr key={s.id} className="border-t border-line">
                      <td className="py-2.5 pr-4 whitespace-nowrap">
                        <span className="font-mono text-xs text-ink-2" title={s.id}>
                          {s.id.length > 12 ? `${s.id.slice(0, 12)}…` : s.id}
                        </span>
                        {s.current && <Chip className="ml-2">{t('security.sessions.current')}</Chip>}
                      </td>
                      <td className="py-2.5 pr-4 whitespace-nowrap text-ink-2">{relativeTime(s.creationTime)}</td>
                      <td className="py-2.5 pr-4 whitespace-nowrap text-ink-2">{relativeTime(s.lastAccessedTime)}</td>
                      <td className="py-2.5 text-right">
                        <Button
                          size="sm"
                          variant="danger"
                          onClick={() => signOut.mutate(s.id)}
                          disabled={s.current || signOut.isPending}
                        >
                          {t('security.sessions.signOut')}
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div className="mt-4 flex items-center justify-between">
            <span className="font-mono text-xs text-ink-3">
              {t('security.sessions.page', { current: query.data.number + 1, total: Math.max(query.data.totalPages, 1) })}
            </span>
            <div className="flex gap-2">
              <Button size="sm" onClick={() => setPage((p) => p - 1)} disabled={page === 0 || query.isFetching}>
                <CaretLeft className="size-4" />
                {t('security.sessions.previous')}
              </Button>
              <Button
                size="sm"
                onClick={() => setPage((p) => p + 1)}
                disabled={query.data.last || query.isFetching}
              >
                {t('security.sessions.next')}
                <CaretRight className="size-4" />
              </Button>
            </div>
          </div>
          {signOut.isError && (
            <p className="mt-2 text-sm text-danger">
              {signOut.error instanceof Error ? signOut.error.message : t('security.sessions.signOutFailed')}
            </p>
          )}
        </>
      )}
    </Section>
  )
}
