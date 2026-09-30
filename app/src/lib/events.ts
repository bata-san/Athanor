import { listen as tauriListen } from '@tauri-apps/api/event'
import type { EventPayloads } from './types'
import { isMockMode, mockListen } from './mock/backend'

export type Unlisten = () => void
export function listen<K extends keyof EventPayloads>(event: K, handler: (payload: EventPayloads[K]) => void): Promise<Unlisten> {
  if (isMockMode()) return Promise.resolve(mockListen(event, handler))
  return tauriListen<EventPayloads[K]>(event, (message) => handler(message.payload))
}
