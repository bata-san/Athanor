import { create } from 'zustand'
import type { AdblockStatus, CommandInfo, DevServer, PanelInfo, Snapshot } from './types'
import { api } from './api'
import { listen } from './events'
import { isMockMode, mockGetPlatformFromUrl } from './mock/backend'

interface AppState {
  snapshot: Snapshot | null; panels: PanelInfo[]; commands: CommandInfo[]; servers: DevServer[]; adblock: AdblockStatus | null; isMock: boolean; ready: boolean
  setSnapshot: (snapshot: Snapshot) => void; setPanels: (panels: PanelInfo[]) => void; setCommands: (commands: CommandInfo[]) => void; setServers: (servers: DevServer[]) => void; setAdblock: (adblock: AdblockStatus) => void
}
export const useAppStore = create<AppState>((set) => ({ snapshot: null, panels: [], commands: [], servers: [], adblock: null, isMock: isMockMode(), ready: false,
  setSnapshot: (snapshot) => set({ snapshot }), setPanels: (panels) => set({ panels }), setCommands: (commands) => set({ commands }), setServers: (servers) => set({ servers }), setAdblock: (adblock) => set({ adblock }),
}))

let bootPromise: Promise<void> | null = null
export function bootStore() {
  if (bootPromise) return bootPromise
  bootPromise = (async () => {
    try {
      const [snapshot, panels, commands, servers, adblock] = await Promise.all([api.getSnapshot(), api.getPanels(), api.getCommands(), api.listDevServers(), api.getAdblockStatus()])
      const forced = mockGetPlatformFromUrl()
      useAppStore.setState({ snapshot: forced ? { ...snapshot, platform: forced } : snapshot, panels, commands, servers, adblock, ready: true })
      document.documentElement.dataset.themeDark = String(snapshot.settings.theme !== 'paper')
      const css = await api.getShellCss()
      let style = document.getElementById('athanor-shell-css') as HTMLStyleElement | null
      if (!style) { style = document.createElement('style'); style.id = 'athanor-shell-css'; document.head.append(style) }
      style.textContent = css
    } catch (error) { console.error('Athanor shell bootstrap failed', error); useAppStore.setState({ ready: true }) }
    void listen('athanor://snapshot', (snapshot) => useAppStore.getState().setSnapshot(snapshot))
    void listen('athanor://adblock', (status) => useAppStore.getState().setAdblock(status))
    void listen('athanor://shell-css', (css) => { const style = document.getElementById('athanor-shell-css') as HTMLStyleElement | null; if (style) style.textContent = css })
  })()
  return bootPromise
}
