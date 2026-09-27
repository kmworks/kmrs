import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { AnimatePresence, motion } from 'motion/react'
import { CaretRight } from '@phosphor-icons/react'
import { komfApi } from '@/lib/api/komf'
import type { KomfConfig, KomfConfigPatch, KomfNameMatchingMode, LibraryDto } from '@/lib/api/types'
import { cn } from '@/lib/utils/cn'
import { plural } from '@/lib/utils/format'
import { Section } from '@/components/account/Section'
import { Button } from '@/components/ui/Button'
import { Chip } from '@/components/ui/Chip'
import { SegmentedControl } from '@/components/ui/SegmentedControl'
import { Switch } from '@/components/ui/Switch'
import { TextField } from '@/components/ui/TextField'
import {
  countChanges,
  computeChanges,
  draftFromConfig,
  hasErrors,
  processingDraftFromConfig,
  providersDraftFromMap,
  validateDraft,
  type KomfConfigDraft,
  type KomfProviderKey,
  type ProcessingDraft,
  type ProvidersDraft,
} from './draft'
import { FormRow } from './FormRow'
import { NotificationsFields } from './NotificationsFields'
import { ProcessingFields } from './ProcessingFields'
import { ProvidersFields } from './ProvidersFields'
import { SelectInput, StringListInput } from './fields'

const NAME_MATCHING_OPTIONS: Array<{ value: KomfNameMatchingMode; label: string }> = [
  { value: 'CLOSEST_MATCH', label: 'Closest match' },
  { value: 'EXACT', label: 'Exact' },
]

const COMICVINE_ID_FORMAT_OPTIONS: Array<{ value: string; label: string }> = [
  { value: '', label: 'No override' },
  { value: 'SERIES', label: 'Series' },
  { value: 'VOLUME', label: 'Volume' },
  { value: 'ISSUE', label: 'Issue' },
]

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
  const overridden = !!processing || !!providers

  return (
    <div className="rounded-lg border border-line">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full cursor-pointer items-center gap-2 px-3 py-2.5 text-left"
      >
        <CaretRight className={cn('size-3.5 shrink-0 text-ink-3 transition-transform duration-150', open && 'rotate-90')} />
        <span className="min-w-0 flex-1 truncate text-sm font-medium text-ink">{library.name}</span>
        {overridden && <Chip className="px-2 py-0.5">Overridden</Chip>}
      </button>
      {open && (
        <div className="border-t border-line px-3 pb-3">
          <FormRow label="Override metadata update">
            <Switch
              checked={!!processing}
              onCheckedChange={(on) => onProcessingChange(on ? processingSeed : undefined)}
              label={`Override metadata update for ${library.name}`}
            />
          </FormRow>
          {processing && (
            <div className="mb-2 rounded-lg border border-line px-3">
              <ProcessingFields value={processing} onChange={onProcessingChange} />
            </div>
          )}
          <FormRow label="Override providers">
            <Switch
              checked={!!providers}
              onCheckedChange={(on) => onProvidersChange(on ? providersSeed : undefined)}
              label={`Override providers for ${library.name}`}
            />
          </FormRow>
          {providers && (
            <div className="rounded-lg border border-line px-3">
              <ProvidersFields value={providers} onChange={onProvidersChange} errors={providerErrors} />
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export function KomfConfigForm({ config, libraries }: { config: KomfConfig; libraries: LibraryDto[] }) {
  const queryClient = useQueryClient()
  const [draft, setDraft] = useState<KomfConfigDraft>(() => draftFromConfig(config))

  // structural sharing keeps the reference stable unless values actually changed (e.g. after save)
  useEffect(() => {
    setDraft(draftFromConfig(config))
  }, [config])

  const changes = useMemo(() => computeChanges(config, draft), [config, draft])
  const errors = useMemo(() => validateDraft(draft), [draft])
  const dirtyCount = countChanges(changes)
  const invalid = hasErrors(errors)

  const save = useMutation({
    mutationFn: (body: KomfConfigPatch) => komfApi.patchConfig(body),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['admin', 'komf-config'] }),
  })

  const discard = () => {
    setDraft(draftFromConfig(config))
    save.reset()
  }

  const sortedLibraries = useMemo(() => libraries.slice().sort((a, b) => a.name.localeCompare(b.name)), [libraries])

  const toggleFilterLibrary = (id: string, on: boolean) =>
    setDraft((d) => ({
      ...d,
      eventListenerLibraryFilter: on
        ? [...d.eventListenerLibraryFilter, id]
        : d.eventListenerLibraryFilter.filter((x) => x !== id),
    }))

  const toggleNotifyLibrary = (id: string, on: boolean) =>
    setDraft((d) => ({
      ...d,
      notificationsLibraryFilter: on
        ? [...d.notificationsLibraryFilter, id]
        : d.notificationsLibraryFilter.filter((x) => x !== id),
    }))

  const setLibraryProcessing = (id: string, v: ProcessingDraft | undefined) =>
    setDraft((d) => {
      const next = { ...d.libraryProcessing }
      if (v) next[id] = v
      else delete next[id]
      return { ...d, libraryProcessing: next }
    })

  const setLibraryProviders = (id: string, v: ProvidersDraft | undefined) =>
    setDraft((d) => {
      const next = { ...d.libraryProviders }
      if (v) next[id] = v
      else delete next[id]
      return { ...d, libraryProviders: next }
    })

  return (
    <div className="space-y-6">
      <Section title="Event listener">
        <FormRow label="Enabled">
          <Switch
            checked={draft.eventListenerEnabled}
            onCheckedChange={(v) => setDraft((d) => ({ ...d, eventListenerEnabled: v }))}
            label="Event listener"
          />
        </FormRow>
        <div className="pt-3">
          <p className="text-sm text-ink-2">Libraries</p>
          <p className="mt-0.5 text-xs text-ink-3">Only listen to selected libraries. Select none to listen to all.</p>
          <div className="mt-2 grid gap-1.5 sm:grid-cols-2">
            {sortedLibraries.map((lib) => (
              <label key={lib.id} className="flex cursor-pointer items-center gap-2 text-sm text-ink-2">
                <input
                  type="checkbox"
                  checked={draft.eventListenerLibraryFilter.includes(lib.id)}
                  onChange={(e) => toggleFilterLibrary(lib.id, e.target.checked)}
                  className="size-4 shrink-0 cursor-pointer accent-accent"
                />
                <span className="truncate">{lib.name}</span>
              </label>
            ))}
          </div>
        </div>
        <div className="pt-3">
          <p className="text-sm text-ink-2">Excluded series</p>
          <p className="mt-0.5 text-xs text-ink-3">
            Series IDs to skip during automatic metadata updates, one per line.
          </p>
          <div className="mt-2">
            <StringListInput
              aria-label="Excluded series"
              value={draft.eventListenerSeriesExcludeFilter}
              onChange={(v) => setDraft((d) => ({ ...d, eventListenerSeriesExcludeFilter: v }))}
            />
          </div>
        </div>
      </Section>

      <Section title="Providers">
        <ProvidersFields
          value={draft.defaultProviders}
          onChange={(v) => setDraft((d) => ({ ...d, defaultProviders: v }))}
          errors={errors.defaultProviders}
        />
        <FormRow label="Name matching">
          <SegmentedControl
            options={NAME_MATCHING_OPTIONS}
            value={draft.nameMatchingMode}
            onChange={(v) => setDraft((d) => ({ ...d, nameMatchingMode: v }))}
          />
        </FormRow>
        <div className="flex flex-col gap-4 border-t border-line pt-4">
          <TextField
            label="MAL client ID"
            helper="Empty clears the configured value."
            value={draft.malClientId}
            onChange={(e) => setDraft((d) => ({ ...d, malClientId: e.target.value }))}
          />
          <TextField
            label="ComicVine API key"
            helper="Empty clears the configured value."
            value={draft.comicVineApiKey}
            onChange={(e) => setDraft((d) => ({ ...d, comicVineApiKey: e.target.value }))}
          />
          <TextField
            label="ComicVine search limit"
            helper="Maximum number of ComicVine search results. Empty clears the configured value."
            inputMode="numeric"
            value={draft.comicVineSearchLimit}
            onChange={(e) => setDraft((d) => ({ ...d, comicVineSearchLimit: e.target.value }))}
            error={errors.comicVineSearchLimit}
          />
          <TextField
            label="ComicVine issue name"
            helper="Empty clears the configured value."
            value={draft.comicVineIssueName}
            onChange={(e) => setDraft((d) => ({ ...d, comicVineIssueName: e.target.value }))}
          />
          <div className="flex flex-col gap-2">
            <p className="text-[13px] font-medium text-ink-2">ComicVine ID format</p>
            <SelectInput
              aria-label="ComicVine ID format"
              className="h-10 w-full"
              options={COMICVINE_ID_FORMAT_OPTIONS}
              value={draft.comicVineIdFormat}
              onChange={(v) => setDraft((d) => ({ ...d, comicVineIdFormat: v }))}
            />
          </div>
          <TextField
            label="Bangumi token"
            helper="Empty clears the configured value."
            value={draft.bangumiToken}
            onChange={(e) => setDraft((d) => ({ ...d, bangumiToken: e.target.value }))}
          />
        </div>
      </Section>

      <Section title="Metadata update">
        <ProcessingFields
          value={draft.defaultProcessing}
          onChange={(v) => setDraft((d) => ({ ...d, defaultProcessing: v }))}
        />
      </Section>

      <Section title="Notifications">
        <NotificationsFields
          value={draft.notifications}
          onChange={(v) => setDraft((d) => ({ ...d, notifications: v }))}
        />
        <div className="pt-3">
          <p className="text-sm text-ink-2">Notify for libraries</p>
          <p className="mt-0.5 text-xs text-ink-3">
            Only send notifications for selected libraries. Select none to notify for all.
          </p>
          <div className="mt-2 grid gap-1.5 sm:grid-cols-2">
            {sortedLibraries.map((lib) => (
              <label key={lib.id} className="flex cursor-pointer items-center gap-2 text-sm text-ink-2">
                <input
                  type="checkbox"
                  checked={draft.notificationsLibraryFilter.includes(lib.id)}
                  onChange={(e) => toggleNotifyLibrary(lib.id, e.target.checked)}
                  className="size-4 shrink-0 cursor-pointer accent-accent"
                />
                <span className="truncate">{lib.name}</span>
              </label>
            ))}
          </div>
        </div>
      </Section>

      <Section title="Library overrides">
        <div className="flex flex-col gap-2">
          {sortedLibraries.map((lib) => (
            <LibraryOverrideRow
              key={lib.id}
              library={lib}
              processing={draft.libraryProcessing[lib.id]}
              // komf seeds a new metadata-update override from the current global default
              processingSeed={
                draft.libraryProcessing[lib.id] ?? processingDraftFromConfig(config.komga.metadataUpdate.default)
              }
              providers={draft.libraryProviders[lib.id]}
              // komf seeds a new provider override from its own built-ins, so send the
              // global defaults instead to end up with "global defaults + admin's edit"
              providersSeed={
                draft.libraryProviders[lib.id] ?? providersDraftFromMap(config.metadataProviders.defaultProviders)
              }
              providerErrors={errors.libraryProviders[lib.id]}
              onProcessingChange={(v) => setLibraryProcessing(lib.id, v)}
              onProvidersChange={(v) => setLibraryProviders(lib.id, v)}
            />
          ))}
        </div>
      </Section>

      {dirtyCount > 0 && <div className="h-16" aria-hidden />}

      <AnimatePresence>
        {dirtyCount > 0 && (
          <div className="pointer-events-none fixed inset-x-0 bottom-6 z-20 flex justify-center px-4">
            <motion.div
              initial={{ opacity: 0, y: 24 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 24 }}
              transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
              className="pointer-events-auto flex w-full max-w-lg flex-col gap-1.5 rounded-xl border border-line bg-overlay px-4 py-3 shadow-pop"
            >
              <div className="flex items-center gap-3">
                <span className="flex-1 text-sm text-ink-2">{plural(dirtyCount, 'unsaved change')}</span>
                <Button size="sm" variant="ghost" onClick={discard} disabled={save.isPending}>
                  Discard
                </Button>
                <Button
                  size="sm"
                  variant="primary"
                  loading={save.isPending}
                  disabled={invalid}
                  onClick={() => save.mutate(changes)}
                >
                  Save
                </Button>
              </div>
              {invalid && <p className="text-xs text-ink-3">Fix the invalid fields above to save.</p>}
              {errors.messages.map((m) => (
                <p key={m} className="text-xs text-danger">
                  {m}
                </p>
              ))}
              {save.isError && (
                <p className="text-xs text-danger">
                  {save.error instanceof Error ? save.error.message : 'Could not save configuration.'}
                </p>
              )}
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  )
}
