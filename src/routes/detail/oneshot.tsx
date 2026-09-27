import { useEffect, useState, type ReactNode } from 'react'
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  ArrowSquareOut,
  ArrowsClockwise,
  BookmarkSimple,
  BookOpen,
  Checks,
  Circle,
  DotsThreeVertical,
  EyeSlash,
  FileMagnifyingGlass,
  ImageSquare,
  PencilSimple,
  PlugsConnected,
  Plus,
  Sparkle,
  Trash,
} from '@phosphor-icons/react'
import { booksApi } from '@/lib/api/books'
import { librariesApi } from '@/lib/api/libraries'
import { seriesApi } from '@/lib/api/series'
import { komfApi } from '@/lib/api/komf'
import { canDownload, isAdmin, useAuthStore } from '@/lib/store/auth'
import { useKomfIntegration } from '@/lib/hooks/useKomfIntegration'
import { useBust } from '@/lib/store/thumbnails'
import { urls } from '@/lib/utils/urls'
import { readRoute } from '@/lib/utils/nav'
import { mediaIssue } from '@/lib/utils/mediaStatus'
import { formatBytes, formatDate, relativeTime } from '@/lib/utils/format'
import { cn } from '@/lib/utils/cn'
import { Button } from '@/components/ui/Button'
import { IconButton } from '@/components/ui/IconButton'
import { Tooltip } from '@/components/ui/Tooltip'
import { BackButton } from '@/components/ui/BackButton'
import { Menu, MenuItem, MenuSeparator } from '@/components/ui/Menu'
import { EmptyState } from '@/components/ui/EmptyState'
import { CoverImage } from '@/components/media/CoverImage'
import { CollectionCard, ReadListCard } from '@/components/media/SeriesCard'
import { HorizontalRow } from '@/components/media/HorizontalRow'
import { useDensityCardWidth } from '@/lib/store/ui'
import { DetailHero } from '@/components/detail/DetailHero'
import { DetailSkeleton } from '@/components/detail/DetailSkeleton'
import { DetailError } from '@/components/detail/DetailError'
import { DetailChipFlow } from '@/components/detail/DetailChipFlow'
import { SeriesMetaLine } from '@/components/detail/SeriesMetaLine'
import { creatorChipItems, genreChipItems, sharingLabelChipItems, tagChipItems } from '@/components/detail/metadataChips'
import { Summary } from '@/components/detail/Summary'
import { DownloadLink } from '@/components/detail/DownloadLink'
import { AddToReadListDialog } from '@/components/detail/AddToReadListDialog'
import { NewCollectionDialog } from '@/components/detail/NewCollectionDialog'
import { ConfirmDeleteDialog } from '@/components/detail/ConfirmDeleteDialog'
import { EditSeriesDialog } from '@/components/metadata/EditSeriesDialog'
import { EditBooksDialog } from '@/components/metadata/EditBooksDialog'
import { PosterManager } from '@/components/metadata/PosterManager'
import { KomfIdentifyDialog } from '@/components/metadata/KomfIdentifyDialog'
import { showToast } from '@/lib/store/toast'
import { trackKomfJob } from '@/lib/store/komfJobs'

function Field({ term, mono, children }: { term: string; mono?: boolean; children: ReactNode }) {
  return (
    <div>
      <dt className="text-xs tracking-wide text-ink-3 uppercase">{term}</dt>
      <dd className={cn('mt-1 text-sm text-ink', mono && 'font-mono')}>{children}</dd>
    </div>
  )
}

export function OneshotDetailPage() {
  const { seriesId = '' } = useParams()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const user = useAuthStore((s) => s.user)
  const rowCardWidth = useDensityCardWidth()
  const [addToListOpen, setAddToListOpen] = useState(false)
  const [newCollectionOpen, setNewCollectionOpen] = useState(false)
  const [editOpen, setEditOpen] = useState(false)
  const [editBookOpen, setEditBookOpen] = useState(false)
  const [postersOpen, setPostersOpen] = useState(false)
  const [identifyOpen, setIdentifyOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const komfReady = useKomfIntegration()

  const seriesQuery = useQuery({ queryKey: ['series', seriesId], queryFn: () => seriesApi.get(seriesId) })
  const series = seriesQuery.data
  const title = series ? series.metadata.title || series.name : ''

  // a oneshot series holds exactly one book; the page is built around it
  const bookQuery = useQuery({
    queryKey: ['series', seriesId, 'oneshot-book'],
    queryFn: async () => (await seriesApi.books(seriesId, { size: 1 })).content[0] ?? null,
    enabled: !!series,
  })
  const book = bookQuery.data ?? null
  const bust = useBust(seriesId)

  const librariesQuery = useQuery({ queryKey: ['libraries'], queryFn: librariesApi.list })
  const collectionsQuery = useQuery({
    queryKey: ['collections', 'series', seriesId],
    queryFn: () => seriesApi.collections(seriesId),
    enabled: !!series,
  })
  const readlistsQuery = useQuery({
    queryKey: ['readlists', 'book', book?.id],
    queryFn: () => booksApi.readlists(book!.id),
    enabled: !!book,
  })

  const markMutation = useMutation({
    mutationFn: (read: boolean) => (read ? booksApi.markRead(book!.id) : booksApi.markUnread(book!.id)),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['books'] })
      queryClient.invalidateQueries({ queryKey: ['series'] })
      queryClient.invalidateQueries({ queryKey: ['dashboard'] })
      queryClient.invalidateQueries({ queryKey: ['readlists'] })
    },
  })

  const analyzeMutation = useMutation({
    mutationFn: () => booksApi.analyze(book!.id),
    onSuccess: () => showToast('Analysis queued'),
    onError: (e) => showToast(e instanceof Error ? e.message : 'Could not queue the analysis'),
  })
  const refreshMutation = useMutation({
    mutationFn: async () => {
      await booksApi.refreshMetadata(book!.id)
      await seriesApi.refreshMetadata(seriesId)
    },
    onSuccess: () => showToast('Metadata refresh queued'),
    onError: (e) => showToast(e instanceof Error ? e.message : 'Could not queue the refresh'),
  })
  // komf PATCHes the metadata asynchronously once the job runs; the SSE SeriesChanged
  // invalidation picks the result up, so no query invalidation here
  const komfMatchMutation = useMutation({
    mutationFn: (libraryId: string) => komfApi.matchSeries(libraryId, seriesId),
    onSuccess: ({ id }) => trackKomfJob(id, title),
    onError: (e) => showToast(e instanceof Error ? e.message : 'Could not queue the match'),
  })
  const deleteMutation = useMutation({
    mutationFn: () => booksApi.deleteFile(book!.id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['books'] })
      queryClient.invalidateQueries({ queryKey: ['series'] })
      queryClient.invalidateQueries({ queryKey: ['dashboard'] })
      navigate('/series')
    },
    onError: (e) => showToast(e instanceof Error ? e.message : 'Could not delete the file'),
  })

  useEffect(() => {
    document.title = title ? `${title} · KMReader` : 'KMReader'
  }, [title])

  useEffect(() => {
    window.scrollTo(0, 0)
  }, [seriesId])

  if (seriesQuery.isPending) return <DetailSkeleton />
  if (seriesQuery.error)
    return <DetailError error={seriesQuery.error} notFoundTitle="Series not found" onRetry={() => seriesQuery.refetch()} />
  if (!series) return null
  if (!series.oneshot) return <Navigate to={`/series/${series.id}`} replace />
  if (bookQuery.isPending) return <DetailSkeleton />
  if (bookQuery.error)
    return <DetailError error={bookQuery.error} notFoundTitle="Book not found" onRetry={() => bookQuery.refetch()} />
  if (!book)
    return (
      <div>
        <BackButton to="/series" className="mb-2 -ml-2" />
        <EmptyState className="py-32" icon={<BookOpen weight="duotone" />} title="No book" body="This oneshot has no book yet." />
      </div>
    )

  const md = series.metadata
  const bookMd = book.metadata
  const library = librariesQuery.data?.find((l) => l.id === series.libraryId)
  const progress = book.readProgress
  const completed = !!progress?.completed
  // an unavailable library makes the book act deleted (komga parity)
  const unavailable = book.deleted || (library?.unavailable ?? false)
  const route = readRoute({ id: book.id, media: book.media, deleted: unavailable })
  const issue = mediaIssue({ media: book.media, deleted: unavailable })
  const readlists = readlistsQuery.data ?? []
  const collections = collectionsQuery.data ?? []
  const cover = urls.seriesThumbnail(series.id, bust || undefined)
  const authors = bookMd.authors.length > 0 ? bookMd.authors : series.booksMetadata.authors
  const summary = md.summary || bookMd.summary
  const progressPct = completed ? 100 : book.media.pagesCount > 0 && progress ? (progress.page / book.media.pagesCount) * 100 : 0

  const creatorItems = creatorChipItems(md.publisher, authors, '/series')
  const genreItems = genreChipItems(md.genres)
  const tagItems = tagChipItems(md.tags, '/series')
  const sharingItems = sharingLabelChipItems(md.sharingLabels)
  const links = [...md.links, ...bookMd.links.filter((bl) => !md.links.some((sl) => sl.url === bl.url))]
  const bookTagItems = tagChipItems(bookMd.tags, '/books')
  const hasMetadataFlows = genreItems.length + tagItems.length + sharingItems.length > 0

  return (
    <div>
      <DetailHero backdrop={cover} leading={<BackButton to="/series" className="mb-2 -ml-2" />}>
        <CoverImage src={cover} alt={title} eager className="w-36 shrink-0 shadow-card md:w-44" />
        <div className="min-w-0 flex-1">
          {library && (
            <p className="text-xs tracking-wide text-ink-3 uppercase">
              <Link to={`/libraries/${library.id}/series`} className="transition-colors hover:text-accent-strong">
                {library.name}
              </Link>
            </p>
          )}
          <h1 className="mt-1 font-display text-3xl font-semibold tracking-tight text-ink md:text-4xl">{title}</h1>
          <DetailChipFlow items={creatorItems} className="mt-2.5" />
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <Button variant="primary" disabled={!route} onClick={() => route && navigate(route)}>
              <BookOpen className="size-4" />
              {progress && !progress.completed ? `Continue · page ${progress.page}` : 'Read'}
            </Button>
            <Tooltip content="Read without saving progress">
              <Button variant="secondary" disabled={!route} onClick={() => route && navigate(`${route}?incognito=true`)}>
                <EyeSlash className="size-4" />
                Peek
              </Button>
            </Tooltip>
            {!completed && (
              <Button variant="secondary" loading={markMutation.isPending} onClick={() => markMutation.mutate(true)}>
                <Checks className="size-4" />
                Mark as read
              </Button>
            )}
            {progress && (
              <Button variant="secondary" loading={markMutation.isPending} onClick={() => markMutation.mutate(false)}>
                <Circle className="size-4" />
                Mark as unread
              </Button>
            )}
            {canDownload(user) && <DownloadLink href={urls.bookFile(book.id)} disabled={unavailable} />}
            {isAdmin(user) && (
              <Menu
                trigger={
                  <IconButton label="More actions">
                    <DotsThreeVertical className="size-5" />
                  </IconButton>
                }
              >
                <MenuItem onSelect={() => setEditOpen(true)}>
                  <PencilSimple className="size-4" /> Edit metadata
                </MenuItem>
                <MenuItem onSelect={() => setEditBookOpen(true)}>
                  <PencilSimple className="size-4" /> Edit book metadata
                </MenuItem>
                <MenuItem onSelect={() => setPostersOpen(true)}>
                  <ImageSquare className="size-4" /> Manage posters
                </MenuItem>
                <MenuSeparator />
                <MenuItem onSelect={() => analyzeMutation.mutate()} disabled={analyzeMutation.isPending}>
                  <FileMagnifyingGlass className="size-4" /> Analyze
                </MenuItem>
                <MenuItem onSelect={() => refreshMutation.mutate()} disabled={refreshMutation.isPending}>
                  <ArrowsClockwise className="size-4" /> Refresh metadata
                </MenuItem>
                {komfReady && (
                  <>
                    <MenuSeparator />
                    <MenuItem onSelect={() => setIdentifyOpen(true)}>
                      <Sparkle className="size-4" /> Identify with komf
                    </MenuItem>
                    <MenuItem
                      onSelect={() => komfMatchMutation.mutate(series.libraryId)}
                      disabled={komfMatchMutation.isPending}
                    >
                      <PlugsConnected className="size-4" /> Match with komf
                    </MenuItem>
                  </>
                )}
                <MenuSeparator />
                <MenuItem onSelect={() => setAddToListOpen(true)}>
                  <BookmarkSimple className="size-4" /> Add to read list
                </MenuItem>
                <MenuItem onSelect={() => setNewCollectionOpen(true)}>
                  <Plus className="size-4" /> New collection with this series
                </MenuItem>
                <MenuSeparator />
                <MenuItem danger onSelect={() => setDeleteOpen(true)}>
                  <Trash className="size-4" /> Delete file
                </MenuItem>
              </Menu>
            )}
          </div>
          {issue && (
            <p
              className={cn(
                'mt-2 text-xs',
                issue.severity === 'danger'
                  ? 'text-danger'
                  : issue.severity === 'accent'
                    ? 'text-accent-strong'
                    : 'text-ink-3',
              )}
            >
              {issue.title}
              {issue.detail && `: ${issue.detail}`}
            </p>
          )}
        </div>
      </DetailHero>

      <SeriesMetaLine md={md} className="mt-4" />

      {md.alternateTitles.length > 0 && (
        <div className="mt-3 space-y-0.5">
          {md.alternateTitles.map((t, i) => (
            <p key={`${t.label}-${i}`} className="text-xs text-ink-3">
              {t.title} ({t.label})
            </p>
          ))}
        </div>
      )}

      {summary && <Summary text={summary} className="mt-4" />}

      {hasMetadataFlows && (
        <div className="mt-4 space-y-2">
          <DetailChipFlow items={genreItems} />
          <DetailChipFlow items={tagItems} />
          <DetailChipFlow items={sharingItems} />
        </div>
      )}

      {links.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1">
          {links.map((l) => (
            <a
              key={l.url}
              href={l.url}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-xs text-ink-3 transition-colors hover:text-accent-strong"
            >
              {l.label}
              <ArrowSquareOut className="size-3" />
            </a>
          ))}
        </div>
      )}

      <section className="mt-8 rounded-xl border border-line bg-surface p-5">
        <dl className="grid grid-cols-1 gap-x-8 gap-y-4 sm:grid-cols-2">
          <Field term="Pages" mono>
            {book.media.pagesCount}
          </Field>
          <Field term="Size" mono>
            {formatBytes(book.sizeBytes)}
          </Field>
          <Field term="Format">{book.media.mediaType}</Field>
          <Field term="Profile">{book.media.mediaProfile}</Field>
          {bookMd.releaseDate && <Field term="Release date">{formatDate(bookMd.releaseDate)}</Field>}
          {bookMd.isbn && (
            <Field term="ISBN" mono>
              {bookMd.isbn}
            </Field>
          )}
          <Field term="Added">{formatDate(book.created)}</Field>
        </dl>

        <DetailChipFlow items={bookTagItems} className="mt-4" />

        {progress && (
          <div className="mt-5 border-t border-line pt-4">
            <p className="text-sm text-ink-2">
              {completed ? 'Completed' : `Page ${progress.page} of ${book.media.pagesCount}`}
              {progress.readDate && <span className="text-ink-3"> · {relativeTime(progress.readDate)}</span>}
            </p>
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-overlay">
              <div className="h-full rounded-full bg-accent transition-[width] duration-300" style={{ width: `${progressPct}%` }} />
            </div>
          </div>
        )}
      </section>

      {collections.length > 0 && (
        <HorizontalRow title="In collections" className="mt-10">
          {collections.map((c) => (
            <div key={c.id} className="shrink-0" style={{ width: rowCardWidth }}>
              <CollectionCard id={c.id} name={c.name} count={c.seriesIds.length} />
            </div>
          ))}
        </HorizontalRow>
      )}

      {readlists.length > 0 && (
        <HorizontalRow title="In read lists" className="mt-10">
          {readlists.map((l) => (
            <div key={l.id} className="shrink-0" style={{ width: rowCardWidth }}>
              <ReadListCard id={l.id} name={l.name} count={l.bookIds.length} />
            </div>
          ))}
        </HorizontalRow>
      )}

      <AddToReadListDialog bookId={book.id} open={addToListOpen} onOpenChange={setAddToListOpen} />
      <NewCollectionDialog open={newCollectionOpen} onOpenChange={setNewCollectionOpen} seriesId={series.id} />
      <EditSeriesDialog open={editOpen} onClose={() => setEditOpen(false)} seriesIds={[series.id]} />
      <EditBooksDialog open={editBookOpen} onClose={() => setEditBookOpen(false)} bookIds={[book.id]} />
      {komfReady && (
        <KomfIdentifyDialog
          open={identifyOpen}
          onOpenChange={setIdentifyOpen}
          series={series}
          onIdentified={() => showToast('Identify queued')}
        />
      )}
      <PosterManager open={postersOpen} onClose={() => setPostersOpen(false)} kind="series" entityId={series.id} title={title} />
      <ConfirmDeleteDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title="Delete book file"
        name={`the file of ${title}`}
        loading={deleteMutation.isPending}
        onConfirm={() => deleteMutation.mutate()}
      />
    </div>
  )
}
