import type { KomfProviderKey, ProviderDraft } from './draft'
import { MANGADEX_LINK_OPTIONS } from './draft'
import { FieldInput } from '@/components/admin/settings/FieldInput'
import { SegmentedControl } from '@/components/ui/SegmentedControl'
import { Switch } from '@/components/ui/Switch'
import { Checklist, SelectInput, StringListInput, Subheading } from './fields'
import { FormRow } from './FormRow'

interface ProviderExtrasProps {
  provider: KomfProviderKey
  value: ProviderDraft
  onChange: (v: ProviderDraft) => void
}

function ArchiveFields({ provider, value, onChange }: ProviderExtrasProps) {
  const set = (patch: Partial<ProviderDraft>) => onChange({ ...value, ...patch })
  return (
    <>
      <Subheading>Offline archive</Subheading>
      <FormRow label="Enabled" helper="Match against a local archive database instead of the API.">
        <Switch
          checked={value.archiveEnabled}
          onCheckedChange={(v) => set({ archiveEnabled: v })}
          label="Offline archive"
        />
      </FormRow>
      {provider === 'bangumi' && (
        <FormRow label="Archive directory">
          <FieldInput
            aria-label="Archive directory"
            className="w-56"
            value={value.archiveDir}
            onChange={(e) => set({ archiveDir: e.target.value })}
          />
        </FormRow>
      )}
      {provider === 'eHentai' && (
        <>
          <FormRow label="Download URL" helper="Empty uses the default e-hentai-db release.">
            <FieldInput
              aria-label="Archive download URL"
              className="w-56"
              value={value.archiveUrl}
              onChange={(e) => set({ archiveUrl: e.target.value })}
            />
          </FormRow>
          <FormRow label="Database file">
            <FieldInput
              aria-label="Archive database file"
              className="w-56"
              value={value.archiveDbFile}
              onChange={(e) => set({ archiveDbFile: e.target.value })}
            />
          </FormRow>
        </>
      )}
      <FormRow label="Update interval (hours)">
        <FieldInput
          aria-label="Archive update interval in hours"
          className="w-24 text-right"
          inputMode="numeric"
          value={value.archiveUpdateIntervalHours}
          onChange={(e) => set({ archiveUpdateIntervalHours: e.target.value })}
        />
      </FormRow>
      <FormRow label="Idle release (seconds)" helper="0 keeps the archive loaded.">
        <FieldInput
          aria-label="Archive idle release in seconds"
          className="w-24 text-right"
          inputMode="numeric"
          value={value.archiveIdleReleaseSecs}
          onChange={(e) => set({ archiveIdleReleaseSecs: e.target.value })}
        />
      </FormRow>
      {provider === 'eHentai' && (
        <>
          <div className="py-3">
            <p className="text-sm text-ink-2">Category filter</p>
            <p className="mt-0.5 text-xs text-ink-3">Only archive entries in these categories, one per line.</p>
            <div className="mt-2">
              <StringListInput
                aria-label="Archive category filter"
                value={value.archiveSearchCategoryFilter}
                onChange={(v) => set({ archiveSearchCategoryFilter: v })}
              />
            </div>
          </div>
          <div className="py-3">
            <p className="text-sm text-ink-2">Uploader filter</p>
            <p className="mt-0.5 text-xs text-ink-3">Only archive entries from these uploaders, one per line.</p>
            <div className="mt-2">
              <StringListInput
                aria-label="Archive uploader filter"
                value={value.archiveSearchUploaderFilter}
                onChange={(v) => set({ archiveSearchUploaderFilter: v })}
              />
            </div>
          </div>
        </>
      )}
    </>
  )
}

/** Provider-specific settings beyond the shared enable/priority/field-toggle blocks. */
export function ProviderExtras({ provider, value, onChange }: ProviderExtrasProps) {
  const set = (patch: Partial<ProviderDraft>) => onChange({ ...value, ...patch })

  switch (provider) {
    case 'aniList':
      return (
        <>
          <FormRow label="Tags score threshold">
            <FieldInput
              aria-label="Tags score threshold"
              className="w-24 text-right"
              inputMode="numeric"
              value={value.tagsScoreThreshold}
              onChange={(e) => set({ tagsScoreThreshold: e.target.value })}
            />
          </FormRow>
          <FormRow label="Tags size limit">
            <FieldInput
              aria-label="Tags size limit"
              className="w-24 text-right"
              inputMode="numeric"
              value={value.tagsSizeLimit}
              onChange={(e) => set({ tagsSizeLimit: e.target.value })}
            />
          </FormRow>
        </>
      )
    case 'mangaDex':
      return (
        <>
          <div className="py-3">
            <p className="text-sm text-ink-2">Cover languages</p>
            <p className="mt-0.5 text-xs text-ink-3">BCP-47 language codes, one per line.</p>
            <div className="mt-2">
              <StringListInput
                aria-label="Cover languages"
                value={value.coverLanguages}
                onChange={(v) => set({ coverLanguages: v })}
              />
            </div>
          </div>
          <div className="py-3">
            <p className="text-sm text-ink-2">Links</p>
            <p className="mt-0.5 text-xs text-ink-3">External links carried over from MangaDex.</p>
            <div className="mt-2">
              <Checklist
                options={MANGADEX_LINK_OPTIONS.map((l) => ({ value: l, label: l.replaceAll('_', ' ') }))}
                values={value.links}
                onChange={(v) => set({ links: v })}
                className="sm:grid-cols-3"
              />
            </div>
          </div>
        </>
      )
    case 'mangaBaka':
      return (
        <FormRow label="Mode" helper="DATABASE matches against the offline MangaBaka dump.">
          <SegmentedControl
            options={[
              { value: 'API', label: 'API' },
              { value: 'DATABASE', label: 'Database' },
            ]}
            value={value.mode}
            onChange={(v) => set({ mode: v })}
          />
        </FormRow>
      )
    case 'bangumi':
      return (
        <>
          <div className="py-3">
            <p className="text-sm text-ink-2">Tag whitelist</p>
            <p className="mt-0.5 text-xs text-ink-3">Only these tags are imported, one per line.</p>
            <div className="mt-2">
              <StringListInput
                aria-label="Tag whitelist"
                value={value.tagWhitelist}
                onChange={(v) => set({ tagWhitelist: v })}
              />
            </div>
          </div>
          <FormRow label="Tag whitelist file" helper="File with one tag per line; overrides the list above.">
            <FieldInput
              aria-label="Tag whitelist file"
              className="w-56"
              value={value.tagWhitelistFile}
              onChange={(e) => set({ tagWhitelistFile: e.target.value })}
            />
          </FormRow>
          <ArchiveFields provider={provider} value={value} onChange={onChange} />
        </>
      )
    case 'eHentai':
      return (
        <>
          <div className="py-3">
            <p className="text-sm text-ink-2">Preferred languages</p>
            <p className="mt-0.5 text-xs text-ink-3">BCP-47 language codes, one per line.</p>
            <div className="mt-2">
              <StringListInput
                aria-label="Preferred languages"
                value={value.preferredLanguages}
                onChange={(v) => set({ preferredLanguages: v })}
              />
            </div>
          </div>
          <FormRow label="Title priority">
            <SelectInput
              aria-label="Title priority"
              options={[
                { value: 'jpn', label: 'Japanese' },
                { value: 'eng', label: 'English' },
              ]}
              value={value.titlePriority}
              onChange={(v) => set({ titlePriority: v })}
            />
          </FormRow>
          <div className="py-3">
            <p className="text-sm text-ink-2">Translator keywords</p>
            <p className="mt-0.5 text-xs text-ink-3">Group names recognized as translators, one per line.</p>
            <div className="mt-2">
              <StringListInput
                aria-label="Translator keywords"
                value={value.translatorKeywords}
                onChange={(v) => set({ translatorKeywords: v })}
              />
            </div>
          </div>
          <FormRow label="Male-only tags file">
            <FieldInput
              aria-label="Male-only tags file"
              className="w-56"
              value={value.maleOnlyTagsFile}
              onChange={(e) => set({ maleOnlyTagsFile: e.target.value })}
            />
          </FormRow>
          <FormRow label="Title template" helper="Supports a {translator} placeholder.">
            <FieldInput
              aria-label="Title template"
              className="w-56"
              value={value.titleTemplate}
              onChange={(e) => set({ titleTemplate: e.target.value })}
            />
          </FormRow>
          <FormRow label="Translate tags">
            <Switch
              checked={value.tagTranslationEnabled}
              onCheckedChange={(v) => set({ tagTranslationEnabled: v })}
              label="Translate tags"
            />
          </FormRow>
          <FormRow label="Tag translation URL" helper="Empty uses the official EhTagTranslation release.">
            <FieldInput
              aria-label="Tag translation URL"
              className="w-56"
              value={value.tagTranslationUrl}
              onChange={(e) => set({ tagTranslationUrl: e.target.value })}
            />
          </FormRow>
          <FormRow label="GID-only match" helper="Auto-match only by gallery ID; link matching is unaffected.">
            <Switch
              checked={value.gidOnlyMatch}
              onCheckedChange={(v) => set({ gidOnlyMatch: v })}
              label="GID-only match"
            />
          </FormRow>
          <FormRow label="Search domain">
            <SelectInput
              aria-label="Search domain"
              options={[
                { value: 'e-hentai', label: 'e-hentai' },
                { value: 'exhentai', label: 'exhentai' },
              ]}
              value={value.searchDomain}
              onChange={(v) => set({ searchDomain: v })}
            />
          </FormRow>
          <FormRow label="IPB member ID" helper="ExHentai login cookie.">
            <FieldInput
              aria-label="IPB member ID"
              className="w-56"
              value={value.ipbMemberId}
              onChange={(e) => set({ ipbMemberId: e.target.value })}
            />
          </FormRow>
          <FormRow label="IPB pass hash" helper="ExHentai login cookie.">
            <FieldInput
              aria-label="IPB pass hash"
              className="w-56"
              value={value.ipbPassHash}
              onChange={(e) => set({ ipbPassHash: e.target.value })}
            />
          </FormRow>
          <ArchiveFields provider={provider} value={value} onChange={onChange} />
        </>
      )
    default:
      return null
  }
}
