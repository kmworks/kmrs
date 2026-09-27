export type GroupKey =
  | 'readStatus'
  | 'seriesStatus'
  | 'complete'
  | 'oneshot'
  | 'deleted'
  | 'letter'
  | 'publishers'
  | 'genres'
  | 'tags'
  | 'sharingLabels'
  | 'ageRatings'
  | 'languages'
  | 'releaseYears'
  | 'authors'
  | 'mediaProfiles'
  | 'mediaStatuses'
  | 'poster'

/** How multiple values inside one group combine in the search DSL. */
export type GroupMode = 'any' | 'all'

export interface AuthorFilter {
  name: string
  role: string
}

export interface FilterState {
  q: string
  readStatus: string[]
  seriesStatus: string[]
  complete: string[]
  oneshot: string[]
  deleted: string[]
  letter: string[]
  publishers: string[]
  genres: string[]
  tags: string[]
  sharingLabels: string[]
  ageRatings: string[]
  languages: string[]
  releaseYears: string[]
  authors: AuthorFilter[]
  mediaProfiles: string[]
  mediaStatuses: string[]
  poster: string[]
  /** groups combined with allOf instead of the default anyOf */
  matchAll: GroupKey[]
  /** groups whose values are matched with isNot instead of is */
  exclude: GroupKey[]
}

export type ReferentialKind =
  | 'publishers'
  | 'genres'
  | 'seriesTags'
  | 'bookTags'
  | 'sharingLabels'
  | 'ageRatings'
  | 'languages'
  | 'releaseDates'

export interface FilterGroupDef {
  key: GroupKey
  label: string
  kind: 'enum' | 'referential' | 'authors' | 'letters'
  options?: { value: string; label: string }[]
  referential?: ReferentialKind
  /** hidden from non-admin users */
  adminOnly?: boolean
  /** offers an is / is-not switch once values are selected */
  negatable?: boolean
}

export interface SortOption {
  label: string
  property: string
}

export interface SortState {
  property: string
  direction: 'asc' | 'desc'
}

const READ_STATUS_OPTIONS = [
  { value: 'READ', label: 'Read' },
  { value: 'UNREAD', label: 'Unread' },
  { value: 'IN_PROGRESS', label: 'In progress' },
]

const YES_NO_OPTIONS = [
  { value: 'true', label: 'Yes' },
  { value: 'false', label: 'No' },
]

/** First-letter navigation values; '#' stands for titles not starting with a letter. */
export const LETTERS = [...'ABCDEFGHIJKLMNOPQRSTUVWXYZ']

export const SERIES_FILTER_GROUPS: FilterGroupDef[] = [
  { key: 'readStatus', label: 'Read status', kind: 'enum', options: READ_STATUS_OPTIONS, negatable: true },
  {
    key: 'seriesStatus',
    label: 'Series status',
    kind: 'enum',
    options: [
      { value: 'ONGOING', label: 'Ongoing' },
      { value: 'ENDED', label: 'Ended' },
      { value: 'ABANDONED', label: 'Abandoned' },
      { value: 'HIATUS', label: 'Hiatus' },
    ],
  },
  { key: 'letter', label: 'First letter', kind: 'letters' },
  { key: 'complete', label: 'Complete', kind: 'enum', options: YES_NO_OPTIONS },
  { key: 'oneshot', label: 'Oneshot', kind: 'enum', options: YES_NO_OPTIONS },
  { key: 'deleted', label: 'Deleted', kind: 'enum', options: YES_NO_OPTIONS, adminOnly: true },
  { key: 'publishers', label: 'Publishers', kind: 'referential', referential: 'publishers' },
  { key: 'genres', label: 'Genres', kind: 'referential', referential: 'genres' },
  { key: 'tags', label: 'Tags', kind: 'referential', referential: 'seriesTags' },
  { key: 'sharingLabels', label: 'Sharing labels', kind: 'referential', referential: 'sharingLabels' },
  { key: 'ageRatings', label: 'Age rating', kind: 'referential', referential: 'ageRatings' },
  { key: 'languages', label: 'Languages', kind: 'referential', referential: 'languages' },
  { key: 'releaseYears', label: 'Release years', kind: 'referential', referential: 'releaseDates' },
  { key: 'authors', label: 'Authors', kind: 'authors' },
]

export const BOOK_FILTER_GROUPS: FilterGroupDef[] = [
  { key: 'readStatus', label: 'Read status', kind: 'enum', options: READ_STATUS_OPTIONS, negatable: true },
  { key: 'tags', label: 'Tags', kind: 'referential', referential: 'bookTags' },
  {
    key: 'mediaProfiles',
    label: 'Media profile',
    kind: 'enum',
    options: [
      { value: 'DIVINA', label: 'Divina' },
      { value: 'PDF', label: 'PDF' },
      { value: 'EPUB', label: 'EPUB' },
    ],
  },
  {
    key: 'mediaStatuses',
    label: 'Media status',
    kind: 'enum',
    options: [
      { value: 'READY', label: 'Ready' },
      { value: 'ERROR', label: 'Error' },
      { value: 'UNKNOWN', label: 'Unknown' },
      { value: 'UNSUPPORTED', label: 'Unsupported' },
      { value: 'OUTDATED', label: 'Outdated' },
    ],
  },
  {
    key: 'poster',
    label: 'Poster',
    kind: 'enum',
    options: [
      { value: 'selected', label: 'Has poster' },
      { value: 'missing', label: 'No poster' },
    ],
  },
  { key: 'releaseYears', label: 'Release years', kind: 'referential', referential: 'releaseDates' },
  { key: 'authors', label: 'Authors', kind: 'authors' },
]

export const SERIES_SORT_OPTIONS: SortOption[] = [
  { label: 'Title', property: 'metadata.titleSort' },
  { label: 'Date added', property: 'createdDate' },
  { label: 'Date updated', property: 'lastModifiedDate' },
  { label: 'Release date', property: 'booksMetadata.releaseDate' },
  { label: 'Last read', property: 'readDate' },
  { label: 'Folder name', property: 'name' },
  { label: 'Books count', property: 'booksCount' },
  { label: 'Random', property: 'random' },
]

export const BOOK_SORT_OPTIONS: SortOption[] = [
  { label: 'Title', property: 'metadata.titleSort' },
  { label: 'Series', property: 'series' },
  { label: 'Number', property: 'metadata.numberSort' },
  { label: 'Date added', property: 'createdDate' },
  { label: 'Date updated', property: 'lastModifiedDate' },
  { label: 'Release date', property: 'metadata.releaseDate' },
  { label: 'Last read', property: 'readProgress.readDate' },
  { label: 'File name', property: 'url' },
  { label: 'File size', property: 'fileSize' },
  { label: 'Pages', property: 'media.pagesCount' },
]

/** sorting by series is meaningless inside a single series' book list */
export const SERIES_BOOK_SORT_OPTIONS = BOOK_SORT_OPTIONS.filter((o) => o.property !== 'series')

// the list-order properties only exist when the search condition joins the list (readListId/collectionId leaf)
export const READLIST_BOOK_SORT_OPTIONS: SortOption[] = [
  { label: 'List order', property: 'readList.number' },
  ...SERIES_BOOK_SORT_OPTIONS,
]

export const COLLECTION_SERIES_SORT_OPTIONS: SortOption[] = [
  { label: 'List order', property: 'collection.number' },
  ...SERIES_SORT_OPTIONS,
]

export const SERIES_DEFAULT_SORT: SortState = { property: 'metadata.titleSort', direction: 'asc' }
export const BOOK_DEFAULT_SORT: SortState = { property: 'name', direction: 'asc' }
export const SERIES_BOOK_DEFAULT_SORT: SortState = { property: 'metadata.numberSort', direction: 'asc' }
export const READLIST_ORDER_SORT: SortState = { property: 'readList.number', direction: 'asc' }
/** kmrs orders unordered read lists by release date */
export const READLIST_DATE_SORT: SortState = { property: 'metadata.releaseDate', direction: 'asc' }
export const COLLECTION_ORDER_SORT: SortState = { property: 'collection.number', direction: 'asc' }
