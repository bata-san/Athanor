import { create } from 'zustand'

/** Whether Ctrl is held while the shell has focus: the sidebar then shows the number each tab answers to. */
export const useCtrlHeld = create<{ held: boolean; set: (held: boolean) => void }>((set) => ({ held: false, set: (held) => set((state) => (state.held === held ? state : { held })) }))
