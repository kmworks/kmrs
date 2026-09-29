import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { ApiError } from '@/lib/api/client'
import { komfApi } from '@/lib/api/komf'
import { librariesApi } from '@/lib/api/libraries'
import { useDocumentTitle } from '@/lib/hooks/useDocumentTitle'
import { Button } from '@/components/ui/Button'
import { EmptyState } from '@/components/ui/EmptyState'
import { PageHeader } from '@/components/ui/PageHeader'
import { Skeleton } from '@/components/ui/Skeleton'
import { KomfConfigForm } from '@/components/admin/komf/KomfConfigForm'

export function AdminKomfPage() {
  const { t } = useTranslation('admin-komf')
  const query = useQuery({ queryKey: ['admin', 'komf-config'], queryFn: komfApi.getConfig })
  const librariesQuery = useQuery({ queryKey: ['libraries'], queryFn: librariesApi.list })

  useDocumentTitle('komf')

  const notConnected = query.error instanceof ApiError && query.error.status === 409
  const loadError = query.error ?? librariesQuery.error

  return (
    <div className="max-w-3xl">
      <PageHeader title="komf" subtitle={t('page.subtitle')} />
      {(query.isLoading || librariesQuery.isLoading) && (
        <div className="space-y-6">
          <Skeleton className="h-40 w-full rounded-xl" />
          <Skeleton className="h-72 w-full rounded-xl" />
          <Skeleton className="h-72 w-full rounded-xl" />
        </div>
      )}
      {notConnected ? (
        <EmptyState
          title={t('page.notConnectedTitle')}
          body={t('page.notConnectedBody')}
          action={
            <Link to="/admin/integrations">
              <Button variant="primary">{t('page.goToIntegrations')}</Button>
            </Link>
          }
        />
      ) : (
        loadError && (
          <div className="flex items-center gap-3 rounded-xl border border-line bg-surface p-5">
            <p className="text-sm text-danger">
              {loadError instanceof Error ? loadError.message : t('page.loadFailed')}
            </p>
            <Button
              size="sm"
              onClick={() => {
                void query.refetch()
                void librariesQuery.refetch()
              }}
            >
              {t('common:action.retry')}
            </Button>
          </div>
        )
      )}
      {query.data && librariesQuery.data && <KomfConfigForm config={query.data} libraries={librariesQuery.data} />}
    </div>
  )
}
