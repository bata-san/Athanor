import type { Snapshot } from '@/lib/types'

/** Placeholder: replaced by the real grid. Contract: `open`, `onClose`, `snapshot`; reads pictures from `useThumbs`. */
export function TabOverview({ open }: { open: boolean; onClose: () => void; snapshot: Snapshot }) {
  return open ? <div data-part="tab-overview" /> : null
}
