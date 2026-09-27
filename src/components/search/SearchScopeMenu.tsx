import { useQuery } from '@tanstack/react-query'
import { BookBookmark, Books, CaretDown, Check, PushPin } from '@phosphor-icons/react'
import { librariesApi } from '@/lib/api/libraries'
import { usePinnedLibraries } from '@/lib/store/clientSettings'
import { Button } from '@/components/ui/Button'
import { Menu, MenuItem, MenuSeparator } from '@/components/ui/Menu'

interface SearchScopeMenuProps {
  /** 'all' | 'pinned' | a library id */
  value: string
  onChange: (value: string) => void
}

export function SearchScopeMenu({ value, onChange }: SearchScopeMenuProps) {
  const { data: libraries } = useQuery({ queryKey: ['libraries'], queryFn: librariesApi.list })
  const { pinned } = usePinnedLibraries()

  // pinned libraries float to the top, same as the sidebar
  const pinnedIndex = new Map((pinned ?? []).map((id, i) => [id, i]))
  const pinRank = (id: string) => pinnedIndex.get(id) ?? Number.MAX_SAFE_INTEGER
  const sorted = libraries?.slice().sort((a, b) => pinRank(a.id) - pinRank(b.id))
  const hasPinned = (pinned?.length ?? 0) > 0
  const current = value !== 'all' && value !== 'pinned' ? libraries?.find((l) => l.id === value) : undefined

  return (
    <Menu
      trigger={
        <Button variant="secondary" size="sm">
          {value === 'pinned' ? (
            <PushPin weight="fill" className="size-4" />
          ) : value === 'all' ? (
            <Books className="size-4" />
          ) : (
            <BookBookmark className="size-4" />
          )}
          {value === 'all' ? 'All libraries' : value === 'pinned' ? 'Pinned libraries' : (current?.name ?? 'Library')}
          <CaretDown className="size-3.5 text-ink-3" />
        </Button>
      }
    >
      <MenuItem onSelect={() => onChange('all')}>
        <span className="flex-1">All libraries</span>
        {value === 'all' && <Check className="size-4 text-accent" />}
      </MenuItem>
      {hasPinned && (
        <MenuItem onSelect={() => onChange('pinned')}>
          <PushPin weight="fill" className="size-3.5 text-ink-3" />
          <span className="flex-1">Pinned libraries</span>
          {value === 'pinned' && <Check className="size-4 text-accent" />}
        </MenuItem>
      )}
      {sorted && sorted.length > 0 && <MenuSeparator />}
      {sorted?.map((l) => (
        <MenuItem key={l.id} onSelect={() => onChange(l.id)}>
          <span className="flex-1 truncate">{l.name}</span>
          {pinnedIndex.has(l.id) && <PushPin weight="fill" className="size-3 shrink-0 text-ink-3" />}
          {value === l.id && <Check className="size-4 text-accent" />}
        </MenuItem>
      ))}
    </Menu>
  )
}
