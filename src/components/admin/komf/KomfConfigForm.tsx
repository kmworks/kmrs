import { useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { AnimatePresence, motion } from 'motion/react'
import { komfApi } from '@/lib/api/komf'
import type { KomfConfig, KomfConfigPatch, KomfNameMatchingMode, LibraryDto } from '@/lib/api/types'
import { plural } from '@/lib/utils/format'
import { Section } from '@/components/account/Section'
import { Button } from '@/components/ui/Button'
import { SegmentedControl } from '@/components/ui/SegmentedControl'
import {
  countChanges,
  computeChanges,
  draftFromConfig,
  hasErrors,
  validateDraft,
  type KomfConfigDraft,
  type ProcessingDraft,
  type ProvidersDraft,
} from './draft'
import { EventListenerFields } from './EventListenerFields'
import { LibraryOverrides } from './LibraryOverrides'
import { NotificationsFields } from './NotificationsFields'
import {
  ChineseConversionFields,
  MylarFields,
  PostProcessingFields,
  ProcessingGeneralFields,
  SearchTitleExtractionFields,
} from './ProcessingFields'
import { ProviderCredentialsFields } from './ProviderCredentialsFields'
import { ProvidersFields } from './ProvidersFields'
import { TabBar } from './TabBar'
import { FormRow } from './FormRow'

const NAME_MATCHING_OPTIONS: Array<{ value: KomfNameMatchingMode; label: string }> = [
  { value: 'CLOSEST_MATCH', label: 'Closest match' },
  { value: 'EXACT', label: 'Exact' },
]

const KOMF_TAB_IDS = ['providers', 'metadata', 'listener', 'notifications', 'overrides'] as const
type KomfTabId = (typeof KOMF_TAB_IDS)[number]

const KOMF_TABS: ReadonlyArray<{ id: KomfTabId; label: string }> = [
  { id: 'providers', label: 'Providers' },
  { id: 'metadata', label: 'Metadata update' },
  { id: 'listener', label: 'Listener' },
  { id: 'notifications', label: 'Notifications' },
  { id: 'overrides', label: 'Overrides' },
]

function tabFromParam(param: string | null): KomfTabId {
  return (KOMF_TAB_IDS as readonly string[]).includes(param ?? '') ? (param as KomfTabId) : 'providers'
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

  const patch = (p: Partial<KomfConfigDraft>) => setDraft((d) => ({ ...d, ...p }))

  const toggleNotifyLibrary = (id: string, on: boolean) =>
    patch({
      notificationsLibraryFilter: on
        ? [...draft.notificationsLibraryFilter, id]
        : draft.notificationsLibraryFilter.filter((x) => x !== id),
    })

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

  const [searchParams, setSearchParams] = useSearchParams()
  const tab = tabFromParam(searchParams.get('tab'))
  const tabBarRef = useRef<HTMLDivElement>(null)
  const tabBarTop = useRef<number | null>(null)

  useEffect(() => {
    const el = tabBarRef.current
    if (el) tabBarTop.current = el.getBoundingClientRect().top + window.scrollY
  }, [])

  const setTab = (id: KomfTabId) => {
    if (id === tab) return
    const next = new URLSearchParams(searchParams)
    next.set('tab', id)
    setSearchParams(next)
    // after the swap the new tab can be shorter than the scroll position; pull back to the pinned bar
    if (tabBarTop.current !== null) {
      const target = tabBarTop.current - 60
      if (window.scrollY > target) window.scrollTo({ top: target })
    }
  }

  const tabErrors: Record<KomfTabId, boolean> = {
    providers: errors.comicVineSearchLimit !== undefined || Object.keys(errors.defaultProviders).length > 0,
    metadata: errors.defaultProcessingMessages.length > 0,
    listener: false,
    notifications: false,
    overrides: Object.keys(errors.libraryProviders).length > 0 || errors.libraryProcessingMessages.length > 0,
  }

  const setProcessing = (v: ProcessingDraft) => patch({ defaultProcessing: v })

  return (
    <div className="space-y-6">
      <div ref={tabBarRef} className="sticky top-15 z-10 bg-bg/80 backdrop-blur-md">
        <TabBar tabs={KOMF_TABS.map((t) => ({ ...t, hasError: tabErrors[t.id] }))} active={tab} onChange={setTab} />
      </div>

      {tab === 'providers' && (
        <>
          <Section title="Providers">
            <ProvidersFields
              value={draft.defaultProviders}
              onChange={(v) => patch({ defaultProviders: v })}
              errors={errors.defaultProviders}
            />
            <FormRow label="Name matching">
              <SegmentedControl
                options={NAME_MATCHING_OPTIONS}
                value={draft.nameMatchingMode}
                onChange={(v) => patch({ nameMatchingMode: v })}
              />
            </FormRow>
          </Section>
          <Section title="Provider credentials">
            <ProviderCredentialsFields value={draft} onChange={patch} searchLimitError={errors.comicVineSearchLimit} />
          </Section>
        </>
      )}

      {tab === 'metadata' && (
        <>
          <Section title="General">
            <div>
              <ProcessingGeneralFields value={draft.defaultProcessing} onChange={setProcessing} />
            </div>
          </Section>
          <Section title="Post-processing">
            <div>
              <PostProcessingFields value={draft.defaultProcessing} onChange={setProcessing} />
            </div>
          </Section>
          <Section title="Search title extraction">
            <div>
              <SearchTitleExtractionFields value={draft.defaultProcessing} onChange={setProcessing} />
            </div>
          </Section>
          <Section title="Chinese conversion">
            <div>
              <ChineseConversionFields value={draft.defaultProcessing} onChange={setProcessing} />
            </div>
          </Section>
          <Section title="Mylar">
            <div>
              <MylarFields value={draft.defaultProcessing} onChange={setProcessing} />
            </div>
          </Section>
        </>
      )}

      {tab === 'listener' && (
        <Section title="Event listener">
          <EventListenerFields value={draft} libraries={sortedLibraries} onChange={patch} />
        </Section>
      )}

      {tab === 'notifications' && (
        <Section title="Notifications">
          <NotificationsFields value={draft.notifications} onChange={(v) => patch({ notifications: v })} />
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
      )}

      {tab === 'overrides' && (
        <Section title="Library overrides">
          <LibraryOverrides
            libraries={sortedLibraries}
            config={config}
            processing={draft.libraryProcessing}
            providers={draft.libraryProviders}
            providerErrors={errors.libraryProviders}
            onProcessingChange={setLibraryProcessing}
            onProvidersChange={setLibraryProviders}
          />
        </Section>
      )}

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
