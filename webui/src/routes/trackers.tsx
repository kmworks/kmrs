import { useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { ArrowSquareOut, SignOut } from '@phosphor-icons/react'
import { trackerLinkKeys, trackersApi } from '@/lib/api/trackers'
import type { KomfOAuthProvider } from '@/lib/api/types'
import { librariesApi } from '@/lib/api/libraries'
import { Button } from '@/components/ui/Button'
import { IconButton } from '@/components/ui/IconButton'
import { PageHeader } from '@/components/ui/PageHeader'
import { ConfirmDeleteDialog } from '@/components/detail/ConfirmDeleteDialog'
import { Switch } from '@/components/ui/Switch'
import { TrackerLogo } from '@/components/trackers/TrackerLogo'
import { TrackerBindings } from '@/components/trackers/TrackerBindings'
import { useDocumentTitle } from '@/lib/hooks/useDocumentTitle'
import { showToast } from '@/lib/store/toast'
import { cn } from '@/lib/utils/cn'

const PROVIDERS: KomfOAuthProvider[] = ['anilist', 'bangumi', 'mal', 'mangabaka']

/** The user's tracker hub: one login per platform plus every series binding
 * they created. Entirely per-user; admins see their own accounts here too. */
export function TrackersPage() {
  const { t } = useTranslation('trackers')
  useDocumentTitle(t('page.title'))
  const queryClient = useQueryClient()
  const [searchParams, setSearchParams] = useSearchParams()
  const [deleting, setDeleting] = useState<{
    seriesId: string
    provider: KomfOAuthProvider
  } | null>(null)

  // the OAuth callback lands here with ?oauth=...; acknowledge once and drop the query
  const oauthHandled = useRef(false)
  useEffect(() => {
    const oauth = searchParams.get('oauth')
    if (oauth === null || oauthHandled.current) return
    oauthHandled.current = true
    if (oauth === 'success') showToast(t('toast.loginSuccess'))
    else if (oauth === 'error') showToast(searchParams.get('message') || t('toast.loginError'))
    const next = new URLSearchParams(searchParams)
    next.delete('oauth')
    next.delete('message')
    setSearchParams(next, { replace: true })
    void queryClient.invalidateQueries({ queryKey: ['trackers', 'oauth'] })
  }, [searchParams, setSearchParams, queryClient, t])

  const linksQuery = useQuery({
    queryKey: trackerLinkKeys.all,
    queryFn: () => trackersApi.listLinks(),
    retry: false,
  })

  const deleteMutation = useMutation({
    mutationFn: (link: { seriesId: string; provider: KomfOAuthProvider }) =>
      trackersApi.deleteLink(link.seriesId, link.provider),
    onSuccess: () => {
      // the dialog is controlled solely by `deleting`: close it so the
      // delete action can't be repeated against an already-removed binding
      setDeleting(null)
      queryClient.invalidateQueries({ queryKey: trackerLinkKeys.all })
      showToast(t('toast.unlinked'))
    },
    onError: (e) => showToast(e instanceof Error ? e.message : t('toast.unlinkFailed')),
  })

  const links = linksQuery.data ?? []

  return (
    <div>
      <PageHeader title={t('page.title')} />
      <p className="mt-2 text-xs text-ink-3">{t('page.accountsHint')}</p>
      <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {PROVIDERS.map((provider) => (
          <ProviderCard key={provider} provider={provider} />
        ))}
      </div>

      <VisibilitySection />
      <TrackerBindings links={links} loading={linksQuery.isPending} onUnlink={setDeleting} />

      <ConfirmDeleteDialog
        open={!!deleting}
        onOpenChange={(open) => !open && setDeleting(null)}
        title={t('unlinkDialog.title')}
        name={deleting ? t('unlinkDialog.name', { provider: t(`provider.${deleting.provider}`) }) : ''}
        loading={deleteMutation.isPending}
        onConfirm={() => deleting && deleteMutation.mutate(deleting)}
      />
    </div>
  )
}

function VisibilitySection() {
  const { t } = useTranslation('trackers')
  const queryClient = useQueryClient()
  const librariesQuery = useQuery({ queryKey: ['libraries'], queryFn: librariesApi.list })
  const prefsQuery = useQuery({
    queryKey: trackerLinkKeys.preferences,
    queryFn: () => trackersApi.getPreferences(),
    retry: false,
  })
  const saveMutation = useMutation({
    mutationFn: (libraries: string[]) =>
      trackersApi.putPreferences({ libraries, defaultTracker: prefsQuery.data?.defaultTracker }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: trackerLinkKeys.preferences }),
    onError: (e) => showToast(e instanceof Error ? e.message : t('toast.visibilityFailed')),
  })
  const selected = new Set(prefsQuery.data?.libraries ?? [])
  const allIds = (librariesQuery.data ?? []).map((l) => l.id)
  const handleChange = (libraryId: string, nextChecked: boolean) => {
    // the PUT replaces the whole preferences object, so toggling before the
    // current values load would reset defaultTracker to empty
    if (!prefsQuery.data) return
    // empty list = unrestricted; the first explicit toggle materializes the
    // restriction list (turning one library off excludes just that one)
    const next =
      selected.size === 0
        ? nextChecked
          ? allIds
          : allIds.filter((id) => id !== libraryId)
        : nextChecked
          ? [...selected, libraryId]
          : [...selected].filter((id) => id !== libraryId)
    saveMutation.mutate(next)
  }
  return (
    <section className="mt-8">
      <h2 className="mb-1 font-display text-lg font-semibold text-ink">{t('page.visibilityHeading')}</h2>
      <p className="mb-3 text-xs text-ink-3">{t('page.visibilityHint')}</p>
      <ul className="flex flex-wrap gap-2">
        {(librariesQuery.data ?? []).map((library) => (
          <li key={library.id} className="flex items-center gap-2.5 rounded-lg border border-line bg-surface px-3 py-2">
            <span className="max-w-40 truncate text-sm text-ink">{library.name}</span>
            <Switch
              checked={selected.size === 0 || selected.has(library.id)}
              onCheckedChange={(on) => handleChange(library.id, on)}
              disabled={saveMutation.isPending || !prefsQuery.data}
              label={library.name}
            />
          </li>
        ))}
      </ul>
    </section>
  )
}

function ProviderCard({ provider }: { provider: KomfOAuthProvider }) {
  const { t } = useTranslation('trackers')
  const queryClient = useQueryClient()
  const statusQuery = useQuery({
    queryKey: ['trackers', 'oauth', provider],
    queryFn: () => trackersApi.oauthStatus(provider),
    retry: false,
  })
  const prefsQuery = useQuery({
    queryKey: trackerLinkKeys.preferences,
    queryFn: () => trackersApi.getPreferences(),
    retry: false,
  })
  const loggedIn = statusQuery.data?.logged_in ?? false
  const isDefault = prefsQuery.data?.defaultTracker === provider
  const defaultMutation = useMutation({
    mutationFn: (defaultTracker: KomfOAuthProvider | undefined) =>
      trackersApi.putPreferences({
        libraries: prefsQuery.data?.libraries ?? [],
        defaultTracker,
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: trackerLinkKeys.preferences }),
    onError: (e) => showToast(e instanceof Error ? e.message : t('toast.saveFailed')),
  })
  const logoutMutation = useMutation({
    mutationFn: () => trackersApi.oauthLogout(provider),
    onSuccess: () => {
      if (isDefault) defaultMutation.mutate(undefined)
      queryClient.invalidateQueries({ queryKey: ['trackers', 'oauth', provider] })
      queryClient.invalidateQueries({ queryKey: ['trackers', 'state'] })
      showToast(t('toast.loggedOut', { provider: t(`provider.${provider}`) }))
    },
    onError: (e) => showToast(e instanceof Error ? e.message : t('toast.logoutFailed')),
  })
  const toggleDefault = () => {
    if (!loggedIn || !prefsQuery.data) return
    defaultMutation.mutate(isDefault ? undefined : provider)
  }

  return (
    <div
      className={cn(
        'rounded-xl border bg-surface p-3 transition-colors',
        loggedIn && isDefault ? 'border-accent/50 bg-accent/5' : 'border-line',
      )}
    >
      <div className="flex items-center gap-2">
        <button
          type="button"
          disabled={!loggedIn || !prefsQuery.data || defaultMutation.isPending}
          aria-pressed={loggedIn && isDefault}
          aria-label={t('page.toggleDefault', { provider: t(`provider.${provider}`) })}
          onClick={toggleDefault}
          className="flex min-w-0 flex-1 cursor-pointer items-center gap-2.5 text-left disabled:cursor-default"
        >
          <TrackerLogo provider={provider} className="size-7 shrink-0" />
          <span className="min-w-0">
            <span className="flex items-center gap-1.5">
              <span className="truncate text-sm font-semibold text-ink">{t(`provider.${provider}`)}</span>
              {loggedIn && isDefault && (
                <span className="shrink-0 rounded bg-accent/10 px-1.5 py-0.5 text-[10px] font-medium text-accent-strong">
                  {t('page.defaultBadge')}
                </span>
              )}
            </span>
            <span className={cn('block truncate text-xs', !statusQuery.isPending && !loggedIn ? 'text-danger' : 'text-ink-3')}>
              {statusQuery.isPending
                ? t('state.loading')
                : loggedIn
                  ? (statusQuery.data?.username ?? t('page.connected'))
                  : t('page.notLoggedIn')}
            </span>
          </span>
        </button>
        {loggedIn && (
          <IconButton
            label={t('page.logout')}
            className="size-8"
            disabled={logoutMutation.isPending}
            onClick={() => logoutMutation.mutate()}
          >
            <SignOut className="size-4" />
          </IconButton>
        )}
      </div>
      {!statusQuery.isPending && !loggedIn && (
        <Button
          className="mt-3"
          variant="secondary"
          size="sm"
          // full browser navigation: the endpoint 302s into the OAuth flow
          onClick={() => window.location.assign(trackersApi.oauthStartUrl(provider))}
        >
          <ArrowSquareOut className="size-4" />
          {t('page.login')}
        </Button>
      )}
    </div>
  )
}
