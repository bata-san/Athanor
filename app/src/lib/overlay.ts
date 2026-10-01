import { create } from 'zustand'
import { useEffect, useId } from 'react'

/**
 * Native tab webviews are drawn above the shell, so anything the shell pops up over the page area (menus,
 * the palette, the developer dock...) has to hide them. Each popup registers here; the app freezes the page
 * into a screenshot and hides the native views while at least one popup is open.
 */
interface OverlayState {
  open: ReadonlySet<string>
  set: (key: string, open: boolean) => void
}

export const useOverlayStore = create<OverlayState>((set) => ({
  open: new Set<string>(),
  set: (key, open) => set((state) => {
    if (state.open.has(key) === open) return state
    const next = new Set(state.open)
    if (open) next.add(key); else next.delete(key)
    return { open: next }
  }),
}))

/** Register a popup as an overlay while `open` is true. Safe to call from many components at once. */
export function useOverlay(open: boolean, key?: string) {
  const id = useId()
  const set = useOverlayStore((state) => state.set)
  const name = key ? `${key}:${id}` : id
  useEffect(() => { set(name, open); return () => set(name, false) }, [open, name, set])
}

export const useAnyOverlay = () => useOverlayStore((state) => state.open.size > 0)
