import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { usersApi } from '@/lib/api/users'
import { relativeTime } from '@/lib/utils/format'
import { Button } from '@/components/ui/Button'
import { Chip } from '@/components/ui/Chip'
import { Skeleton } from '@/components/ui/Skeleton'
import { Section } from './Section'

const SESSION_LIMIT = 10

export function SessionsSection() {
  const { t } = useTranslation('account')
  const queryClient = useQueryClient()
  const query = useQuery({ queryKey: ['account', 'sessions'], queryFn: usersApi.mySessions })

  const signOut = useMutation({
    mutationFn: (id: string) => usersApi.deleteMySession(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['account', 'sessions'] }),
  })

  const sessions = query.data ?? []
  const [showAll, setShowAll] = useState(false)
  const visible = showAll ? sessions : sessions.slice(0, SESSION_LIMIT)

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
          {sessions.length === 0 ? (
            <p className="text-sm text-ink-3">{t('security.sessions.empty')}</p>
          ) : (
            <>
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
                    {visible.map((s) => (
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
              {sessions.length > SESSION_LIMIT && (
                <button
                  type="button"
                  onClick={() => setShowAll((v) => !v)}
                  className="mt-2 cursor-pointer text-sm text-accent-strong hover:underline"
                >
                  {showAll ? t('common:action.showLess') : t('security.sessions.showAll', { count: sessions.length })}
                </button>
              )}
            </>
          )}
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
