import type { ReactNode } from 'react'
import { cn } from '@/lib/utils/cn'

export function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-2">
      <h3 className="px-1 text-xs font-medium text-ink-3">{title}</h3>
      {children}
    </section>
  )
}

/** A card of rows split by hairlines */
export function RowGroup({ children }: { children: ReactNode }) {
  return <div className="divide-y divide-line rounded-xl bg-raised px-3">{children}</div>
}

export function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-h-11 flex-wrap items-center justify-between gap-x-3 gap-y-2 py-2">
      <span className="text-[13px] text-ink">{label}</span>
      {children}
    </div>
  )
}

interface OptionTilesProps<T extends string> {
  options: Array<{ value: T; label: string; icon: ReactNode }>
  value: T
  onChange: (v: T) => void
  perRow: number
}

/** Tiles grow to fill their row, so a short last row stays flush with the panel edges */
export function OptionTiles<T extends string>({ options, value, onChange, perRow }: OptionTilesProps<T>) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map((opt) => {
        const selected = opt.value === value
        return (
          <button
            key={opt.value}
            type="button"
            aria-pressed={selected}
            onClick={() => onChange(opt.value)}
            style={{ flexBasis: `calc(${100 / perRow}% - 0.375rem)` }}
            className={cn(
              'flex min-w-0 grow cursor-pointer flex-col items-center gap-1 rounded-lg border px-1 py-2 text-center text-xs leading-tight transition-colors duration-150',
              selected
                ? 'border-accent/60 bg-accent-soft font-medium text-ink'
                : 'border-transparent bg-raised text-ink-2 hover:bg-overlay hover:text-ink',
            )}
          >
            <span className={cn('text-lg leading-none', selected && 'text-accent')}>{opt.icon}</span>
            {opt.label}
          </button>
        )
      })}
    </div>
  )
}
