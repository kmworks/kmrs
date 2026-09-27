import { Dialog } from '@/components/ui/Dialog'
import { Button } from '@/components/ui/Button'

interface KomfResetDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** series title shown in the confirmation copy */
  name: string
  loading: boolean
  onConfirm: () => void
}

export function KomfResetDialog({ open, onOpenChange, name, loading, onConfirm }: KomfResetDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="Reset metadata with komf" size="sm">
      <div className="px-5 py-4">
        <p className="text-sm text-ink-2">
          Reset <span className="font-medium text-ink">{name}</span>? komf removes the metadata it wrote, including
          field locks and uploaded covers.
        </p>
      </div>
      <div className="flex justify-end gap-2 border-t border-line px-5 py-3.5">
        <Button variant="ghost" onClick={() => onOpenChange(false)}>
          Cancel
        </Button>
        <Button variant="danger" loading={loading} onClick={onConfirm}>
          Reset
        </Button>
      </div>
    </Dialog>
  )
}
