import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { ArrowLeft, ArrowRight, ArrowSquareOut, ChartLineUp, Trash } from '@phosphor-icons/react'
import { trackerEntryUrl } from '@/lib/api/trackers'
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

export function TrackerBindings({
  links,
  loading,
  onUnlink,
}: {
  links: TrackerLink[]
  loading: boolean
  onUnlink: (link: TrackerLink) => void
}) {
  const { t } = useTranslation('trackers')
  const [filter, setFilter] = useState<ProviderFilter>('all')
  const [page, setPage] = useState(0)
  const groups = useMemo(() => {
    const bySeries = new Map<string, TrackerLink[]>()
    for (const link of links) {
      const group = bySeries.get(link.seriesId) ?? []
      group.push(link)
      bySeries.set(link.seriesId, group)
    }
    return Array.from(bySeries.values())
  }, [links])
  const filtered = filter === 'all' ? groups : groups.filter((group) => group.some((link) => link.provider === filter))
  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const currentPage = Math.min(page, pageCount - 1)
  const pageGroups = filtered.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE)

  return (
    <section className="mt-8">
      <div className="mb-3">
        <h2 className="flex items-center gap-2 font-display text-lg font-semibold text-ink">
          <ChartLineUp className="size-5 text-ink-3" />
          {t('page.bindingsHeading')}
        </h2>
        <p className="mt-1 text-xs text-ink-3">{t('page.bindingsHint')}</p>
      </div>
      {loading ? null : links.length === 0 ? (
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
              { value: 'all', label: t('page.filterAll', { count: groups.length }) },
              ...PROVIDERS.map((provider) => ({
                value: provider,
                label: t('page.providerCount', {
                  provider: t(`provider.${provider}`),
                  count: links.filter((link) => link.provider === provider).length,
                }),
                icon: <TrackerLogo provider={provider} className="size-3.5" />,
              })),
            ]}
          />
          {pageGroups.length === 0 ? (
            <p className="text-sm text-ink-3">{t('page.noMatches')}</p>
          ) : (
            <ul className="divide-y divide-line rounded-xl border border-line bg-surface">
              {pageGroups.map((group) => {
                const first = group[0]
                const title = first.title || `#${first.trackId}`
                return (
                  <li key={first.seriesId} className="flex flex-col gap-3 px-4 py-3 lg:flex-row lg:items-center">
                    <div className="flex min-w-0 items-center gap-3 lg:flex-1">
                      <CoverImage src={urls.seriesThumbnail(first.seriesId)} alt={title} className="w-11 shrink-0" />
                      <Link
                        to={`/series/${first.seriesId}`}
                        className="truncate text-sm font-medium text-ink transition-colors hover:text-accent-strong"
                      >
                        {title}
                      </Link>
                    </div>
                    <div className="flex flex-wrap gap-2 lg:max-w-2/3 lg:justify-end">
                      {group.map((link) => (
                        <div key={link.provider} className="flex items-center gap-1.5 rounded-lg bg-raised px-2 py-1 text-xs">
                          <TrackerLogo provider={link.provider} className="size-3.5" />
                          <span className="font-medium text-ink-2">{t(`provider.${link.provider}`)}</span>
                          <a
                            href={trackerEntryUrl(link.provider, link.trackId)}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-0.5 font-mono text-ink-3 transition-colors hover:text-accent-strong"
                          >
                            #{link.trackId}
                            <ArrowSquareOut className="size-3" />
                          </a>
                          <span className="text-ink-3">{t(`mode.${link.trackMode}`)}</span>
                          {link.chapterOffset !== 0 && (
                            <span className="text-ink-3">{t('page.offset', { offset: link.chapterOffset })}</span>
                          )}
                          <Tooltip content={t('row.unlink')}>
                            <IconButton label={t('row.unlink')} className="size-6" onClick={() => onUnlink(link)}>
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
              <p className="text-sm text-ink-3">{t('page.pageInfo', { page: currentPage + 1, pages: pageCount })}</p>
              <div className="flex gap-2">
                <Button variant="secondary" size="sm" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}>
                  <ArrowLeft className="size-4" /> {t('page.previous')}
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={currentPage >= pageCount - 1}
                  onClick={() => setPage(currentPage + 1)}
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
