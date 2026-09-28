import { Book, Check } from '@phosphor-icons/react'
import type { AuthorDto } from '@/lib/api/types'
import { primaryAuthor } from '@/lib/utils/authors'
import { cn } from '@/lib/utils/cn'

/** Capsule progress bar pinned to the bottom of a cover. */
export function ProgressCapsule({ value, className }: { value: number; className?: string }) {
  const pct = Math.max(0, Math.min(1, value))
  const show = pct > 0
  return (
    <div
      aria-hidden={!show}
      className={cn(
        'pointer-events-none absolute inset-x-1.5 bottom-1.5 h-1 rounded-full bg-black/45',
        'transition-[opacity,transform] duration-300 ease-out-expo',
        show ? 'opacity-100' : 'translate-y-0.5 opacity-0',
        className,
      )}
    >
      <div
        className="h-full rounded-full bg-accent transition-[width] duration-300"
        style={{ width: `${Math.max(pct * 100, 4)}%` }}
      />
    </div>
  )
}

/** Checkmark marking a completed book; flush with the cover corner like the series UnreadBadge. */
export function CompletedBadge({ show = true, className }: { show?: boolean; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        'pointer-events-none absolute top-0 right-0 flex origin-top-right items-center justify-center p-[3px]',
        'rounded-tr-lg rounded-bl-lg bg-black/80 text-white',
        'transition-[opacity,transform] duration-200 ease-out-expo',
        show ? 'scale-100 opacity-100' : 'scale-50 opacity-0',
        className,
      )}
    >
      <Check className="size-2.5" weight="bold" />
    </span>
  )
}

/** Unread-count badge, flush with the cover's top-right corner. */
export function UnreadBadge({ count, className }: { count: number; className?: string }) {
  const show = count > 0
  return (
    <span
      aria-hidden={!show}
      className={cn(
        'pointer-events-none absolute top-0 right-0 flex h-5.5 min-w-5.5 origin-top-right items-center justify-center px-1.5',
        'rounded-tr-lg rounded-bl-lg bg-black/80 text-[11px] font-semibold text-white tabular-nums',
        'transition-[opacity,transform] duration-200 ease-out-expo',
        show ? 'scale-100 opacity-100' : 'scale-50 opacity-0',
        className,
      )}
    >
      {/* keyed so a count change replays the pop */}
      <span key={count} className="animate-badge-pop">
        {count > 99 ? '99+' : count}
      </span>
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
