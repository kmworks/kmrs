import { useEffect, type ReactNode } from 'react'
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowSquareOut, BookOpen, Checks } from '@phosphor-icons/react'
import { booksApi } from '@/lib/api/books'
import { librariesApi } from '@/lib/api/libraries'
import { seriesApi } from '@/lib/api/series'
import { canDownload, useAuthStore } from '@/lib/store/auth'
import { useBust } from '@/lib/store/thumbnails'
import { urls } from '@/lib/utils/urls'
import { readRoute } from '@/lib/utils/nav'
import { mediaIssue } from '@/lib/utils/mediaStatus'
import { formatBytes, formatDate, readingDirectionLabel, relativeTime, seriesStatusLabel } from '@/lib/utils/format'
import { cn } from '@/lib/utils/cn'
import { Button } from '@/components/ui/Button'
import { Chip } from '@/components/ui/Chip'
import { BackButton } from '@/components/ui/BackButton'
import { EmptyState } from '@/components/ui/EmptyState'
import { CoverImage } from '@/components/media/CoverImage'
import { ReadListCard } from '@/components/media/SeriesCard'
import { HorizontalRow } from '@/components/media/HorizontalRow'
import { useDensityCardWidth } from '@/lib/store/ui'
import { DetailHero } from '@/components/detail/DetailHero'
import { DetailSkeleton } from '@/components/detail/DetailSkeleton'
import { DetailError } from '@/components/detail/DetailError'
import { Summary } from '@/components/detail/Summary'
import { DownloadLink } from '@/components/detail/DownloadLink'

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

  const seriesQuery = useQuery({ queryKey: ['series', seriesId], queryFn: () => seriesApi.get(seriesId) })
  const series = seriesQuery.data

  // a oneshot series holds exactly one book; the page is built around it
  const bookQuery = useQuery({
    queryKey: ['series', seriesId, 'oneshot-book'],
    queryFn: async () => (await seriesApi.books(seriesId, { size: 1 })).content[0] ?? null,
    enabled: !!series,
  })
  const book = bookQuery.data ?? null
  const bust = useBust(book?.id ?? seriesId)

  const librariesQuery = useQuery({ queryKey: ['libraries'], queryFn: librariesApi.list })
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

  const title = series ? series.metadata.title || series.name : ''
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
  const cover = urls.bookThumbnail(book.id, bust || undefined)
  const authors = bookMd.authors.length > 0 ? bookMd.authors : series.booksMetadata.authors
  const authorsLine = authors.map((a) => `${a.name} (${a.role})`).join(', ')
  const summary = md.summary || bookMd.summary
  const progressPct = completed ? 100 : book.media.pagesCount > 0 && progress ? (progress.page / book.media.pagesCount) * 100 : 0

  const chips: Array<{ key: string; label: string; to?: string }> = []
  const statusLabel = seriesStatusLabel(md.status)
  if (statusLabel) chips.push({ key: 'status', label: statusLabel, to: `/series?seriesStatus=${md.status}` })
  if (md.publisher)
    chips.push({ key: 'publisher', label: md.publisher, to: `/series?publishers=${encodeURIComponent(md.publisher)}` })
  if (md.language)
    chips.push({ key: 'language', label: md.language, to: `/series?languages=${encodeURIComponent(md.language)}` })
  if (md.ageRating != null)
    chips.push({ key: 'age', label: `${md.ageRating}+`, to: `/series?ageRatings=${md.ageRating}` })
  const directionLabel = readingDirectionLabel(md.readingDirection)
  if (directionLabel) chips.push({ key: 'direction', label: directionLabel })
  for (const g of md.genres) chips.push({ key: `genre-${g}`, label: g, to: `/series?genres=${encodeURIComponent(g)}` })
  for (const t of md.tags) chips.push({ key: `tag-${t}`, label: t, to: `/series?tags=${encodeURIComponent(t)}` })
  for (const s of md.sharingLabels) chips.push({ key: `sharing-${s}`, label: s })

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
          {authorsLine && <p className="mt-1.5 text-ink-2">{authorsLine}</p>}
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <Button variant="primary" disabled={!route} onClick={() => route && navigate(route)}>
              <BookOpen className="size-4" />
              {progress && !progress.completed ? `Continue · page ${progress.page}` : 'Read'}
            </Button>
            <Button variant="secondary" loading={markMutation.isPending} onClick={() => markMutation.mutate(!completed)}>
              {!completed && <Checks className="size-4" />}
              {completed ? 'Mark as unread' : 'Mark as read'}
            </Button>
            {canDownload(user) && <DownloadLink href={urls.bookFile(book.id)} disabled={unavailable} />}
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

      {chips.length > 0 && (
        <div className="mt-5 flex flex-wrap gap-1.5">
          {chips.map((c) => (
            <Chip key={c.key} to={c.to}>
              {c.label}
            </Chip>
          ))}
        </div>
      )}

      {md.alternateTitles.length > 0 && (
        <div className="mt-3 space-y-0.5">
          {md.alternateTitles.map((t, i) => (
            <p key={`${t.label}-${i}`} className="text-xs text-ink-3">
              {t.title} ({t.label})
            </p>
          ))}
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

      {summary && <Summary text={summary} className="mt-4" />}

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

        {bookMd.tags.length > 0 && (
          <div className="mt-4 flex flex-wrap gap-1.5">
            {bookMd.tags.map((t) => (
              <Chip key={t} to={`/books?tags=${encodeURIComponent(t)}`}>
                {t}
              </Chip>
            ))}
          </div>
        )}

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

      {readlists.length > 0 && (
        <HorizontalRow title="In read lists" className="mt-10">
          {readlists.map((l) => (
            <div key={l.id} className="shrink-0" style={{ width: rowCardWidth }}>
              <ReadListCard id={l.id} name={l.name} count={l.bookIds.length} />
            </div>
          ))}
        </HorizontalRow>
      )}
    </div>
  )
}
