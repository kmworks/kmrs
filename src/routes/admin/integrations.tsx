import { useEffect, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ApiError } from '@/lib/api/client'
import { komfApi } from '@/lib/api/komf'
import type { KomfIntegrationDto, KomfIntegrationState } from '@/lib/api/types'
import { cn } from '@/lib/utils/cn'
import { Section } from '@/components/account/Section'
import { Button } from '@/components/ui/Button'
import { Dialog } from '@/components/ui/Dialog'
import { PageHeader } from '@/components/ui/PageHeader'
import { Skeleton } from '@/components/ui/Skeleton'
import { TextField } from '@/components/ui/TextField'

const STATE_PILL: Record<KomfIntegrationState, { label: string; className: string }> = {
  connected: { label: 'Connected', className: 'border-accent/40 bg-accent-soft text-accent-strong' },
  pending: { label: 'Pending', className: 'border-line bg-raised text-ink-2' },
  error: { label: 'Error', className: 'border-danger/40 bg-danger/10 text-danger' },
}

function Pill({ className, children }: { className: string; children: ReactNode }) {
  return (
    <span className={cn('inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium', className)}>
      {children}
    </span>
  )
}

interface ViolationMessage {
  field: string
  message: string
}

function violationMessages(err: unknown): ViolationMessage[] {
  if (!(err instanceof ApiError)) return []
  const body = err.body as { violations?: { fieldName?: unknown; message?: unknown }[] } | undefined
  if (!body || !Array.isArray(body.violations)) return []
  return body.violations
    .filter((v) => typeof v?.message === 'string')
    .map((v) => ({ field: typeof v.fieldName === 'string' ? v.fieldName : '', message: v.message as string }))
}

function IntegrationForm({ integration }: { integration: KomfIntegrationDto }) {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const [url, setUrl] = useState(integration.url ?? '')
  const [baseUrl, setBaseUrl] = useState(integration.baseUrl ?? window.location.origin)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [editing, setEditing] = useState(false)

  // structural sharing keeps the reference stable across refetches, so in-progress edits survive
  useEffect(() => {
    setUrl(integration.url ?? '')
    setBaseUrl(integration.baseUrl ?? window.location.origin)
  }, [integration])

  const invalidate = () => void queryClient.invalidateQueries({ queryKey: ['admin', 'komf-integration'] })

  const connect = useMutation({
    mutationFn: () => komfApi.updateIntegration({ url: url.trim(), baseUrl: baseUrl.trim() }),
    onSuccess: () => {
      setEditing(false)
      invalidate()
    },
  })
  const disconnect = useMutation({
    mutationFn: komfApi.disconnect,
    onSuccess: () => {
      setConfirmOpen(false)
      setEditing(false)
      invalidate()
    },
  })

  const cancelEdit = () => {
    setUrl(integration.url ?? '')
    setBaseUrl(integration.baseUrl ?? window.location.origin)
    setEditing(false)
    connect.reset()
  }

  // a configured integration shows its saved values read-only; Edit unlocks them so a
  // changed URL goes through Reconnect (re-provision) instead of a destructive disconnect
  const locked = integration.configured && !editing

  const violations = connect.error ? violationMessages(connect.error) : []
  const violationFor = (field: string) => violations.find((v) => v.field === field)?.message
  const otherViolations = violations.filter((v) => v.field !== 'url' && v.field !== 'baseUrl')
  const connectError =
    connect.error && violations.length === 0
      ? connect.error instanceof Error
        ? connect.error.message
        : 'Could not connect to komf.'
      : null

  return (
    <div className="space-y-6">
      <Section title="komf">
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center gap-2">
            {integration.configured && integration.state ? (
              <Pill className={STATE_PILL[integration.state].className}>{STATE_PILL[integration.state].label}</Pill>
            ) : (
              <Pill className="border-line bg-raised text-ink-2">Not configured</Pill>
            )}
            {integration.configured && (
              <Pill
                className={
                  integration.komfReachable
                    ? 'border-accent/40 bg-accent-soft text-accent-strong'
                    : 'border-danger/40 bg-danger/10 text-danger'
                }
              >
                {integration.komfReachable ? 'komf reachable' : 'komf unreachable'}
              </Pill>
            )}
          </div>
          {integration.lastError && <p className="text-sm text-danger">{integration.lastError}</p>}
          <TextField
            label="komf URL"
            helper="Address of the komf server."
            placeholder="http://komf:8085"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            error={violationFor('url')}
            disabled={locked}
          />
          <TextField
            label="kmrs base URL"
            helper="Address komf uses to call back into kmrs."
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
            error={violationFor('baseUrl')}
            disabled={locked}
          />
          <div className="flex items-center gap-2">
            {locked ? (
              <Button variant="primary" onClick={() => setEditing(true)}>
                Edit
              </Button>
            ) : (
              <Button variant="primary" loading={connect.isPending} onClick={() => connect.mutate()}>
                {integration.configured ? 'Reconnect' : 'Connect'}
              </Button>
            )}
            {integration.state === 'connected' && (
              <Button variant="secondary" onClick={() => navigate('/admin/integrations/komf')}>
                Configure
              </Button>
            )}
            {editing && integration.configured && (
              <Button variant="ghost" onClick={cancelEdit}>
                Cancel
              </Button>
            )}
            {integration.configured && (
              <Button variant="danger" onClick={() => setConfirmOpen(true)}>
                Disconnect
              </Button>
            )}
          </div>
          {otherViolations.map((v, i) => (
            <p key={i} className="text-sm text-danger">
              {v.field ? `${v.field}: ${v.message}` : v.message}
            </p>
          ))}
          {connectError && <p className="text-sm text-danger">{connectError}</p>}
          {disconnect.isError && (
            <p className="text-sm text-danger">
              {disconnect.error instanceof Error ? disconnect.error.message : 'Could not disconnect.'}
            </p>
          )}
        </div>
      </Section>

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen} title="Disconnect komf" size="sm">
        <div className="px-5 py-4">
          <p className="text-sm text-ink-2">
            Disconnect komf? The stored connection and its API key are removed, and komf stops receiving metadata
            requests.
          </p>
        </div>
        <div className="flex justify-end gap-2 border-t border-line px-5 py-3.5">
          <Button variant="ghost" onClick={() => setConfirmOpen(false)}>
            Cancel
          </Button>
          <Button variant="danger" loading={disconnect.isPending} onClick={() => disconnect.mutate()}>
            Disconnect
          </Button>
        </div>
      </Dialog>
    </div>
  )
}

export function AdminIntegrationsPage() {
  const query = useQuery({ queryKey: ['admin', 'komf-integration'], queryFn: komfApi.getIntegration })

  useEffect(() => {
    document.title = 'Integrations · KMReader'
  }, [])

  return (
    <div className="max-w-3xl">
      <PageHeader title="Integrations" subtitle="External services connected to this server" />
      {query.isLoading && (
        <div className="space-y-6">
          <Skeleton className="h-72 w-full rounded-xl" />
        </div>
      )}
      {query.isError && (
        <div className="flex items-center gap-3 rounded-xl border border-line bg-surface p-5">
          <p className="text-sm text-danger">
            {query.error instanceof Error ? query.error.message : 'Could not load integrations.'}
          </p>
          <Button size="sm" onClick={() => void query.refetch()}>
            Try again
          </Button>
        </div>
      )}
      {query.data && <IntegrationForm integration={query.data} />}
    </div>
  )
}
