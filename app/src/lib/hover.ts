import { create } from 'zustand'

/** The link under the pointer, per tab. The address pill shows it in place of the page address while it is set. */
export const useHover = create<{ links: Record<string, string>; set: (tab: string, text: string) => void }>((set) => ({
  links: {},
  set: (tab, text) => set((state) => {
    if ((state.links[tab] ?? '') === text) return state
    const links = { ...state.links }
    if (text) links[tab] = text; else delete links[tab]
    return { links }
  }),
}))
