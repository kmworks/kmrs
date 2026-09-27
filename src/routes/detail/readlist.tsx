import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { BookOpen, CircleNotch, DotsThreeVertical, EyeSlash, Image, ListChecks, PencilSimple, Plus, Trash } from '@phosphor-icons/react'
import { readlistsApi } from '@/lib/api/collections'
import type { ReadListDto } from '@/lib/api/types'
import { isAdmin, useAuthStore } from '@/lib/store/auth'
import { readRoute } from '@/lib/utils/nav'
import { plural } from '@/lib/utils/format'
import { Button } from '@/components/ui/Button'
import { BackButton } from '@/components/ui/BackButton'
import { Tooltip } from '@/components/ui/Tooltip'
import { Dialog } from '@/components/ui/Dialog'
import { IconButton } from '@/components/ui/IconButton'
import { Menu, MenuItem, MenuSeparator } from '@/components/ui/Menu'
import { TextField } from '@/components/ui/TextField'
import { EmptyState } from '@/components/ui/EmptyState'
import { PageHeader } from '@/components/ui/PageHeader'
import { Skeleton, GridSkeleton } from '@/components/ui/Skeleton'
import { MediaGrid } from '@/components/media/MediaGrid'
import { BookCard } from '@/components/media/BookCard'
import { DetailError } from '@/components/detail/DetailError'
import { ConfirmDeleteDialog } from '@/components/detail/ConfirmDeleteDialog'
import { OrderBadge } from '@/components/detail/OrderBadge'
import { ReadStatusFilterControl, type ReadStatusFilter } from '@/components/detail/ReadStatusFilter'
import { useSentinel } from '@/components/detail/useSentinel'
import { EditReadListBooks } from '@/components/readlists/EditReadListBooks'
import { BookPickerDialog } from '@/components/readlists/BookPickerDialog'
import { PosterManager } from '@/components/metadata/PosterManager'

const PAGE_SIZE = 48

function EditReadListDialog({
  open,
  onOpenChange,
  readlist,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  readlist: ReadListDto
}) {
  const [name, setName] = useState(readlist.name)
  const [summary, setSummary] = useState(readlist.summary)
  const queryClient = useQueryClient()

  useEffect(() => {
    if (open) {
      setName(readlist.name)
      setSummary(readlist.summary)
    }
  }, [open, readlist.name, readlist.summary])

  const mutation = useMutation({
    mutationFn: () => readlistsApi.update(readlist.id, { name: name.trim(), summary: summary.trim() }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['readlists'] })
      onOpenChange(false)
    },
  })

  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="Edit read list" size="sm">
      <form
        onSubmit={(e) => {
          e.preventDefault()
          if (name.trim()) mutation.mutate()
        }}
        className="space-y-4 px-5 py-4"
      >
        <TextField label="Name" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
        <div className="flex flex-col gap-2">
          <label htmlFor="readlist-summary" className="text-[13px] font-medium text-ink-2">
            Summary
          </label>
          <textarea
            id="readlist-summary"
            rows={3}
            value={summary}
            onChange={(e) => setSummary(e.target.value)}
            className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-base text-ink transition-colors placeholder:text-ink-3 focus:border-accent/70 focus:outline-none"
          />
        </div>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" loading={mutation.isPending} disabled={!name.trim()}>
            Save
          </Button>
        </div>
      </form>
    </Dialog>
  )
}

export function ReadListDetailPage() {
  const { readListId = '' } = useParams()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const admin = isAdmin(useAuthStore((s) => s.user))
  const [readStatus, setReadStatus] = useState<ReadStatusFilter>('ALL')
  const [editing, setEditing] = useState(false)
  const [editOpen, setEditOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [addBooksOpen, setAddBooksOpen] = useState(false)
  const [postersOpen, setPostersOpen] = useState(false)

  const readlistQuery = useQuery({
    queryKey: ['readlists', readListId],
    queryFn: () => readlistsApi.get(readListId),
  })
  const readlist = readlistQuery.data

  // First unread (or in-progress) book, falling back to the first book when fully read
  const continueQuery = useQuery({
    queryKey: ['readlists', readListId, 'continue-target'],
    queryFn: async () => {
      const unread = await readlistsApi.books(readListId, { readStatus: ['UNREAD', 'IN_PROGRESS'], size: 1 })
      if (unread.content[0]) return unread.content[0]
      const first = await readlistsApi.books(readListId, { size: 1 })
      return first.content[0] ?? null
    },
    enabled: !!readlist,
  })
  const booksQuery = useInfiniteQuery({
    queryKey: ['readlists', readListId, 'books', readStatus],
    queryFn: ({ pageParam }) =>
      readlistsApi.books(readListId, {
        page: pageParam,
        size: PAGE_SIZE,
        readStatus: readStatus === 'ALL' ? undefined : [readStatus],
      }),
    initialPageParam: 0,
    getNextPageParam: (last) => (last.last ? undefined : last.number + 1),
    enabled: !!readlist && !editing,
  })

  const deleteMutation = useMutation({
    mutationFn: () => readlistsApi.delete(readListId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['readlists'] })
      navigate('/readlists')
    },
  })

  const addBooksMutation = useMutation({
    mutationFn: (ids: string[]) => readlistsApi.update(readListId, { bookIds: [...(readlist?.bookIds ?? []), ...ids] }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['readlists'] })
      setAddBooksOpen(false)
    },
  })

  useEffect(() => {
    document.title = readlist ? `${readlist.name} · KMReader` : 'KMReader'
  }, [readlist])

  const sentinelRef = useSentinel(
    () => {
      if (booksQuery.hasNextPage && !booksQuery.isFetchingNextPage) booksQuery.fetchNextPage()
    },
    !!booksQuery.hasNextPage,
  )

  if (readlistQuery.isPending)
    return (
      <div>
        <Skeleton className="h-9 w-64" />
        <Skeleton className="mt-2 h-4 w-20" />
        <GridSkeleton className="mt-8" />
      </div>
    )
  if (readlistQuery.error)
    return (
      <DetailError error={readlistQuery.error} notFoundTitle="Read list not found" onRetry={() => readlistQuery.refetch()} />
    )
  if (!readlist) return null

  const books = booksQuery.data?.pages.flatMap((p) => p.content) ?? []
  const continueTarget = continueQuery.data
  const continueRoute = continueTarget ? readRoute(continueTarget) : null

  return (
    <div>
      <BackButton to="/readlists" className="mb-2 -ml-2" />
      <PageHeader
        title={readlist.name}
        subtitle={plural(readlist.bookIds.length, 'book')}
        actions={
          <>
            {!editing && (
              <>
                <Button
                  variant="primary"
                  size="sm"
                  disabled={!continueRoute}
                  loading={continueQuery.isPending}
                  onClick={() =>
                    continueRoute && navigate(`${continueRoute}?context=READLIST&contextId=${readlist.id}`)
                  }
                >
                  <BookOpen className="size-4" /> Continue
                </Button>
                <Tooltip content="Read without saving progress">
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={!continueRoute}
                    onClick={() =>
                      continueRoute && navigate(`${continueRoute}?context=READLIST&contextId=${readlist.id}&incognito=true`)
                    }
                  >
                    <EyeSlash className="size-4" /> Peek
                  </Button>
                </Tooltip>
              </>
            )}
            {admin && !editing && (
              <>
                <Button variant="secondary" size="sm" onClick={() => setAddBooksOpen(true)}>
                  <Plus className="size-4" /> Add books
                </Button>
                <Button variant="secondary" size="sm" onClick={() => setEditing(true)}>
                  <ListChecks className="size-4" /> Edit
                </Button>
                <Menu
                  trigger={
                    <IconButton label="More actions" className="size-8">
                      <DotsThreeVertical className="size-5" />
                    </IconButton>
                  }
                >
                  <MenuItem onSelect={() => setPostersOpen(true)}>
                    <Image className="size-4" /> Manage posters
                  </MenuItem>
                  <MenuItem onSelect={() => setEditOpen(true)}>
                    <PencilSimple className="size-4" /> Edit details
                  </MenuItem>
                  <MenuSeparator />
                  <MenuItem danger onSelect={() => setDeleteOpen(true)}>
                    <Trash className="size-4" /> Delete
                  </MenuItem>
                </Menu>
              </>
            )}
          </>
        }
      />

      {readlist.summary && <p className="-mt-3 mb-6 max-w-3xl text-sm text-ink-2">{readlist.summary}</p>}

      {editing ? (
        <EditReadListBooks readlist={readlist} onExit={() => setEditing(false)} />
      ) : (
        <>
          <div className="mb-4">
            <ReadStatusFilterControl value={readStatus} onChange={setReadStatus} />
          </div>

          {booksQuery.isPending ? (
            <GridSkeleton />
          ) : booksQuery.error ? (
            <EmptyState
              title="Could not load books"
              body={booksQuery.error.message}
              action={
                <Button variant="secondary" onClick={() => booksQuery.refetch()}>
                  Retry
                </Button>
              }
            />
          ) : books.length === 0 ? (
            <EmptyState
              title="No books"
              body={readStatus === 'ALL' ? 'This read list is empty.' : 'No books match this filter.'}
            />
          ) : (
            <MediaGrid>
              {books.map((b, i) => (
                <div key={b.id} className="relative">
                  <BookCard book={b} showSeries />
                  {readlist.ordered && <OrderBadge index={i + 1} />}
                </div>
              ))}
            </MediaGrid>
          )}
          <div ref={sentinelRef} />
          {booksQuery.isFetchingNextPage && (
            <div className="mt-6 flex justify-center">
              <CircleNotch className="size-5 animate-spin text-ink-3" />
            </div>
          )}
        </>
      )}

      <EditReadListDialog open={editOpen} onOpenChange={setEditOpen} readlist={readlist} />
      <ConfirmDeleteDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title="Delete read list"
        name={readlist.name}
        loading={deleteMutation.isPending}
        onConfirm={() => deleteMutation.mutate()}
      />
      <BookPickerDialog
        open={addBooksOpen}
        onOpenChange={setAddBooksOpen}
        title="Add books"
        confirmLabel="Add to read list"
        mode="multi"
        excludeIds={new Set(readlist.bookIds)}
        onConfirm={(selected) => addBooksMutation.mutate(selected.map((b) => b.id))}
        confirming={addBooksMutation.isPending}
        error={addBooksMutation.error?.message}
      />
      <PosterManager
        open={postersOpen}
        onClose={() => setPostersOpen(false)}
        kind="readlist"
        entityId={readlist.id}
        title={readlist.name}
      />
    </div>
  )
}
