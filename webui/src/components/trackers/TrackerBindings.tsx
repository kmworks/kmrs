import { useState } from 'react'
import { Link } from 'react-router-dom'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { ArrowLeft, ArrowRight, ChartLineUp, Trash } from '@phosphor-icons/react'
import { trackerLinkKeys, trackersApi } from '@/lib/api/trackers'
import type { KomfOAuthProvider, TrackerLink } from '@/lib/api/types'
import { urls } from '@/lib/utils/urls'
import { Button } from '@/components/ui/Button'
import { IconButton } from '@/components/ui/IconButton'
import { Tooltip } from '@/components/ui/Tooltip'
import { SegmentedControl } from '@/components/ui/SegmentedControl'
import { TrackerLogo } from '@/components/trackers/TrackerLogo'
import { CoverImage } from '@/components/media/CoverImage'

const PROVIDERS: KomfOAuthProvider[] = ['anilist', 'bangumi', 'mal', 'mangabaka']
const PAGE_SIZE = 20

type ProviderFilter = KomfOAuthProvider | 'all'

function filterLabel(label: string, count: number) {
  return (
    <span className="inline-flex items-baseline gap-1">
      <span>{label}</span>
      <span className="text-[10px] font-normal text-ink-3">{count}</span>
    </span>
  )
}

export function TrackerBindings({ onUnlink }: { onUnlink: (link: TrackerLink) => void }) {
  const { t } = useTranslation('trackers')
  const [filter, setFilter] = useState<ProviderFilter>('all')
  const [page, setPage] = useState(0)
  const provider = filter === 'all' ? undefined : filter
  const linksQuery = useQuery({
    queryKey: trackerLinkKeys.list(page, provider),
    queryFn: () => trackersApi.listLinks({ page, size: PAGE_SIZE, provider }),
    placeholderData: keepPreviousData,
    retry: false,
  })
  const data = linksQuery.data
  const totalPages = data?.totalPages
  const groups = data?.content ?? []
  const seriesCount = data?.counts.series ?? 0
  const pageCount = Math.max(1, totalPages ?? 1)

  if (totalPages !== undefined && page > 0 && page >= totalPages) {
    setPage(Math.max(0, totalPages - 1))
  }

  return (
    <section className="mt-8">
      <div className="mb-3">
        <h2 className="flex items-center gap-2 font-display text-lg font-semibold text-ink">
          <ChartLineUp className="size-5 text-ink-3" />
          {t('page.bindingsHeading')}
        </h2>
        <p className="mt-1 text-xs text-ink-3">{t('page.bindingsHint')}</p>
      </div>
      {linksQuery.isPending ? null : seriesCount === 0 ? (
        <p className="text-sm text-ink-3">{t('section.empty')}</p>
      ) : (
        <>
          <SegmentedControl
            className="mb-4 max-w-full flex-wrap"
            size="sm"
            value={filter}
            onChange={(value) => {
              setFilter(value)
              setPage(0)
            }}
            options={[
              { value: 'all', label: filterLabel(t('page.filterAll'), seriesCount) },
              ...PROVIDERS.map((provider) => ({
                value: provider,
                label: filterLabel(t(`provider.${provider}`), data?.counts.providers[provider] ?? 0),
                icon: <TrackerLogo provider={provider} className="size-3.5" />,
              })),
            ]}
          />
          {groups.length === 0 ? (
            <p className="text-sm text-ink-3">{t('page.noMatches')}</p>
          ) : (
            <ul className="divide-y divide-line rounded-xl border border-line bg-surface">
              {groups.map((group) => {
                const first = group.links[0]
                const title = first.title || `#${first.trackId}`
                return (
                  <li key={group.seriesId} className="flex flex-col gap-2 px-4 py-2 lg:flex-row lg:items-center lg:gap-4">
                    <div className="flex min-w-0 flex-1 items-center gap-2.5">
                      <CoverImage src={urls.seriesThumbnail(first.seriesId)} alt={title} className="w-9 shrink-0" />
                      <Link
                        to={`/series/${first.seriesId}`}
                        className="truncate text-sm font-medium text-ink transition-colors hover:text-accent-strong"
                      >
                        {title}
                      </Link>
                    </div>
                    <div className="flex flex-wrap gap-1.5 lg:justify-end">
                      {group.links.map((link) => (
                        <div
                          key={link.provider}
                          className="flex h-8 min-w-0 items-center gap-1.5 rounded-lg border border-line bg-raised px-2 text-xs"
                        >
                          <TrackerLogo provider={link.provider} className="size-3.5 shrink-0" />
                          <span className="truncate font-medium text-ink-2">{t(`provider.${link.provider}`)}</span>
                          <span className="shrink-0 text-ink-3">{t(`mode.${link.trackMode}`)}</span>
                          {link.chapterOffset !== 0 && (
                            <span className="shrink-0 text-ink-3">{t('page.offset', { offset: link.chapterOffset })}</span>
                          )}
                          <Tooltip content={t('row.unlink')}>
                            <IconButton label={t('row.unlink')} className="-mr-1 size-6 shrink-0" onClick={() => onUnlink(link)}>
                              <Trash className="size-3.5" />
                            </IconButton>
                          </Tooltip>
                        </div>
                      ))}
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
          {pageCount > 1 && (
            <div className="mt-4 flex items-center justify-between gap-3">
              <p className="text-sm text-ink-3">{t('page.pageInfo', { page: page + 1, pages: pageCount })}</p>
              <div className="flex gap-2">
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={page === 0 || linksQuery.isFetching}
                  onClick={() => setPage(page - 1)}
                >
                  <ArrowLeft className="size-4" /> {t('page.previous')}
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={!data || data.last || linksQuery.isFetching}
                  onClick={() => setPage(page + 1)}
                >
                  {t('page.next')} <ArrowRight className="size-4" />
                </Button>
              </div>
            </div>
          )}
        </>
      )}
    </section>
  )
}
