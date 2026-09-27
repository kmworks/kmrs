import type { KomfConfigDraft } from './draft'
import { TextField } from '@/components/ui/TextField'
import { SelectInput } from './fields'

const COMICVINE_ID_FORMAT_OPTIONS: Array<{ value: string; label: string }> = [
  { value: '', label: 'No override' },
  { value: 'SERIES', label: 'Series' },
  { value: 'VOLUME', label: 'Volume' },
  { value: 'ISSUE', label: 'Issue' },
]

interface ProviderCredentialsFieldsProps {
  value: KomfConfigDraft
  onChange: (patch: Partial<KomfConfigDraft>) => void
  searchLimitError?: string
}

export function ProviderCredentialsFields({ value, onChange, searchLimitError }: ProviderCredentialsFieldsProps) {
  return (
    <div className="flex flex-col gap-4">
      <TextField
        label="MAL client ID"
        helper="Empty clears the configured value."
        value={value.malClientId}
        onChange={(e) => onChange({ malClientId: e.target.value })}
      />
      <TextField
        label="ComicVine API key"
        helper="Empty clears the configured value."
        value={value.comicVineApiKey}
        onChange={(e) => onChange({ comicVineApiKey: e.target.value })}
      />
      <TextField
        label="ComicVine search limit"
        helper="Maximum number of ComicVine search results. Empty clears the configured value."
        inputMode="numeric"
        value={value.comicVineSearchLimit}
        onChange={(e) => onChange({ comicVineSearchLimit: e.target.value })}
        error={searchLimitError}
      />
      <TextField
        label="ComicVine issue name"
        helper="Empty clears the configured value."
        value={value.comicVineIssueName}
        onChange={(e) => onChange({ comicVineIssueName: e.target.value })}
      />
      <div className="flex flex-col gap-2">
        <p className="text-[13px] font-medium text-ink-2">ComicVine ID format</p>
        <SelectInput
          aria-label="ComicVine ID format"
          className="h-10 w-full"
          options={COMICVINE_ID_FORMAT_OPTIONS}
          value={value.comicVineIdFormat}
          onChange={(v) => onChange({ comicVineIdFormat: v })}
        />
      </div>
      <TextField
        label="Bangumi token"
        helper="Empty clears the configured value."
        value={value.bangumiToken}
        onChange={(e) => onChange({ bangumiToken: e.target.value })}
      />
    </div>
  )
}
