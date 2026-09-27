import type { KomfProviderKey, ProvidersDraft } from './draft'
import { PROVIDER_KEYS, PROVIDER_LABELS } from './draft'
import { FieldInput } from '@/components/admin/settings/FieldInput'
import { Switch } from '@/components/ui/Switch'
import { FormRow } from './FormRow'

interface ProvidersFieldsProps {
  value: ProvidersDraft
  onChange: (v: ProvidersDraft) => void
  errors?: Partial<Record<KomfProviderKey, string>>
}

/** One row per metadata provider: enable switch plus priority. */
export function ProvidersFields({ value, onChange, errors }: ProvidersFieldsProps) {
  const setProvider = (key: KomfProviderKey, patch: Partial<ProvidersDraft[KomfProviderKey]>) =>
    onChange({ ...value, [key]: { ...value[key], ...patch } })

  return (
    <div>
      {PROVIDER_KEYS.map((key) => (
        <FormRow key={key} label={PROVIDER_LABELS[key]}>
          <div className="flex flex-col items-end gap-1">
            <div className="flex items-center gap-3">
              <FieldInput
                aria-label={`${PROVIDER_LABELS[key]} priority`}
                className="w-20 text-right"
                inputMode="numeric"
                value={value[key].priority}
                onChange={(e) => setProvider(key, { priority: e.target.value })}
                invalid={!!errors?.[key]}
              />
              <Switch
                checked={value[key].enabled}
                onCheckedChange={(v) => setProvider(key, { enabled: v })}
                label={`${PROVIDER_LABELS[key]} enabled`}
              />
            </div>
            {errors?.[key] && <p className="text-xs text-danger">{errors[key]}</p>}
          </div>
        </FormRow>
      ))}
    </div>
  )
}
