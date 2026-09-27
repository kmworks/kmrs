import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { BookOpen, CircleNotch, Images, Warning } from '@phosphor-icons/react'
import { booksApi } from '@/lib/api/books'
import { readlistsApi } from '@/lib/api/collections'
import { bookPostersApi, readListPostersApi, seriesPostersApi } from '@/lib/api/posters'
import { seriesApi } from '@/lib/api/series'
import { ApiError } from '@/lib/api/client'
import type { BookDto, ReadingDirection } from '@/lib/api/types'
import { canDownload, isAdmin, useAuthStore } from '@/lib/store/auth'
import { useThumbnailBust } from '@/lib/store/thumbnails'
import {
  READER_BACKGROUNDS,
  useReaderSettings,
  type ContinuousScaleType,
  type ScaleType,
} from '@/lib/store/readerSettings'
import { needsConvert, supportedImageFormats } from '@/lib/utils/imageSupport'
import { showToast } from '@/lib/store/toast'
import { urls } from '@/lib/utils/urls'
import type { PagedReaderLayout, SpreadPage } from '@/lib/utils/spreads'
import { readingDirectionLabel } from '@/lib/utils/format'
import { convertErrorCodes, mediaIssue } from '@/lib/utils/mediaStatus'
import { Button } from '@/components/ui/Button'
import { EmptyState } from '@/components/ui/EmptyState'
import { ContinuousReader } from '@/components/reader/ContinuousReader'
import { PagedReader } from '@/components/reader/PagedReader'
import { ReaderChrome, type PosterTarget } from '@/components/reader/ReaderChrome'
import { SettingsPanel } from '@/components/reader/SettingsPanel'
import { ShortcutsHelp } from '@/components/reader/ShortcutsHelp'
import { ThumbnailExplorer } from '@/components/reader/ThumbnailExplorer'
import { useWindowKeys } from '@/components/reader/keys'

const SCALE_CYCLE: ScaleType[] = ['SCREEN', 'WIDTH', 'WIDTH_SHRINK_ONLY', 'HEIGHT', 'ORIGINAL']
const SCALE_LABELS: Record<ScaleType, string> = {
  SCREEN: 'Fit screen',
  WIDTH: 'Fit width',
  WIDTH_SHRINK_ONLY: 'Shrink to width',
  HEIGHT: 'Fit height',
  ORIGINAL: 'Original',
}
const CONTINUOUS_SCALE_CYCLE: ContinuousScaleType[] = ['WIDTH', 'ORIGINAL']
const CONTINUOUS_SCALE_LABELS: Record<ContinuousScaleType, string> = { WIDTH: 'Fit width', ORIGINAL: 'Original' }
const LAYOUT_CYCLE: PagedReaderLayout[] = ['SINGLE_PAGE', 'DOUBLE_PAGES', 'DOUBLE_NO_COVER']
const LAYOUT_LABELS: Record<PagedReaderLayout, string> = {
  SINGLE_PAGE: 'Single page',
  DOUBLE_PAGES: 'Double pages',
  DOUBLE_NO_COVER: 'Double pages (no cover)',
}
const DIRECTION_BY_KEY: Record<string, ReadingDirection> = {
  l: 'LEFT_TO_RIGHT',
  r: 'RIGHT_TO_LEFT',
  v: 'VERTICAL',
  w: 'WEBTOON',
}

function loadErrorReason(error: unknown): string {
  if (error instanceof ApiError) {
    const msg = convertErrorCodes(error.message)
    return msg.startsWith(String(error.status)) ? msg : `HTTP ${error.status} · ${msg}`
  }
  // network failures surface as bare TypeError from fetch, with no useful message
  if (error instanceof TypeError) return 'Could not reach the server. Check your connection and try again.'
  if (error instanceof Error) return error.message
  return 'Unknown error'
}

export function ReaderPage() {
  const { bookId = '' } = useParams()
  // remount per book so every piece of session state starts clean
  return <Reader key={bookId} bookId={bookId} />
}

function Reader({ bookId }: { bookId: string }) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [searchParams, setSearchParams] = useSearchParams()
  const context = searchParams.get('context')
  const contextId = searchParams.get('contextId')
  const incognito = searchParams.get('incognito') === 'true'
  const initialPageParam = Number(searchParams.get('page'))

  const settingsDirection = useReaderSettings((s) => s.readingDirection)
  const background = useReaderSettings((s) => s.background)
  const user = useAuthStore((s) => s.user)
  const admin = isAdmin(user)

  const bookQuery = useQuery({ queryKey: ['books', 'detail', bookId], queryFn: () => booksApi.get(bookId) })
  const book = bookQuery.data
  const seriesQuery = useQuery({
    queryKey: ['series', 'detail', book?.seriesId],
    queryFn: () => seriesApi.get(book!.seriesId),
    enabled: !!book,
  })
  const pagesQuery = useQuery({
    queryKey: ['books', 'pages', bookId],
    queryFn: async (): Promise<SpreadPage[]> => {
      const [pageDtos, supported] = await Promise.all([booksApi.pages(bookId), supportedImageFormats()])
      return pageDtos.map((p) => ({
        ...p,
        url: needsConvert(p.mediaType, supported)
          ? urls.bookPage(bookId, p.number, { convert: 'jpeg' })
          : urls.bookPage(bookId, p.number),
      }))
    },
  })
  const pages = pagesQuery.data
  const pagesCount = pages?.length ?? 0

  const siblingQuery = (dir: 'previous' | 'next') => ({
    queryKey: ['books', 'sibling', dir, bookId, context, contextId],
    queryFn: (): Promise<BookDto | null> => {
      const request =
        context === 'READLIST' && contextId ? readlistsApi[dir](contextId, bookId) : booksApi[dir](bookId)
      return request.catch((e) => {
        if (e instanceof ApiError && e.status === 404) return null
        throw e
      })
    },
  })
  const siblingPrevious = useQuery(siblingQuery('previous')).data ?? null
  const siblingNext = useQuery(siblingQuery('next')).data ?? null

  const [page, setPage] = useState<number | null>(null)
  const [chromeVisible, setChromeVisible] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [explorerOpen, setExplorerOpen] = useState(false)
  const [helpOpen, setHelpOpen] = useState(false)
  // series metadata can override the direction for this session only
  const [sessionDirection, setSessionDirection] = useState<ReadingDirection | null>(null)
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [posterBusy, setPosterBusy] = useState(false)

  const direction = sessionDirection ?? settingsDirection

  const progressTimer = useRef<number | undefined>(undefined)
  const pendingPage = useRef<number | null>(null)
  const jumpArmed = useRef<'previous' | 'next' | null>(null)
  const jumpTimer = useRef<number | undefined>(undefined)

  // initial page: ?page= wins, then unread progress, else first page
  useEffect(() => {
    if (page !== null || !book || !pages || pages.length === 0) return
    if (initialPageParam >= 1 && initialPageParam <= pages.length) setPage(Math.floor(initialPageParam))
    else if (book.readProgress && !book.readProgress.completed)
      setPage(Math.min(Math.max(1, book.readProgress.page), pages.length))
    else setPage(1)
  }, [page, book, pages, initialPageParam])

  // reflect the page in the URL so refresh and shares land on the same page
  useEffect(() => {
    if (page === null) return
    const next = new URLSearchParams()
    next.set('page', String(page))
    if (context && contextId) {
      next.set('context', context)
      next.set('contextId', contextId)
    }
    if (incognito) next.set('incognito', 'true')
    setSearchParams(next, { replace: true })
  }, [page, context, contextId, incognito, setSearchParams])

  useEffect(() => {
    if (page === null || incognito) return
    pendingPage.current = page
    window.clearTimeout(progressTimer.current)
    progressTimer.current = window.setTimeout(() => {
      if (pendingPage.current !== null) {
        booksApi.updateProgress(bookId, { page: pendingPage.current }).catch(() => {})
        pendingPage.current = null
      }
    }, 300)
  }, [page, bookId, incognito])

  // flush the debounced progress on exit
  useEffect(
    () => () => {
      window.clearTimeout(progressTimer.current)
      if (pendingPage.current !== null) {
        booksApi.updateProgress(bookId, { page: pendingPage.current }).catch(() => {})
      }
    },
    [bookId],
  )

  const metaNotified = useRef(false)
  useEffect(() => {
    const series = seriesQuery.data
    if (!series || metaNotified.current) return
    metaNotified.current = true
    const meta = series.metadata.readingDirection
    if (meta && meta !== settingsDirection) {
      setSessionDirection(meta)
      showToast('Reading direction from series metadata')
    }
  }, [seriesQuery.data, settingsDirection])

  useEffect(() => {
    if (book) document.title = `${book.metadata.title || book.name} · KMReader`
  }, [book])
  useEffect(
    () => () => {
      document.title = 'KMReader'
      window.clearTimeout(jumpTimer.current)
    },
    [],
  )

  useEffect(() => {
    const onChange = () => setIsFullscreen(!!document.fullscreenElement)
    document.addEventListener('fullscreenchange', onChange)
    return () => document.removeEventListener('fullscreenchange', onChange)
  }, [])
  useEffect(() => {
    if (useReaderSettings.getState().alwaysFullscreen && !document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(() => {})
    }
  }, [])
  useEffect(
    () => () => {
      if (document.fullscreenElement) document.exitFullscreen().catch(() => {})
    },
    [],
  )
  const toggleFullscreen = useCallback(() => {
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {})
    else document.documentElement.requestFullscreen().catch(() => {})
  }, [])
  const onAlwaysFullscreenChange = useCallback((on: boolean) => {
    useReaderSettings.getState().update({ alwaysFullscreen: on })
    if (on) document.documentElement.requestFullscreen().catch(() => {})
    else if (document.fullscreenElement) document.exitFullscreen().catch(() => {})
  }, [])

  // closing returns to whatever page opened the reader; the book page is only the fallback for direct loads
  const exitReader = useCallback(() => {
    if ((window.history.state?.idx ?? 0) > 0) navigate(-1)
    else navigate(`/book/${bookId}`)
  }, [navigate, bookId])

  const goToBook = useCallback(() => navigate(`/book/${bookId}`), [navigate, bookId])

  const contextQuery = useCallback(() => {
    const q = new URLSearchParams()
    if (context && contextId) {
      q.set('context', context)
      q.set('contextId', contextId)
    }
    if (incognito) q.set('incognito', 'true')
    const s = q.toString()
    return s ? `?${s}` : ''
  }, [context, contextId, incognito])

  const goBook = useCallback(
    (dir: 'previous' | 'next') => {
      const sibling = dir === 'next' ? siblingNext : siblingPrevious
      // replace keeps the whole reading session as one history entry, so closing still returns to the page that opened the reader
      if (sibling) navigate(`/book/${sibling.id}/read${contextQuery()}`, { replace: true })
      else exitReader()
    },
    [siblingNext, siblingPrevious, navigate, contextQuery, exitReader],
  )

  // first boundary turn arms the jump, a second one within the toast window commits it
  const boundaryTurn = useCallback(
    (dir: 'previous' | 'next') => {
      if (jumpArmed.current === dir) {
        window.clearTimeout(jumpTimer.current)
        jumpArmed.current = null
        goBook(dir)
        return
      }
      jumpArmed.current = dir
      const hasSibling = dir === 'next' ? !!siblingNext : !!siblingPrevious
      showToast(
        dir === 'next'
          ? hasSibling
            ? 'Last page. Turn again for the next book.'
            : 'Last page. Turn again to exit.'
          : hasSibling
            ? 'First page. Turn again for the previous book.'
            : 'First page. Turn again to exit.',
      )
      jumpTimer.current = window.setTimeout(() => (jumpArmed.current = null), 3000)
    },
    [siblingNext, siblingPrevious, goBook],
  )

  const goTo = useCallback(
    (n: number) => {
      if (pagesCount > 0) setPage(Math.min(Math.max(1, n), pagesCount))
    },
    [pagesCount],
  )

  const changeDirection = useCallback(
    (d: ReadingDirection) => {
      useReaderSettings.getState().update({ readingDirection: d })
      setSessionDirection(null)
      showToast(`Reading direction: ${readingDirectionLabel(d)}`)
    },
    [],
  )

  const cycleScale = useCallback(() => {
    const s = useReaderSettings.getState()
    if (direction === 'WEBTOON') {
      const v = CONTINUOUS_SCALE_CYCLE[(CONTINUOUS_SCALE_CYCLE.indexOf(s.continuousScale) + 1) % CONTINUOUS_SCALE_CYCLE.length]
      s.update({ continuousScale: v })
      showToast(`Scale: ${CONTINUOUS_SCALE_LABELS[v]}`)
    } else {
      const v = SCALE_CYCLE[(SCALE_CYCLE.indexOf(s.scale) + 1) % SCALE_CYCLE.length]
      s.update({ scale: v })
      showToast(`Scale: ${SCALE_LABELS[v]}`)
    }
  }, [direction])

  const cycleLayout = useCallback(() => {
    const s = useReaderSettings.getState()
    const v = LAYOUT_CYCLE[(LAYOUT_CYCLE.indexOf(s.pageLayout) + 1) % LAYOUT_CYCLE.length]
    s.update({ pageLayout: v })
    showToast(`Page layout: ${LAYOUT_LABELS[v]}`)
  }, [])

  const cyclePadding = useCallback(() => {
    const s = useReaderSettings.getState()
    const v = (s.continuousPadding + 5) % 45
    s.update({ continuousPadding: v })
    showToast(v === 0 ? 'Side padding: none' : `Side padding: ${v}%`)
  }, [])

  const cycleMargin = useCallback(() => {
    const s = useReaderSettings.getState()
    const v = (s.continuousMargin + 5) % 20
    s.update({ continuousMargin: v })
    showToast(v === 0 ? 'Page gap: none' : `Page gap: ${v}px`)
  }, [])

  useWindowKeys((e) => {
    if (e.key === 'Escape') {
      // Radix dialogs close themselves on Escape
      if (explorerOpen || helpOpen) return
      if (settingsOpen) setSettingsOpen(false)
      else if (chromeVisible) setChromeVisible(false)
      else exitReader()
      return
    }
    switch (e.key) {
      case 'Home':
        goTo(1)
        break
      case 'End':
        goTo(pagesCount)
        break
      case 'l':
      case 'r':
      case 'v':
      case 'w':
        changeDirection(DIRECTION_BY_KEY[e.key])
        break
      case 'c':
        cycleScale()
        break
      case 'd':
        if (direction !== 'WEBTOON') cycleLayout()
        break
      case 'p':
        if (direction === 'WEBTOON') cyclePadding()
        break
      case 'n':
        if (direction === 'WEBTOON') cycleMargin()
        break
      case 'f':
        toggleFullscreen()
        break
      case 'm':
        setChromeVisible((v) => !v)
        break
      case 's':
        setSettingsOpen((v) => !v)
        break
      case 't':
        setExplorerOpen((v) => !v)
        break
      case 'h':
        setHelpOpen((v) => !v)
        break
    }
  })

  if (bookQuery.isError) {
    const notFound = bookQuery.error instanceof ApiError && bookQuery.error.status === 404
    return (
      <div className="fixed inset-0 flex items-center justify-center bg-bg">
        <EmptyState
          icon={notFound ? <BookOpen weight="duotone" /> : <Warning weight="duotone" />}
          title={notFound ? 'Book not found' : 'Failed to load book'}
          body={notFound ? 'It may have been deleted, or you do not have access to it.' : loadErrorReason(bookQuery.error)}
          action={
            <div className="flex items-center gap-2">
              {!notFound && (
                <Button variant="primary" loading={bookQuery.isFetching} onClick={() => bookQuery.refetch()}>
                  Retry
                </Button>
              )}
              <Button onClick={() => navigate('/dashboard')}>Back to dashboard</Button>
            </div>
          }
        />
      </div>
    )
  }

  if (book) {
    const issue = mediaIssue(book)
    if (issue) {
      return (
        <div className="fixed inset-0 flex items-center justify-center bg-bg">
          <EmptyState
            icon={issue.severity === 'danger' ? <Warning weight="duotone" /> : <BookOpen weight="duotone" />}
            title={issue.title}
            body={issue.detail}
            action={<Button onClick={() => navigate(`/book/${bookId}`)}>Back to book</Button>}
          />
        </div>
      )
    }
  }

  if (pagesQuery.isError) {
    return (
      <div className="fixed inset-0 flex items-center justify-center bg-bg">
        <EmptyState
          icon={<Warning weight="duotone" />}
          title="Failed to load pages"
          body={loadErrorReason(pagesQuery.error)}
          action={
            <div className="flex items-center gap-2">
              <Button variant="primary" loading={pagesQuery.isFetching} onClick={() => pagesQuery.refetch()}>
                Retry
              </Button>
              <Button onClick={() => navigate(`/book/${bookId}`)}>Back to book</Button>
            </div>
          }
        />
      </div>
    )
  }

  if (pages && pages.length === 0) {
    return (
      <div className="fixed inset-0 flex items-center justify-center bg-bg">
        <EmptyState
          icon={<Images weight="duotone" />}
          title="No pages"
          action={<Button onClick={() => navigate(`/book/${bookId}`)}>Back to book</Button>}
        />
      </div>
    )
  }

  if (!book || !pages || page === null) {
    return (
      <div className="fixed inset-0 flex flex-col items-center justify-center gap-4 bg-black text-white">
        <CircleNotch className="size-8 animate-spin text-white/70" />
        {book && <p className="max-w-md truncate px-4 text-sm text-white/70">{book.metadata.title || book.name}</p>}
      </div>
    )
  }

  const title = book.metadata.title || book.name
  const number = book.metadata.number
  const pill = number ? `#${number} - ${title} / ${book.seriesTitle}` : `${title} / ${book.seriesTitle}`
  const toggleChrome = () => setChromeVisible((v) => !v)

  const downloadFile = () => {
    const a = document.createElement('a')
    a.href = urls.bookFile(bookId)
    a.download = book.name
    a.click()
  }

  const fetchPageBlob = async (): Promise<Blob> => {
    const res = await fetch(urls.bookPage(bookId, page), { credentials: 'same-origin' })
    if (!res.ok) throw new Error(`Page request failed (${res.status})`)
    return res.blob()
  }

  const setPoster = async (target: PosterTarget) => {
    if (posterBusy) return
    setPosterBusy(true)
    try {
      const blob = await fetchPageBlob()
      const targetId = target === 'book' ? bookId : target === 'series' ? book.seriesId : contextId!
      if (target === 'book') await bookPostersApi.upload(bookId, blob, true)
      else if (target === 'series') await seriesPostersApi.upload(book.seriesId, blob, true)
      else await readListPostersApi.upload(targetId, blob, true)
      useThumbnailBust.getState().bump(targetId)
      queryClient.invalidateQueries({ queryKey: ['books'] })
      queryClient.invalidateQueries({ queryKey: ['series'] })
      queryClient.invalidateQueries({ queryKey: ['readlists'] })
      queryClient.invalidateQueries({ queryKey: ['dashboard'] })
      showToast(`Page ${page} set as ${target === 'readlist' ? 'read list' : target} poster`)
    } catch {
      showToast('Could not set the poster')
    } finally {
      setPosterBusy(false)
    }
  }

  const downloadPage = async () => {
    try {
      const blob = await fetchPageBlob()
      const ext = blob.type === 'image/png' ? 'png' : blob.type === 'image/webp' ? 'webp' : blob.type === 'image/gif' ? 'gif' : 'jpg'
      const base = book.seriesTitle.replace(/[\\/:*?"<>|]/g, '_')
      const a = document.createElement('a')
      a.href = URL.createObjectURL(blob)
      a.download = `${base} - page ${page}.${ext}`
      a.click()
      URL.revokeObjectURL(a.href)
    } catch {
      showToast('Could not download the page')
    }
  }

  return (
    <div className="fixed inset-0 overflow-hidden select-none" style={{ background: READER_BACKGROUNDS[background] }}>
      {direction === 'WEBTOON' ? (
        <ContinuousReader
          pages={pages}
          page={page}
          onPageChange={goTo}
          onToggleChrome={toggleChrome}
          onJumpPrevious={() => boundaryTurn('previous')}
          onJumpNext={() => boundaryTurn('next')}
        />
      ) : (
        <PagedReader
          pages={pages}
          page={page}
          direction={direction}
          onPageChange={goTo}
          onToggleChrome={toggleChrome}
          onJumpPrevious={() => boundaryTurn('previous')}
          onJumpNext={() => boundaryTurn('next')}
        />
      )}

      <ReaderChrome
        visible={chromeVisible}
        title={pill}
        page={page}
        pagesCount={pagesCount}
        rtl={direction === 'RIGHT_TO_LEFT'}
        incognito={incognito}
        isFullscreen={isFullscreen}
        canDownloadFile={canDownload(user)}
        canSetPoster={admin}
        readListContext={context === 'READLIST' && !!contextId}
        posterBusy={posterBusy}
        hasPreviousBook={!!siblingPrevious}
        hasNextBook={!!siblingNext}
        onClose={exitReader}
        onGoToPage={goTo}
        onFirstPage={() => goTo(1)}
        onLastPage={() => goTo(pagesCount)}
        onPreviousBook={() => goBook('previous')}
        onNextBook={() => goBook('next')}
        onToggleExplorer={() => setExplorerOpen((v) => !v)}
        onToggleSettings={() => setSettingsOpen((v) => !v)}
        onToggleHelp={() => setHelpOpen((v) => !v)}
        onToggleFullscreen={toggleFullscreen}
        onDownload={downloadFile}
        onDownloadPage={downloadPage}
        onSetPoster={setPoster}
        onGoToBook={goToBook}
      />

      <SettingsPanel
        open={settingsOpen}
        direction={direction}
        onDirectionChange={changeDirection}
        onAlwaysFullscreenChange={onAlwaysFullscreenChange}
        onClose={() => setSettingsOpen(false)}
      />

      <ThumbnailExplorer
        open={explorerOpen}
        onOpenChange={setExplorerOpen}
        bookId={bookId}
        pagesCount={pagesCount}
        currentPage={page}
        onGoToPage={goTo}
      />

      <ShortcutsHelp open={helpOpen} onOpenChange={setHelpOpen} />
    </div>
  )
}
