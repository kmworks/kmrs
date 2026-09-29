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
  trackMany: (entries: { id: string; label: string }[]) => void
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

// removal timers and the aggregate stream are not UI state, so they stay outside the store
const removeTimers = new Map<string, number>()

export const useKomfJobs = create<KomfJobsState>()((set, get) => ({
  jobs: {},

  track: (jobId, label) => {
    if (get().jobs[jobId]) return
    set((s) => ({
      jobs: { ...s.jobs, [jobId]: { id: jobId, label, text: 'Matching…', failed: null, done: false } },
    }))
    restartStream()
  },

  trackMany: (entries) => {
    const fresh = entries.filter((e) => !get().jobs[e.id])
    if (fresh.length === 0) return
    const jobs = { ...get().jobs }
    for (const e of fresh) {
      jobs[e.id] = { id: e.id, label: e.label, text: 'Matching…', failed: null, done: false }
    }
    set({ jobs })
    restartStream()
  },

  dismiss: (jobId) => {
    const job = get().jobs[jobId]
    window.clearTimeout(removeTimers.get(jobId))
    removeTimers.delete(jobId)
    removeJob(jobId)
    // an unfinished job still holds an upstream stream on the aggregate connection
    if (job && !job.done) restartStream()
  },
}))

export function trackKomfJob(jobId: string, label: string) {
  useKomfJobs.getState().track(jobId, label)
}

export function trackKomfJobs(entries: { id: string; label: string }[]) {
  useKomfJobs.getState().trackMany(entries)
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

function unfinishedIds(): string[] {
  return Object.values(useKomfJobs.getState().jobs)
    .filter((j) => !j.done)
    .map((j) => j.id)
}

// mirrors the aggregate endpoint's per-stream id cap
const STREAM_ID_CHUNK = 64

// every tracked job's events arrive on aggregate streams (one per STREAM_ID_CHUNK
// ids); adding or dropping a job reopens them with the live id set
let streamGen = 0
const controllers = new Set<AbortController>()
const resolving = new Set<string>()

function restartStream() {
  streamGen++
  for (const c of controllers) c.abort()
  controllers.clear()
  const ids = unfinishedIds()
  for (let i = 0; i < ids.length; i += STREAM_ID_CHUNK) {
    void runChunk(ids.slice(i, i + STREAM_ID_CHUNK), streamGen)
  }
}

// one chunk's stream, re-established on error the way EventSource would; a natural
// end (every upstream closed) resolves the chunk's final statuses via the jobs API
async function runChunk(ids: string[], gen: number) {
  for (;;) {
    if (gen !== streamGen) return
    const pending = ids.filter((id) => {
      const j = useKomfJobs.getState().jobs[id]
      return j && !j.done
    })
    if (pending.length === 0) return
    const controller = new AbortController()
    controllers.add(controller)
    const ended = await runStream(pending, controller.signal)
    controllers.delete(controller)
    if (gen !== streamGen) return
    if (ended && (await resolveAll(pending))) return
    // the connection dropped mid-run, or komf still reports jobs running after
    // closing their streams; EventSource would auto-reconnect, a fetch stream
    // needs a manual one
    await new Promise((r) => window.setTimeout(r, 3000))
  }
}

/** Resolves final statuses via the jobs API; false while any job still runs. */
async function resolveAll(ids: string[]): Promise<boolean> {
  const results = await Promise.all(ids.map((id) => resolveFinal(id)))
  return results.every(Boolean)
}

async function runStream(ids: string[], signal: AbortSignal): Promise<boolean> {
  try {
    await streamEvents(ids, signal, (event) => {
      const jobId = event.jobId
      if (!jobId || !useKomfJobs.getState().jobs[jobId]) return
      if (event.type === 'JobStreamClosedEvent') {
        // komf closes a job's stream when the job ends, so the final status
        // comes from the jobs API
        void resolveFinal(jobId)
        return
      }
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
    return true
  } catch {
    return false
  }
}

async function resolveFinal(jobId: string): Promise<boolean> {
  if (resolving.has(jobId)) return true
  const tracked = useKomfJobs.getState().jobs[jobId]
  if (!tracked || tracked.done) return true
  resolving.add(jobId)
  try {
    const job = await komfApi.getJob(jobId)
    // the stream closing does not make a running job a success; leave it tracked
    // so the chunk's reconnect loop picks it up again
    if (job.status === 'RUNNING') return false
    const recorded = useKomfJobs.getState().jobs[jobId]?.failed ?? null
    finishJob(jobId, job.status === 'FAILED' ? (job.message ?? recorded ?? i18n.t('metadata:identify.matchFailed')) : null)
    return true
  } catch {
    // komf no longer knows the job (e.g. after EventStreamNotFoundEvent): fall back
    // to whatever the stream told us
    const recorded = useKomfJobs.getState().jobs[jobId]?.failed ?? null
    finishJob(jobId, recorded ?? i18n.t('metadata:identify.matchFailed'))
    return true
  } finally {
    resolving.delete(jobId)
  }
}

// the body is read manually because EventSource auto-reconnects when komf closes
// the stream on completion; a fetch stream just ends
async function streamEvents(jobIds: string[], signal: AbortSignal, onEvent: (event: KomfJobEvent) => void) {
  const res = await fetch(`/api/v1/komf/jobs/events?ids=${jobIds.map(encodeURIComponent).join(',')}`, {
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
    else if (line.startsWith('data:')) data += (data === '' ? '' : '\n') + line.slice(5).trim()
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
