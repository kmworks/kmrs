import { Fragment, useCallback, useEffect, useMemo, type ReactNode } from 'react'
import { Link, Navigate, useParams, useSearchParams } from 'react-router-dom'
import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { CaretRight, CircleNotch, MagnifyingGlass, WarningCircle } from '@phosphor-icons/react'
import { motion, useReducedMotion } from 'motion/react'
import { booksApi } from '@/lib/api/books'
import { collectionsApi, readlistsApi } from '@/lib/api/collections'
import { seriesApi } from '@/lib/api/series'
import type { Page } from '@/lib/api/types'
import { useDocumentTitle } from '@/lib/hooks/useDocumentTitle'
import { useDensityCardWidth } from '@/lib/store/ui'
import { BackButton, HistoryBackButton } from '@/components/ui/BackButton'
import { Button } from '@/components/ui/Button'
import { EmptyState } from '@/components/ui/EmptyState'
import { PageHeader } from '@/components/ui/PageHeader'
import { CardSkeleton, GridSkeleton, Skeleton } from '@/components/ui/Skeleton'
import { BookCard } from '@/components/media/BookCard'
import { HorizontalRow } from '@/components/media/HorizontalRow'
import { MediaGrid } from '@/components/media/MediaGrid'
import { CollectionCard, ReadListCard, SeriesCard } from '@/components/media/SeriesCard'
import { cardSelection, useSelection } from '@/components/selection/useSelection'
import { SelectionModeButton } from '@/components/selection/SelectionModeButton'
import { SeriesSelectionBar } from '@/components/browse/SeriesSelectionBar'
import { BooksSelectionBar } from '@/components/browse/BooksSelectionBar'
import { libraryScopeCondition } from '@/components/filters/builders'
import { Sentinel } from '@/components/filters/Sentinel'
import { scopeKey, scopeLibraryIds, scopeValue, useSearchScope, type SearchScope } from '@/components/search/scope'

const CATEGORIES = ['series', 'books', 'collections', 'readlists'] as const

type SearchCategory = (typeof CATEGORIES)[number]

function parseCategory(raw: string | null | undefined): SearchCategory | undefined {
  return CATEGORIES.some((category) => category === raw) ? (raw as SearchCategory) : undefined
}

function scopedSearch(q: string, libraryIds: string[] | undefined) {
  const condition = libraryScopeCondition(libraryIds ?? [])
  return { fullTextSearch: q, ...(condition && { condition }) }
}

function categorySearchUrl(category: SearchCategory, q: string, scope: SearchScope) {
  const params = new URLSearchParams({ q })
  const scopeParam = scopeValue(scope)
  if (scopeParam !== 'all') params.set('scope', scopeParam)
  return `/search/${category}?${params}`
}

export function SearchPage() {
  const { t } = useTranslation('search')
  const [searchParams] = useSearchParams()
  const q = (searchParams.get('q') ?? '').trim()
  const { scope } = useSearchScope()

  useDocumentTitle(q ? t('titleWithQuery', { q }) : t('title'))

  return (
    <div>
      <HistoryBackButton to="/dashboard" className="mb-4 -ml-2" />
      {!q ? (
        <EmptyState
          icon={<MagnifyingGlass />}
          title={t('emptyTitle')}
          body={t('emptyBody')}
        />
      ) : (
        <AllResults q={q} scope={scope} />
      )}
    </div>
  )
}

export function SearchCategoryPage() {
  const { t } = useTranslation('search')
  const [searchParams] = useSearchParams()
  const category = parseCategory(useParams().category)
  const q = (searchParams.get('q') ?? '').trim()
  const { scope } = useSearchScope()
  const libraryIds = scopeLibraryIds(scope)
  const sk = scopeKey(scope)

  useDocumentTitle(category ? (q ? t('titleWithQuery', { q }) : t(`categories.${category}`)) : undefined)

  const seriesSel = useSelection()
  const booksSel = useSelection()
  const activeSel = category === 'books' ? booksSel : seriesSel
  const clearSeriesSel = seriesSel.clear
  const clearBooksSel = booksSel.clear
  // results are replaced wholesale when the query, category or scope changes; stale selections would point at hidden items
  useEffect(() => {
    clearSeriesSel()
    clearBooksSel()
  }, [q, category, sk, clearSeriesSel, clearBooksSel])

  const qs = searchParams.toString()
  const backTo = qs ? `/search?${qs}` : '/search'
  if (!category) return <Navigate to={backTo} replace />

  return (
    <div>
      <BackButton to={backTo} className="mb-2 -ml-2" />
      <PageHeader
        title={t(`categories.${category}`)}
        actions={
          category === 'series' || category === 'books' ? (
            <SelectionModeButton active={activeSel.active} onToggle={activeSel.toggleActive} />
          ) : undefined
        }
      />
      {!q ? (
        <EmptyState
          icon={<MagnifyingGlass />}
          title={t('emptyTitle')}
          body={t('emptyBody')}
        />
      ) : category === 'series' ? (
        <CategoryGrid
          q={q}
          queryKey={['series', 'search', q, sk]}
          fetchPage={(page) => seriesApi.list({ search: scopedSearch(q, libraryIds), page, size: 24 })}
          renderCard={(s, ids) => <SeriesCard series={s} selection={cardSelection(seriesSel, s.id, ids)} />}
          selectionBar={(items) => <SeriesSelectionBar selection={seriesSel} items={items} />}
        />
      ) : category === 'books' ? (
        <CategoryGrid
          q={q}
          queryKey={['books', 'search', q, sk]}
          fetchPage={(page) => booksApi.list({ search: scopedSearch(q, libraryIds), page, size: 24 })}
          renderCard={(b, ids) => <BookCard book={b} showSeries selection={cardSelection(booksSel, b.id, ids)} />}
          selectionBar={(items) => <BooksSelectionBar selection={booksSel} loadedIds={items.map((b) => b.id)} />}
        />
      ) : category === 'collections' ? (
        <CategoryGrid
          q={q}
          queryKey={['collections', 'search', q, sk]}
          fetchPage={(page) => collectionsApi.list({ search: q, libraryId: libraryIds, page, size: 24 })}
          renderCard={(c) => <CollectionCard id={c.id} name={c.name} count={c.seriesIds.length} />}
        />
      ) : (
        <CategoryGrid
          q={q}
          queryKey={['readlists', 'search', q, sk]}
          fetchPage={(page) => readlistsApi.list({ search: q, libraryId: libraryIds, page, size: 24 })}
          renderCard={(r) => <ReadListCard id={r.id} name={r.name} count={r.bookIds.length} />}
        />
      )}
    </div>
  )
}

function AllResults({ q, scope }: { q: string; scope: SearchScope }) {
  const { t } = useTranslation('search')
  const libraryIds = scopeLibraryIds(scope)
  const sk = scopeKey(scope)
  const series = useQuery({
    queryKey: ['series', 'search', q, sk, 'preview'],
    queryFn: () => seriesApi.list({ search: scopedSearch(q, libraryIds), size: 8 }),
  })
  const books = useQuery({
    queryKey: ['books', 'search', q, sk, 'preview'],
    queryFn: () => booksApi.list({ search: scopedSearch(q, libraryIds), size: 8 }),
  })
  const collections = useQuery({
    queryKey: ['collections', 'search', q, sk, 'preview'],
    queryFn: () => collectionsApi.list({ search: q, libraryId: libraryIds, size: 8 }),
  })
  const readlists = useQuery({
    queryKey: ['readlists', 'search', q, sk, 'preview'],
    queryFn: () => readlistsApi.list({ search: q, libraryId: libraryIds, size: 8 }),
  })
  const queries = [series, books, collections, readlists]
  const reduce = useReducedMotion()

  if (queries.some((x) => x.isLoading)) return <PreviewSkeleton />

  const failed = queries.find((x) => x.isLoadingError)
  if (failed) {
    return <SearchError error={failed.error} onRetry={() => queries.forEach((x) => void x.refetch())} />
  }

  const total = queries.reduce((n, x) => n + (x.data?.totalElements ?? 0), 0)
  if (total === 0) return <NoResults q={q} />

  return (
    <motion.div
      className="space-y-8"
      initial={reduce ? false : { opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, ease: 'easeOut' }}
    >
      <PreviewRow
        title={t('categories.series')}
        to={categorySearchUrl('series', q, scope)}
        page={series.data}
        renderCard={(s) => <SeriesCard series={s} />}
      />
      <PreviewRow
        title={t('categories.books')}
        to={categorySearchUrl('books', q, scope)}
        page={books.data}
        renderCard={(b) => <BookCard book={b} showSeries />}
      />
      <PreviewRow
        title={t('categories.collections')}
        to={categorySearchUrl('collections', q, scope)}
        page={collections.data}
        renderCard={(c) => <CollectionCard id={c.id} name={c.name} count={c.seriesIds.length} />}
      />
      <PreviewRow
        title={t('categories.readlists')}
        to={categorySearchUrl('readlists', q, scope)}
        page={readlists.data}
        renderCard={(r) => <ReadListCard id={r.id} name={r.name} count={r.bookIds.length} />}
      />
    </motion.div>
  )
}

function PreviewRow<T extends { id: string }>({
  title,
  to,
  page,
  renderCard,
}: {
  title: string
  to: string
  page?: Page<T>
  renderCard: (item: T) => ReactNode
}) {
  const { t } = useTranslation('search')
  const width = useDensityCardWidth()
  if (!page || page.totalElements === 0) return null
  return (
    <HorizontalRow title={`${title} · ${page.totalElements}`} to={to}>
      {page.content.map((item) => (
        <div key={item.id} className="shrink-0 snap-start" style={{ width }}>
          {renderCard(item)}
        </div>
      ))}
      {page.totalElements > page.content.length && (
        <Link
          to={to}
          style={{ width }}
          className="cover-aspect flex shrink-0 snap-start flex-col items-center justify-center gap-1.5 self-start rounded-lg border border-line text-[13px] font-medium text-ink-3 transition-colors hover:border-accent/50 hover:text-accent-strong"
        >
          {t('viewAll')}
          <CaretRight className="size-4" />
        </Link>
      )}
    </HorizontalRow>
  )
}

function CategoryGrid<T extends { id: string }>({
  q,
  queryKey,
  fetchPage,
  renderCard,
  selectionBar,
}: {
  q: string
  queryKey: readonly unknown[]
  fetchPage: (page: number) => Promise<Page<T>>
  /** orderedIds is the loaded grid order, used for shift-click range selection */
  renderCard: (item: T, orderedIds: string[]) => ReactNode
  /** rendered below the grid with the currently loaded items (batch actions) */
  selectionBar?: (items: T[]) => ReactNode
}) {
  const { data, isLoading, isLoadingError, error, refetch, fetchNextPage, hasNextPage, isFetchingNextPage } =
    useInfiniteQuery({
      queryKey,
      queryFn: ({ pageParam }) => fetchPage(pageParam),
      initialPageParam: 0,
      getNextPageParam: (last) => (last.last ? undefined : last.number + 1),
    })

  const loadMore = useCallback(() => {
    if (hasNextPage && !isFetchingNextPage) void fetchNextPage()
  }, [hasNextPage, isFetchingNextPage, fetchNextPage])

  const items = useMemo(() => data?.pages.flatMap((p) => p.content) ?? [], [data?.pages])
  const loadedIds = useMemo(() => items.map((i) => i.id), [items])

  if (isLoading) return <GridSkeleton count={12} />
  if (isLoadingError) return <SearchError error={error} onRetry={() => void refetch()} />
  if (items.length === 0) return <NoResults q={q} />

  return (
    <>
      <MediaGrid>
        {items.map((item) => (
          <Fragment key={item.id}>{renderCard(item, loadedIds)}</Fragment>
        ))}
      </MediaGrid>
      {selectionBar?.(items)}
      {isFetchingNextPage && (
        <div className="mt-8 flex justify-center text-ink-3">
          <CircleNotch className="size-5 animate-spin" />
        </div>
      )}
      <Sentinel active={!!hasNextPage} onIntersect={loadMore} />
    </>
  )
}

function NoResults({ q }: { q: string }) {
  const { t } = useTranslation('search')
  return (
    <EmptyState
      icon={<MagnifyingGlass />}
      title={t('noResultsTitle', { q })}
      body={t('noResultsBody')}
    />
  )
}

function SearchError({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  const { t } = useTranslation('search')
  return (
    <EmptyState
      icon={<WarningCircle />}
      title={t('failedTitle')}
      body={error instanceof Error ? error.message : t('failedBody')}
      action={<Button onClick={onRetry}>{t('common:action.retry')}</Button>}
    />
  )
}

function PreviewSkeleton() {
  const width = useDensityCardWidth()
  return (
    <div className="space-y-8">
      {[0, 1].map((i) => (
        <div key={i}>
          <Skeleton className="mb-4 h-5.5 w-44" />
          <div className="flex gap-4 overflow-hidden">
            {Array.from({ length: 6 }, (_, j) => (
              <div key={j} className="shrink-0" style={{ width }}>
                <CardSkeleton />
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}
