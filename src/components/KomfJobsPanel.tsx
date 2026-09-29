import { AnimatePresence, motion } from 'motion/react'
import { CircleNotch, X } from '@phosphor-icons/react'
import { useTranslation } from 'react-i18next'
import { useKomfJobs } from '@/lib/store/komfJobs'
import { IconButton } from '@/components/ui/IconButton'

export function KomfJobsPanel() {
  const { t } = useTranslation()
  const jobs = useKomfJobs((s) => s.jobs)
  const dismiss = useKomfJobs((s) => s.dismiss)
  const list = Object.values(jobs)
  if (list.length === 0) return null
  return (
    <div className="pointer-events-none fixed right-6 bottom-6 z-20 flex flex-col items-end gap-2">
      <AnimatePresence>
        {list.map((job) => (
          <motion.div
            key={job.id}
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 24 }}
            transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
            className="pointer-events-auto flex min-w-72 items-center gap-3 rounded-xl border border-line bg-overlay px-4 py-3 shadow-pop"
          >
            {!job.done && <CircleNotch className="size-4 shrink-0 animate-spin text-ink-3" />}
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium text-ink">{job.label}</div>
              <div className={job.failed ? 'truncate text-xs text-danger' : 'truncate text-xs text-ink-2'}>
                {job.failed ?? job.text}
              </div>
            </div>
            {job.failed && (
              <IconButton label={t('action.dismiss')} className="-mr-1 size-7" onClick={() => dismiss(job.id)}>
                <X className="size-4" />
              </IconButton>
            )}
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  )
}
