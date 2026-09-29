import { Trans, useTranslation } from 'react-i18next'
import { Funnel, X } from '@phosphor-icons/react'
import { Button } from '@/components/ui/Button'
import { describeActiveFilters, parseAuthor, type ActiveFilterItem } from './filterUrl'
import { SortMenu } from './SortMenu'
import type { AuthorFilter, FilterGroupDef, FilterState, GroupKey, SortOption, SortState } from './types'

interface FilterBarProps {
  count?: number
  noun: 'books' | 'series'
  groups: FilterGroupDef[]
  state: FilterState
  activeCount: number
  onToggleValue: (key: GroupKey, value: string) => void
  onToggleAuthor: (author: AuthorFilter) => void
  onClearQ: () => void
  onOpenFilters: () => void
  sortOptions: SortOption[]
  sort: SortState
  onSortChange: (s: SortState) => void
}

function FilterChip({ label, onRemove }: { label: string; onRemove: () => void }) {
  const { t } = useTranslation('filters')
  return (
    <button
      type="button"
      onClick={onRemove}
      title={t('chip.remove', { label })}
      className="inline-flex max-w-56 cursor-pointer items-center gap-1 rounded-full border border-line bg-raised px-2.5 py-1 text-xs text-ink-2 transition-colors hover:border-line-strong hover:text-ink"
    >
      <span className="truncate">{label}</span>
      <X className="size-3 shrink-0 text-ink-3" />
    </button>
  )
}

export function FilterBar({
  count,
  noun,
  groups,
  state,
  activeCount,
  onToggleValue,
  onToggleAuthor,
  onClearQ,
  onOpenFilters,
  sortOptions,
  sort,
  onSortChange,
}: FilterBarProps) {
  const { t } = useTranslation('filters')
  const items = describeActiveFilters(state, groups)
  const remove = (item: ActiveFilterItem) => {
    if (item.group === 'q') onClearQ()
    else if (item.group === 'authors') onToggleAuthor(parseAuthor(item.value))
    else onToggleValue(item.group, item.value)
  }

  return (
    <div className="mb-5 flex flex-wrap items-center gap-x-3 gap-y-2">
      <span className="text-xs text-ink-3">
        {count !== undefined && (
          <Trans i18nKey={`filters:noun.${noun}`} count={count} components={{ num: <span className="font-mono" /> }} />
        )}
      </span>
      <div className="flex min-w-0 flex-1 flex-wrap items-center justify-end gap-2">
        {items.map((item) => (
          <FilterChip key={item.key} label={item.label} onRemove={() => remove(item)} />
        ))}
        <Button variant="secondary" size="sm" onClick={onOpenFilters}>
          <Funnel className="size-4" />
          {t('title')}
          {activeCount > 0 && (
            <span className="flex h-4 min-w-4 items-center justify-center rounded-full bg-accent px-1 font-mono text-[10px] font-semibold text-accent-ink">
              {activeCount}
            </span>
          )}
        </Button>
        <SortMenu options={sortOptions} value={sort} onChange={onSortChange} />
      </div>
    </div>
  )
}
