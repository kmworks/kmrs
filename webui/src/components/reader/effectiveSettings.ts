import { createContext, useContext, useMemo } from 'react'
import type { ReadingDirection } from '@/lib/api/types'
import { useResolvedBackground, useReaderSettings, type ResolvedReaderBackground } from '@/lib/store/readerSettings'
import { useReaderOverrides, type OverridableKey, type ReaderOverride } from '@/lib/store/readerOverrides'
import type { ReaderSettings } from '@/lib/store/readerSettings'
import { buildFilterString } from '@/lib/utils/readerFilters'

export type EffectiveReaderSettings = Pick<ReaderSettings, OverridableKey>

export interface EffectiveReaderSettingsValue {
  settings: EffectiveReaderSettings
  /** keys the current book overrides; drives the "custom settings" affordance in the panel */
  overriddenKeys: OverridableKey[]
  /** writes a per-book override; undefined values delete their key */
  update: (patch: ReaderOverride) => void
  resetOverrides: () => void
}

export const EffectiveReaderSettingsContext = createContext<EffectiveReaderSettingsValue | null>(null)

/**
 * Merges the global defaults with the current book's overrides. The reading
 * direction is the only three-level key: per-book override, then the series
 * metadata direction, then the global default.
 */
export function useEffectiveReaderSettings(
  bookId: string,
  metaDirection: ReadingDirection | null,
): EffectiveReaderSettingsValue {
  const override = useReaderOverrides((s) => s.byBook[bookId])
  const updateStore = useReaderOverrides((s) => s.update)
  const resetStore = useReaderOverrides((s) => s.reset)
  const globals = useReaderSettings()
  return useMemo<EffectiveReaderSettingsValue>(
    () => ({
      settings: {
        readingDirection: override?.readingDirection ?? metaDirection ?? globals.readingDirection,
        pageLayout: override?.pageLayout ?? globals.pageLayout,
        scale: override?.scale ?? globals.scale,
        splitWide: override?.splitWide ?? globals.splitWide,
        stretchSmall: override?.stretchSmall ?? globals.stretchSmall,
        tapZones: override?.tapZones ?? globals.tapZones,
        animations: override?.animations ?? globals.animations,
        pageTransition: override?.pageTransition ?? globals.pageTransition,
        background: override?.background ?? globals.background,
        filters: override?.filters ?? globals.filters,
      },
      overriddenKeys: (Object.keys(override ?? {}) as OverridableKey[]).filter((k) => override?.[k] !== undefined),
      update: (patch: ReaderOverride) => updateStore(bookId, patch),
      resetOverrides: () => resetStore(bookId),
    }),
    [override, metaDirection, globals, bookId, updateStore, resetStore],
  )
}

function useEffective(): EffectiveReaderSettingsValue {
  const ctx = useContext(EffectiveReaderSettingsContext)
  if (!ctx) throw new Error('reader effective settings used outside the reader route')
  return ctx
}

export function useEffectiveSettings(): EffectiveReaderSettings {
  return useEffective().settings
}

export function useEffectiveControls(): Pick<
  EffectiveReaderSettingsValue,
  'overriddenKeys' | 'update' | 'resetOverrides'
> {
  const { overriddenKeys, update, resetOverrides } = useEffective()
  return { overriddenKeys, update, resetOverrides }
}

/** Resolves the effective background, tracking AUTO against the app theme. */
export function useEffectiveBackground(): ResolvedReaderBackground {
  return useResolvedBackground(useEffectiveSettings().background)
}

export function useEffectivePageFilter(): string {
  const { filters } = useEffectiveSettings()
  return useMemo(() => buildFilterString(filters), [filters])
}
