import { Book, Check } from '@phosphor-icons/react'
import type { AuthorDto } from '@/lib/api/types'
import { primaryAuthor } from '@/lib/utils/authors'
import { cn } from '@/lib/utils/cn'

/** Capsule progress bar pinned to the bottom of a cover. */
export function ProgressCapsule({ value, className }: { value: number; className?: string }) {
  const pct = Math.max(0, Math.min(1, value))
  if (pct <= 0) return null
  return (
    <div className={cn('pointer-events-none absolute inset-x-1.5 bottom-1.5 h-1 rounded-full bg-black/45', className)}>
      <div
        className="h-full rounded-full bg-accent transition-[width] duration-300"
        style={{ width: `${Math.max(pct * 100, 4)}%` }}
      />
    </div>
  )
}

/** Checkmark marking a completed book; flush with the cover corner like the series UnreadBadge. */
export function CompletedBadge({ className }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        'pointer-events-none absolute top-0 right-0 flex items-center justify-center p-[3px]',
        'rounded-tr-lg rounded-bl-lg bg-black/80 text-white',
        className,
      )}
    >
      <Check className="size-2.5" weight="bold" />
    </span>
  )
}

/** Unread-count badge, flush with the cover's top-right corner. */
export function UnreadBadge({ count, className }: { count: number; className?: string }) {
  if (count <= 0) return null
  return (
    <span
      className={cn(
        'pointer-events-none absolute top-0 right-0 flex h-5.5 min-w-5.5 items-center justify-center px-1.5',
        'rounded-tr-lg rounded-bl-lg bg-black/80 text-[11px] font-semibold text-white tabular-nums',
        className,
      )}
    >
      {count > 99 ? '99+' : count}
    </span>
  )
}

/** Oneshot marker for card text lines: a single-book icon (vs. the Books stack of
    series) followed by the primary author, so the line carries useful info instead
    of just the "Oneshot" label. Render as a fragment so the caller controls layout. */
export function OneshotLine({ authors }: { authors: AuthorDto[] }) {
  return (
    <>
      <Book className="size-3 shrink-0" />
      {primaryAuthor(authors)?.name ?? 'Oneshot'}
    </>
  )
}
