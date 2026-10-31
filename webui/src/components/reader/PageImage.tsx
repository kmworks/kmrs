import { CircleNotch } from '@phosphor-icons/react'
import { useState, type CSSProperties, type HTMLAttributes } from 'react'
import { useReaderSettings } from '@/lib/store/readerSettings'
import { cn } from '@/lib/utils/cn'

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
  const [loaded, setLoaded] = useState(false)
  const background = useReaderSettings((s) => s.background)
  return (
    <div className={cn('relative', className)} style={style} {...rest}>
      {load && !loaded && (
        <CircleNotch
          aria-hidden
          className={cn(
            'absolute top-[min(50%,50dvh)] left-1/2 size-8 -translate-x-1/2 -translate-y-1/2 animate-spin',
            background === 'WHITE' ? 'text-black/50' : 'text-white/60',
          )}
        />
      )}
      {load && (
        <img
          src={src}
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
        />
      )}
    </div>
  )
}
