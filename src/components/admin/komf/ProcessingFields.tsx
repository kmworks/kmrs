import type { KomfLibraryType, KomfReadingDirection, KomfUpdateMode } from '@/lib/api/types'
import type { ProcessingDraft } from './draft'
import { FieldInput } from '@/components/admin/settings/FieldInput'
import { SegmentedControl } from '@/components/ui/SegmentedControl'
import { Switch } from '@/components/ui/Switch'
import { FormRow } from './FormRow'

const LIBRARY_TYPE_OPTIONS: Array<{ value: KomfLibraryType; label: string }> = [
  { value: 'MANGA', label: 'Manga' },
  { value: 'NOVEL', label: 'Novel' },
  { value: 'COMIC', label: 'Comic' },
  { value: 'WEBTOON', label: 'Webtoon' },
]

const UPDATE_MODE_OPTIONS: Array<{ value: KomfUpdateMode; label: string }> = [
  { value: 'API', label: 'API' },
  { value: 'COMIC_INFO', label: 'ComicInfo' },
  { value: 'MYLAR_SERIES_JSON', label: 'Mylar series.json' },
]

const READING_DIRECTION_OPTIONS: Array<{ value: KomfReadingDirection | ''; label: string }> = [
  { value: '', label: 'No override' },
  { value: 'LEFT_TO_RIGHT', label: 'Left to right' },
  { value: 'RIGHT_TO_LEFT', label: 'Right to left' },
  { value: 'VERTICAL', label: 'Vertical' },
  { value: 'WEBTOON', label: 'Webtoon' },
]

interface ProcessingFieldsProps {
  value: ProcessingDraft
  onChange: (v: ProcessingDraft) => void
}

/** Shared editor for a metadata-processing block, used by the global default and per-library overrides. */
export function ProcessingFields({ value, onChange }: ProcessingFieldsProps) {
  const set = (patch: Partial<ProcessingDraft>) => onChange({ ...value, ...patch })

  const toggleMode = (mode: KomfUpdateMode, on: boolean) =>
    set({ updateModes: on ? [...value.updateModes, mode] : value.updateModes.filter((m) => m !== mode) })

  return (
    <div>
      <FormRow label="Library type">
        <SegmentedControl
          options={LIBRARY_TYPE_OPTIONS}
          value={value.libraryType}
          onChange={(v) => set({ libraryType: v })}
        />
      </FormRow>
      <FormRow label="Update modes">
        <div className="flex flex-col gap-1.5">
          {UPDATE_MODE_OPTIONS.map((opt) => (
            <label key={opt.value} className="flex cursor-pointer items-center gap-2 text-sm text-ink-2">
              <input
                type="checkbox"
                checked={value.updateModes.includes(opt.value)}
                onChange={(e) => toggleMode(opt.value, e.target.checked)}
                className="size-4 cursor-pointer accent-accent"
              />
              {opt.label}
            </label>
          ))}
        </div>
      </FormRow>
      <FormRow label="Aggregate metadata">
        <Switch checked={value.aggregate} onCheckedChange={(v) => set({ aggregate: v })} label="Aggregate metadata" />
      </FormRow>
      <FormRow label="Merge tags">
        <Switch checked={value.mergeTags} onCheckedChange={(v) => set({ mergeTags: v })} label="Merge tags" />
      </FormRow>
      <FormRow label="Merge genres">
        <Switch checked={value.mergeGenres} onCheckedChange={(v) => set({ mergeGenres: v })} label="Merge genres" />
      </FormRow>
      <FormRow label="Book covers">
        <Switch checked={value.bookCovers} onCheckedChange={(v) => set({ bookCovers: v })} label="Book covers" />
      </FormRow>
      <FormRow label="Series covers">
        <Switch checked={value.seriesCovers} onCheckedChange={(v) => set({ seriesCovers: v })} label="Series covers" />
      </FormRow>
      <FormRow label="Override existing covers">
        <Switch
          checked={value.overrideExistingCovers}
          onCheckedChange={(v) => set({ overrideExistingCovers: v })}
          label="Override existing covers"
        />
      </FormRow>
      <FormRow label="Lock covers">
        <Switch checked={value.lockCovers} onCheckedChange={(v) => set({ lockCovers: v })} label="Lock covers" />
      </FormRow>
      <FormRow label="Override ComicInfo">
        <Switch
          checked={value.overrideComicInfo}
          onCheckedChange={(v) => set({ overrideComicInfo: v })}
          label="Override ComicInfo"
        />
      </FormRow>

      <h3 className="mt-4 border-t border-line pt-4 text-[13px] font-medium text-ink">Post-processing</h3>
      <FormRow label="Series title">
        <Switch checked={value.seriesTitle} onCheckedChange={(v) => set({ seriesTitle: v })} label="Series title" />
      </FormRow>
      <FormRow label="Series title language">
        <FieldInput
          aria-label="Series title language"
          className="w-36"
          value={value.seriesTitleLanguage}
          onChange={(e) => set({ seriesTitleLanguage: e.target.value })}
        />
      </FormRow>
      <FormRow label="Alternative series titles">
        <Switch
          checked={value.alternativeSeriesTitles}
          onCheckedChange={(v) => set({ alternativeSeriesTitles: v })}
          label="Alternative series titles"
        />
      </FormRow>
      <FormRow label="Order books">
        <Switch checked={value.orderBooks} onCheckedChange={(v) => set({ orderBooks: v })} label="Order books" />
      </FormRow>
      <FormRow label="Reading direction">
        <select
          aria-label="Reading direction"
          value={value.readingDirectionValue}
          onChange={(e) => set({ readingDirectionValue: e.target.value as KomfReadingDirection | '' })}
          className="h-9 cursor-pointer rounded-lg border border-line bg-surface px-3 text-base text-ink focus:border-accent/70 focus:outline-none"
        >
          {READING_DIRECTION_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </FormRow>
      <FormRow label="Language">
        <FieldInput
          aria-label="Language"
          className="w-36"
          value={value.languageValue}
          onChange={(e) => set({ languageValue: e.target.value })}
        />
      </FormRow>
    </div>
  )
}
