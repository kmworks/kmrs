import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { ReaderSettings } from '@/lib/store/readerSettings'

/**
 * Settings a book can override without touching the global defaults.
 * Continuous-mode geometry, swipe, fullscreen and the EPUB typography stay
 * global-only.
 */
export const OVERRIDABLE_KEYS = [
  'readingDirection',
  'pageLayout',
  'scale',
  'splitWide',
  'stretchSmall',
  'tapZones',
  'animations',
  'pageTransition',
  'background',
  'filters',
] as const

export type OverridableKey = (typeof OVERRIDABLE_KEYS)[number]

export type ReaderOverride = Partial<Pick<ReaderSettings, OverridableKey>>

interface ReaderOverridesState {
  byBook: Record<string, ReaderOverride>
  /** merge a patch into a book's override; undefined values delete their key so the book follows the global default again */
  update: (bookId: string, patch: ReaderOverride) => void
  /** drop every override of one book */
  reset: (bookId: string) => void
}

export const useReaderOverrides = create<ReaderOverridesState>()(
  persist(
    (set) => ({
      byBook: {},
      update: (bookId, patch) =>
        set((s) => {
          const merged: ReaderOverride = { ...s.byBook[bookId] }
          for (const key of OVERRIDABLE_KEYS) {
            if (!(key in patch)) continue
            const value = patch[key]
            if (value === undefined) delete merged[key]
            else Object.assign(merged, { [key]: value })
          }
          const byBook = { ...s.byBook }
          if (Object.keys(merged).length === 0) delete byBook[bookId]
          else byBook[bookId] = merged
          return { byBook }
        }),
      reset: (bookId) =>
        set((s) => {
          if (!(bookId in s.byBook)) return s
          const byBook = { ...s.byBook }
          delete byBook[bookId]
          return { byBook }
        }),
    }),
    { name: 'kmweb.reader.overrides' },
  ),
)
