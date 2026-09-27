import { Plus, X } from '@phosphor-icons/react'
import type { NotificationUrlEntry, NotificationsDraft } from './draft'
import { FieldInput } from '@/components/admin/settings/FieldInput'
import { Button } from '@/components/ui/Button'
import { IconButton } from '@/components/ui/IconButton'
import { Switch } from '@/components/ui/Switch'
import { Subheading } from './fields'
import { FormRow } from './FormRow'

interface UrlListEditorProps {
  entries: NotificationUrlEntry[]
  onChange: (entries: NotificationUrlEntry[]) => void
  addLabel: string
  ariaLabel: string
}

function UrlListEditor({ entries, onChange, addLabel, ariaLabel }: UrlListEditorProps) {
  return (
    <div className="flex flex-col gap-1.5">
      {entries.map((entry, i) => (
        <div key={entry.key ?? `new-${i}`} className="flex items-center gap-1.5">
          {entry.key === null ? (
            <FieldInput
              aria-label={`${ariaLabel} ${i + 1}`}
              className="w-full font-mono text-[13px]"
              placeholder="https://…"
              value={entry.value}
              onChange={(e) => onChange(entries.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)))}
            />
          ) : (
            <span className="min-w-0 flex-1 truncate font-mono text-[13px] text-ink-3">{entry.value}</span>
          )}
          <IconButton
            label={`Remove ${ariaLabel}`}
            className="size-8"
            onClick={() => onChange(entries.filter((_, j) => j !== i))}
          >
            <X className="size-4" />
          </IconButton>
        </div>
      ))}
      <div>
        <Button size="sm" variant="ghost" onClick={() => onChange([...entries, { key: null, value: '' }])}>
          <Plus className="size-4" /> {addLabel}
        </Button>
      </div>
    </div>
  )
}

interface NotificationsFieldsProps {
  value: NotificationsDraft
  onChange: (v: NotificationsDraft) => void
}

export function NotificationsFields({ value, onChange }: NotificationsFieldsProps) {
  const set = (patch: Partial<NotificationsDraft>) => onChange({ ...value, ...patch })

  return (
    <div>
      <div className="pb-3">
        <p className="text-sm font-medium text-ink">Discord</p>
        <p className="mt-0.5 text-xs text-ink-3">
          komf masks existing webhooks, so they cannot be edited here — remove and re-add to change one.
        </p>
        <div className="mt-2">
          <UrlListEditor
            entries={value.discordWebhooks}
            onChange={(v) => set({ discordWebhooks: v })}
            addLabel="Add webhook"
            ariaLabel="Discord webhook"
          />
        </div>
      </div>
      <FormRow label="Include series cover">
        <Switch
          checked={value.discordSeriesCover}
          onCheckedChange={(v) => set({ discordSeriesCover: v })}
          label="Discord series cover"
        />
      </FormRow>

      <Subheading>Apprise</Subheading>
      <div className="py-3">
        <p className="text-sm text-ink-2">URLs</p>
        <p className="mt-0.5 text-xs text-ink-3">
          Apprise notification URLs, e.g. tgram://, ntfy://. Masked entries are read-only.
        </p>
        <div className="mt-2">
          <UrlListEditor
            entries={value.appriseUrls}
            onChange={(v) => set({ appriseUrls: v })}
            addLabel="Add URL"
            ariaLabel="Apprise URL"
          />
        </div>
      </div>
      <FormRow label="Include series cover">
        <Switch
          checked={value.appriseSeriesCover}
          onCheckedChange={(v) => set({ appriseSeriesCover: v })}
          label="Apprise series cover"
        />
      </FormRow>
    </div>
  )
}
