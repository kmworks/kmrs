import { create } from 'zustand'
import { komfApi } from '@/lib/api/komf'
import i18n from '@/lib/i18n'
import type { KomfJobEvent } from '@/lib/api/types'
import { showToast } from './toast'

export interface TrackedJob {
  id: string
  label: string
  text: string
  failed: string | null
  done: boolean
}

interface KomfJobsState {
  jobs: Record<string, TrackedJob>
  track: (jobId: string, label: string) => void
  dismiss: (jobId: string) => void
}

// komf's provider enum values get readable names; unknown ones are title-cased
const PROVIDER_NAMES: Record<string, string> = {
  MANGA_BAKA: 'MangaBaka',
  BOOK_WALKER: 'BookWalker',
  MANGADEX: 'MangaDex',
  MANGA_UPDATES: 'MangaUpdates',
  MANGAUPDATES: 'MangaUpdates',
  ANILIST: 'AniList',
  MAL: 'MyAnimeList',
  COMIC_VINE: 'ComicVine',
  BANGUMI: 'Bangumi',
  YEN_PRESS: 'Yen Press',
  VIZ: 'VIZ',
  WEBTOONS: 'Webtoons',
  NAUTILJON: 'Nautiljon',
  KODANSHA: 'Kodansha',
  HENTAG: 'Hentag',
}

function providerName(raw: string): string {
  const known = PROVIDER_NAMES[raw]
  if (known) return known
  return raw
    .toLowerCase()
    .split(/[_\s]+/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ')
}

// abort controllers and removal timers are not UI state, so they stay outside the store
const controllers = new Map<string, AbortController>()
const removeTimers = new Map<string, number>()

export const useKomfJobs = create<KomfJobsState>()((set, get) => ({
  jobs: {},

  track: (jobId, label) => {
    if (get().jobs[jobId]) return
    const controller = new AbortController()
    controllers.set(jobId, controller)
    set((s) => ({
      jobs: { ...s.jobs, [jobId]: { id: jobId, label, text: 'Matching…', failed: null, done: false } },
    }))
    void runJob(jobId, controller.signal)
  },

  dismiss: (jobId) => {
    controllers.get(jobId)?.abort()
    controllers.delete(jobId)
    window.clearTimeout(removeTimers.get(jobId))
    removeTimers.delete(jobId)
    removeJob(jobId)
  },
}))

export function trackKomfJob(jobId: string, label: string) {
  useKomfJobs.getState().track(jobId, label)
}

function updateJob(jobId: string, patch: Partial<TrackedJob>) {
  useKomfJobs.setState((s) => {
    const job = s.jobs[jobId]
    if (!job) return s
    return { jobs: { ...s.jobs, [jobId]: { ...job, ...patch } } }
  })
}

function removeJob(jobId: string) {
  useKomfJobs.setState((s) => {
    if (!s.jobs[jobId]) return s
    const jobs = { ...s.jobs }
    delete jobs[jobId]
    return { jobs }
  })
}

function finishJob(jobId: string, failed: string | null) {
  const job = useKomfJobs.getState().jobs[jobId]
  if (!job || job.done) return
  controllers.delete(jobId)
  updateJob(jobId, { done: true, failed })
  if (failed) {
    showToast(`${job.label}: ${failed}`)
  } else {
    showToast(`${job.label}: match completed`)
    removeTimers.set(
      jobId,
      window.setTimeout(() => {
        removeTimers.delete(jobId)
        removeJob(jobId)
      }, 3000),
    )
  }
}

async function runJob(jobId: string, signal: AbortSignal) {
  try {
    await streamEvents(jobId, signal, (event) => {
      switch (event.type) {
        case 'ProviderSeriesEvent':
          updateJob(jobId, { text: `${providerName(event.provider)}…` })
          break
        case 'ProviderBookEvent':
          updateJob(jobId, {
            text: `${providerName(event.provider)} · books ${event.bookProgress}/${event.totalBooks}`,
          })
          break
        case 'ProviderCompletedEvent':
          updateJob(jobId, { text: `${providerName(event.provider)} done` })
          break
        case 'ProviderErrorEvent':
        case 'ProcessingErrorEvent':
          updateJob(jobId, { failed: event.message })
          break
        case 'PostProcessingStartEvent':
          updateJob(jobId, { text: 'Post-processing…' })
          break
        case 'EventStreamNotFoundEvent':
          break
      }
    })
  } catch {
    // stream errors fall through to the status check so a dropped connection
    // does not leave the card spinning
  }
  if (signal.aborted) return
  // the stream closes when the job finishes without a completion event, so the
  // final status comes from the jobs API
  try {
    const job = await komfApi.getJob(jobId)
    const recorded = useKomfJobs.getState().jobs[jobId]?.failed ?? null
    finishJob(jobId, job.status === 'FAILED' ? (job.message ?? recorded ?? i18n.t('metadata:identify.matchFailed')) : null)
  } catch {
    // komf no longer knows the job (e.g. after EventStreamNotFoundEvent): fall back
    // to whatever the stream told us
    const recorded = useKomfJobs.getState().jobs[jobId]?.failed ?? null
    finishJob(jobId, recorded ?? i18n.t('metadata:identify.matchFailed'))
  }
}

// the body is read manually because EventSource auto-reconnects when komf closes
// the stream on completion; a fetch stream just ends
async function streamEvents(jobId: string, signal: AbortSignal, onEvent: (event: KomfJobEvent) => void) {
  const res = await fetch(`/api/v1/komf/jobs/${jobId}/events`, {
    signal,
    credentials: 'same-origin',
    headers: { 'X-Requested-With': 'XMLHttpRequest' },
  })
  if (!res.ok || !res.body) throw new Error(`events stream failed: ${res.status}`)
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader()
  let buffer = ''
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += value
    const frames = buffer.split(/\r?\n\r?\n/)
    buffer = frames.pop() ?? ''
    for (const frame of frames) {
      const event = parseFrame(frame)
      if (event) onEvent(event)
    }
  }
}

// komf relays the discriminator as the SSE event line; the data payload carries
// only the fields. frames without an event line are keep-alives
function parseFrame(frame: string): KomfJobEvent | null {
  let name = ''
  let data = ''
  for (const line of frame.split('\n')) {
    if (line.startsWith('event:')) name = line.slice(6).trim()
    else if (line.startsWith('data:')) data += line.slice(5).trim()
  }
  if (!name) return null
  let fields: Record<string, unknown> = {}
  if (data) {
    try {
      fields = JSON.parse(data) as Record<string, unknown>
    } catch {
      return null
    }
  }
  return { ...fields, type: name } as KomfJobEvent
}
