import { keepPreviousData, useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { Trash } from '@phosphor-icons/react'
import { pageHashesApi } from '@/lib/api/pageHashes'
import type { PageHashMatchDto } from '@/lib/api/types'
import { urls } from '@/lib/utils/urls'
import { formatBytes, plural } from '@/lib/utils/format'
import { Button } from '@/components/ui/Button'
import { Dialog } from '@/components/ui/Dialog'
import { IconButton } from '@/components/ui/IconButton'
import { Skeleton } from '@/components/ui/Skeleton'
import { Sentinel } from '@/components/filters/Sentinel'

interface MatchesDialogProps {
  hash: string | null
  onOpenChange: (open: boolean) => void
}

function MatchCard({ hash, match }: { hash: string; match: PageHashMatchDto }) {
  const queryClient = useQueryClient()

  const remove = useMutation({
    mutationFn: () => pageHashesApi.deleteMatch(hash, match),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['admin', 'page-hashes'] })
    },
  })

  return (
    <figure className="group relative overflow-hidden rounded-lg border border-line bg-raised">
      <Link to={`/book/${match.bookId}`} className="block">
        <div
          className="h-36 w-full bg-cover bg-center"
          style={{ backgroundImage: `url(${urls.bookPage(match.bookId, match.pageNumber)})` }}
        />
      </Link>
      <figcaption className="flex items-center gap-2 px-2.5 py-2">
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs text-ink-2" title={match.fileName}>
            <Link to={`/book/${match.bookId}`} className="hover:text-accent-strong">
              {match.fileName}
            </Link>
          </p>
          <p className="text-[11px] text-ink-3">
            p.{match.pageNumber} · {formatBytes(match.fileSize)}
          </p>
        </div>
        <IconButton
          label="Delete this page from the book"
          className="size-8 text-danger hover:bg-danger/10"
          onClick={() => remove.mutate()}
          disabled={remove.isPending}
        >
          <Trash className="size-4" />
        </IconButton>
      </figcaption>
      {remove.isError && (
        <p className="px-2.5 pb-2 text-[11px] text-danger">
          {remove.error instanceof Error ? remove.error.message : 'Delete failed'}
        </p>
      )}
    </figure>
  )
}

export function MatchesDialog({ hash, onOpenChange }: MatchesDialogProps) {
  const q = useInfiniteQuery({
    queryKey: ['admin', 'page-hashes', 'matches', hash],
    queryFn: ({ pageParam }) => pageHashesApi.matches(hash!, { page: pageParam, size: 24 }),
    getNextPageParam: (last) => (last.last ? undefined : last.number + 1),
    initialPageParam: 0,
    enabled: !!hash,
    placeholderData: keepPreviousData,
  })

  const matches = q.data?.pages.flatMap((p) => p.content) ?? []

  return (
    <Dialog open={!!hash} onOpenChange={onOpenChange} title="Matching pages" size="lg">
      <div className="p-5">
        <p className="mb-4 truncate font-mono text-xs text-ink-3" title={hash ?? undefined}>
          {hash}
        </p>
        {q.isPending ? (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {Array.from({ length: 8 }, (_, i) => (
              <Skeleton key={i} className="h-44" />
            ))}
          </div>
        ) : q.isError ? (
          <div className="flex items-center gap-3">
            <p className="text-sm text-danger">
              {q.error instanceof Error ? q.error.message : 'Could not load matches.'}
            </p>
            <Button size="sm" onClick={() => void q.refetch()}>
              Try again
            </Button>
          </div>
        ) : matches.length === 0 ? (
          <p className="text-sm text-ink-3">No remaining matches for this hash.</p>
        ) : (
          <>
            <p className="mb-3 text-xs text-ink-3">{plural(q.data.pages[0].totalElements, 'match', 'matches')}</p>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
              {matches.map((m) => (
                <MatchCard key={`${m.bookId}:${m.pageNumber}`} hash={hash!} match={m} />
              ))}
            </div>
            <Sentinel
              active={!!q.hasNextPage && !q.isPlaceholderData}
              onIntersect={() => {
                if (q.hasNextPage && !q.isFetchingNextPage) void q.fetchNextPage()
              }}
            />
            {q.isFetchingNextPage && <Skeleton className="mt-3 h-8 w-full" />}
          </>
        )}
      </div>
    </Dialog>
  )
}
