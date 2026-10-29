import { useTranslation } from 'react-i18next'
import { ArrowLeft } from '@phosphor-icons/react'
import { cn } from '@/lib/utils/cn'
import { IconButton } from '@/components/ui/IconButton'
import { useGoBack } from '@/lib/hooks/useGoBack'

export function BackButton({ to, className }: { to: string; className?: string }) {
  const goBack = useGoBack()
  const { t } = useTranslation()
  return (
    <IconButton
      label={t('action.back')}
      // above DetailHero's blurred backdrop, which bleeds upward over this spot
      className={cn('relative z-10', className)}
      onClick={() => goBack(to)}
    >
      <ArrowLeft className="size-5" />
    </IconButton>
  )
}

/**
 * For top-level pages (browse, search) that are also link targets from other pages:
 * renders nothing on a direct load, where there is nothing to go back to.
 */
export function HistoryBackButton({ to, className }: { to: string; className?: string }) {
  if ((window.history.state?.idx ?? 0) <= 0) return null
  return <BackButton to={to} className={className} />
}
