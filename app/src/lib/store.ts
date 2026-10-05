import { create } from 'zustand'
import type { AdblockStatus, CommandInfo, DevServer, PanelInfo, Snapshot } from './types'
import { api } from './api'
import { listen } from './events'
import { isMockMode, mockGetPlatformFromUrl, mockThemeDark } from './mock/backend'
import { applyShellCss } from './theme'

interface AppState {
  snapshot: Snapshot | null; panels: PanelInfo[]; commands: CommandInfo[]; servers: DevServer[]; adblock: AdblockStatus | null; isMock: boolean; ready: boolean; bootError: string | null
  setSnapshot: (snapshot: Snapshot) => void; setPanels: (panels: PanelInfo[]) => void; setCommands: (commands: CommandInfo[]) => void; setServers: (servers: DevServer[]) => void; setAdblock: (adblock: AdblockStatus) => void
}
export const useAppStore = create<AppState>((set) => ({ snapshot: null, panels: [], commands: [], servers: [], adblock: null, isMock: isMockMode(), ready: false, bootError: null,
  setSnapshot: (snapshot) => set({ snapshot }), setPanels: (panels) => set({ panels }), setCommands: (commands) => set({ commands }), setServers: (servers) => set({ servers }), setAdblock: (adblock) => set({ adblock }),
}))

let bootPromise: Promise<void> | null = null
let subscriptions: Promise<unknown> | null = null
let snapshotRevision = 0
export function bootStore() {
  if (bootPromise) return bootPromise
  bootPromise = (async () => {
    useAppStore.setState({ ready: false, bootError: null })
    try {
      subscriptions ??= Promise.allSettled([
        listen('athanor://snapshot', (snapshot) => { snapshotRevision++; useAppStore.getState().setSnapshot(snapshot) }),
        listen('athanor://adblock', (status) => useAppStore.getState().setAdblock(status)),
        listen('athanor://shell-css', (css) => applyShellCss(css, mockThemeDark(useAppStore.getState().snapshot?.settings.theme))),
      ]).then((results) => {
        const failure = results.find((result) => result.status === 'rejected')
        if (failure?.status === 'rejected') {
          for (const result of results) if (result.status === 'fulfilled') result.value()
          subscriptions = null
          throw failure.reason
        }
      })
      await subscriptions
      const revision = snapshotRevision
      const [snapshot, css, optional] = await Promise.all([api.getSnapshot(), api.getShellCss(), Promise.allSettled([api.getPanels(), api.getCommands(), api.listDevServers(), api.getAdblockStatus()])])
      const forced = mockGetPlatformFromUrl()
      const [panels, commands, servers, adblock] = optional
      const current = revision === snapshotRevision ? snapshot : useAppStore.getState().snapshot ?? snapshot
      applyShellCss(css, mockThemeDark(current.settings.theme))
      useAppStore.setState({ snapshot: forced ? { ...current, platform: forced } : current, panels: panels.status === 'fulfilled' ? panels.value : [], commands: commands.status === 'fulfilled' ? commands.value : [], servers: servers.status === 'fulfilled' ? servers.value : [], adblock: useAppStore.getState().adblock ?? (adblock.status === 'fulfilled' ? adblock.value : null), ready: true })
    } catch (error) { console.error('Athanor shell bootstrap failed', error); useAppStore.setState({ ready: true, bootError: String(error) }); bootPromise = null }
  })()
  return bootPromise
}
