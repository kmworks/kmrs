import { create } from 'zustand'

// Bust tokens for cover URLs, changed on thumbnail events and stream resets so <img>
// reloads without a full page refresh.
interface ThumbnailState {
  bust: Record<string, number>
  generation: number
  bump: (id: string) => void
  reset: () => void
}

export const useThumbnailBust = create<ThumbnailState>()((set) => ({
  bust: {},
  generation: 0,
  bump: (id) => set((s) => ({ bust: { ...s.bust, [id]: (s.bust[id] ?? 0) + 1 } })),
  reset: () => set((s) => ({ bust: {}, generation: s.generation + 1 })),
}))

export const useBust = (id: string) =>
  useThumbnailBust((s) => {
    const bust = s.bust[id] ?? 0
    return s.generation === 0 ? bust : `${s.generation}:${bust}`
  })

export const useBustGeneration = () => useThumbnailBust((s) => (s.generation === 0 ? undefined : s.generation))
