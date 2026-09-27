import { useNavigate, Link } from 'react-router-dom'
import { BookOpen, CheckCircle, DotsThree } from '@phosphor-icons/react'
import type { BookDto } from '@/lib/api/types'
import { urls } from '@/lib/utils/urls'
import { bookDetailRoute, readRoute } from '@/lib/utils/nav'
import { useBust } from '@/lib/store/thumbnails'
import { plural, relativeTime } from '@/lib/utils/format'
import { cardStatusLabel } from '@/lib/utils/mediaStatus'
import { useLibraryUnavailable } from '@/lib/utils/libraries'
import { useCoverTint } from '@/lib/utils/coverTint'
import { cn } from '@/lib/utils/cn'
import { MenuItem } from '@/components/ui/Menu'
import { BookCardMenu } from './BookCardMenu'

/**
 * Apple Books-style resume card: cover-tinted solid background, small cover on
 * the left, title/series/progress lines on the right, trailing ellipsis menu.
 */
export function KeepReadingCard({ book, className }: { book: BookDto; className?: string }) {
  const navigate = useNavigate()
  const bust = useBust(book.id)
  const cover = urls.bookThumbnail(book.id, bust || undefined)
  const tint = useCoverTint(cover)
  const tinted = tint !== null
  const libraryUnavailable = useLibraryUnavailable(book.libraryId)
  const unavailable = book.deleted || libraryUnavailable
  const to = readRoute({ id: book.id, media: book.media, deleted: unavailable }) ?? bookDetailRoute(book)
  const title = book.metadata.title || book.name
  const completed = book.readProgress?.completed ?? false
  const pct = !completed && book.media.pagesCount > 0 && book.readProgress ? book.readProgress.page / book.media.pagesCount : 0

  const titleColor = tinted ? (completed ? 'text-white/70' : 'text-white') : completed ? 'text-ink-2' : 'text-ink'
  const seriesColor = tinted ? 'text-white/85' : 'text-ink'
  const metaColor = tinted ? 'text-white/70' : 'text-ink-2'

  const statusLabel = cardStatusLabel({ deleted: unavailable, mediaStatus: book.media.status })
  const meta = statusLabel ? (
    <span className={statusLabel.className}>{statusLabel.text}</span>
  ) : completed ? (
    <span className="inline-flex items-center gap-1">
      <CheckCircle className="size-3" weight="fill" />
      {relativeTime(book.readProgress!.readDate)}
    </span>
  ) : (
    `${Math.round(pct * 100)}% · ${plural(book.media.pagesCount, 'page')}`
  )

  return (
    <div
      className={cn(
        'group relative flex w-[250px] shrink-0 items-center rounded-xl p-2 transition-[background-color,box-shadow,filter] duration-200 hover:shadow-card hover:brightness-[1.07]',
        !tinted && 'bg-raised',
        className,
      )}
      style={tint ? { backgroundColor: tint } : undefined}
    >
      <div aria-hidden className="pointer-events-none absolute inset-0 rounded-[inherit] inset-ring-1 inset-ring-line" />

      {/* cover + text form a single navigation target; the trailing menu stays a separate one */}
      <Link to={to} aria-label={`Continue reading ${title}`} className="flex min-w-0 flex-1 items-center gap-3 self-stretch outline-none">
        <img
          src={cover}
          alt={title}
          loading="lazy"
          draggable={false}
          className="cover-aspect w-[45px] shrink-0 rounded-md object-cover shadow-[0_2px_10px_rgb(0_0_0/0.5)] ring-1 ring-line"
        />
        <div className="flex min-w-0 flex-1 flex-col self-stretch">
          <div className="flex-1" />
          <div>
            <p className={cn('line-clamp-2 pb-1 text-[13px] leading-snug font-semibold', titleColor)}>{title}</p>
            {(book.oneshot || book.seriesTitle) && (
              <p className={cn('truncate text-xs', seriesColor)}>{book.oneshot ? 'Oneshot' : book.seriesTitle}</p>
            )}
          </div>
          <div className="flex-1" />
          <p className={cn('truncate text-[11px] tabular-nums', metaColor)}>{meta}</p>
          <div className="flex-1" />
        </div>
      </Link>

      <BookCardMenu
        book={book}
        navItem={
          <MenuItem onSelect={() => navigate(bookDetailRoute(book))}>
            <BookOpen className="size-4" /> Book details
          </MenuItem>
        }
        trigger={
          <button
            type="button"
            aria-label={`Actions for ${title}`}
            className={cn(
              'inline-flex size-9 shrink-0 cursor-pointer items-center justify-center self-center rounded-full transition-colors',
              metaColor,
              tinted ? 'hover:bg-white/10' : 'hover:bg-ink/5',
            )}
          >
            <DotsThree className="size-4" weight="bold" />
          </button>
        }
      />
    </div>
  )
}
