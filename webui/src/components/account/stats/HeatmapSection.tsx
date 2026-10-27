import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { statsApi } from '@/lib/api/stats'
import { formatDay, monthShort, weekdayShort } from '@/lib/utils/format'
import { cn } from '@/lib/utils/cn'
import { Skeleton } from '@/components/ui/Skeleton'
import { Tooltip } from '@/components/ui/Tooltip'
import { SectionState } from './SectionState'

const RANGE_MONTHS = 12

const CELL = 10
const GAP = 3
const PITCH = CELL + GAP
const WEEKDAY_WIDTH = 24

// the empty level must stay visible on both themes, so it derives from ink, not raised
const LEVELS = [
  'bg-[color-mix(in_srgb,var(--ink)_7%,transparent)]',
  'bg-[color-mix(in_srgb,var(--accent)_30%,transparent)]',
  'bg-[color-mix(in_srgb,var(--accent)_55%,transparent)]',
  'bg-[color-mix(in_srgb,var(--accent)_80%,transparent)]',
  'bg-accent',
]

interface DayCell {
  day: string
  pages: number
  books: number
}

function dayOf(date: Date): string {
  return date.toISOString().slice(0, 10)
}

export function HeatmapSection({ libraryId }: { libraryId?: string }) {
  const { t } = useTranslation('stats')
  const tzOffsetMinutes = -new Date().getTimezoneOffset()
  const query = useQuery({
    queryKey: ['stats', 'activity', libraryId ?? 'all', tzOffsetMinutes],
    queryFn: () => statsApi.activity(libraryId, tzOffsetMinutes),
  })

  const { weeks, quartile, hasData } = useMemo(() => {
    const byDay = new Map((query.data?.readingTimeSeries ?? []).map((p) => [p.date, p]))
    // series days are UTC, so the grid runs on UTC days to keep cells aligned with them
    const now = new Date()
    const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
    const cursor = new Date(end)
    cursor.setUTCMonth(cursor.getUTCMonth() - RANGE_MONTHS)
    // columns start on Sunday, matching the weekday buckets' indexing
    cursor.setUTCDate(cursor.getUTCDate() - cursor.getUTCDay())

    const weeks: DayCell[][] = []
    let maxPages = 0
    let hasData = false
    while (cursor <= end) {
      const week: DayCell[] = []
      for (let dow = 0; dow < 7 && cursor <= end; dow++) {
        const day = dayOf(cursor)
        const point = byDay.get(day)
        if (point) hasData = true
        if (point && point.pagesRead > maxPages) maxPages = point.pagesRead
        week.push({ day, pages: point?.pagesRead ?? 0, books: point?.booksCompleted ?? 0 })
        cursor.setUTCDate(cursor.getUTCDate() + 1)
      }
      weeks.push(week)
    }
    return { weeks, quartile: maxPages / 4, hasData }
  }, [query.data])

  const monthLabels = weeks.flatMap((week, wi) =>
    week.filter((cell) => cell.day.endsWith('-01')).map((cell) => ({ wi, day: cell.day })),
  )

  const level = (pages: number) => (pages === 0 || quartile === 0 ? 0 : Math.min(4, Math.ceil(pages / quartile)))

  return (
    <section className="min-w-0 rounded-xl border border-line bg-surface p-5">
      <h2 className="mb-4 text-[15px] font-semibold text-ink">{t('heatmap.title')}</h2>
      <SectionState query={query} skeleton={<Skeleton className="h-32 w-full" />}>
        {() =>
          !hasData ? (
            <p className="py-8 text-center text-sm text-ink-3">{t('heatmap.empty')}</p>
          ) : (
            <div className="overflow-x-auto">
              <div className="inline-block">
                <div className="relative mb-1 h-4" style={{ marginLeft: WEEKDAY_WIDTH + GAP }}>
                  {monthLabels.map(({ wi, day }) => (
                    <span key={wi} className="absolute text-[10px] text-ink-3" style={{ left: wi * PITCH }}>
                      {monthShort(day)}
                    </span>
                  ))}
                </div>
                <div className="flex" style={{ gap: GAP }}>
                  <div className="flex flex-col" style={{ gap: GAP, width: WEEKDAY_WIDTH }}>
                    {Array.from({ length: 7 }, (_, dow) => (
                      <div key={dow} className="flex items-center text-[10px] text-ink-3" style={{ height: CELL }}>
                        {dow % 2 === 1 ? weekdayShort(dow) : null}
                      </div>
                    ))}
                  </div>
                  {weeks.map((week, wi) => (
                    <div key={wi} className="flex flex-col" style={{ gap: GAP }}>
                      {week.map((cell) => (
                        <Tooltip
                          key={cell.day}
                          content={
                            <div className="flex flex-col gap-0.5">
                              <div className="font-medium">{formatDay(cell.day)}</div>
                              <div>
                                {cell.pages > 0 ? t('heatmap.pages', { count: cell.pages }) : t('heatmap.noActivity')}
                              </div>
                              {cell.books > 0 && <div>{t('heatmap.completed', { count: cell.books })}</div>}
                            </div>
                          }
                        >
                          <div
                            tabIndex={0}
                            aria-label={t('heatmap.dayLabel', {
                              date: formatDay(cell.day),
                              activity:
                                cell.pages > 0 ? t('heatmap.pages', { count: cell.pages }) : t('heatmap.noActivity'),
                            })}
                            className={cn('rounded-[2px]', LEVELS[level(cell.pages)])}
                            style={{ width: CELL, height: CELL }}
                          />
                        </Tooltip>
                      ))}
                    </div>
                  ))}
                </div>
                <div className="mt-2 flex items-center justify-end gap-1 text-[10px] text-ink-3">
                  {t('heatmap.less')}
                  {LEVELS.map((c) => (
                    <span key={c} className={cn('inline-block rounded-[2px]', c)} style={{ width: CELL, height: CELL }} />
                  ))}
                  {t('heatmap.more')}
                </div>
              </div>
            </div>
          )
        }
      </SectionState>
    </section>
  )
}
