import { useState } from 'react'
import { CaretRight, Plus } from '@phosphor-icons/react'
import type { KomfLibraryType, KomfNameMatchingMode } from '@/lib/api/types'
import { cn } from '@/lib/utils/cn'
import type { BookMetadataDraft, KomfProviderKey, ProviderDraft, ProvidersDraft, SeriesMetadataDraft } from './draft'
import {
  AUTHOR_ROLE_OPTIONS,
  PROVIDERS_WITH_BOOKS,
  PROVIDERS_WITH_MEDIA_TYPE,
  PROVIDER_KEYS,
  PROVIDER_LABELS,
} from './draft'
import { FieldInput } from '@/components/admin/settings/FieldInput'
import { Button } from '@/components/ui/Button'
import { Menu, MenuItem } from '@/components/ui/Menu'
import { SegmentedControl } from '@/components/ui/SegmentedControl'
import { Switch } from '@/components/ui/Switch'
import { Checklist, CollapsibleGroup } from './fields'
import { FormRow } from './FormRow'
import { ProviderExtras } from './ProviderExtras'

const NAME_MATCHING_OPTIONS: Array<{ value: KomfNameMatchingMode | ''; label: string }> = [
  { value: '', label: 'Inherit' },
  { value: 'CLOSEST_MATCH', label: 'Closest match' },
  { value: 'EXACT', label: 'Exact' },
]

const MEDIA_TYPE_OPTIONS: Array<{ value: KomfLibraryType; label: string }> = [
  { value: 'MANGA', label: 'Manga' },
  { value: 'NOVEL', label: 'Novel' },
]

type BooleanKeys<T> = { [K in keyof T]: T[K] extends boolean ? K : never }[keyof T]

const SERIES_METADATA_OPTIONS: Array<{ value: BooleanKeys<SeriesMetadataDraft>; label: string }> = [
  { value: 'status', label: 'Status' },
  { value: 'title', label: 'Title' },
  { value: 'alternativeTitles', label: 'Alternative titles' },
  { value: 'summary', label: 'Summary' },
  { value: 'publisher', label: 'Publisher' },
  { value: 'readingDirection', label: 'Reading direction' },
  { value: 'ageRating', label: 'Age rating' },
  { value: 'language', label: 'Language' },
  { value: 'genres', label: 'Genres' },
  { value: 'tags', label: 'Tags' },
  { value: 'totalBookCount', label: 'Book count' },
  { value: 'authors', label: 'Authors' },
  { value: 'releaseDate', label: 'Release date' },
  { value: 'thumbnail', label: 'Cover' },
  { value: 'links', label: 'Links' },
  { value: 'score', label: 'Score' },
  { value: 'useOriginalPublisher', label: 'Use original publisher' },
]

const BOOK_METADATA_OPTIONS: Array<{ value: BooleanKeys<BookMetadataDraft>; label: string }> = [
  { value: 'title', label: 'Title' },
  { value: 'summary', label: 'Summary' },
  { value: 'number', label: 'Number' },
  { value: 'numberSort', label: 'Number sort' },
  { value: 'releaseDate', label: 'Release date' },
  { value: 'authors', label: 'Authors' },
  { value: 'tags', label: 'Tags' },
  { value: 'isbn', label: 'ISBN' },
  { value: 'links', label: 'Links' },
  { value: 'thumbnail', label: 'Cover' },
]

const ROLE_OPTIONS = AUTHOR_ROLE_OPTIONS.map((r) => ({ value: r, label: r.charAt(0) + r.slice(1).toLowerCase() }))

interface ProviderCardProps {
  provider: KomfProviderKey
  value: ProviderDraft
  onChange: (v: ProviderDraft) => void
  error?: string
  /** expand the options on mount — used for a freshly added provider */
  defaultOpen?: boolean
}

function ProviderCard({ provider, value, onChange, error, defaultOpen }: ProviderCardProps) {
  const [open, setOpen] = useState(defaultOpen ?? false)
  const label = PROVIDER_LABELS[provider]
  const set = (patch: Partial<ProviderDraft>) => onChange({ ...value, ...patch })
  const setSeries = (patch: Partial<SeriesMetadataDraft>) =>
    set({ seriesMetadata: { ...value.seriesMetadata, ...patch } })
  const setBook = (patch: Partial<BookMetadataDraft>) => set({ bookMetadata: { ...value.bookMetadata, ...patch } })
  const seriesFieldCount = SERIES_METADATA_OPTIONS.filter((o) => value.seriesMetadata[o.value]).length
  const bookFieldCount = BOOK_METADATA_OPTIONS.filter((o) => value.bookMetadata[o.value]).length

  return (
    <div className="rounded-lg border border-line">
      <div className="flex items-center gap-3 px-3 py-2.5">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-label={`${label} options`}
          aria-expanded={open}
          className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 text-left"
        >
          <CaretRight
            className={cn('size-3.5 shrink-0 text-ink-3 transition-transform duration-150', open && 'rotate-90')}
          />
          <span className="truncate text-sm font-medium text-ink">{label}</span>
        </button>
        <FieldInput
          aria-label={`${label} priority`}
          className="w-20 text-right"
          inputMode="numeric"
          value={value.priority}
          onChange={(e) => set({ priority: e.target.value })}
          invalid={!!error}
        />
        <Switch checked={value.enabled} onCheckedChange={(v) => set({ enabled: v })} label={`${label} enabled`} />
      </div>
      {open && (
        <div className="border-t border-line px-3 pb-3">
          {PROVIDERS_WITH_MEDIA_TYPE.has(provider) && (
            <FormRow label="Media type">
              <SegmentedControl
                options={MEDIA_TYPE_OPTIONS}
                value={value.mediaType}
                onChange={(v) => set({ mediaType: v })}
              />
            </FormRow>
          )}
          <FormRow label="Name matching">
            <SegmentedControl
              options={NAME_MATCHING_OPTIONS}
              value={value.nameMatchingMode}
              onChange={(v) => set({ nameMatchingMode: v })}
            />
          </FormRow>
          <div className="py-3">
            <p className="text-sm text-ink-2">Author roles</p>
            <div className="mt-2">
              <Checklist
                options={ROLE_OPTIONS}
                values={value.authorRoles}
                onChange={(v) => set({ authorRoles: v })}
              />
            </div>
          </div>
          <div className="py-3">
            <p className="text-sm text-ink-2">Artist roles</p>
            <div className="mt-2">
              <Checklist
                options={ROLE_OPTIONS}
                values={value.artistRoles}
                onChange={(v) => set({ artistRoles: v })}
              />
            </div>
          </div>

          <CollapsibleGroup label="Series metadata" summary={`${seriesFieldCount}/${SERIES_METADATA_OPTIONS.length}`}>
            <Checklist
              options={SERIES_METADATA_OPTIONS}
              values={SERIES_METADATA_OPTIONS.filter((o) => value.seriesMetadata[o.value]).map((o) => o.value)}
              onChange={(v) => {
                const patch: Partial<SeriesMetadataDraft> = {}
                for (const o of SERIES_METADATA_OPTIONS) patch[o.value] = v.includes(o.value)
                setSeries(patch)
              }}
              className="sm:grid-cols-3"
            />
            <FormRow label="Original publisher tag name">
              <FieldInput
                aria-label="Original publisher tag name"
                className="w-36"
                value={value.seriesMetadata.originalPublisherTagName}
                onChange={(e) => setSeries({ originalPublisherTagName: e.target.value })}
              />
            </FormRow>
            <FormRow label="English publisher tag name">
              <FieldInput
                aria-label="English publisher tag name"
                className="w-36"
                value={value.seriesMetadata.englishPublisherTagName}
                onChange={(e) => setSeries({ englishPublisherTagName: e.target.value })}
              />
            </FormRow>
            <FormRow label="French publisher tag name">
              <FieldInput
                aria-label="French publisher tag name"
                className="w-36"
                value={value.seriesMetadata.frenchPublisherTagName}
                onChange={(e) => setSeries({ frenchPublisherTagName: e.target.value })}
              />
            </FormRow>
          </CollapsibleGroup>

          {PROVIDERS_WITH_BOOKS.has(provider) && (
            <CollapsibleGroup
              label="Book metadata"
              summary={value.seriesMetadata.books ? `${bookFieldCount}/${BOOK_METADATA_OPTIONS.length}` : 'Off'}
            >
              <FormRow label="Update book metadata">
                <Switch
                  checked={value.seriesMetadata.books}
                  onCheckedChange={(v) => setSeries({ books: v })}
                  label="Update book metadata"
                />
              </FormRow>
              {value.seriesMetadata.books && (
                <div className="pb-3">
                  <Checklist
                    options={BOOK_METADATA_OPTIONS}
                    values={BOOK_METADATA_OPTIONS.filter((o) => value.bookMetadata[o.value]).map((o) => o.value)}
                    onChange={(v) => {
                      const patch: Partial<BookMetadataDraft> = {}
                      for (const o of BOOK_METADATA_OPTIONS) patch[o.value] = v.includes(o.value)
                      setBook(patch)
                    }}
                    className="sm:grid-cols-3"
                  />
                </div>
              )}
            </CollapsibleGroup>
          )}

          <ProviderExtras provider={provider} value={value} onChange={onChange} />
        </div>
      )}
      {error && <p className="px-3 pb-2 text-xs text-danger">{error}</p>}
    </div>
  )
}

interface ProvidersFieldsProps {
  value: ProvidersDraft
  onChange: (v: ProvidersDraft) => void
  errors?: Partial<Record<KomfProviderKey, string>>
}

/** One expandable card per enabled provider; disabled providers are added back from the menu. */
export function ProvidersFields({ value, onChange, errors }: ProvidersFieldsProps) {
  const [addedKey, setAddedKey] = useState<KomfProviderKey | null>(null)
  const enabled = PROVIDER_KEYS.filter((key) => value[key].enabled)
  const available = PROVIDER_KEYS.filter((key) => !value[key].enabled)

  return (
    <div className="flex flex-col gap-2">
      {enabled.length === 0 && <p className="text-sm text-ink-3">No providers enabled.</p>}
      {enabled.map((key) => (
        <ProviderCard
          key={key}
          provider={key}
          value={value[key]}
          onChange={(v) => onChange({ ...value, [key]: v })}
          error={errors?.[key]}
          defaultOpen={key === addedKey}
        />
      ))}
      {available.length > 0 && (
        <Menu
          align="start"
          trigger={
            <Button size="sm" variant="secondary" className="self-start">
              <Plus className="size-4" /> Add provider
            </Button>
          }
        >
          {available.map((key) => (
            <MenuItem
              key={key}
              onSelect={() => {
                setAddedKey(key)
                onChange({ ...value, [key]: { ...value[key], enabled: true } })
              }}
            >
              {PROVIDER_LABELS[key]}
            </MenuItem>
          ))}
        </Menu>
      )}
    </div>
  )
}
