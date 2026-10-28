import { useTranslation } from 'react-i18next'
import { Checks, CheckSquare } from '@phosphor-icons/react'
import { Button } from '@/components/ui/Button'

interface SelectionModeButtonProps {
  active: boolean
  onToggle: () => void
}

export function SelectionModeButton({ active, onToggle }: SelectionModeButtonProps) {
  const { t } = useTranslation('media')
  return (
    <Button variant={active ? 'primary' : 'secondary'} size="sm" aria-pressed={active} onClick={onToggle}>
      {active ? <Checks className="size-4" /> : <CheckSquare className="size-4" />}
      {active ? t('common:action.done') : t('menu.select')}
    </Button>
  )
}
