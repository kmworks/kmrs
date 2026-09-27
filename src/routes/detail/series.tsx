import { useEffect, useState } from 'react'
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom'
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  ArrowSquareOut,
  ArrowsClockwise,
  BookOpen,
  Checks,
  Circle,
  CircleNotch,
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
import { seriesApi } from '@/lib/api/series'
import { librariesApi } from '@/lib/api/libraries'
import { komfApi } from '@/lib/api/komf'
import { canDownload, isAdmin, useAuthStore } from '@/lib/store/auth'
import { useKomfIntegration } from '@/lib/hooks/useKomfIntegration'
import { useBust } from '@/lib/store/thumbnails'
import { urls } from '@/lib/utils/urls'
import { readRoute } from '@/lib/utils/nav'
import { showToast } from '@/lib/store/toast'
import { trackKomfJob } from '@/lib/store/komfJobs'
import { Button } from '@/components/ui/Button'
import { IconButton } from '@/components/ui/IconButton'
import { Tooltip } from '@/components/ui/Tooltip'
import { BackButton } from '@/components/ui/BackButton'
import { Menu, MenuItem, MenuSeparator } from '@/components/ui/Menu'
import { EmptyState } from '@/components/ui/EmptyState'
import { GridSkeleton } from '@/components/ui/Skeleton'
import { CoverImage } from '@/components/media/CoverImage'
import { MediaGrid } from '@/components/media/MediaGrid'
import { useDensityCardWidth } from '@/lib/store/ui'
import { BookCard } from '@/components/media/BookCard'
import { CollectionCard } from '@/components/media/SeriesCard'
import { HorizontalRow } from '@/components/media/HorizontalRow'
import { DetailHero } from '@/components/detail/DetailHero'
import { DetailSkeleton } from '@/components/detail/DetailSkeleton'
import { DetailError } from '@/components/detail/DetailError'
import { DetailChipFlow } from '@/components/detail/DetailChipFlow'
import { SeriesMetaLine } from '@/components/detail/SeriesMetaLine'
import { creatorChipItems, genreChipItems, sharingLabelChipItems, tagChipItems } from '@/components/detail/metadataChips'
import { Summary } from '@/components/detail/Summary'
import { DownloadLink } from '@/components/detail/DownloadLink'
import { NewCollectionDialog } from '@/components/detail/NewCollectionDialog'
import { ConfirmDeleteDialog } from '@/components/detail/ConfirmDeleteDialog'
import { EditSeriesDialog } from '@/components/metadata/EditSeriesDialog'
import { PosterManager } from '@/components/metadata/PosterManager'
import { KomfIdentifyDialog } from '@/components/metadata/KomfIdentifyDialog'
import { ReadStatusFilterControl, type ReadStatusFilter } from '@/components/detail/ReadStatusFilter'
import { useSentinel } from '@/components/detail/useSentinel'

const PAGE_SIZE = 48

export function SeriesDetailPage() {
  const { seriesId = '' } = useParams()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const user = useAuthStore((s) => s.user)
  const bust = useBust(seriesId)
  const rowCardWidth = useDensityCardWidth()
  const [readStatus, setReadStatus] = useState<ReadStatusFilter>('ALL')
  const [newCollectionOpen, setNewCollectionOpen] = useState(false)
  const [editOpen, setEditOpen] = useState(false)
  const [postersOpen, setPostersOpen] = useState(false)
  const [identifyOpen, setIdentifyOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const komfReady = useKomfIntegration()

  const seriesQuery = useQuery({ queryKey: ['series', seriesId], queryFn: () => seriesApi.get(seriesId) })
  const series = seriesQuery.data
  const title = series ? series.metadata.title || series.name : ''

  const librariesQuery = useQuery({ queryKey: ['libraries'], queryFn: librariesApi.list })
  const collectionsQuery = useQuery({
    queryKey: ['collections', 'series', seriesId],
    queryFn: () => seriesApi.collections(seriesId),
    enabled: !!series && !series.oneshot,
  })
  // First unread (or in-progress) book, falling back to the first book when fully read
  const readTargetQuery = useQuery({
    queryKey: ['series', seriesId, 'read-target'],
    queryFn: async () => {
      const unread = await seriesApi.books(seriesId, { readStatus: ['UNREAD', 'IN_PROGRESS'], size: 1 })
      if (unread.content[0]) return unread.content[0]
      const first = await seriesApi.books(seriesId, { size: 1 })
      return first.content[0] ?? null
    },
    enabled: !!series && !series.oneshot,
  })
  const booksQuery = useInfiniteQuery({
    queryKey: ['series', seriesId, 'books', readStatus],
    queryFn: ({ pageParam }) =>
      seriesApi.books(seriesId, {
        page: pageParam,
        size: PAGE_SIZE,
        readStatus: readStatus === 'ALL' ? undefined : [readStatus],
      }),
    initialPageParam: 0,
    getNextPageParam: (last) => (last.last ? undefined : last.number + 1),
    enabled: !!series && !series.oneshot,
  })

  const markMutation = useMutation({
    mutationFn: (read: boolean) => (read ? seriesApi.markRead(seriesId) : seriesApi.markUnread(seriesId)),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['series'] })
      queryClient.invalidateQueries({ queryKey: ['books'] })
      queryClient.invalidateQueries({ queryKey: ['dashboard'] })
      queryClient.invalidateQueries({ queryKey: ['readlists'] })
    },
  })

  const analyzeMutation = useMutation({
    mutationFn: () => seriesApi.analyze(seriesId),
    onSuccess: () => showToast('Analysis queued'),
    onError: (e) => showToast(e instanceof Error ? e.message : 'Could not queue the analysis'),
  })
  const refreshMutation = useMutation({
    mutationFn: () => seriesApi.refreshMetadata(seriesId),
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
    mutationFn: () => seriesApi.deleteFile(seriesId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['series'] })
      queryClient.invalidateQueries({ queryKey: ['books'] })
      queryClient.invalidateQueries({ queryKey: ['dashboard'] })
      navigate('/series')
    },
    onError: (e) => showToast(e instanceof Error ? e.message : 'Could not delete the files'),
  })

  useEffect(() => {
    document.title = title ? `${title} · KMReader` : 'KMReader'
  }, [title])

  const sentinelRef = useSentinel(
    () => {
      if (booksQuery.hasNextPage && !booksQuery.isFetchingNextPage) booksQuery.fetchNextPage()
    },
    !!booksQuery.hasNextPage,
  )

  if (seriesQuery.isPending) return <DetailSkeleton />
  if (seriesQuery.error)
    return <DetailError error={seriesQuery.error} notFoundTitle="Series not found" onRetry={() => seriesQuery.refetch()} />
  if (!series) return null
  if (series.oneshot) return <Navigate to={`/oneshot/${series.id}`} replace />

  const md = series.metadata
  const library = librariesQuery.data?.find((l) => l.id === series.libraryId)
  // an unavailable library makes the series act deleted (komga parity)
  const unavailable = series.deleted || (library?.unavailable ?? false)
  const canMarkRead = series.booksUnreadCount > 0
  const canMarkUnread = series.booksReadCount + series.booksInProgressCount > 0
  const readTarget = readTargetQuery.data
  const readTargetRoute = readTarget ? readRoute(readTarget) : null
  const books = booksQuery.data?.pages.flatMap((p) => p.content) ?? []
  const collections = collectionsQuery.data ?? []
  const cover = urls.seriesThumbnail(series.id, bust || undefined)

  const creatorItems = creatorChipItems(md.publisher, series.booksMetadata.authors, '/series')
  const genreItems = genreChipItems(md.genres)
  const tagItems = tagChipItems(md.tags, '/series')
  const sharingItems = sharingLabelChipItems(md.sharingLabels)
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
            <Button
              variant="primary"
              disabled={!readTargetRoute}
              loading={readTargetQuery.isPending}
              onClick={() => readTargetRoute && navigate(readTargetRoute)}
            >
              <BookOpen className="size-4" />
              Read
            </Button>
            <Tooltip content="Read without saving progress">
              <Button
                variant="secondary"
                disabled={!readTargetRoute}
                onClick={() => readTargetRoute && navigate(`${readTargetRoute}?incognito=true`)}
              >
                <EyeSlash className="size-4" />
                Peek
              </Button>
            </Tooltip>
            {canMarkRead && (
              <Button variant="secondary" loading={markMutation.isPending} onClick={() => markMutation.mutate(true)}>
                <Checks className="size-4" />
                Mark as read
              </Button>
            )}
            {canMarkUnread && (
              <Button variant="secondary" loading={markMutation.isPending} onClick={() => markMutation.mutate(false)}>
                <Circle className="size-4" />
                Mark as unread
              </Button>
            )}
            {canDownload(user) && <DownloadLink href={urls.seriesFile(series.id)} disabled={unavailable} />}
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
          {unavailable && <p className="mt-2 text-xs font-medium text-danger">Unavailable</p>}
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

      {md.summary && <Summary text={md.summary} className="mt-4" />}

      {hasMetadataFlows && (
        <div className="mt-4 space-y-2">
          <DetailChipFlow items={genreItems} />
          <DetailChipFlow items={tagItems} />
          <DetailChipFlow items={sharingItems} />
        </div>
      )}

      {md.links.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1">
          {md.links.map((l) => (
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

      <p className="mt-4 text-sm text-ink-3">
        <span className="font-mono text-ink-2">{series.booksCount}</span> books
        {' · '}
        <span className="font-mono text-ink-2">{series.booksReadCount}</span> read
        {' · '}
        <span className="font-mono text-ink-2">{series.booksUnreadCount}</span> unread
      </p>

      <section className="mt-10">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-display text-xl font-semibold text-ink">Books</h2>
          <ReadStatusFilterControl value={readStatus} onChange={setReadStatus} />
        </div>
        {booksQuery.isPending ? (
          <GridSkeleton count={6} />
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
            body={readStatus === 'ALL' ? 'This series has no books.' : 'No books match this filter.'}
          />
        ) : (
          <MediaGrid>
            {books.map((b) => (
              <BookCard key={b.id} book={b} />
            ))}
          </MediaGrid>
        )}
        <div ref={sentinelRef} />
        {booksQuery.isFetchingNextPage && (
          <div className="mt-6 flex justify-center">
            <CircleNotch className="size-5 animate-spin text-ink-3" />
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

      <NewCollectionDialog open={newCollectionOpen} onOpenChange={setNewCollectionOpen} seriesId={series.id} />
      <EditSeriesDialog open={editOpen} onClose={() => setEditOpen(false)} seriesIds={[series.id]} />
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
        title="Delete series files"
        name={`all files of ${title}`}
        loading={deleteMutation.isPending}
        onConfirm={() => deleteMutation.mutate()}
      />
    </div>
  )
}
