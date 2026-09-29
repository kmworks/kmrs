import { useMutation, useQueryClient } from '@tanstack/react-query'
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
    ...handlers('Scan queued', 'Could not queue the scan'),
  })
  const analyze = useMutation({
    mutationFn: () => librariesApi.analyze(library.id),
    ...handlers('Analysis queued', 'Could not queue the analysis'),
  })
  const refresh = useMutation({
    mutationFn: () => librariesApi.refreshMetadata(library.id),
    ...handlers('Metadata refresh queued', 'Could not queue the metadata refresh'),
  })
  const emptyTrash = useMutation({
    mutationFn: () => librariesApi.emptyTrash(library.id),
    ...handlers('Empty trash queued', 'Could not empty the trash'),
  })
  const busy = scan.isPending || analyze.isPending || refresh.isPending || emptyTrash.isPending

  return (
    <Menu
      side="right"
      align="start"
      trigger={
        <IconButton
          label={`${library.name} actions`}
          className="size-6 rounded-md opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100 [@media(pointer:coarse)]:opacity-60 [&_svg]:size-3.5"
        >
          <DotsThreeVertical />
        </IconButton>
      }
    >
      <MenuItem disabled={busy} onSelect={() => scan.mutate(false)}>
        <Scan className="size-4" />
        Scan
      </MenuItem>
      <MenuItem disabled={busy} onSelect={() => scan.mutate(true)}>
        <MagnifyingGlassPlus className="size-4" />
        Scan (deep)
      </MenuItem>
      <MenuItem disabled={busy} onSelect={() => analyze.mutate()}>
        <ChartBar className="size-4" />
        Analyze
      </MenuItem>
      <MenuItem disabled={busy} onSelect={() => refresh.mutate()}>
        <ArrowsClockwise className="size-4" />
        Refresh metadata
      </MenuItem>
      <MenuItem disabled={busy} onSelect={() => emptyTrash.mutate()}>
        <TrashSimple className="size-4" />
        Empty trash
      </MenuItem>
    </Menu>
  )
}
