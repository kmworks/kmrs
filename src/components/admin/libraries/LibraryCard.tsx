import { useState, type ReactNode } from 'react'
import { useMutation, useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import {
  ArrowsClockwise,
  ChartBar,
  DotsThreeVertical,
  Folder,
  MagnifyingGlassPlus,
  PencilSimple,
  Scan,
  Trash,
  TrashSimple,
} from '@phosphor-icons/react'
import { ApiError } from '@/lib/api/client'
import { librariesApi } from '@/lib/api/libraries'
import { actuatorApi } from '@/lib/api/settings'
import type { LibraryDto, MetricDto } from '@/lib/api/types'
import { cn } from '@/lib/utils/cn'
import { formatBytes } from '@/lib/utils/format'
import { Button } from '@/components/ui/Button'
import { IconButton } from '@/components/ui/IconButton'
import { Menu, MenuItem, MenuSeparator } from '@/components/ui/Menu'
import { Tooltip } from '@/components/ui/Tooltip'
import { metricStat } from '../metric'
import { scanIntervalBadgeKey } from './model'

interface LibraryCardProps {
  library: LibraryDto
  onEdit: (library: LibraryDto) => void
  onDelete: (library: LibraryDto) => void
}

export function LibraryCard({ library, onEdit, onDelete }: LibraryCardProps) {
  const { t } = useTranslation('admin-maintenance')
  const queryClient = useQueryClient()
  const [actionError, setActionError] = useState<string | null>(null)

  const handlers = {
    onMutate: () => setActionError(null),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['libraries'] }),
    onError: (err: unknown) => setActionError(err instanceof Error ? err.message : t('libraries.actionFailed')),
  }

  const scan = useMutation({ mutationFn: (deep: boolean) => librariesApi.scan(library.id, deep), ...handlers })
  const analyze = useMutation({ mutationFn: () => librariesApi.analyze(library.id), ...handlers })
  const refresh = useMutation({ mutationFn: () => librariesApi.refreshMetadata(library.id), ...handlers })
  const emptyTrash = useMutation({ mutationFn: () => librariesApi.emptyTrash(library.id), ...handlers })
  const busy = scan.isPending || analyze.isPending || refresh.isPending || emptyTrash.isPending

  const intervalKey = scanIntervalBadgeKey(library.scanInterval)

  const seriesCount = statOrZero(useLibraryMetric('komga.series', library.id))
  const bookCount = statOrZero(useLibraryMetric('komga.books', library.id))
  const totalSize = statOrZero(useLibraryMetric('komga.books.filesize', library.id))
  const statsReady = seriesCount !== undefined && bookCount !== undefined && totalSize !== undefined

  return (
    <div className="flex flex-col rounded-xl border border-line bg-surface p-4 transition-colors hover:border-line-strong">
      <div className="flex items-center justify-between gap-2">
        <h3 className="min-w-0 truncate text-[15px] font-semibold text-ink">{library.name}</h3>
        <div className="flex shrink-0 items-center gap-1.5">
          {library.unavailable && <Badge danger>{t('common:state.unavailable')}</Badge>}
          {intervalKey && <Badge>{t(intervalKey)}</Badge>}
        </div>
      </div>
      <Tooltip content={library.root}>
        <p className="mt-1.5 flex items-center gap-1.5 font-mono text-xs text-ink-3">
          <Folder className="size-3.5 shrink-0" />
          <span className="min-w-0 truncate">{library.root}</span>
        </p>
      </Tooltip>
      {statsReady && (
        <p className="mt-1.5 text-xs text-ink-2">
          {t('libraries.stats.line', {
            series: t('libraries.stats.series', { count: seriesCount }),
            books: t('libraries.stats.books', { count: bookCount }),
            size: formatBytes(totalSize),
          })}
        </p>
      )}
      <div className="mt-4 flex items-center justify-between border-t border-line pt-3">
        <Button size="sm" loading={scan.isPending} disabled={busy} onClick={() => scan.mutate(false)}>
          <Scan className="size-4" />
          {t('layout:libraryMenu.scan')}
        </Button>
        <Menu
          trigger={
            <IconButton label={t('libraries.actions')}>
              <DotsThreeVertical className="size-4" />
            </IconButton>
          }
        >
          <MenuItem disabled={busy} onSelect={() => scan.mutate(true)}>
            <MagnifyingGlassPlus className="size-4" />
            {t('layout:libraryMenu.scanDeep')}
          </MenuItem>
          <MenuItem disabled={busy} onSelect={() => analyze.mutate()}>
            <ChartBar className="size-4" />
            {t('layout:libraryMenu.analyze')}
          </MenuItem>
          <MenuItem disabled={busy} onSelect={() => refresh.mutate()}>
            <ArrowsClockwise className="size-4" />
            {t('layout:libraryMenu.refreshMetadata')}
          </MenuItem>
          <MenuItem disabled={busy} onSelect={() => emptyTrash.mutate()}>
            <TrashSimple className="size-4" />
            {t('layout:libraryMenu.emptyTrash')}
          </MenuItem>
          <MenuSeparator />
          <MenuItem onSelect={() => onEdit(library)}>
            <PencilSimple className="size-4" />
            {t('common:action.edit')}
          </MenuItem>
          <MenuItem danger onSelect={() => onDelete(library)}>
            <Trash className="size-4" />
            {t('common:action.delete')}
          </MenuItem>
        </Menu>
      </div>
      {actionError && <p className="mt-2 text-xs text-danger">{actionError}</p>}
    </div>
  )
}

function Badge({ children, danger }: { children: ReactNode; danger?: boolean }) {
  return (
    <span
      className={cn(
        'rounded-full border px-2 py-0.5 text-[11px] font-medium whitespace-nowrap',
        danger ? 'border-danger/40 bg-danger/10 text-danger' : 'border-line bg-raised text-ink-2',
      )}
    >
      {children}
    </span>
  )
}

function useLibraryMetric(name: string, libraryId: string) {
  return useQuery({
    queryKey: ['admin', 'metric', name, libraryId],
    queryFn: () => actuatorApi.metric(name, [`library:${libraryId}`]),
    refetchInterval: 30_000,
  })
}

// the per-library gauges have no rows for an empty library, so the metric 404s instead of reporting 0
function statOrZero(q: UseQueryResult<MetricDto>): number | undefined {
  const value = metricStat(q.data, 'VALUE')
  if (value !== undefined) return value
  if (q.error instanceof ApiError && q.error.status === 404) return 0
  return undefined
}
