import { useMemo, useState, type FormEvent, type InputHTMLAttributes, type ReactNode } from 'react'
import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query'
import { Copy, LockSimple, LockSimpleOpen, Minus, Plus } from '@phosphor-icons/react'
import { booksApi } from '@/lib/api/books'
import type { BookDto, BookMetadataUpdateDto } from '@/lib/api/types'
import { cn } from '@/lib/utils/cn'
import { Button } from '@/components/ui/Button'
import { Dialog } from '@/components/ui/Dialog'
import { IconButton } from '@/components/ui/IconButton'
import { SegmentedControl } from '@/components/ui/SegmentedControl'
import { Skeleton } from '@/components/ui/Skeleton'
import { TextField } from '@/components/ui/TextField'
import { EmptyState } from '@/components/ui/EmptyState'
import { LabelListEditor } from '@/components/admin/users/LabelListEditor'
import { BatchField, FormErrorBanner, LockToggle, PairListEditor, TextAreaField, TextInput, type Pair, type PairErrors } from './fields'
import { isValidIsbn13, isValidUrl, mapViolations } from './validation'

const GENERAL_FIELDS = ['title', 'summary', 'number', 'numberSort', 'releaseDate', 'isbn']

type Tab = 'general' | 'authors' | 'tags' | 'links'

const TAB_OF_FIELD: Record<string, Tab> = {
  ...Object.fromEntries(GENERAL_FIELDS.map((f) => [f, 'general' as Tab])),
  authors: 'authors',
  tags: 'tags',
  links: 'links',
}

function validatePairs(pairs: Pair[], bCheck: (v: string) => string | undefined): PairErrors {
  const out: PairErrors = {}
  pairs.forEach((p, i) => {
    const row: { a?: string; b?: string } = {}
    if (!p.a.trim()) row.a = 'Must not be blank'
    const bError = bCheck(p.b)
    if (bError) row.b = bError
    if (row.a || row.b) out[i] = row
  })
  return out
}

const authorCheck = (v: string) => (v.trim() ? undefined : 'Must not be blank')
const urlCheck = (v: string) => (isValidUrl(v.trim()) ? undefined : 'Must be a valid URL')

export function EditBooksDialog({ open, onClose, bookIds }: { open: boolean; onClose: () => void; bookIds: string[] }) {
  const singleId = bookIds.length === 1 ? bookIds[0] : null
  const bookQuery = useQuery({
    queryKey: ['books', singleId],
    queryFn: () => booksApi.get(singleId!),
    enabled: open && !!singleId,
  })

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) onClose()
      }}
      title={singleId ? 'Edit book metadata' : `Edit metadata of ${bookIds.length} books`}
      size="lg"
    >
      {singleId && bookQuery.isPending && (
        <div className="flex flex-col gap-4 px-5 py-4">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-2/3" />
          <Skeleton className="h-24 w-full" />
        </div>
      )}
      {singleId && bookQuery.error && (
        <EmptyState
          title="Could not load the book"
          body={bookQuery.error.message}
          action={
            <Button variant="secondary" onClick={() => bookQuery.refetch()}>
              Retry
            </Button>
          }
        />
      )}
      {singleId && bookQuery.data && <SingleBookForm key={bookQuery.data.id} book={bookQuery.data} onClose={onClose} />}
      {!singleId && open && <BatchBooksForm key={bookIds.join(',')} ids={bookIds} onClose={onClose} />}
    </Dialog>
  )
}

function SingleBookForm({ book, onClose }: { book: BookDto; onClose: () => void }) {
  const queryClient = useQueryClient()
  const md = book.metadata
  const [tab, setTab] = useState<Tab>('general')
  const [title, setTitle] = useState(md.title)
  const [summary, setSummary] = useState(md.summary)
  const [number, setNumber] = useState(md.number)
  const [numberSort, setNumberSort] = useState(String(md.numberSort))
  const [releaseDate, setReleaseDate] = useState(md.releaseDate ?? '')
  const [isbn, setIsbn] = useState(md.isbn)
  const [authors, setAuthors] = useState<Pair[]>(md.authors.map((a) => ({ a: a.name, b: a.role })))
  const [tags, setTags] = useState<string[]>(md.tags)
  const [links, setLinks] = useState<Pair[]>(md.links.map((l) => ({ a: l.label, b: l.url })))
  const [locks, setLocks] = useState({
    title: md.titleLock,
    summary: md.summaryLock,
    number: md.numberLock,
    numberSort: md.numberSortLock,
    releaseDate: md.releaseDateLock,
    isbn: md.isbnLock,
    authors: md.authorsLock,
    tags: md.tagsLock,
    links: md.linksLock,
  })
  type LockKey = keyof typeof locks
  const toggleLock = (key: LockKey) => setLocks((p) => ({ ...p, [key]: !p[key] }))
  // editing a field locks it, mirroring komga: manual edits are protected from metadata refresh
  const autoLock = (key: LockKey) => setLocks((p) => (p[key] ? p : { ...p, [key]: true }))
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [pairErrors, setPairErrors] = useState<{ authors: PairErrors; links: PairErrors }>({ authors: {}, links: {} })
  const [formErrors, setFormErrors] = useState<string[]>([])

  const save = useMutation({
    mutationFn: (body: BookMetadataUpdateDto) => booksApi.patchMetadata(book.id, body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['books'] })
      queryClient.invalidateQueries({ queryKey: ['series'] })
      queryClient.invalidateQueries({ queryKey: ['dashboard'] })
      queryClient.invalidateQueries({ queryKey: ['readlists'] })
      onClose()
    },
    onError: (err) => {
      const mapped = mapViolations(err)
      const scalars: Record<string, string> = {}
      const rest = [...mapped.rest]
      for (const [k, v] of Object.entries(mapped.scalars)) {
        if (TAB_OF_FIELD[k]) scalars[k] = v
        else rest.push(`${k}: ${v}`)
      }
      setErrors(scalars)
      setPairErrors((p) => ({
        authors: { ...p.authors, ...mapped.pairs.authors },
        links: { ...p.links, ...mapped.pairs.links },
      }))
      setFormErrors(rest.length > 0 ? rest : [err instanceof Error ? err.message : 'Could not save the metadata.'])
      jumpToError([...Object.keys(scalars), ...Object.keys(mapped.pairs)])
    },
  })

  const jumpToError = (fields: string[]) => {
    const first = fields.map((f) => TAB_OF_FIELD[f]).find((t) => t && t !== tab)
    if (first) setTab(first)
  }

  const submit = (ev: FormEvent) => {
    ev.preventDefault()
    if (save.isPending) return
    const e: Record<string, string> = {}
    if (!title.trim()) e.title = 'Must not be blank'
    if (!number.trim()) e.number = 'Must not be blank'
    if (!numberSort.trim() || Number.isNaN(Number(numberSort))) e.numberSort = 'Must be a number'
    if (isbn.trim() && !isValidIsbn13(isbn)) e.isbn = 'Must be blank or a valid ISBN-13'
    const ae = validatePairs(authors, authorCheck)
    const le = validatePairs(links, urlCheck)
    setErrors(e)
    setPairErrors({ authors: ae, links: le })
    setFormErrors([])
    const failed = [...Object.keys(e), ...(Object.keys(ae).length > 0 ? ['authors'] : []), ...(Object.keys(le).length > 0 ? ['links'] : [])]
    if (failed.length > 0) {
      jumpToError(failed)
      return
    }
    save.mutate({
      title: title.trim(),
      titleLock: locks.title,
      number: number.trim(),
      numberLock: locks.number,
      numberSort: Number(numberSort),
      numberSortLock: locks.numberSort,
      summary: summary.trim() === '' ? null : summary,
      summaryLock: locks.summary,
      releaseDate: releaseDate === '' ? null : releaseDate,
      releaseDateLock: locks.releaseDate,
      isbn: isbn.trim() === '' ? null : isbn.trim(),
      isbnLock: locks.isbn,
      authors: authors.map((p) => ({ name: p.a.trim(), role: p.b.trim() })),
      authorsLock: locks.authors,
      tags,
      tagsLock: locks.tags,
      links: links.map((p) => ({ label: p.a.trim(), url: p.b.trim() })),
      linksLock: locks.links,
    })
  }

  const clearError = (key: string) =>
    setErrors((p) => {
      const next = { ...p }
      delete next[key]
      return next
    })

  return (
    <form onSubmit={submit}>
      <div className="flex flex-col gap-5 px-5 py-4">
        <FormErrorBanner messages={formErrors} />
        <SegmentedControl<Tab>
          options={[
            { value: 'general', label: 'General' },
            { value: 'authors', label: 'Authors' },
            { value: 'tags', label: 'Tags' },
            { value: 'links', label: 'Links' },
          ]}
          value={tab}
          onChange={setTab}
        />

        {tab === 'general' && (
          <>
            <div className="grid gap-4 sm:grid-cols-2">
              <TextField
                label="Title"
                required
                value={title}
                onChange={(e) => { setTitle(e.target.value); autoLock('title'); clearError('title') }}
                error={errors.title}
                trailing={<LockToggle locked={locks.title} onChange={() => toggleLock('title')} label="Title" />}
              />
              <TextField
                label="Number"
                required
                value={number}
                onChange={(e) => { setNumber(e.target.value); autoLock('number'); clearError('number') }}
                error={errors.number}
                trailing={<LockToggle locked={locks.number} onChange={() => toggleLock('number')} label="Number" />}
              />
              <TextField
                label="Sort number"
                required
                type="number"
                step="0.1"
                value={numberSort}
                onChange={(e) => { setNumberSort(e.target.value); autoLock('numberSort'); clearError('numberSort') }}
                error={errors.numberSort}
                helper={errors.numberSort ? undefined : 'You can use decimal numbers'}
                trailing={<LockToggle locked={locks.numberSort} onChange={() => toggleLock('numberSort')} label="Sort number" />}
              />
              <TextField
                label="Release date"
                type="date"
                value={releaseDate}
                onChange={(e) => { setReleaseDate(e.target.value); autoLock('releaseDate') }}
                error={errors.releaseDate}
                trailing={<LockToggle locked={locks.releaseDate} onChange={() => toggleLock('releaseDate')} label="Release date" />}
              />
              <TextField
                label="ISBN"
                value={isbn}
                onChange={(e) => { setIsbn(e.target.value); autoLock('isbn'); clearError('isbn') }}
                error={errors.isbn}
                helper={errors.isbn ? undefined : 'ISBN-13, empty to clear'}
                trailing={<LockToggle locked={locks.isbn} onChange={() => toggleLock('isbn')} label="ISBN" />}
              />
            </div>
            <TextAreaField
              label="Summary"
              value={summary}
              onChange={(v) => { setSummary(v); autoLock('summary') }}
              error={errors.summary}
              trailing={<LockToggle locked={locks.summary} onChange={() => toggleLock('summary')} label="Summary" />}
            />
          </>
        )}

        {tab === 'authors' && (
          <PairListEditor
            label="Authors"
            pairs={authors}
            onChange={(p) => { setAuthors(p); autoLock('authors') }}
            aLabel="Name"
            bLabel="Role"
            aPlaceholder="Kentaro Miura"
            bPlaceholder="writer"
            addLabel="Add author"
            errors={pairErrors.authors}
            trailing={<LockToggle locked={locks.authors} onChange={() => toggleLock('authors')} label="Authors" />}
          />
        )}

        {tab === 'tags' && (
          <LabelListEditor
            label="Tags"
            values={tags}
            onChange={(v) => { setTags(v); autoLock('tags') }}
            placeholder="Add tag…"
            trailing={<LockToggle locked={locks.tags} onChange={() => toggleLock('tags')} label="Tags" />}
          />
        )}

        {tab === 'links' && (
          <PairListEditor
            label="Web links"
            pairs={links}
            onChange={(p) => { setLinks(p); autoLock('links') }}
            aLabel="Label"
            bLabel="URL"
            aPlaceholder="Wiki"
            bPlaceholder="https://…"
            addLabel="Add link"
            errors={pairErrors.links}
            trailing={<LockToggle locked={locks.links} onChange={() => toggleLock('links')} label="Web links" />}
          />
        )}
      </div>

      <div className="flex justify-end gap-2 border-t border-line px-5 py-3.5">
        <Button type="button" variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button type="submit" variant="primary" loading={save.isPending}>
          Save changes
        </Button>
      </div>
    </form>
  )
}

type BatchKey = 'summary' | 'releaseDate' | 'isbn' | 'authors' | 'tags' | 'links'
type PerBookKey = 'title' | 'number' | 'numberSort' | 'releaseDate' | 'isbn'

interface BookRow {
  values: Record<PerBookKey, string>
  locks: Record<PerBookKey, boolean>
  /** value edited */
  dirty: Record<PerBookKey, boolean>
  /** lock toggled without editing the value */
  lockTouched: Record<PerBookKey, boolean>
}

const BOOK_ROW_GRID = 'sm:grid-cols-[minmax(0,1fr)_5rem_6.5rem_8rem_9rem]'

function LockableInput({
  label,
  locked,
  onLockChange,
  error,
  ...rest
}: {
  label: string
  locked: boolean
  onLockChange: (v: boolean) => void
  error?: string
} & InputHTMLAttributes<HTMLInputElement>) {
  return (
    <div>
      <div className="relative">
        <TextInput aria-label={label} placeholder={label} error={!!error} className="pr-8" {...rest} />
        <div className="absolute inset-y-0 right-1 flex items-center">
          <LockToggle locked={locked} onChange={onLockChange} label={label} />
        </div>
      </div>
      {error && <p className="mt-1 text-[13px] text-danger">{error}</p>}
    </div>
  )
}

/** Column header of the per-book grid: label, lock-all toggle, and optional column helpers. */
function BulkColumnHead({
  label,
  status,
  onToggleAll,
  children,
}: {
  label: string
  /** 0 = none locked, 1 = some, 2 = all */
  status: 0 | 1 | 2
  onToggleAll: () => void
  children?: ReactNode
}) {
  return (
    <div className="flex items-center gap-0.5">
      <button
        type="button"
        onClick={onToggleAll}
        aria-label={status === 2 ? `Unlock all ${label}` : `Lock all ${label}`}
        title={status === 2 ? `Unlock all ${label}` : `Lock all ${label}`}
        className={cn(
          'inline-flex cursor-pointer items-center justify-center rounded-md p-1 transition-colors hover:bg-overlay',
          status !== 0 ? 'text-accent' : 'text-ink-3',
        )}
      >
        {status === 0 ? <LockSimpleOpen className="size-3.5" /> : <LockSimple className="size-3.5" weight={status === 2 ? 'bold' : 'regular'} />}
      </button>
      <span className="text-xs font-medium text-ink-3">{label}</span>
      {children}
    </div>
  )
}

function BatchBooksForm({ ids, onClose }: { ids: string[]; onClose: () => void }) {
  const queryClient = useQueryClient()
  const [tab, setTab] = useState<'shared' | 'perBook'>('shared')
  const [enabled, setEnabled] = useState<Partial<Record<BatchKey, boolean>>>({})
  const [sharedLocks, setSharedLocks] = useState<Partial<Record<BatchKey, boolean>>>({})
  const [summary, setSummary] = useState('')
  const [releaseDate, setReleaseDate] = useState('')
  const [isbn, setIsbn] = useState('')
  const [authors, setAuthors] = useState<Pair[]>([])
  const [tags, setTags] = useState<string[]>([])
  const [links, setLinks] = useState<Pair[]>([])
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [pairErrors, setPairErrors] = useState<{ authors: PairErrors; links: PairErrors }>({ authors: {}, links: {} })
  const [formErrors, setFormErrors] = useState<string[]>([])
  const [rowErrors, setRowErrors] = useState<Record<string, Partial<Record<PerBookKey, string>>>>({})
  const [edits, setEdits] = useState<Record<string, BookRow> | null>(null)

  const { booksPending, booksError, books } = useQueries({
    queries: ids.map((id) => ({ queryKey: ['books', id], queryFn: () => booksApi.get(id) })),
    combine: (results) => ({
      booksPending: results.some((r) => r.isPending),
      booksError: results.find((r) => r.error)?.error,
      books: results.every((r) => r.isSuccess) ? results.map((r) => r.data) : null,
    }),
  })

  const initialRows = useMemo(() => {
    if (!books) return null
    return Object.fromEntries(
      books.map((b) => [
        b.id,
        {
          values: {
            title: b.metadata.title,
            number: b.metadata.number,
            numberSort: String(b.metadata.numberSort),
            releaseDate: b.metadata.releaseDate ?? '',
            isbn: b.metadata.isbn,
          },
          locks: {
            title: b.metadata.titleLock,
            number: b.metadata.numberLock,
            numberSort: b.metadata.numberSortLock,
            releaseDate: b.metadata.releaseDateLock,
            isbn: b.metadata.isbnLock,
          },
          dirty: { title: false, number: false, numberSort: false, releaseDate: false, isbn: false },
          lockTouched: { title: false, number: false, numberSort: false, releaseDate: false, isbn: false },
        },
      ]),
    ) as Record<string, BookRow>
  }, [books])
  const rows = edits ?? initialRows
  const bookById = new Map((books ?? []).map((b) => [b.id, b]))

  const updateRows = (fn: (rs: Record<string, BookRow>) => Record<string, BookRow>) =>
    setEdits((prev) => fn(prev ?? initialRows ?? {}))

  const setValue = (id: string, key: PerBookKey, value: string) =>
    updateRows((rs) => ({
      ...rs,
      [id]: {
        ...rs[id],
        values: { ...rs[id].values, [key]: value },
        dirty: { ...rs[id].dirty, [key]: true },
        locks: { ...rs[id].locks, [key]: true },
      },
    }))

  const toggleRowLock = (id: string, key: PerBookKey) =>
    updateRows((rs) => ({
      ...rs,
      [id]: { ...rs[id], locks: { ...rs[id].locks, [key]: !rs[id].locks[key] }, lockTouched: { ...rs[id].lockTouched, [key]: true } },
    }))

  const lockAll = (key: PerBookKey, v: boolean) =>
    updateRows((rs) =>
      Object.fromEntries(
        Object.entries(rs).map(([id, r]) => [id, { ...r, locks: { ...r.locks, [key]: v }, lockTouched: { ...r.lockTouched, [key]: true } }]),
      ),
    )

  const lockStatus = (key: PerBookKey): 0 | 1 | 2 => {
    if (!rows) return 0
    const count = Object.values(rows).filter((r) => r.locks[key]).length
    if (count === 0) return 0
    return count === ids.length ? 2 : 1
  }

  const shiftAllNumberSort = (delta: number) =>
    updateRows((rs) =>
      Object.fromEntries(
        Object.entries(rs).map(([id, r]) => [
          id,
          {
            ...r,
            values: { ...r.values, numberSort: String((Number(r.values.numberSort) || 0) + delta) },
            dirty: { ...r.dirty, numberSort: true },
            locks: { ...r.locks, numberSort: true },
          },
        ]),
      ),
    )

  const copySortToNumber = () =>
    updateRows((rs) =>
      Object.fromEntries(
        Object.entries(rs).map(([id, r]) => [
          id,
          { ...r, values: { ...r.values, number: r.values.numberSort }, dirty: { ...r.dirty, number: true }, locks: { ...r.locks, number: true } },
        ]),
      ),
    )

  const toggle = (key: BatchKey) => (v: boolean) => {
    setEnabled((p) => ({ ...p, [key]: v }))
    if (v) setSharedLocks((p) => ({ ...p, [key]: p[key] ?? true }))
  }
  const toggleSharedLock = (key: BatchKey) => (v: boolean) => setSharedLocks((p) => ({ ...p, [key]: v }))
  const anyEnabled = Object.values(enabled).some(Boolean)
  const anyTouched = !!rows && Object.values(rows).some((r) => Object.values(r.dirty).some(Boolean) || Object.values(r.lockTouched).some(Boolean))

  const save = useMutation({
    mutationFn: (bodies: Record<string, BookMetadataUpdateDto>) => booksApi.bulkPatchMetadata(bodies),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['books'] })
      queryClient.invalidateQueries({ queryKey: ['series'] })
      queryClient.invalidateQueries({ queryKey: ['dashboard'] })
      queryClient.invalidateQueries({ queryKey: ['readlists'] })
      onClose()
    },
    onError: (err) => {
      const mapped = mapViolations(err)
      setErrors(mapped.scalars)
      setFormErrors(mapped.rest.length > 0 ? mapped.rest : [err instanceof Error ? err.message : 'Could not save the metadata.'])
    },
  })

  const submit = (ev: FormEvent) => {
    ev.preventDefault()
    if (save.isPending || (!anyEnabled && !anyTouched)) return
    const e: Record<string, string> = {}
    if (enabled.isbn && isbn.trim() && !isValidIsbn13(isbn)) e.isbn = 'Must be blank or a valid ISBN-13'
    const ae = enabled.authors ? validatePairs(authors, authorCheck) : {}
    const le = enabled.links ? validatePairs(links, urlCheck) : {}
    const re: Record<string, Partial<Record<PerBookKey, string>>> = {}
    if (rows) {
      for (const [id, r] of Object.entries(rows)) {
        const row: Partial<Record<PerBookKey, string>> = {}
        if (r.dirty.title && !r.values.title.trim()) row.title = 'Must not be blank'
        if (r.dirty.number && !r.values.number.trim()) row.number = 'Must not be blank'
        if (r.dirty.numberSort && (!r.values.numberSort.trim() || Number.isNaN(Number(r.values.numberSort)))) row.numberSort = 'Must be a number'
        if (r.dirty.isbn && r.values.isbn.trim() && !isValidIsbn13(r.values.isbn)) row.isbn = 'Must be blank or a valid ISBN-13'
        if (Object.keys(row).length > 0) re[id] = row
      }
    }
    setErrors(e)
    setPairErrors({ authors: ae, links: le })
    setRowErrors(re)
    setFormErrors([])
    if (Object.keys(e).length > 0 || Object.keys(ae).length > 0 || Object.keys(le).length > 0 || Object.keys(re).length > 0) {
      setTab(Object.keys(re).length > 0 ? 'perBook' : 'shared')
      return
    }

    const shared: BookMetadataUpdateDto = {}
    if (enabled.summary) {
      shared.summary = summary.trim() === '' ? null : summary
      shared.summaryLock = sharedLocks.summary ?? true
    }
    if (enabled.releaseDate) {
      shared.releaseDate = releaseDate === '' ? null : releaseDate
      shared.releaseDateLock = sharedLocks.releaseDate ?? true
    }
    if (enabled.isbn) {
      shared.isbn = isbn.trim() === '' ? null : isbn.trim()
      shared.isbnLock = sharedLocks.isbn ?? true
    }
    if (enabled.authors) {
      shared.authors = authors.map((p) => ({ name: p.a.trim(), role: p.b.trim() }))
      shared.authorsLock = sharedLocks.authors ?? true
    }
    if (enabled.tags) {
      shared.tags = tags
      shared.tagsLock = sharedLocks.tags ?? true
    }
    if (enabled.links) {
      shared.links = links.map((p) => ({ label: p.a.trim(), url: p.b.trim() }))
      shared.linksLock = sharedLocks.links ?? true
    }

    const bodies: Record<string, BookMetadataUpdateDto> = {}
    for (const id of ids) {
      // per-book fields win over shared ones for the same book
      const body: BookMetadataUpdateDto = { ...shared }
      const r = rows?.[id]
      if (r) {
        if (r.dirty.title) body.title = r.values.title.trim()
        if (r.dirty.number) body.number = r.values.number.trim()
        if (r.dirty.numberSort) body.numberSort = Number(r.values.numberSort)
        if (r.dirty.releaseDate) body.releaseDate = r.values.releaseDate === '' ? null : r.values.releaseDate
        if (r.dirty.isbn) body.isbn = r.values.isbn.trim() === '' ? null : r.values.isbn.trim()
        if (r.dirty.title || r.lockTouched.title) body.titleLock = r.locks.title
        if (r.dirty.number || r.lockTouched.number) body.numberLock = r.locks.number
        if (r.dirty.numberSort || r.lockTouched.numberSort) body.numberSortLock = r.locks.numberSort
        if (r.dirty.releaseDate || r.lockTouched.releaseDate) body.releaseDateLock = r.locks.releaseDate
        if (r.dirty.isbn || r.lockTouched.isbn) body.isbnLock = r.locks.isbn
      }
      if (Object.keys(body).length > 0) bodies[id] = body
    }
    save.mutate(bodies)
  }

  return (
    <form onSubmit={submit}>
      <div className="flex flex-col gap-3 px-5 py-4">
        <FormErrorBanner messages={formErrors} />
        <SegmentedControl<'shared' | 'perBook'>
          options={[
            { value: 'shared', label: 'Shared fields' },
            { value: 'perBook', label: 'Per book' },
          ]}
          value={tab}
          onChange={setTab}
        />

        {tab === 'shared' && (
          <>
            <p className="text-sm text-ink-3">Switched-on fields are applied to all {ids.length} books and locked by default.</p>

            <BatchField label="Summary" enabled={!!enabled.summary} onEnabledChange={toggle('summary')} hint="Empty clears the summary." locked={sharedLocks.summary ?? true} onLockedChange={toggleSharedLock('summary')}>
              <TextAreaField ariaLabel="Summary" value={summary} onChange={setSummary} />
            </BatchField>

            <BatchField label="Release date" enabled={!!enabled.releaseDate} onEnabledChange={toggle('releaseDate')} hint="Empty clears the date." locked={sharedLocks.releaseDate ?? true} onLockedChange={toggleSharedLock('releaseDate')}>
              <TextInput type="date" value={releaseDate} onChange={(e) => setReleaseDate(e.target.value)} aria-label="Release date" />
            </BatchField>

            <BatchField label="ISBN" enabled={!!enabled.isbn} onEnabledChange={toggle('isbn')} hint="ISBN-13, empty to clear." locked={sharedLocks.isbn ?? true} onLockedChange={toggleSharedLock('isbn')}>
              <TextInput
                value={isbn}
                onChange={(e) => { setIsbn(e.target.value); setErrors((p) => { const next = { ...p }; delete next.isbn; return next }) }}
                aria-label="ISBN"
                error={!!errors.isbn}
              />
              {errors.isbn && <p className="mt-1 text-[13px] text-danger">{errors.isbn}</p>}
            </BatchField>

            <BatchField label="Authors" enabled={!!enabled.authors} onEnabledChange={toggle('authors')} hint="Replaces all authors; an empty list clears them." locked={sharedLocks.authors ?? true} onLockedChange={toggleSharedLock('authors')}>
              <PairListEditor
                pairs={authors}
                onChange={setAuthors}
                aLabel="Name"
                bLabel="Role"
                aPlaceholder="Kentaro Miura"
                bPlaceholder="writer"
                addLabel="Add author"
                errors={pairErrors.authors}
              />
            </BatchField>

            <BatchField label="Tags" enabled={!!enabled.tags} onEnabledChange={toggle('tags')} hint="Replaces all tags; an empty list clears them." locked={sharedLocks.tags ?? true} onLockedChange={toggleSharedLock('tags')}>
              <LabelListEditor label="Tags" values={tags} onChange={setTags} placeholder="Add tag…" />
            </BatchField>

            <BatchField label="Web links" enabled={!!enabled.links} onEnabledChange={toggle('links')} hint="Replaces all links; an empty list clears them." locked={sharedLocks.links ?? true} onLockedChange={toggleSharedLock('links')}>
              <PairListEditor
                pairs={links}
                onChange={setLinks}
                aLabel="Label"
                bLabel="URL"
                aPlaceholder="Wiki"
                bPlaceholder="https://…"
                addLabel="Add link"
                errors={pairErrors.links}
              />
            </BatchField>
          </>
        )}

        {tab === 'perBook' && (
          <>
            <p className="text-sm text-ink-3">Only fields you touch are sent; editing locks the field. Per-book values override shared fields.</p>
            {booksPending && (
              <div className="flex flex-col gap-3">
                <Skeleton className="h-24 w-full" />
                <Skeleton className="h-24 w-full" />
              </div>
            )}
            {booksError && (
              <EmptyState
                title="Could not load the books"
                body={booksError.message}
                action={
                  <Button variant="secondary" onClick={() => queryClient.invalidateQueries({ queryKey: ['books'] })}>
                    Retry
                  </Button>
                }
              />
            )}
            {rows && (
              <div className="flex flex-col gap-3">
                <div className={cn('hidden gap-2 sm:grid', BOOK_ROW_GRID)}>
                  <BulkColumnHead label="Title" status={lockStatus('title')} onToggleAll={() => lockAll('title', lockStatus('title') !== 2)} />
                  <BulkColumnHead label="Number" status={lockStatus('number')} onToggleAll={() => lockAll('number', lockStatus('number') !== 2)}>
                    <IconButton label="Copy sort number into number" className="size-6" onClick={copySortToNumber}>
                      <Copy className="size-3.5" />
                    </IconButton>
                  </BulkColumnHead>
                  <BulkColumnHead label="Sort number" status={lockStatus('numberSort')} onToggleAll={() => lockAll('numberSort', lockStatus('numberSort') !== 2)}>
                    <IconButton label="Decrement all by 1" className="size-6" onClick={() => shiftAllNumberSort(-1)}>
                      <Minus className="size-3.5" />
                    </IconButton>
                    <IconButton label="Increment all by 1" className="size-6" onClick={() => shiftAllNumberSort(1)}>
                      <Plus className="size-3.5" />
                    </IconButton>
                  </BulkColumnHead>
                  <BulkColumnHead label="Release date" status={lockStatus('releaseDate')} onToggleAll={() => lockAll('releaseDate', lockStatus('releaseDate') !== 2)} />
                  <BulkColumnHead label="ISBN" status={lockStatus('isbn')} onToggleAll={() => lockAll('isbn', lockStatus('isbn') !== 2)} />
                </div>
                {ids.map((id) => {
                  const row = rows[id]
                  const book = bookById.get(id)
                  if (!row || !book) return null
                  return (
                    <div key={id} className="rounded-lg border border-line p-3">
                      <p className="mb-2 truncate text-[13px] font-medium text-ink-2">{book.name}</p>
                      <div className={cn('grid gap-2', BOOK_ROW_GRID)}>
                        <LockableInput label="Title" value={row.values.title} onChange={(e) => setValue(id, 'title', e.target.value)} locked={row.locks.title} onLockChange={() => toggleRowLock(id, 'title')} error={rowErrors[id]?.title} />
                        <LockableInput label="Number" value={row.values.number} onChange={(e) => setValue(id, 'number', e.target.value)} locked={row.locks.number} onLockChange={() => toggleRowLock(id, 'number')} error={rowErrors[id]?.number} />
                        <LockableInput label="Sort number" type="number" step="0.1" value={row.values.numberSort} onChange={(e) => setValue(id, 'numberSort', e.target.value)} locked={row.locks.numberSort} onLockChange={() => toggleRowLock(id, 'numberSort')} error={rowErrors[id]?.numberSort} />
                        <LockableInput label="Release date" type="date" value={row.values.releaseDate} onChange={(e) => setValue(id, 'releaseDate', e.target.value)} locked={row.locks.releaseDate} onLockChange={() => toggleRowLock(id, 'releaseDate')} error={rowErrors[id]?.releaseDate} />
                        <LockableInput label="ISBN" value={row.values.isbn} onChange={(e) => setValue(id, 'isbn', e.target.value)} locked={row.locks.isbn} onLockChange={() => toggleRowLock(id, 'isbn')} error={rowErrors[id]?.isbn} />
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </>
        )}
      </div>

      <div className="flex justify-end gap-2 border-t border-line px-5 py-3.5">
        <Button type="button" variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button type="submit" variant="primary" loading={save.isPending} disabled={!anyEnabled && !anyTouched}>
          Save changes
        </Button>
      </div>
    </form>
  )
}
