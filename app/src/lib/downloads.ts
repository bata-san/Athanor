import { create } from 'zustand'
import type { Download } from './types'

export const isDownloading = (item: Download) => item.state === 'started' || item.state === 'progress'
export function formatBytes(value: number) {
  if (!Number.isFinite(value) || value <= 0) return '0 B'
  const unit = Math.min(3, Math.floor(Math.log(value) / Math.log(1024)))
  return `${(value / 1024 ** unit).toFixed(unit === 0 ? 0 : 1)} ${['B', 'KB', 'MB', 'GB'][unit]}`
}
export function downloadStatus(item: Download) {
  if (item.state === 'done') return `Completed · ${formatBytes(item.received)}`
  if (item.state === 'cancelled') return 'Cancelled'
  if (item.state === 'failed') return item.error || 'The transfer could not finish. Download it again from the original page.'
  const amount = item.total > 0 ? `${formatBytes(item.received)} of ${formatBytes(item.total)}` : `${formatBytes(item.received)} received · Size unknown`
  return `${item.state === 'paused' ? 'Paused' : 'Downloading'} · ${amount}`
}
export const useDownloads = create<{ items: Download[]; update: (item: Download) => void; hydrate: (items: Download[]) => void }>((set) => ({
  items: [],
  update: (item) => set((state) => ({ items: state.items.some((old) => old.id === item.id) ? state.items.map((old) => old.id === item.id ? item : old) : [item, ...state.items] })),
  hydrate: (items) => set((state) => ({ items: [...state.items, ...items.filter((item) => !state.items.some((old) => old.id === item.id))].sort((a, b) => b.id - a.id) })),
}))
