import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import {
  ArrowsClockwise,
  ChartBar,
  DotsThreeVertical,
  MagnifyingGlassPlus,
  Scan,
  TrashSimple,
} from '@phosphor-icons/react'
import { librariesApi } from '@/lib/api/libraries'
import type { LibraryDto } from '@/lib/api/types'
import { showToast } from '@/lib/store/toast'
import { IconButton } from '@/components/ui/IconButton'
import { Menu, MenuItem } from '@/components/ui/Menu'

/** Per-library admin actions (scan family) attached to each sidebar library row. */
export function SidebarLibraryMenu({ library }: { library: LibraryDto }) {
  const { t } = useTranslation('layout')
  const queryClient = useQueryClient()

  const handlers = (queued: string, failed: string) => ({
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['libraries'] })
      showToast(queued)
    },
    onError: (e: unknown) => showToast(e instanceof Error ? e.message : failed),
  })

  const scan = useMutation({
    mutationFn: (deep: boolean) => librariesApi.scan(library.id, deep),
    ...handlers(t('libraryMenu.scanQueued'), t('libraryMenu.scanFailed')),
  })
  const analyze = useMutation({
    mutationFn: () => librariesApi.analyze(library.id),
    ...handlers(t('libraryMenu.analyzeQueued'), t('libraryMenu.analyzeFailed')),
  })
  const refresh = useMutation({
    mutationFn: () => librariesApi.refreshMetadata(library.id),
    ...handlers(t('libraryMenu.refreshQueued'), t('libraryMenu.refreshFailed')),
  })
  const emptyTrash = useMutation({
    mutationFn: () => librariesApi.emptyTrash(library.id),
    ...handlers(t('libraryMenu.emptyTrashQueued'), t('libraryMenu.emptyTrashFailed')),
  })
  const busy = scan.isPending || analyze.isPending || refresh.isPending || emptyTrash.isPending

  return (
    <Menu
      side="right"
      align="start"
      trigger={
        <IconButton
          label={t('libraryMenu.actions', { name: library.name })}
          className="size-6 rounded-md opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100 [@media(pointer:coarse)]:opacity-60 [&_svg]:size-3.5"
        >
          <DotsThreeVertical />
        </IconButton>
      }
    >
      <MenuItem disabled={busy} onSelect={() => scan.mutate(false)}>
        <Scan className="size-4" />
        {t('libraryMenu.scan')}
      </MenuItem>
      <MenuItem disabled={busy} onSelect={() => scan.mutate(true)}>
        <MagnifyingGlassPlus className="size-4" />
        {t('libraryMenu.scanDeep')}
      </MenuItem>
      <MenuItem disabled={busy} onSelect={() => analyze.mutate()}>
        <ChartBar className="size-4" />
        {t('libraryMenu.analyze')}
      </MenuItem>
      <MenuItem disabled={busy} onSelect={() => refresh.mutate()}>
        <ArrowsClockwise className="size-4" />
        {t('libraryMenu.refreshMetadata')}
      </MenuItem>
      <MenuItem disabled={busy} onSelect={() => emptyTrash.mutate()}>
        <TrashSimple className="size-4" />
        {t('libraryMenu.emptyTrash')}
      </MenuItem>
    </Menu>
  )
}
