import type {
  KomfConfig,
  KomfConfigPatch,
  KomfEventListenerConfig,
  KomfLibraryType,
  KomfMetadataProcessingConfig,
  KomfNameMatchingMode,
  KomfPostProcessingConfig,
  KomfProviderConfig,
  KomfProvidersMap,
  KomfReadingDirection,
  KomfUpdateMode,
} from '@/lib/api/types'

export const PROVIDER_KEYS = [
  'mangaUpdates',
  'mangaBaka',
  'bookWalker',
  'mangaDex',
  'aniList',
  'mal',
  'comicVine',
  'yenPress',
  'viz',
  'bangumi',
  'webtoons',
  'eHentai',
] as const satisfies readonly (keyof KomfProvidersMap)[]

export type KomfProviderKey = (typeof PROVIDER_KEYS)[number]

export const PROVIDER_LABELS: Record<KomfProviderKey, string> = {
  mangaUpdates: 'MangaUpdates',
  mangaBaka: 'MangaBaka',
  bookWalker: 'BookWalker',
  mangaDex: 'MangaDex',
  aniList: 'AniList',
  mal: 'MAL',
  comicVine: 'ComicVine',
  yenPress: 'Yen Press',
  viz: 'Viz',
  bangumi: 'Bangumi',
  webtoons: 'Webtoons',
  eHentai: 'E-Hentai',
}

/** Editable form mirror of a processing block: text inputs are strings, '' means "no value / clear". */
export interface ProcessingDraft {
  libraryType: KomfLibraryType
  aggregate: boolean
  mergeTags: boolean
  mergeGenres: boolean
  bookCovers: boolean
  seriesCovers: boolean
  overrideExistingCovers: boolean
  lockCovers: boolean
  updateModes: KomfUpdateMode[]
  overrideComicInfo: boolean
  seriesTitle: boolean
  seriesTitleLanguage: string
  alternativeSeriesTitles: boolean
  orderBooks: boolean
  readingDirectionValue: KomfReadingDirection | ''
  languageValue: string
}

export interface ProviderDraft {
  enabled: boolean
  priority: string
}

export type ProvidersDraft = Record<KomfProviderKey, ProviderDraft>

export interface KomfConfigDraft {
  eventListenerEnabled: boolean
  eventListenerLibraryFilter: string[]
  defaultProviders: ProvidersDraft
  nameMatchingMode: KomfNameMatchingMode
  malClientId: string
  comicVineApiKey: string
  bangumiToken: string
  defaultProcessing: ProcessingDraft
  /** key present = override enabled for that library */
  libraryProcessing: Record<string, ProcessingDraft>
  libraryProviders: Record<string, ProvidersDraft>
}

export function processingDraftFromConfig(p: KomfMetadataProcessingConfig): ProcessingDraft {
  return {
    libraryType: p.libraryType,
    aggregate: p.aggregate,
    mergeTags: p.mergeTags,
    mergeGenres: p.mergeGenres,
    bookCovers: p.bookCovers,
    seriesCovers: p.seriesCovers,
    overrideExistingCovers: p.overrideExistingCovers,
    lockCovers: p.lockCovers,
    updateModes: [...p.updateModes],
    overrideComicInfo: p.overrideComicInfo,
    seriesTitle: p.postProcessing.seriesTitle,
    seriesTitleLanguage: p.postProcessing.seriesTitleLanguage ?? '',
    alternativeSeriesTitles: p.postProcessing.alternativeSeriesTitles,
    orderBooks: p.postProcessing.orderBooks,
    readingDirectionValue: p.postProcessing.readingDirectionValue ?? '',
    languageValue: p.postProcessing.languageValue ?? '',
  }
}

export function providersDraftFromMap(m: KomfProvidersMap): ProvidersDraft {
  const out = {} as ProvidersDraft
  for (const key of PROVIDER_KEYS) out[key] = { enabled: m[key].enabled, priority: m[key].priority.toString() }
  return out
}

export function draftFromConfig(config: KomfConfig): KomfConfigDraft {
  return {
    eventListenerEnabled: config.komga.eventListener.enabled,
    eventListenerLibraryFilter: [...config.komga.eventListener.metadataLibraryFilter],
    defaultProviders: providersDraftFromMap(config.metadataProviders.defaultProviders),
    nameMatchingMode: config.metadataProviders.nameMatchingMode,
    malClientId: config.metadataProviders.malClientId ?? '',
    comicVineApiKey: config.metadataProviders.comicVineClientId ?? '',
    bangumiToken: config.metadataProviders.bangumiToken ?? '',
    defaultProcessing: processingDraftFromConfig(config.komga.metadataUpdate.default),
    libraryProcessing: Object.fromEntries(
      Object.entries(config.komga.metadataUpdate.library).map(([id, p]) => [id, processingDraftFromConfig(p)]),
    ),
    libraryProviders: Object.fromEntries(
      Object.entries(config.metadataProviders.libraryProviders)
        .filter((e): e is [string, KomfProvidersMap] => e[1] !== null)
        .map(([id, m]) => [id, providersDraftFromMap(m)]),
    ),
  }
}

export interface KomfDraftErrors {
  defaultProviders: Partial<Record<KomfProviderKey, string>>
  libraryProviders: Record<string, Partial<Record<KomfProviderKey, string>>>
}

function positiveInt(v: string): boolean {
  return /^\d+$/.test(v) && Number(v) > 0
}

const PRIORITY_ERROR = 'Must be a positive whole number.'

export function validateDraft(d: KomfConfigDraft): KomfDraftErrors {
  const errors: KomfDraftErrors = { defaultProviders: {}, libraryProviders: {} }
  for (const key of PROVIDER_KEYS) {
    if (!positiveInt(d.defaultProviders[key].priority.trim())) errors.defaultProviders[key] = PRIORITY_ERROR
  }
  for (const [libId, providers] of Object.entries(d.libraryProviders)) {
    const sub: Partial<Record<KomfProviderKey, string>> = {}
    for (const key of PROVIDER_KEYS) {
      if (!positiveInt(providers[key].priority.trim())) sub[key] = PRIORITY_ERROR
    }
    if (Object.keys(sub).length > 0) errors.libraryProviders[libId] = sub
  }
  return errors
}

export function hasErrors(errors: KomfDraftErrors): boolean {
  return Object.keys(errors.defaultProviders).length > 0 || Object.keys(errors.libraryProviders).length > 0
}

function sameStringSet(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((x) => b.includes(x))
}

type ProcessingPatch = Partial<Omit<KomfMetadataProcessingConfig, 'postProcessing'>> & {
  postProcessing?: Partial<KomfPostProcessingConfig>
}

type ProvidersPatch = { [K in KomfProviderKey]?: Partial<KomfProviderConfig> }

/** PATCH semantics: only dirty fields, '' on a tri-state text field clears it (null). */
function processingChanges(src: KomfMetadataProcessingConfig, d: ProcessingDraft): ProcessingPatch {
  const out: ProcessingPatch = {}
  if (d.libraryType !== src.libraryType) out.libraryType = d.libraryType
  if (d.aggregate !== src.aggregate) out.aggregate = d.aggregate
  if (d.mergeTags !== src.mergeTags) out.mergeTags = d.mergeTags
  if (d.mergeGenres !== src.mergeGenres) out.mergeGenres = d.mergeGenres
  if (d.bookCovers !== src.bookCovers) out.bookCovers = d.bookCovers
  if (d.seriesCovers !== src.seriesCovers) out.seriesCovers = d.seriesCovers
  if (d.overrideExistingCovers !== src.overrideExistingCovers) out.overrideExistingCovers = d.overrideExistingCovers
  if (d.lockCovers !== src.lockCovers) out.lockCovers = d.lockCovers
  if (!sameStringSet(d.updateModes, src.updateModes)) out.updateModes = d.updateModes
  if (d.overrideComicInfo !== src.overrideComicInfo) out.overrideComicInfo = d.overrideComicInfo
  const pp = src.postProcessing
  const post: Partial<KomfPostProcessingConfig> = {}
  if (d.seriesTitle !== pp.seriesTitle) post.seriesTitle = d.seriesTitle
  const stl = d.seriesTitleLanguage.trim()
  if (stl !== (pp.seriesTitleLanguage ?? '')) post.seriesTitleLanguage = stl === '' ? null : stl
  if (d.alternativeSeriesTitles !== pp.alternativeSeriesTitles)
    post.alternativeSeriesTitles = d.alternativeSeriesTitles
  if (d.orderBooks !== pp.orderBooks) post.orderBooks = d.orderBooks
  if (d.readingDirectionValue !== (pp.readingDirectionValue ?? ''))
    post.readingDirectionValue = d.readingDirectionValue === '' ? null : d.readingDirectionValue
  const lv = d.languageValue.trim()
  if (lv !== (pp.languageValue ?? '')) post.languageValue = lv === '' ? null : lv
  if (Object.keys(post).length > 0) out.postProcessing = post
  return out
}

/** A brand-new override sends the whole draft (komf would otherwise seed its own defaults).
    alternativeSeriesTitleLanguages stays absent so the server-side seed keeps it. */
function processingDraftToPatch(d: ProcessingDraft): ProcessingPatch {
  const stl = d.seriesTitleLanguage.trim()
  const lv = d.languageValue.trim()
  return {
    libraryType: d.libraryType,
    aggregate: d.aggregate,
    mergeTags: d.mergeTags,
    mergeGenres: d.mergeGenres,
    bookCovers: d.bookCovers,
    seriesCovers: d.seriesCovers,
    overrideExistingCovers: d.overrideExistingCovers,
    lockCovers: d.lockCovers,
    updateModes: d.updateModes,
    overrideComicInfo: d.overrideComicInfo,
    postProcessing: {
      seriesTitle: d.seriesTitle,
      seriesTitleLanguage: stl === '' ? null : stl,
      alternativeSeriesTitles: d.alternativeSeriesTitles,
      orderBooks: d.orderBooks,
      readingDirectionValue: d.readingDirectionValue === '' ? null : d.readingDirectionValue,
      languageValue: lv === '' ? null : lv,
    },
  }
}

function providersChanges(src: KomfProvidersMap, d: ProvidersDraft): ProvidersPatch {
  const out: ProvidersPatch = {}
  for (const key of PROVIDER_KEYS) {
    const sub: Partial<KomfProviderConfig> = {}
    if (d[key].enabled !== src[key].enabled) sub.enabled = d[key].enabled
    const p = d[key].priority.trim()
    if (p !== src[key].priority.toString() && positiveInt(p)) sub.priority = Number(p)
    if (Object.keys(sub).length > 0) out[key] = sub
  }
  return out
}

function providersDraftToMap(d: ProvidersDraft): KomfProvidersMap {
  const out = {} as KomfProvidersMap
  for (const key of PROVIDER_KEYS) out[key] = { enabled: d[key].enabled, priority: Number(d[key].priority) }
  return out
}

export function computeChanges(config: KomfConfig, d: KomfConfigDraft): KomfConfigPatch {
  const patch: KomfConfigPatch = {}

  const el = config.komga.eventListener
  const eventListener: Partial<KomfEventListenerConfig> = {}
  if (d.eventListenerEnabled !== el.enabled) eventListener.enabled = d.eventListenerEnabled
  if (!sameStringSet(d.eventListenerLibraryFilter, el.metadataLibraryFilter))
    eventListener.metadataLibraryFilter = d.eventListenerLibraryFilter

  const defaultProcessing = processingChanges(config.komga.metadataUpdate.default, d.defaultProcessing)

  const library: Record<string, ProcessingPatch | null> = {}
  const processingIds = new Set([
    ...Object.keys(config.komga.metadataUpdate.library),
    ...Object.keys(d.libraryProcessing),
  ])
  for (const id of processingIds) {
    const had = config.komga.metadataUpdate.library[id]
    const now = d.libraryProcessing[id]
    if (now && had) {
      const sub = processingChanges(had, now)
      if (Object.keys(sub).length > 0) library[id] = sub
    } else if (now) {
      library[id] = processingDraftToPatch(now)
    } else if (had) {
      library[id] = null
    }
  }

  const metadataUpdate: NonNullable<NonNullable<KomfConfigPatch['komga']>['metadataUpdate']> = {}
  if (Object.keys(defaultProcessing).length > 0) metadataUpdate.default = defaultProcessing
  if (Object.keys(library).length > 0) metadataUpdate.library = library

  const komga: NonNullable<KomfConfigPatch['komga']> = {}
  if (Object.keys(eventListener).length > 0) komga.eventListener = eventListener
  if (Object.keys(metadataUpdate).length > 0) komga.metadataUpdate = metadataUpdate
  if (Object.keys(komga).length > 0) patch.komga = komga

  const mp = config.metadataProviders
  const providers: NonNullable<KomfConfigPatch['metadataProviders']> = {}
  if (d.nameMatchingMode !== mp.nameMatchingMode) providers.nameMatchingMode = d.nameMatchingMode
  const mal = d.malClientId.trim()
  if (mal !== (mp.malClientId ?? '')) providers.malClientId = mal === '' ? null : mal
  const cv = d.comicVineApiKey.trim()
  if (cv !== (mp.comicVineClientId ?? '')) providers.comicVineClientId = cv === '' ? null : cv
  const bgm = d.bangumiToken.trim()
  if (bgm !== (mp.bangumiToken ?? '')) providers.bangumiToken = bgm === '' ? null : bgm

  const defaultProviders = providersChanges(mp.defaultProviders, d.defaultProviders)
  if (Object.keys(defaultProviders).length > 0) providers.defaultProviders = defaultProviders

  const libraryProviders: Record<string, ProvidersPatch | null> = {}
  const providerIds = new Set([...Object.keys(mp.libraryProviders), ...Object.keys(d.libraryProviders)])
  for (const id of providerIds) {
    const had = mp.libraryProviders[id]
    const now = d.libraryProviders[id]
    if (now && had) {
      const sub = providersChanges(had, now)
      if (Object.keys(sub).length > 0) libraryProviders[id] = sub
    } else if (now) {
      libraryProviders[id] = providersDraftToMap(now)
    } else if (had !== undefined && had !== null) {
      libraryProviders[id] = null
    }
  }
  if (Object.keys(libraryProviders).length > 0) providers.libraryProviders = libraryProviders
  if (Object.keys(providers).length > 0) patch.metadataProviders = providers

  return patch
}

/** Leaf-level change count for the save bar label. */
export function countChanges(patch: KomfConfigPatch): number {
  const count = (v: unknown): number => {
    if (v !== null && typeof v === 'object' && !Array.isArray(v))
      return Object.values(v).reduce((n, x) => n + count(x), 0)
    return 1
  }
  return count(patch)
}
