import { CircleNotch, ImageBroken } from '@phosphor-icons/react'
import { useState, type CSSProperties, type HTMLAttributes } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/Button'
import { useReaderSettings } from '@/lib/store/readerSettings'
import { cn } from '@/lib/utils/cn'
import { imageErrored, imageRetried, imageStateFor, retrySrc, type PageImageState } from './pageRetry'

interface PageImageProps extends HTMLAttributes<HTMLDivElement> {
  src: string
  alt: string
  /** img fill inside the slot; defaults to contain */
  imgClassName?: string
  imgStyle?: CSSProperties
  /** gates the img element for slots that defer loading; the spinner only shows while loading */
  load?: boolean
  onMeasure?: (width: number, height: number) => void
}

/**
 * A page slot with a spinner centered until its image is ready. The wrapper owns the slot
 * geometry so the spinner centers on the reserved box; the complete check skips the spinner
 * when the cache already has the image, since window slides remount loaded slots.
 *
 * The first load error is retried automatically once; if that also fails the slot keeps its
 * box and shows a retry button. Only the button stops click/pointer propagation: both readers
 * turn pages from container-level click regions, and the rest of a failed slot must keep
 * turning pages so an unreadable page can be skipped.
 */
export function PageImage({
  src,
  alt,
  imgClassName,
  imgStyle,
  load = true,
  onMeasure,
  className,
  style,
  ...rest
}: PageImageProps) {
  const { t } = useTranslation('reader')
  const [loaded, setLoaded] = useState(false)
  const [state, setState] = useState<PageImageState | null>(null)
  const { attempt, failed } = imageStateFor(state, src)
  const background = useReaderSettings((s) => s.background)
  const hintColor = background === 'WHITE' ? 'text-black/50' : 'text-white/60'
  return (
    <div className={cn('relative', className)} style={style} {...rest}>
      {load && !loaded && !failed && (
        <CircleNotch
          aria-hidden
          className={cn(
            'absolute top-[min(50%,50dvh)] left-1/2 size-8 -translate-x-1/2 -translate-y-1/2 animate-spin',
            hintColor,
          )}
        />
      )}
      {load && failed ? (
        <div
          role="alert"
          className={cn('flex h-full w-full flex-col items-center justify-center gap-2', hintColor)}
        >
          <ImageBroken aria-hidden className="size-8" />
          <span className="text-sm">{t('error.pageFailed')}</span>
          <Button
            variant="primary"
            size="sm"
            onClick={(e) => {
              e.stopPropagation()
              setLoaded(false)
              setState((s) => (s !== null ? imageRetried(s) : s))
            }}
            onPointerDown={(e) => e.stopPropagation()}
            onPointerUp={(e) => e.stopPropagation()}
            onPointerCancel={(e) => e.stopPropagation()}
          >
            {t('common:action.retry')}
          </Button>
        </div>
      ) : (
        load && (
          <img
            src={retrySrc(src, attempt)}
            alt={alt}
            draggable={false}
            className={imgClassName ?? 'block h-full w-full object-contain'}
            style={imgStyle}
            ref={(el) => {
              if (el?.complete && el.naturalWidth > 0) setLoaded(true)
            }}
            onLoad={(e) => {
              setLoaded(true)
              onMeasure?.(e.currentTarget.naturalWidth, e.currentTarget.naturalHeight)
            }}
            onError={() => setState((s) => imageErrored(s, src))}
          />
        )
      )}
    </div>
  )
}
