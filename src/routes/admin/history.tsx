import { useEffect, useMemo, useState } from 'react'
import { keepPreviousData, useInfiniteQuery } from '@tanstack/react-query'
import { Check, ClockCounterClockwise, Funnel, WarningCircle } from '@phosphor-icons/react'
import { historyApi } from '@/lib/api/history'
import type { HistoricalEventDto, HistoricalEventType } from '@/lib/api/types'
import { cn } from '@/lib/utils/cn'
import { plural, relativeTime } from '@/lib/utils/format'
import { Button } from '@/components/ui/Button'
import { Chip } from '@/components/ui/Chip'
import { EmptyState } from '@/components/ui/EmptyState'
import { Menu, MenuItem } from '@/components/ui/Menu'
import { PageHeader } from '@/components/ui/PageHeader'
import { Skeleton } from '@/components/ui/Skeleton'
import { Sentinel } from '@/components/filters/Sentinel'

const EVENT_TYPES: Array<{ value: HistoricalEventType; label: string; badge: string }> = [
  { value: 'BookFileDeleted', label: 'Book file deleted', badge: 'border-red-500/40 bg-red-500/10 text-red-500' },
  { value: 'SeriesFolderDeleted', label: 'Series folder deleted', badge: 'border-amber-500/40 bg-amber-500/10 text-amber-500' },
  { value: 'BookConverted', label: 'Book converted', badge: 'border-sky-500/40 bg-sky-500/10 text-sky-500' },
  { value: 'BookImported', label: 'Book imported', badge: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-500' },
  { value: 'DuplicatePageDeleted', label: 'Duplicate page deleted', badge: 'border-violet-500/40 bg-violet-500/10 text-violet-500' },
  { value: 'BookTrashed', label: 'Book trashed', badge: 'border-orange-500/40 bg-orange-500/10 text-orange-500' },
  { value: 'SeriesTrashed', label: 'Series trashed', badge: 'border-yellow-500/40 bg-yellow-500/10 text-yellow-500' },
  { value: 'BookPurged', label: 'Book purged', badge: 'border-rose-500/40 bg-rose-500/10 text-rose-500' },
  { value: 'SeriesPurged', label: 'Series purged', badge: 'border-pink-500/40 bg-pink-500/10 text-pink-500' },
]

const typeMeta = (t: string) => EVENT_TYPES.find((e) => e.value === t)

function baseName(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).pop() ?? path
}

function Row({ event }: { event: HistoricalEventDto }) {
  const meta = typeMeta(event.type)
  const { name, ...rest } = event.properties
  const extra = Object.entries(rest)

  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-4 py-3">
      <span
        className={cn(
          'inline-flex shrink-0 items-center rounded-full border px-2 py-0.5 text-[11px] font-medium',
          meta?.badge ?? 'border-line bg-raised text-ink-2',
        )}
      >
        {meta?.label ?? event.type}
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm text-ink" title={name}>
          {name ? baseName(name) : '(no file recorded)'}
        </p>
        {extra.length > 0 && (
          <p className="mt-0.5 truncate text-xs text-ink-3" title={extra.map(([k, v]) => `${k}: ${v}`).join('\n')}>
            {extra.map(([k, v]) => `${k}: ${k === 'hash' ? `${v.slice(0, 12)}…` : v}`).join(' · ')}
          </p>
        )}
      </div>
      {event.seriesId && (
        <Chip to={`/series/${event.seriesId}`} className="px-2 py-0.5 text-[11px]">
          Series
        </Chip>
      )}
      {event.bookId && (
        <Chip to={`/book/${event.bookId}`} className="px-2 py-0.5 text-[11px]">
          Book
        </Chip>
      )}
      <span className="shrink-0 text-xs whitespace-nowrap text-ink-3" title={new Date(event.timestamp).toLocaleString()}>
        {relativeTime(event.timestamp)}
      </span>
    </li>
  )
}

export function AdminHistoryPage() {
  const [typeFilter, setTypeFilter] = useState<HistoricalEventType | null>(null)

  useEffect(() => {
    document.title = 'History · KMReader'
  }, [])

  const q = useInfiniteQuery({
    queryKey: ['admin', 'history'],
    queryFn: ({ pageParam }) => historyApi.list({ page: pageParam, size: 100 }),
    getNextPageParam: (last) => (last.last ? undefined : last.number + 1),
    initialPageParam: 0,
    placeholderData: keepPreviousData,
  })

  const all = useMemo(() => q.data?.pages.flatMap((p) => p.content) ?? [], [q.data])
  // the API has no type parameter, so filtering happens on the loaded pages
  const items = useMemo(() => (typeFilter ? all.filter((e) => e.type === typeFilter) : all), [all, typeFilter])

  return (
    <div className="max-w-5xl">
      <PageHeader
        title="History"
        subtitle="File deletions, trash activity, conversions and imports"
        actions={
          <Menu
            trigger={
              <Button variant="secondary" size="sm">
                <Funnel className="size-4" />
                {typeFilter ? (typeMeta(typeFilter)?.label ?? typeFilter) : 'All types'}
              </Button>
            }
          >
            <MenuItem onSelect={() => setTypeFilter(null)}>
              <span className="flex-1">All types</span>
              {typeFilter === null && <Check className="size-4 text-accent" />}
            </MenuItem>
            {EVENT_TYPES.map((t) => (
              <MenuItem key={t.value} onSelect={() => setTypeFilter(t.value)}>
                <span className="flex-1">{t.label}</span>
                {typeFilter === t.value && <Check className="size-4 text-accent" />}
              </MenuItem>
            ))}
          </Menu>
        }
      />

      {q.isPending ? (
        <div className="flex flex-col gap-2.5">
          {Array.from({ length: 8 }, (_, i) => (
            <Skeleton key={i} className="h-12 w-full" />
          ))}
        </div>
      ) : q.isError ? (
        <EmptyState
          icon={<WarningCircle />}
          title="Couldn't load history"
          body={q.error instanceof Error ? q.error.message : 'Something went wrong.'}
          action={<Button onClick={() => q.refetch()}>Retry</Button>}
        />
      ) : items.length === 0 && !q.hasNextPage ? (
        <EmptyState
          icon={<ClockCounterClockwise />}
          title={typeFilter ? 'No events of this type' : 'No history yet'}
          body={
            typeFilter
              ? 'Nothing matching this filter has been recorded.'
              : 'File deletions, trash activity, conversions and imports will be recorded here.'
          }
        />
      ) : (
        <>
          <ul className="flex flex-col divide-y divide-line rounded-xl border border-line bg-surface">
            {items.map((e) => (
              <Row key={e.id} event={e} />
            ))}
          </ul>
          {items.length === 0 && typeFilter && (
            <p className="py-6 text-center text-sm text-ink-3">
              Looking for {typeMeta(typeFilter)?.label ?? 'matching'} events in older pages…
            </p>
          )}
          <Sentinel
            active={!!q.hasNextPage && !q.isPlaceholderData}
            onIntersect={() => {
              if (q.hasNextPage && !q.isFetchingNextPage) void q.fetchNextPage()
            }}
          />
          {q.isFetchingNextPage && <Skeleton className="mt-3 h-10 w-full" />}
          {!q.hasNextPage && all.length > 0 && (
            <p className="mt-4 text-center text-xs text-ink-3">{plural(all.length, 'event')} recorded</p>
          )}
        </>
      )}
    </div>
  )
}
