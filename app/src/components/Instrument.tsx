import { useEffect, useMemo, useState } from 'react'
import type { Snapshot } from '@/lib/types'
import { groupSidebarTabs } from '@/lib/sidebarModel'
import { api } from '@/lib/api'
import { cn } from '@/lib/utils'

/**
 * Small "instrument" details in the spirit of the engraved scale on a lens barrel: hairline ticks, tiny mono
 * numerals, an index mark. Everything here is quiet (muted, a few pixels tall) and either informative or
 * clickable, never decorative noise. Type is PP Fraktion Mono when installed, IBM Plex Mono otherwise.
 */

/** One tick per tab of the current space, the active one long and dark; click a tick to jump to that tab. */
export function TabRuler({ snapshot, className }: { snapshot: Snapshot; className?: string }) {
  const { workspace } = snapshot
  // Same order as the sidebar list: pinned, then folders, then loose tabs.
  const tabs = useMemo(() => { const groups = groupSidebarTabs(workspace.tabs, workspace.folders, workspace.activeSpace); return [...groups.pinned, ...groups.folders.flatMap((group) => group.tabs), ...groups.root] }, [workspace.tabs, workspace.folders, workspace.activeSpace])
  if (tabs.length < 2) return null
  const index = Math.max(0, tabs.findIndex((tab) => tab.id === workspace.activeTab))
  const pad = (value: number) => String(value).padStart(2, '0')
  return <div className={cn('flex items-end gap-2 px-3 font-instr text-[9.5px] uppercase tracking-[0.08em] text-muted-foreground tabular-nums rail:hidden', className)} data-part="tab-ruler">
    <div className="flex h-3.5 min-w-0 flex-1 items-end" role="group" aria-label="Tab position">
      {tabs.map((tab, position) => {
        const major = position % 5 === 0
        const active = position === index
        return <button key={tab.id} type="button" title={tab.title} aria-label={`Go to ${tab.title}`} aria-current={active} className="group/tick flex h-full min-w-px flex-1 items-end justify-center outline-none" onClick={() => void api.activateTab(tab.id)}>
          <span className={cn('block w-px rounded-full bg-border transition-[height,background-color] duration-150 group-hover/tick:bg-foreground/60', active ? 'h-3.5 bg-foreground' : major ? 'h-2' : 'h-1')} />
        </button>
      })}
    </div>
    <span className="shrink-0 leading-none">{pad(index + 1)}<span className="opacity-50">/{pad(tabs.length)}</span></span>
  </div>
}

/** A day scale (00-24 h) with an index at the current time, like a distance scale on a lens. */
export function DayScale({ className }: { className?: string }) {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => { const id = window.setInterval(() => setNow(new Date()), 30_000); return () => window.clearInterval(id) }, [])
  const hours = now.getHours() + now.getMinutes() / 60
  const clock = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`
  const ticks = Array.from({ length: 49 }, (_, i) => i) // every 30 minutes
  return <div className={cn('select-none font-instr text-[9.5px] uppercase tracking-[0.1em] text-muted-foreground/80 tabular-nums', className)} role="img" aria-label={`Local time ${clock}`} data-part="day-scale">
    <div className="relative h-7">
      {ticks.map((tick) => {
        const major = tick % 6 === 0
        return <span key={tick} className="absolute bottom-3 w-px bg-current opacity-50" style={{ left: `${(tick / 48) * 100}%`, height: major ? 9 : tick % 2 === 0 ? 6 : 3 }} />
      })}
      {[0, 6, 12, 18, 24].map((hour) => <span key={hour} className="absolute bottom-0 -translate-x-1/2 leading-none" style={{ left: `${(hour / 24) * 100}%` }}>{String(hour).padStart(2, '0')}</span>)}
      <span className="absolute bottom-3 w-px bg-foreground transition-[left] duration-700" style={{ left: `${(hours / 24) * 100}%`, height: 14 }} aria-hidden="true" />
      <span className="absolute -top-0.5 -translate-x-1/2 text-[8px] leading-none text-foreground transition-[left] duration-700" style={{ left: `${(hours / 24) * 100}%` }} aria-hidden="true">▾</span>
    </div>
    <div className="mt-1 flex justify-between"><span>Local</span><span className="text-foreground/80">{clock}</span></div>
  </div>
}

/** Four hairline crop marks, like a viewfinder frame. */
export function CropMarks({ className, inset = 14, size = 9 }: { className?: string; inset?: number; size?: number }) {
  const mark = 'absolute border-current'
  const edge = { width: size, height: size }
  return <div className={cn('pointer-events-none absolute inset-0 text-foreground/15', className)} aria-hidden="true" data-part="crop-marks">
    <span className={cn(mark, 'border-s border-t')} style={{ left: inset, top: inset, ...edge }} />
    <span className={cn(mark, 'border-e border-t')} style={{ right: inset, top: inset, ...edge }} />
    <span className={cn(mark, 'border-s border-b')} style={{ left: inset, bottom: inset, ...edge }} />
    <span className={cn(mark, 'border-e border-b')} style={{ right: inset, bottom: inset, ...edge }} />
  </div>
}
