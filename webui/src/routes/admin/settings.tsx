import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { settingsApi } from '@/lib/api/settings'
import { useDocumentTitle } from '@/lib/hooks/useDocumentTitle'
import { Button } from '@/components/ui/Button'
import { PageHeader } from '@/components/ui/PageHeader'
import { Skeleton } from '@/components/ui/Skeleton'
import { SettingsForm } from '@/components/admin/settings/SettingsForm'
import { UiSettingsSection } from '@/components/admin/settings/UiSettingsSection'

export function AdminSettingsPage() {
  const { t } = useTranslation('admin-settings')
  const query = useQuery({ queryKey: ['admin', 'settings'], queryFn: settingsApi.get })

  useDocumentTitle(t('settings.title'))

  return (
    <div className="max-w-3xl">
      <PageHeader title={t('settings.title')} subtitle={t('settings.subtitle')} />
      <div className="space-y-6">
        <UiSettingsSection />
        {query.isLoading && (
          <>
            <Skeleton className="h-36 w-full rounded-xl" />
            <Skeleton className="h-44 w-full rounded-xl" />
            <Skeleton className="h-28 w-full rounded-xl" />
          </>
        )}
        {query.isLoadingError && (
          <div className="flex items-center gap-3 rounded-xl border border-line bg-surface p-5">
            <p className="text-sm text-danger">
              {query.error instanceof Error ? query.error.message : t('settings.loadFailed')}
            </p>
            <Button size="sm" onClick={() => void query.refetch()}>
              {t('common:action.retry')}
            </Button>
          </div>
        )}
        {query.data && <SettingsForm settings={query.data} />}
      </div>
    </div>
  )
}
