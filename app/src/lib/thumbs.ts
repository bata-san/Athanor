import { useEffect } from 'react'
import { create } from 'zustand'
import { api } from './api'
import { useAppStore } from './store'
import { useOverlayStore } from './overlay'

/** Small page pictures for the tab overview, keyed by tab id. Memory only: they are a convenience, never state. */
export const useThumbs = create<{ images: Record<string, string>; put: (tab: string, image: string) => void; drop: (tab: string) => void }>((set) => ({
  images: {},
  put: (tab, image) => set((state) => ({ images: { ...state.images, [tab]: image } })),
  drop: (tab) => set((state) => { if (!(tab in state.images)) return state; const images = { ...state.images }; delete images[tab]; return { images } }),
}))

/** Scale a captured page picture down to a card-sized JPEG. */
export function shrink(source: string, width = 480): Promise<string> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => {
      const scale = Math.min(1, width / image.naturalWidth)
      const canvas = document.createElement('canvas')
      canvas.width = Math.max(1, Math.round(image.naturalWidth * scale)); canvas.height = Math.max(1, Math.round(image.naturalHeight * scale))
      const context = canvas.getContext('2d')
      if (!context) { reject(new Error('no canvas')); return }
      context.drawImage(image, 0, 0, canvas.width, canvas.height)
      resolve(canvas.toDataURL('image/jpeg', 0.72))
    }
    image.onerror = () => reject(new Error('bad picture'))
    image.src = source
  })
}

/**
 * Keeps a picture of the page you are looking at: after it finishes loading, and every so often while you stay on it.
 * Only the visible page can be captured, so this is how the tabs you left get their pictures.
 */
export function useThumbnailCapture(enabled: boolean) {
  const activeTab = useAppStore((state) => state.snapshot?.workspace.activeTab ?? null)
  const loading = useAppStore((state) => (activeTab ? state.snapshot?.runtime[activeTab]?.loading ?? false : false))
  const url = useAppStore((state) => state.snapshot?.workspace.tabs.find((tab) => tab.id === state.snapshot?.workspace.activeTab)?.url ?? '')
  useEffect(() => {
    if (!enabled || !activeTab || loading || !url || url.startsWith('athanor://')) return
    let cancelled = false
    const shoot = async () => {
      // Popups hide the page behind a still picture: nothing to capture then.
      if (cancelled || document.hidden || useOverlayStore.getState().open.size > 0) return
      try { const picture = await shrink(await api.captureFrame(activeTab)); if (!cancelled) useThumbs.getState().put(activeTab, picture) } catch { /* the page is not ready; the next round tries again */ }
    }
    const first = window.setTimeout(() => void shoot(), 1200)
    const every = window.setInterval(() => void shoot(), 20000)
    return () => { cancelled = true; window.clearTimeout(first); window.clearInterval(every) }
  }, [enabled, activeTab, loading, url])
}
