import type {
  KomfChineseDirection,
  KomfChineseField,
  KomfLibraryType,
  KomfPublisherTagName,
  KomfReadingDirection,
  KomfUpdateMode,
} from '@/lib/api/types'
import type { ProcessingDraft } from './draft'
import { FieldInput } from '@/components/admin/settings/FieldInput'
import { IconButton } from '@/components/ui/IconButton'
import { Button } from '@/components/ui/Button'
import { SegmentedControl } from '@/components/ui/SegmentedControl'
import { Switch } from '@/components/ui/Switch'
import { Plus, X } from '@phosphor-icons/react'
import { Checklist, SelectInput, StringListInput, Subheading } from './fields'
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

const CHINESE_DIRECTION_OPTIONS: Array<{ value: KomfChineseDirection; label: string }> = [
  { value: 't2s', label: 'Traditional to Simplified' },
  { value: 's2t', label: 'Simplified to Traditional' },
]

const CHINESE_FIELD_OPTIONS: Array<{ value: KomfChineseField; label: string }> = [
  { value: 'title', label: 'Title' },
  { value: 'genres', label: 'Genres' },
  { value: 'tags', label: 'Tags' },
  { value: 'summary', label: 'Summary' },
]

interface ProcessingGroupProps {
  value: ProcessingDraft
  onChange: (v: ProcessingDraft) => void
}

// Each group renders a fragment so the composed ProcessingFields below keeps the
// same first:/last: FormRow spacing as a flat list; the tab view wraps each group
// in a plain div to restore that spacing inside its own card.

export function ProcessingGeneralFields({ value, onChange }: ProcessingGroupProps) {
  const set = (patch: Partial<ProcessingDraft>) => onChange({ ...value, ...patch })

  const toggleMode = (mode: KomfUpdateMode, on: boolean) =>
    set({ updateModes: on ? [...value.updateModes, mode] : value.updateModes.filter((m) => m !== mode) })

  return (
    <>
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
      <FormRow label="Failed match collection" helper="Series that fail auto-identify are added to this collection.">
        <FieldInput
          aria-label="Failed match collection"
          className="w-56"
          value={value.failedMatchCollectionName}
          onChange={(e) => set({ failedMatchCollectionName: e.target.value })}
        />
      </FormRow>
    </>
  )
}

export function PostProcessingFields({ value, onChange }: ProcessingGroupProps) {
  const set = (patch: Partial<ProcessingDraft>) => onChange({ ...value, ...patch })
  const setLabels = (patch: Partial<ProcessingDraft['alternateTitleLabels']>) =>
    set({ alternateTitleLabels: { ...value.alternateTitleLabels, ...patch } })

  const setPublisherTagName = (index: number, patch: Partial<KomfPublisherTagName>) =>
    set({
      publisherTagNames: value.publisherTagNames.map((t, i) => (i === index ? { ...t, ...patch } : t)),
    })

  return (
    <>
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
      <div className="py-3">
        <p className="text-sm text-ink-2">Alternative title languages</p>
        <p className="mt-0.5 text-xs text-ink-3">BCP-47 language codes, one per line.</p>
        <div className="mt-2">
          <StringListInput
            aria-label="Alternative title languages"
            value={value.alternativeSeriesTitleLanguages}
            onChange={(v) => set({ alternativeSeriesTitleLanguages: v })}
          />
        </div>
      </div>
      <FormRow label="Fallback to alternative title">
        <Switch
          checked={value.fallbackToAltTitle}
          onCheckedChange={(v) => set({ fallbackToAltTitle: v })}
          label="Fallback to alternative title"
        />
      </FormRow>
      <FormRow label="Order books">
        <Switch checked={value.orderBooks} onCheckedChange={(v) => set({ orderBooks: v })} label="Order books" />
      </FormRow>
      <FormRow label="Reading direction">
        <SelectInput
          aria-label="Reading direction"
          options={READING_DIRECTION_OPTIONS}
          value={value.readingDirectionValue}
          onChange={(v) => set({ readingDirectionValue: v })}
        />
      </FormRow>
      <FormRow label="Language">
        <FieldInput
          aria-label="Language"
          className="w-36"
          value={value.languageValue}
          onChange={(e) => set({ languageValue: e.target.value })}
        />
      </FormRow>
      <FormRow label="Score tag name" helper="Write the score into this tag; empty disables.">
        <FieldInput
          aria-label="Score tag name"
          className="w-36"
          placeholder="score:"
          value={value.scoreTagName}
          onChange={(e) => set({ scoreTagName: e.target.value })}
        />
      </FormRow>
      <FormRow label="Original publisher tag name">
        <FieldInput
          aria-label="Original publisher tag name"
          className="w-36"
          value={value.originalPublisherTagName}
          onChange={(e) => set({ originalPublisherTagName: e.target.value })}
        />
      </FormRow>
      <div className="py-3">
        <p className="text-sm text-ink-2">Publisher tag names</p>
        <p className="mt-0.5 text-xs text-ink-3">Tag name to use per publisher language.</p>
        <div className="mt-2 flex flex-col gap-1.5">
          {value.publisherTagNames.map((t, i) => (
            <div key={i} className="flex items-center gap-1.5">
              <FieldInput
                aria-label={`Publisher tag name ${i + 1}`}
                className="w-40"
                placeholder="Tag name"
                value={t.tagName}
                onChange={(e) => setPublisherTagName(i, { tagName: e.target.value })}
              />
              <FieldInput
                aria-label={`Publisher tag language ${i + 1}`}
                className="w-28"
                placeholder="Language"
                value={t.language}
                onChange={(e) => setPublisherTagName(i, { language: e.target.value })}
              />
              <IconButton
                label="Remove publisher tag"
                className="size-8"
                onClick={() => set({ publisherTagNames: value.publisherTagNames.filter((_, j) => j !== i) })}
              >
                <X className="size-4" />
              </IconButton>
            </div>
          ))}
          <div>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => set({ publisherTagNames: [...value.publisherTagNames, { tagName: '', language: '' }] })}
            >
              <Plus className="size-4" /> Add tag name
            </Button>
          </div>
        </div>
      </div>
      <div className="py-3">
        <p className="text-sm text-ink-2">Alternate title labels</p>
        <p className="mt-0.5 text-xs text-ink-3">Custom labels for alternative titles; empty uses the defaults.</p>
        <div className="mt-2 flex flex-wrap gap-1.5">
          <FieldInput
            aria-label="Romaji title label"
            className="w-36"
            placeholder="Romaji"
            value={value.alternateTitleLabels.romaji}
            onChange={(e) => setLabels({ romaji: e.target.value })}
          />
          <FieldInput
            aria-label="Native title label"
            className="w-36"
            placeholder="Native"
            value={value.alternateTitleLabels.native}
            onChange={(e) => setLabels({ native: e.target.value })}
          />
          <FieldInput
            aria-label="Localized title label"
            className="w-36"
            placeholder="Localized"
            value={value.alternateTitleLabels.localized}
            onChange={(e) => setLabels({ localized: e.target.value })}
          />
        </div>
      </div>
      <FormRow label="Skip series with links" helper="Identification skips series that already have provider links.">
        <Switch
          checked={value.linksSkipEnabled}
          onCheckedChange={(v) => set({ linksSkipEnabled: v })}
          label="Skip series with links"
        />
      </FormRow>
      <FormRow label="Match by links" helper="Identification matches directly from existing provider links.">
        <Switch
          checked={value.linksMatchEnabled}
          onCheckedChange={(v) => set({ linksMatchEnabled: v })}
          label="Match by links"
        />
      </FormRow>
    </>
  )
}

export function SearchTitleExtractionFields({ value, onChange }: ProcessingGroupProps) {
  const set = (patch: Partial<ProcessingDraft>) => onChange({ ...value, ...patch })
  const setExtraction = (patch: Partial<ProcessingDraft['searchTitleExtraction']>) =>
    set({ searchTitleExtraction: { ...value.searchTitleExtraction, ...patch } })

  const setCharMapping = (index: number, patch: Partial<{ from: string; to: string }>) =>
    setExtraction({
      charMappings: value.searchTitleExtraction.charMappings.map((m, i) => (i === index ? { ...m, ...patch } : m)),
    })

  return (
    <>
      <FormRow label="Enabled" helper="Clean up series titles before searching providers.">
        <Switch
          checked={value.searchTitleExtraction.enabled}
          onCheckedChange={(v) => setExtraction({ enabled: v })}
          label="Search title extraction"
        />
      </FormRow>
      {value.searchTitleExtraction.enabled && (
        <>
          <FormRow label="Bracket regex" helper="Removed from the title before searching.">
            <FieldInput
              aria-label="Bracket regex"
              className="w-56 font-mono text-[13px]"
              value={value.searchTitleExtraction.bracketRegex}
              onChange={(e) => setExtraction({ bracketRegex: e.target.value })}
            />
          </FormRow>
          <FormRow label="Author separator">
            <FieldInput
              aria-label="Author separator"
              className="w-36"
              value={value.searchTitleExtraction.authorSeparator}
              onChange={(e) => setExtraction({ authorSeparator: e.target.value })}
            />
          </FormRow>
          <div className="py-3">
            <p className="text-sm text-ink-2">Title splitters</p>
            <p className="mt-0.5 text-xs text-ink-3">The title is split on these and the first part is used.</p>
            <div className="mt-2">
              <StringListInput
                aria-label="Title splitters"
                value={value.searchTitleExtraction.titleSplitters}
                onChange={(v) => setExtraction({ titleSplitters: v })}
              />
            </div>
          </div>
          <FormRow label="Symbol normalize regex" helper="Matching symbols are removed before comparing titles.">
            <FieldInput
              aria-label="Symbol normalize regex"
              className="w-56 font-mono text-[13px]"
              value={value.searchTitleExtraction.symbolNormalizeRegex}
              onChange={(e) => setExtraction({ symbolNormalizeRegex: e.target.value })}
            />
          </FormRow>
          <div className="py-3">
            <p className="text-sm text-ink-2">Character mappings</p>
            <p className="mt-0.5 text-xs text-ink-3">Single characters replaced before comparing titles.</p>
            <div className="mt-2 flex flex-col gap-1.5">
              {value.searchTitleExtraction.charMappings.map((m, i) => (
                <div key={i} className="flex items-center gap-1.5">
                  <FieldInput
                    aria-label={`Character mapping source ${i + 1}`}
                    className="w-24 font-mono text-[13px]"
                    value={m.from}
                    onChange={(e) => setCharMapping(i, { from: e.target.value })}
                  />
                  <span className="text-sm text-ink-3">→</span>
                  <FieldInput
                    aria-label={`Character mapping replacement ${i + 1}`}
                    className="w-24 font-mono text-[13px]"
                    value={m.to}
                    onChange={(e) => setCharMapping(i, { to: e.target.value })}
                  />
                  <IconButton
                    label="Remove character mapping"
                    className="size-8"
                    onClick={() =>
                      setExtraction({ charMappings: value.searchTitleExtraction.charMappings.filter((_, j) => j !== i) })
                    }
                  >
                    <X className="size-4" />
                  </IconButton>
                </div>
              ))}
              <div>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() =>
                    setExtraction({
                      charMappings: [...value.searchTitleExtraction.charMappings, { from: '', to: '' }],
                    })
                  }
                >
                  <Plus className="size-4" /> Add mapping
                </Button>
              </div>
            </div>
          </div>
          <div className="py-3">
            <p className="text-sm text-ink-2">Cleanup regexes</p>
            <p className="mt-0.5 text-xs text-ink-3">Applied in order; matches are removed from the title.</p>
            <div className="mt-2">
              <StringListInput
                aria-label="Cleanup regexes"
                value={value.searchTitleExtraction.cleanupRegex}
                onChange={(v) => setExtraction({ cleanupRegex: v })}
              />
            </div>
          </div>
        </>
      )}
    </>
  )
}

export function ChineseConversionFields({ value, onChange }: ProcessingGroupProps) {
  const set = (patch: Partial<ProcessingDraft>) => onChange({ ...value, ...patch })
  const setConversion = (patch: Partial<ProcessingDraft['chineseConversion']>) =>
    set({ chineseConversion: { ...value.chineseConversion, ...patch } })

  return (
    <>
      <FormRow label="Enabled" helper="Convert between Simplified and Traditional Chinese.">
        <Switch
          checked={value.chineseConversion.enabled}
          onCheckedChange={(v) => setConversion({ enabled: v })}
          label="Chinese conversion"
        />
      </FormRow>
      {value.chineseConversion.enabled && (
        <>
          <FormRow label="Direction">
            <SegmentedControl
              options={CHINESE_DIRECTION_OPTIONS}
              value={value.chineseConversion.direction}
              onChange={(v) => setConversion({ direction: v })}
            />
          </FormRow>
          <FormRow label="Convert search terms">
            <Switch
              checked={value.chineseConversion.search}
              onCheckedChange={(v) => setConversion({ search: v })}
              label="Convert search terms"
            />
          </FormRow>
          <FormRow label="Convert when matching">
            <Switch
              checked={value.chineseConversion.matching}
              onCheckedChange={(v) => setConversion({ matching: v })}
              label="Convert when matching"
            />
          </FormRow>
          <FormRow label="Convert written metadata">
            <Switch
              checked={value.chineseConversion.updateEnabled}
              onCheckedChange={(v) => setConversion({ updateEnabled: v })}
              label="Convert written metadata"
            />
          </FormRow>
          {value.chineseConversion.updateEnabled && (
            <div className="py-3">
              <p className="text-sm text-ink-2">Converted fields</p>
              <div className="mt-2">
                <Checklist
                  options={CHINESE_FIELD_OPTIONS}
                  values={value.chineseConversion.updateFields}
                  onChange={(v) => setConversion({ updateFields: v })}
                  className="sm:grid-cols-4"
                />
              </div>
            </div>
          )}
        </>
      )}
    </>
  )
}

export function MylarFields({ value, onChange }: ProcessingGroupProps) {
  const set = (patch: Partial<ProcessingDraft>) => onChange({ ...value, ...patch })

  return (
    <>
      <FormRow label="Download covers" helper="Also download series covers when exporting series.json.">
        <Switch checked={value.mylarCovers} onCheckedChange={(v) => set({ mylarCovers: v })} label="Mylar covers" />
      </FormRow>
      <FormRow label="Output directory" helper="Empty exports next to the series.">
        <FieldInput
          aria-label="Mylar output directory"
          className="w-56"
          value={value.mylarOutputDir}
          onChange={(e) => set({ mylarOutputDir: e.target.value })}
        />
      </FormRow>
    </>
  )
}

/** Full processing editor with group dividers, for override rows where all groups share one card. */
export function ProcessingFields({ value, onChange }: ProcessingGroupProps) {
  return (
    <div>
      <ProcessingGeneralFields value={value} onChange={onChange} />
      <Subheading>Post-processing</Subheading>
      <PostProcessingFields value={value} onChange={onChange} />
      <Subheading>Search title extraction</Subheading>
      <SearchTitleExtractionFields value={value} onChange={onChange} />
      <Subheading>Chinese conversion</Subheading>
      <ChineseConversionFields value={value} onChange={onChange} />
      <Subheading>Mylar</Subheading>
      <MylarFields value={value} onChange={onChange} />
    </div>
  )
}
