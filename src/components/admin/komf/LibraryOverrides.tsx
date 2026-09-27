import { useState } from 'react'
import { CaretRight } from '@phosphor-icons/react'
import type { KomfConfig, LibraryDto } from '@/lib/api/types'
import { Button } from '@/components/ui/Button'
import { Chip } from '@/components/ui/Chip'
import { Dialog } from '@/components/ui/Dialog'
import { Switch } from '@/components/ui/Switch'
import {
  processingDraftFromConfig,
  providersDraftFromMap,
  type KomfProviderKey,
  type ProcessingDraft,
  type ProvidersDraft,
} from './draft'
import { FormRow } from './FormRow'
import { ProcessingFields } from './ProcessingFields'
import { ProvidersFields } from './ProvidersFields'

interface LibraryOverrideRowProps {
  library: LibraryDto
  processing: ProcessingDraft | undefined
  processingSeed: ProcessingDraft
  providers: ProvidersDraft | undefined
  providersSeed: ProvidersDraft
  providerErrors: Partial<Record<KomfProviderKey, string>> | undefined
  onProcessingChange: (v: ProcessingDraft | undefined) => void
  onProvidersChange: (v: ProvidersDraft | undefined) => void
}

function LibraryOverrideRow({
  library,
  processing,
  processingSeed,
  providers,
  providersSeed,
  providerErrors,
  onProcessingChange,
  onProvidersChange,
}: LibraryOverrideRowProps) {
  const [open, setOpen] = useState(false)
  const hasProviderErrors = providerErrors !== undefined && Object.keys(providerErrors).length > 0

  return (
    <>
      <button
        type="button"
        aria-haspopup="dialog"
        onClick={() => setOpen(true)}
        className="flex w-full cursor-pointer items-center gap-2 rounded-lg border border-line px-3 py-2.5 text-left transition-colors duration-150 hover:bg-raised"
      >
        <span className="min-w-0 flex-1 truncate text-sm font-medium text-ink">{library.name}</span>
        {processing && <Chip className="shrink-0 px-2 py-0.5">Metadata update</Chip>}
        {providers && <Chip className="shrink-0 px-2 py-0.5">Providers</Chip>}
        {hasProviderErrors && <span className="size-1.5 shrink-0 rounded-full bg-danger" aria-hidden />}
        <CaretRight className="size-3.5 shrink-0 text-ink-3" />
      </button>
      <Dialog open={open} onOpenChange={setOpen} title={library.name} size="lg">
        <div className="px-5 py-4">
          <FormRow label="Override metadata update" helper="Off inherits the global metadata update settings.">
            <Switch
              checked={!!processing}
              onCheckedChange={(on) => onProcessingChange(on ? processingSeed : undefined)}
              label={`Override metadata update for ${library.name}`}
            />
          </FormRow>
          {processing && (
            <div className="mb-2 border-t border-line pt-4">
              <ProcessingFields value={processing} onChange={onProcessingChange} />
            </div>
          )}
          <FormRow label="Override providers" helper="Off inherits the global provider settings.">
            <Switch
              checked={!!providers}
              onCheckedChange={(on) => onProvidersChange(on ? providersSeed : undefined)}
              label={`Override providers for ${library.name}`}
            />
          </FormRow>
          {providers && (
            <div className="border-t border-line pt-4">
              <ProvidersFields value={providers} onChange={onProvidersChange} errors={providerErrors} />
            </div>
          )}
        </div>
        <div className="flex items-center justify-between gap-3 border-t border-line px-5 py-3.5">
          <p className="text-xs text-ink-3">
            Changes join the page&apos;s unsaved changes — save from the bar at the bottom.
          </p>
          <Button variant="primary" className="shrink-0" onClick={() => setOpen(false)}>
            Done
          </Button>
        </div>
      </Dialog>
    </>
  )
}

interface LibraryOverridesProps {
  libraries: LibraryDto[]
  config: KomfConfig
  processing: Record<string, ProcessingDraft>
  providers: Record<string, ProvidersDraft>
  providerErrors: Record<string, Partial<Record<KomfProviderKey, string>>>
  onProcessingChange: (libId: string, v: ProcessingDraft | undefined) => void
  onProvidersChange: (libId: string, v: ProvidersDraft | undefined) => void
}

export function LibraryOverrides({
  libraries,
  config,
  processing,
  providers,
  providerErrors,
  onProcessingChange,
  onProvidersChange,
}: LibraryOverridesProps) {
  return (
    <div className="flex flex-col gap-2">
      {libraries.map((lib) => (
        <LibraryOverrideRow
          key={lib.id}
          library={lib}
          processing={processing[lib.id]}
          // komf seeds a new metadata-update override from the current global default
          processingSeed={processing[lib.id] ?? processingDraftFromConfig(config.komga.metadataUpdate.default)}
          providers={providers[lib.id]}
          // komf seeds a new provider override from its own built-ins, so send the
          // global defaults instead to end up with "global defaults + admin's edit"
          providersSeed={providers[lib.id] ?? providersDraftFromMap(config.metadataProviders.defaultProviders)}
          providerErrors={providerErrors[lib.id]}
          onProcessingChange={(v) => onProcessingChange(lib.id, v)}
          onProvidersChange={(v) => onProvidersChange(lib.id, v)}
        />
      ))}
    </div>
  )
}
