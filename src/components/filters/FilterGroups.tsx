import { useMemo, useState, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { X } from '@phosphor-icons/react'
import { referentialApi } from '@/lib/api/referential'
import { Skeleton } from '@/components/ui/Skeleton'
import { SegmentedControl } from '@/components/ui/SegmentedControl'
import { cn } from '@/lib/utils/cn'
import { useDebouncedValue } from './useDebouncedValue'
import { LETTERS, type AuthorFilter, type FilterGroupDef, type FilterState, type GroupKey, type GroupMode, type ReferentialKind } from './types'

const MODE_OPTIONS: { value: GroupMode; labelKey: string }[] = [
  { value: 'any', labelKey: 'filters:mode.any' },
  { value: 'all', labelKey: 'filters:mode.all' },
]

const GROUP_SEARCH_THRESHOLD = 40

function OptionChip({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'inline-flex cursor-pointer items-center gap-1 rounded-full border px-2.5 py-1 text-xs transition-colors',
        active
          ? 'border-accent/50 bg-accent-soft text-accent-strong'
          : 'border-line bg-raised text-ink-2 hover:border-line-strong hover:text-ink',
      )}
    >
      {children}
    </button>
  )
}

function GroupSearchInput({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) {
  return (
    <input
      type="search"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className="mb-2 h-8 w-full rounded-lg border border-line bg-surface px-2.5 text-base text-ink transition-colors placeholder:text-ink-3 focus:border-accent/70 focus:outline-none"
    />
  )
}

function LoadingChips() {
  return (
    <div className="flex flex-wrap gap-1.5">
      <Skeleton className="h-6 w-16 rounded-full" />
      <Skeleton className="h-6 w-24 rounded-full" />
      <Skeleton className="h-6 w-20 rounded-full" />
    </div>
  )
}

function LoadError({ onRetry }: { onRetry: () => void }) {
  const { t } = useTranslation('filters')
  return (
    <p className="text-xs text-ink-3">
      {t('options.loadError')}{' '}
      <button type="button" onClick={onRetry} className="cursor-pointer text-accent-strong hover:underline">
        {t('common:action.retry')}
      </button>
    </p>
  )
}

function fetchReferential(kind: ReferentialKind, libraryId?: string): Promise<string[]> {
  const lib = libraryId ? [libraryId] : undefined
  switch (kind) {
    case 'publishers':
      return referentialApi.publishers({ libraryId: lib })
    case 'genres':
      return referentialApi.genres({ libraryId: lib })
    case 'seriesTags':
      return referentialApi.seriesTags({ libraryId: lib })
    case 'bookTags':
      return referentialApi.bookTags({ libraryId: lib })
    case 'sharingLabels':
      return referentialApi.sharingLabels({ libraryId: lib })
    case 'ageRatings':
      return referentialApi.ageRatings({ libraryId: lib })
    case 'languages':
      return referentialApi.languages({ libraryId: lib })
    case 'releaseDates':
      return referentialApi.releaseDates({ libraryId: lib })
  }
}

function sortReferential(kind: ReferentialKind, values: string[], locale: string): string[] {
  const arr = [...values]
  if (kind === 'releaseDates') return arr.sort((a, b) => Number(b) - Number(a))
  if (kind === 'ageRatings')
    return arr.sort((a, b) => {
      const na = Number(a)
      const nb = Number(b)
      if (!Number.isNaN(na) && !Number.isNaN(nb)) return na - nb
      return a.localeCompare(b, locale)
    })
  return arr.sort((a, b) => a.localeCompare(b, locale))
}

function ReferentialOptions({
  kind,
  libraryId,
  selected,
  enabled,
  onToggle,
}: {
  kind: ReferentialKind
  libraryId?: string
  selected: string[]
  enabled: boolean
  onToggle: (value: string) => void
}) {
  const [filter, setFilter] = useState('')
  const { t, i18n } = useTranslation('filters')
  const query = useQuery({
    queryKey: ['referential', kind, libraryId ?? 'all'],
    queryFn: () => fetchReferential(kind, libraryId),
    enabled,
    staleTime: 60_000,
  })

  const options = useMemo(() => sortReferential(kind, query.data ?? [], i18n.language), [kind, query.data, i18n.language])
  const visible = useMemo(() => {
    const f = filter.trim().toLowerCase()
    // selected values stay visible so they can be deselected while filtering
    return options.filter((o) => selected.includes(o) || !f || o.toLowerCase().includes(f))
  }, [options, filter, selected])

  if (query.isPending) return <LoadingChips />
  if (query.isError) return <LoadError onRetry={() => query.refetch()} />

  return (
    <div>
      {options.length > GROUP_SEARCH_THRESHOLD && (
        <GroupSearchInput value={filter} onChange={setFilter} placeholder={t('options.filterPlaceholder')} />
      )}
      {visible.length === 0 ? (
        <p className="text-xs text-ink-3">{t('options.noMatch')}</p>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {visible.map((o) => (
            <OptionChip key={o} active={selected.includes(o)} onClick={() => onToggle(o)}>
              {o}
            </OptionChip>
          ))}
        </div>
      )}
    </div>
  )
}

const AUTHOR_RESULTS_LIMIT = 60

function LetterOptions({ selected, onSelect }: { selected: string[]; onSelect: (letter: string) => void }) {
  const active = selected[0]
  return (
    <div className="flex flex-wrap gap-1">
      {[...LETTERS, '#'].map((l) => (
        <button
          key={l}
          type="button"
          onClick={() => onSelect(l)}
          aria-pressed={active === l}
          className={cn(
            'size-7 cursor-pointer rounded-md font-mono text-xs transition-colors',
            active === l ? 'bg-accent-soft text-accent-strong' : 'text-ink-3 hover:bg-raised hover:text-ink',
          )}
        >
          {l}
        </button>
      ))}
    </div>
  )
}

function AuthorsOptions({
  libraryId,
  selected,
  enabled,
  onToggle,
}: {
  libraryId?: string
  selected: AuthorFilter[]
  enabled: boolean
  onToggle: (author: AuthorFilter) => void
}) {
  const [text, setText] = useState('')
  const { t } = useTranslation('filters')
  const debounced = useDebouncedValue(text, 300)
  const query = useQuery({
    queryKey: ['referential', 'authors', libraryId ?? 'all', debounced],
    queryFn: () => referentialApi.authors({ libraryId, search: debounced.trim() || undefined }),
    enabled,
    staleTime: 30_000,
  })

  const results = (query.data ?? []).filter((a) => !selected.some((s) => s.name === a.name && s.role === a.role))
  const shown = results.slice(0, AUTHOR_RESULTS_LIMIT)

  return (
    <div>
      {selected.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-1.5">
          {selected.map((a) => (
            <OptionChip key={`${a.name},${a.role}`} active onClick={() => onToggle(a)}>
              {a.role ? `${a.name} (${a.role})` : a.name}
              <X className="size-3" />
            </OptionChip>
          ))}
        </div>
      )}
      <GroupSearchInput value={text} onChange={setText} placeholder={t('authors.searchPlaceholder')} />
      {query.isPending ? (
        <LoadingChips />
      ) : query.isError ? (
        <LoadError onRetry={() => query.refetch()} />
      ) : shown.length === 0 ? (
        <p className="text-xs text-ink-3">{t('authors.noMatch')}</p>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {shown.map((a) => (
            <OptionChip key={`${a.name},${a.role}`} active={false} onClick={() => onToggle({ name: a.name, role: a.role })}>
              {a.role ? `${a.name} (${a.role})` : a.name}
            </OptionChip>
          ))}
          {results.length > shown.length && (
            <span className="self-center text-xs text-ink-3">{t('authors.moreHint')}</span>
          )}
        </div>
      )}
    </div>
  )
}

interface FilterGroupSectionProps {
  def: FilterGroupDef
  state: FilterState
  libraryId?: string
  enabled: boolean
  onToggleValue: (key: GroupKey, value: string) => void
  onToggleAuthor: (author: AuthorFilter) => void
  onSetMode: (key: GroupKey, mode: GroupMode) => void
  onSetNegated: (key: GroupKey, negated: boolean) => void
  onSetExclusive: (key: GroupKey, value: string) => void
}

const NEGATE_OPTIONS: { value: 'is' | 'isNot'; labelKey: string }[] = [
  { value: 'is', labelKey: 'filters:negate.is' },
  { value: 'isNot', labelKey: 'filters:negate.isNot' },
]

export function FilterGroupSection({
  def,
  state,
  libraryId,
  enabled,
  onToggleValue,
  onToggleAuthor,
  onSetMode,
  onSetNegated,
  onSetExclusive,
}: FilterGroupSectionProps) {
  const { t } = useTranslation('filters')
  const values = def.kind === 'authors' ? [] : (state[def.key] as string[])
  const selectedCount = def.kind === 'authors' ? state.authors.length : values.length
  const mode: GroupMode = state.matchAll.includes(def.key) ? 'all' : 'any'
  const negated = state.exclude.includes(def.key)

  return (
    <section className="border-b border-line py-4 last:border-b-0">
      <div className="mb-2.5 flex flex-wrap items-center justify-between gap-x-2 gap-y-1.5">
        <h3 className="text-[11px] font-medium tracking-[0.08em] text-ink-3 uppercase">{t(def.labelKey)}</h3>
        <div className="flex items-center gap-1.5">
          {def.negatable && selectedCount >= 1 && (
            <SegmentedControl
              size="sm"
              options={NEGATE_OPTIONS.map((o) => ({ value: o.value, label: t(o.labelKey) }))}
              value={negated ? 'isNot' : 'is'}
              onChange={(m) => onSetNegated(def.key, m === 'isNot')}
            />
          )}
          {selectedCount >= 2 && (
            <SegmentedControl
              size="sm"
              options={MODE_OPTIONS.map((o) => ({ value: o.value, label: t(o.labelKey) }))}
              value={mode}
              onChange={(m) => onSetMode(def.key, m)}
            />
          )}
        </div>
      </div>
      {def.kind === 'enum' && def.options && (
        <div className="flex flex-wrap gap-1.5">
          {def.options.map((o) => (
            <OptionChip key={o.value} active={values.includes(o.value)} onClick={() => onToggleValue(def.key, o.value)}>
              {t(o.labelKey)}
            </OptionChip>
          ))}
        </div>
      )}
      {def.kind === 'referential' && def.referential && (
        <ReferentialOptions
          kind={def.referential}
          libraryId={libraryId}
          selected={values}
          enabled={enabled}
          onToggle={(v) => onToggleValue(def.key, v)}
        />
      )}
      {def.kind === 'letters' && <LetterOptions selected={values} onSelect={(l) => onSetExclusive(def.key, l)} />}
      {def.kind === 'authors' && (
        <AuthorsOptions libraryId={libraryId} selected={state.authors} enabled={enabled} onToggle={onToggleAuthor} />
      )}
    </section>
  )
}
