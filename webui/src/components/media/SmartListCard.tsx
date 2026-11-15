import { useTranslation } from 'react-i18next'
import type { SmartListTarget, SmartListVisibility } from '@/lib/api/types'
import { urls } from '@/lib/utils/urls'
import { useBust } from '@/lib/store/thumbnails'
import { CoverImage } from './CoverImage'
import { CardFrame, CardOverlayText, CardText } from './CardFrame'
import { MediaCardPreview } from './CardPreview'

/** server-generated mosaic cover of the matched books, busted on SmartListThumbnailChanged */
export function SmartListCard({
  id,
  name,
  target,
  visibility,
  className,
}: {
  id: string
  name: string
  target: SmartListTarget
  visibility: SmartListVisibility
  className?: string
}) {
  const { t } = useTranslation('smartlists')
  const bust = useBust(id)
  const secondary = t(`target.${target === 'BOOK' ? 'book' : 'series'}`)
  // older kmrs builds serve no visibility: treat it as private instead of crashing
  const visibilityLabel = visibility ? t(`visibility.${visibility.toLowerCase()}`) : null
  const cover = urls.smartlistThumbnail(id, bust || undefined)
  return (
    <CardFrame
      to={`/smart-lists/${id}`}
      label={name}
      className={className}
      preview={<MediaCardPreview title={name} cover={cover} subtitle={secondary} meta={visibilityLabel} />}
    >
      <div className="relative">
        <CoverImage src={cover} alt={name} />
        <CardOverlayText title={name} secondary={secondary} />
      </div>
      <CardText
        title={name}
        secondary={
          <>
            {secondary}
            {visibility && visibility !== 'PRIVATE' && (
              <span className="ml-1.5 rounded-full bg-accent-soft px-1.5 py-0.5 text-[10px] text-accent-strong">
                {visibilityLabel}
              </span>
            )}
          </>
        }
      />
    </CardFrame>
  )
}
