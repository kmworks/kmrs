import { useCallback, useEffect, useState } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'
import { keepPreviousData, useInfiniteQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { Books, MagnifyingGlass, WarningCircle } from '@phosphor-icons/react'
import { collectionsApi } from '@/lib/api/collections'
import { useDocumentTitle } from '@/lib/hooks/useDocumentTitle'
import { Button } from '@/components/ui/Button'
import { EmptyState } from '@/components/ui/EmptyState'
import { HistoryBackButton } from '@/components/ui/BackButton'
import { PageHeader } from '@/components/ui/PageHeader'
import { CardSkeleton, GridSkeleton } from '@/components/ui/Skeleton'
import { MediaGrid } from '@/components/media/MediaGrid'
import { CollectionCard } from '@/components/media/SeriesCard'
import { Sentinel } from '@/components/filters/Sentinel'

export function BrowseCollectionsPage() {
  const { t, i18n } = useTranslation('browse')
  const { libraryId } = useParams()
  const [searchParams, setSearchParams] = useSearchParams()
  const qParam = searchParams.get('q') ?? ''
  const [text, setText] = useState(qParam)

  useDocumentTitle(t('collections.title'))

  // external URL changes (back/forward, shared links) sync back into the input
  useEffect(() => {
    setText(qParam)
  }, [qParam])

  useEffect(() => {
    if (text === qParam) return
    const t = setTimeout(() => {
      const next = new URLSearchParams(searchParams)
      if (text.trim()) next.set('q', text)
      else next.delete('q')
      setSearchParams(next, { replace: true })
    }, 300)
    return () => clearTimeout(t)
  }, [text, qParam, searchParams, setSearchParams])

  const q = useInfiniteQuery({
    queryKey: ['collections', 'list', libraryId ?? 'all', qParam],
    queryFn: ({ pageParam }) =>
      collectionsApi.list({
        search: qParam || undefined,
        libraryId: libraryId ? [libraryId] : undefined,
        page: pageParam,
        size: 50,
      }),
    getNextPageParam: (last) => (last.last ? undefined : last.number + 1),
    initialPageParam: 0,
    placeholderData: keepPreviousData,
  })

  const items = q.data?.pages.flatMap((p) => p.content) ?? []
  const total = q.data?.pages[0]?.totalElements
  const { hasNextPage, isFetchingNextPage, isPlaceholderData, fetchNextPage } = q
  const loadMore = useCallback(() => {
    if (hasNextPage && !isFetchingNextPage && !isPlaceholderData) void fetchNextPage()
  }, [hasNextPage, isFetchingNextPage, isPlaceholderData, fetchNextPage])

  return (
    <div>
      <HistoryBackButton to="/dashboard" className="mb-2 -ml-2" />
      <PageHeader
        title={t('collections.title')}
        subtitle={
          total !== undefined ? (
            <>
              <span className="font-mono">{total.toLocaleString(i18n.language)}</span> {t('collections.count', { count: total })}
            </>
          ) : undefined
        }
      />
      <div className="mb-5">
        <div className="relative w-full max-w-xs">
          <MagnifyingGlass className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-3" />
          <input
            type="search"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={t('collections.searchPlaceholder')}
            className="h-9 w-full rounded-lg border border-line bg-surface pr-3 pl-9 text-base text-ink transition-colors placeholder:text-ink-3 focus:border-accent/70 focus:outline-none"
          />
        </div>
      </div>
      {q.isPending ? (
        <GridSkeleton count={18} />
      ) : q.isError ? (
        <EmptyState
          icon={<WarningCircle />}
          title={t('collections.loadError')}
          body={q.error?.message || t('errorFallback')}
          action={<Button onClick={() => q.refetch()}>{t('common:action.retry')}</Button>}
        />
      ) : items.length === 0 ? (
        <EmptyState
          icon={<Books />}
          title={t('collections.empty')}
          body={qParam ? t('tryDifferentSearch') : undefined}
        />
      ) : (
        <>
          <MediaGrid>
            {items.map((c) => (
              <CollectionCard key={c.id} id={c.id} name={c.name} count={c.seriesIds.length} />
            ))}
          </MediaGrid>
          {isFetchingNextPage && (
            <MediaGrid className="mt-7">
              {Array.from({ length: 4 }, (_, i) => (
                <CardSkeleton key={i} />
              ))}
            </MediaGrid>
          )}
          <Sentinel active={!!hasNextPage && !isPlaceholderData} onIntersect={loadMore} />
        </>
      )}
    </div>
  )
}
