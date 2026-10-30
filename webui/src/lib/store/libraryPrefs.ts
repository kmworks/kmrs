import { create } from 'zustand'
import { persist } from 'zustand/middleware'

interface LibraryPrefs {
  /** last sort per browse scope (e.g. "series:<libraryId>", "books:<libraryId>") */
  sort: Record<string, string>
  /** last filters per browse scope, as a URL query string without q/sort */
  filters: Record<string, string>
}

interface LibraryPrefsState extends LibraryPrefs {
  setSort: (scope: string, sort: string) => void
  setFilters: (scope: string, filters: string) => void
}

export const useLibraryPrefs = create<LibraryPrefsState>()(
  persist(
    (set) => ({
      sort: {},
      filters: {},
      setSort: (scope, sort) => set((s) => ({ sort: { ...s.sort, [scope]: sort } })),
      setFilters: (scope, filters) => set((s) => ({ filters: { ...s.filters, [scope]: filters } })),
    }),
    {
      name: 'kmweb.libraryPrefs',
      version: 1,
      // v1: book title sorts used to persist 'metadata.titleSort', which the books API never accepted
      migrate: (persisted) => {
        const state = persisted as LibraryPrefs
        return {
          ...state,
          sort: Object.fromEntries(
            Object.entries(state.sort ?? {}).map(([scope, value]) => [
              scope,
              scope.startsWith('books:') && value.startsWith('metadata.titleSort,')
                ? `metadata.title${value.slice('metadata.titleSort'.length)}`
                : value,
            ]),
          ),
        }
      },
    },
  ),
)
