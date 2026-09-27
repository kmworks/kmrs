import { useEffect, useState } from 'react'
import { keepPreviousData, useMutation, useQuery } from '@tanstack/react-query'
import { BookOpen, CircleNotch, MagnifyingGlass } from '@phosphor-icons/react'
import { komfApi } from '@/lib/api/komf'
import type { KomfSeriesSearchResult, SeriesDto } from '@/lib/api/types'
import { Dialog } from '@/components/ui/Dialog'
import { Button } from '@/components/ui/Button'
import { Skeleton } from '@/components/ui/Skeleton'
import { EmptyState } from '@/components/ui/EmptyState'
import { CoverImage } from '@/components/media/CoverImage'

interface KomfIdentifyDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  series: SeriesDto
  onIdentified: () => void
}

export function KomfIdentifyDialog({ open, onOpenChange, series, onIdentified }: KomfIdentifyDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="Identify with komf">
      {/* Dialog unmounts its children on close, so the search and mutation state
          restart fresh on every open */}
      <IdentifyContent series={series} onIdentified={onIdentified} close={() => onOpenChange(false)} />
    </Dialog>
  )
}

function IdentifyContent({
  series,
  onIdentified,
  close,
}: {
  series: SeriesDto
  onIdentified: () => void
  close: () => void
}) {
  const [text, setText] = useState(series.metadata.title || series.name)
  const [search, setSearch] = useState(text)

  useEffect(() => {
    const t = setTimeout(() => setSearch(text.trim()), 300)
    return () => clearTimeout(t)
  }, [text])

  const q = useQuery({
    queryKey: ['komf-search', series.id, search],
    queryFn: () => komfApi.search({ name: search, libraryId: series.libraryId, seriesId: series.id }),
    enabled: search.length > 0,
    placeholderData: keepPreviousData,
  })

  const identify = useMutation({
    mutationFn: (r: KomfSeriesSearchResult) =>
      komfApi.identify({
        libraryId: series.libraryId,
        seriesId: series.id,
        provider: r.provider,
        providerSeriesId: r.resultId,
      }),
    onSuccess: () => {
      close()
      onIdentified()
    },
  })

  const results = q.data ?? []
  const pendingKey =
    identify.isPending && identify.variables ? `${identify.variables.provider}:${identify.variables.resultId}` : null

  return (
    <>
      <div className="px-5 pt-4">
        <div className="relative">
          <MagnifyingGlass className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-3" />
          <input
            type="search"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Search komf providers…"
            autoFocus
            className="h-9 w-full rounded-lg border border-line bg-surface pr-3 pl-9 text-base text-ink transition-colors placeholder:text-ink-3 focus:border-accent/70 focus:outline-none"
          />
        </div>
      </div>
      <div className="min-h-72 px-5 py-4">
        {!search ? (
          <EmptyState title="Type a title to search komf" />
        ) : q.isPending ? (
          <div className="flex flex-col gap-2">
            {Array.from({ length: 5 }, (_, i) => (
              <div key={i} className="flex items-center gap-3 px-2 py-2">
                <Skeleton className="cover-aspect w-11 shrink-0" />
                <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                  <Skeleton className="h-3.5 w-3/5" />
                  <Skeleton className="h-3 w-2/5" />
                </div>
              </div>
            ))}
          </div>
        ) : q.isError ? (
          <EmptyState
            title="Could not search komf"
            body={q.error.message}
            action={
              <Button variant="secondary" onClick={() => q.refetch()}>
                Retry
              </Button>
            }
          />
        ) : results.length === 0 ? (
          <EmptyState title="No results" body="Try a different title." />
        ) : (
          <ul className="flex flex-col">
            {results.map((r) => {
              const key = `${r.provider}:${r.resultId}`
              const meta = [r.mediaType, r.language].filter(Boolean).join(' · ')
              return (
                <li key={key}>
                  <button
                    type="button"
                    disabled={identify.isPending}
                    onClick={() => identify.mutate(r)}
                    className="flex w-full cursor-pointer items-center gap-3 rounded-lg px-2 py-2 text-left transition-colors hover:bg-raised disabled:cursor-default disabled:opacity-60"
                  >
                    {r.imageUrl ? (
                      <CoverImage src={r.imageUrl} alt={r.title} className="w-11 shrink-0" />
                    ) : (
                      <div className="cover-aspect flex w-11 shrink-0 items-center justify-center rounded-lg bg-raised text-ink-3">
                        <BookOpen className="size-5" weight="duotone" />
                      </div>
                    )}
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-ink">{r.title}</span>
                      {meta && <span className="mt-0.5 block truncate text-xs text-ink-3">{meta}</span>}
                    </span>
                    {pendingKey === key ? (
                      <CircleNotch className="size-4 shrink-0 animate-spin text-ink-3" />
                    ) : (
                      <span className="shrink-0 rounded-full border border-line bg-raised px-2 py-0.5 text-[11px] font-medium text-ink-2">
                        {r.provider}
                      </span>
                    )}
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </div>
      {identify.isError && (
        <div className="border-t border-line px-5 py-3">
          <p className="text-sm text-danger">
            {identify.error instanceof Error ? identify.error.message : 'Could not queue the identify'}
          </p>
        </div>
      )}
    </>
  )
}
