import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { WarningCircle } from '@phosphor-icons/react'
import { clientSettingsApi } from '@/lib/api/clientSettings'
import { usersApi } from '@/lib/api/users'
import { Button } from '@/components/ui/Button'
import { EmptyState } from '@/components/ui/EmptyState'
import { Skeleton } from '@/components/ui/Skeleton'
import { Switch } from '@/components/ui/Switch'
import { Section } from '@/components/account/Section'

// server-side keys must be all-lowercase dotted segments
export const HIDE_PASSWORD_KEY = 'webui.login.hide-password'
export const OAUTH_AUTO_KEY = 'webui.login.oauth-auto'

export function UiSettingsSection() {
  const { t } = useTranslation('admin-settings')
  const queryClient = useQueryClient()

  const settingsQuery = useQuery({ queryKey: ['admin', 'client-settings', 'global'], queryFn: clientSettingsApi.listGlobal })
  // shown only as context: the toggles are no-ops without providers
  const providersQuery = useQuery({ queryKey: ['oauth2-providers'], queryFn: usersApi.oauth2Providers })

  const hidePassword = settingsQuery.data?.[HIDE_PASSWORD_KEY]?.value === 'true'
  const oauthAuto = settingsQuery.data?.[OAUTH_AUTO_KEY]?.value === 'true'
  const providerCount = providersQuery.data?.length ?? 0

  const save = useMutation({
    mutationFn: (changes: Record<string, boolean>) =>
      clientSettingsApi.saveGlobal(
        // allowUnauthorized: the login page is anonymous and must be able to read this
        Object.fromEntries(
          Object.entries(changes).map(([key, value]) => [key, { value: String(value), allowUnauthorized: true }]),
        ),
      ),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['admin', 'client-settings', 'global'] }),
  })

  if (settingsQuery.isPending) return <Skeleton className="h-28 rounded-xl" />
  if (settingsQuery.isLoadingError) {
    return (
      <EmptyState
        icon={<WarningCircle />}
        title={t('ui.loadFailed')}
        body={settingsQuery.error instanceof Error ? settingsQuery.error.message : t('ui.errorFallback')}
        action={<Button onClick={() => settingsQuery.refetch()}>{t('common:action.retry')}</Button>}
      />
    )
  }

  return (
    <Section title={t('ui.login')}>
      <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2.5">
        <div className="min-w-0 max-w-md">
          <p className="text-sm text-ink-2">{t('ui.hidePassword')}</p>
          <p className="mt-0.5 text-xs text-ink-3">
            {providersQuery.data
              ? t('ui.hidePasswordHelperWithCount', { count: providerCount })
              : t('ui.hidePasswordHelper')}
          </p>
        </div>
        <Switch
          checked={hidePassword}
          onCheckedChange={(v) =>
            // auto-login only works with the form hidden, so hiding-off must turn it off too
            save.mutate(v ? { [HIDE_PASSWORD_KEY]: true } : { [HIDE_PASSWORD_KEY]: false, [OAUTH_AUTO_KEY]: false })
          }
          disabled={save.isPending}
          label={t('ui.hidePassword')}
        />
      </div>
      {hidePassword && providersQuery.data && providerCount === 0 && (
        <p className="mt-3 text-xs text-accent-strong">{t('ui.noProviderWarning')}</p>
      )}
      <div className="mt-5 flex flex-wrap items-center justify-between gap-x-6 gap-y-2.5 border-t border-line pt-5">
        <div className="min-w-0 max-w-md">
          <p className="text-sm text-ink-2">{t('ui.oauthAuto')}</p>
          <p className="mt-0.5 text-xs text-ink-3">{t('ui.oauthAutoHelper')}</p>
        </div>
        <Switch
          checked={oauthAuto}
          onCheckedChange={(v) => save.mutate({ [OAUTH_AUTO_KEY]: v })}
          disabled={save.isPending || !hidePassword}
          label={t('ui.oauthAuto')}
        />
      </div>
      {oauthAuto && providersQuery.data && providerCount !== 1 && (
        <p className="mt-3 text-xs text-accent-strong">{t('ui.oauthAutoNoSingleProvider')}</p>
      )}
      {save.isError && (
        <p className="mt-3 text-sm text-danger">
          {save.error instanceof Error ? save.error.message : t('ui.saveFailed')}
        </p>
      )}
    </Section>
  )
}
