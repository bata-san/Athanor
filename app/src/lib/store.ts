import { create } from 'zustand'
import type { AdblockStatus, CommandInfo, DevServer, PanelInfo, Snapshot } from './types'
import { api } from './api'
import { listen } from './events'
import { isMockMode, mockGetPlatformFromUrl, mockThemeDark } from './mock/backend'
import { applyShellCss } from './theme'

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
      applyShellCss(await api.getShellCss(), mockThemeDark(snapshot.settings.theme))
    } catch (error) { console.error('Athanor shell bootstrap failed', error); useAppStore.setState({ ready: true }) }
    void listen('athanor://snapshot', (snapshot) => useAppStore.getState().setSnapshot(snapshot))
    void listen('athanor://adblock', (status) => useAppStore.getState().setAdblock(status))
    void listen('athanor://shell-css', (css) => applyShellCss(css, mockThemeDark(useAppStore.getState().snapshot?.settings.theme)))
  })()
  return bootPromise
}
