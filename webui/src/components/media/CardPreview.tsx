import * as RadixHoverCard from '@radix-ui/react-hover-card'
import { useState, type ReactNode } from 'react'
import type { AuthorDto } from '@/lib/api/types'
import { sortAuthorsByRole } from '@/lib/utils/authors'
import { useUiStore } from '@/lib/store/ui'
import { CoverImage } from './CoverImage'

interface CardPreviewProps {
  children: ReactNode
  content: ReactNode
  disabled?: boolean
}

/** Desktop hover and keyboard-focus preview; touch input keeps the card's normal tap behavior. */
export function CardPreview({ children, content, disabled = false }: CardPreviewProps) {
  const [open, setOpen] = useState(false)
  const previewEnabled = useUiStore((s) => s.cardHoverPreview)
  const isDisabled = disabled || !previewEnabled
  return (
    <RadixHoverCard.Root
      open={!isDisabled && open}
      onOpenChange={(next) => setOpen(!isDisabled && next)}
      openDelay={400}
      closeDelay={120}
    >
      <RadixHoverCard.Trigger asChild>{children}</RadixHoverCard.Trigger>
      <RadixHoverCard.Portal>
        <RadixHoverCard.Content
          side="right"
          align="start"
          sideOffset={12}
          collisionPadding={12}
          className="z-30 max-h-[calc(100vh-24px)] w-80 max-w-[calc(100vw-24px)] overflow-y-auto rounded-xl border border-line bg-raised p-3.5 text-ink shadow-pop outline-none origin-[var(--radix-hover-card-content-transform-origin)] data-[state=open]:animate-menu-in data-[state=closed]:animate-menu-out"
        >
          {content}
        </RadixHoverCard.Content>
      </RadixHoverCard.Portal>
    </RadixHoverCard.Root>
  )
}

interface MediaCardPreviewProps {
  title: string
  cover?: string
  subtitle?: ReactNode
  authors?: AuthorDto[]
  meta?: ReactNode
  summary?: string
  blurred?: boolean
}

export function MediaCardPreview({ title, cover, subtitle, authors, meta, summary, blurred }: MediaCardPreviewProps) {
  const authorNames = authors
    ? [...new Set(sortAuthorsByRole(authors).map((author) => author.name))].join(' · ')
    : ''
  const cleanSummary = summary?.trim()

  return (
    <div>
      <div className="flex items-start gap-3">
        {cover && <CoverImage src={cover} alt="" eager blurred={blurred} className="w-14 shrink-0 shadow-card" />}
        <div className="min-w-0 flex-1">
          <p className="text-[15px] leading-snug font-semibold break-words text-ink">{title}</p>
          {subtitle && <p className="mt-1 text-xs leading-relaxed break-words text-ink-2">{subtitle}</p>}
          {authorNames && <p className="mt-1.5 line-clamp-2 text-xs leading-relaxed text-ink-2">{authorNames}</p>}
          {meta && <div className="mt-1.5 text-[11px] leading-relaxed text-ink-3">{meta}</div>}
        </div>
      </div>
      {cleanSummary && (
        <p className="mt-3 line-clamp-4 border-t border-line pt-3 text-xs leading-relaxed whitespace-pre-line text-ink-2">
          {cleanSummary}
        </p>
      )}
    </div>
  )
}
