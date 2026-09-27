import { cn } from '@/lib/utils/cn'

interface TabBarProps<T extends string> {
  tabs: ReadonlyArray<{ id: T; label: string; hasError?: boolean }>
  active: T
  onChange: (id: T) => void
}

export function TabBar<T extends string>({ tabs, active, onChange }: TabBarProps<T>) {
  return (
    <div role="tablist" className="flex gap-1 overflow-x-auto border-b border-line">
      {tabs.map((tab) => {
        const selected = tab.id === active
        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={selected}
            onClick={() => onChange(tab.id)}
            className={cn(
              'relative cursor-pointer px-3 py-2 text-sm whitespace-nowrap transition-colors duration-150',
              selected ? 'font-medium text-ink' : 'text-ink-3 hover:text-ink-2',
            )}
          >
            {tab.label}
            {tab.hasError && (
              <span className="ml-1.5 inline-block size-1.5 rounded-full bg-danger align-middle" aria-hidden />
            )}
            {selected && <span className="absolute inset-x-3 -bottom-px h-0.5 bg-accent" />}
          </button>
        )
      })}
    </div>
  )
}
