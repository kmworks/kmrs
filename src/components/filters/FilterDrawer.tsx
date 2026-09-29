import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { X } from '@phosphor-icons/react'
import { Button } from '@/components/ui/Button'
import { IconButton } from '@/components/ui/IconButton'
import { FilterGroupSection } from './FilterGroups'
import type { AuthorFilter, FilterGroupDef, FilterState, GroupKey, GroupMode } from './types'

interface FilterDrawerProps {
  open: boolean
  onClose: () => void
  groups: FilterGroupDef[]
  state: FilterState
  libraryId?: string
  activeCount: number
  onToggleValue: (key: GroupKey, value: string) => void
  onToggleAuthor: (author: AuthorFilter) => void
  onSetMode: (key: GroupKey, mode: GroupMode) => void
  onSetNegated: (key: GroupKey, negated: boolean) => void
  onSetExclusive: (key: GroupKey, value: string) => void
  onClearAll: () => void
}

export function FilterDrawer({
  open,
  onClose,
  groups,
  state,
  libraryId,
  activeCount,
  onToggleValue,
  onToggleAuthor,
  onSetMode,
  onSetNegated,
  onSetExclusive,
  onClearAll,
}: FilterDrawerProps) {
  const { t } = useTranslation('filters')
  const reduce = useReducedMotion()

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  useEffect(() => {
    if (!open) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prev
    }
  }, [open])

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            key="overlay"
            className="fixed inset-0 z-20 bg-black/60"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: reduce ? 0 : 0.15 }}
            onClick={onClose}
          />
          <motion.aside
            key="panel"
            aria-label={t('title')}
            className="fixed inset-y-0 right-0 z-20 flex w-80 flex-col border-l border-line bg-surface sm:w-96"
            initial={reduce ? { opacity: 0 } : { x: '100%' }}
            animate={reduce ? { opacity: 1 } : { x: 0 }}
            exit={reduce ? { opacity: 0 } : { x: '100%' }}
            transition={reduce ? { duration: 0 } : { type: 'spring', stiffness: 380, damping: 36 }}
          >
            <div className="flex h-14 shrink-0 items-center justify-between border-b border-line px-4">
              <h2 className="font-display text-lg font-semibold text-ink">{t('title')}</h2>
              <div className="flex items-center gap-1">
                <Button variant="ghost" size="sm" onClick={onClearAll} disabled={activeCount === 0}>
                  {t('clearAll')}
                </Button>
                <IconButton label={t('close')} onClick={onClose}>
                  <X className="size-5" />
                </IconButton>
              </div>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-4">
              {groups.map((def) => (
                <FilterGroupSection
                  key={def.key}
                  def={def}
                  state={state}
                  libraryId={libraryId}
                  enabled={open}
                  onToggleValue={onToggleValue}
                  onToggleAuthor={onToggleAuthor}
                  onSetMode={onSetMode}
                  onSetNegated={onSetNegated}
                  onSetExclusive={onSetExclusive}
                />
              ))}
            </div>
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  )
}
