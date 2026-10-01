import { useMemo, useRef, useState } from 'react'
import type * as React from 'react'
import { Tooltip, TooltipContent, TooltipTrigger } from './ui/tooltip'
import type { Snapshot } from '@/lib/types'
import { groupSidebarTabs } from '@/lib/sidebarModel'
import { api } from '@/lib/api'
import { cn } from '@/lib/utils'

/**
 * The tab ruler: a quiet, functional scale with one tick per tab. Type is PP Fraktion Mono when installed,
 * IBM Plex Mono otherwise.
 */

/**
 * One tick per tab of the current space (in sidebar order); the active tick is long and dark. It is a scrubber:
 * press and drag along the scale to run through the tabs or click a tick to jump.
 * Horizontal above the status line; vertical along the edge of the collapsed icon rail.
 */
export function TabRuler({ snapshot, orientation = 'horizontal', className }: { snapshot: Snapshot; orientation?: 'horizontal' | 'vertical'; className?: string }) {
  const { workspace } = snapshot
  // Same order as the sidebar list: pinned, then folders, then loose tabs.
  const tabs = useMemo(() => { const groups = groupSidebarTabs(workspace.tabs, workspace.folders, workspace.activeSpace); return [...groups.pinned, ...groups.folders.flatMap((group) => group.tabs), ...groups.root] }, [workspace.tabs, workspace.folders, workspace.activeSpace])
  const [hover, setHover] = useState<number | null>(null)
  const scale = useRef<HTMLDivElement>(null)
  const vertical = orientation === 'vertical'
  if (tabs.length < 2) return null
  const index = Math.max(0, tabs.findIndex((tab) => tab.id === workspace.activeTab))
  const pad = (value: number) => String(value).padStart(2, '0')
  const indexAt = (event: React.PointerEvent) => {
    const box = scale.current?.getBoundingClientRect()
    if (!box) return index
    const ratio = vertical ? (event.clientY - box.top) / box.height : (event.clientX - box.left) / box.width
    return Math.max(0, Math.min(tabs.length - 1, Math.floor(ratio * tabs.length)))
  }
  const go = (position: number) => { const tab = tabs[position]; if (tab && tab.id !== workspace.activeTab) void api.activateTab(tab.id) }
  const hovered = hover !== null ? tabs[hover] : null
  const tickClass = (position: number) => {
    const major = position % 5 === 0
    const active = position === index
    const near = hover === position
    return cn('block rounded-full transition-[width,height,background-color] duration-150', vertical ? 'h-px' : 'w-px', active ? 'bg-foreground' : near ? 'bg-foreground/70' : 'bg-border',
      vertical ? (active ? 'w-3' : near ? 'w-2.5' : major ? 'w-2' : 'w-1') : (active ? 'h-3.5' : near ? 'h-3' : major ? 'h-2' : 'h-1'))
  }
  const scrubber = <div ref={scale} role="slider" tabIndex={0} aria-label="Tab position" aria-orientation={orientation} aria-valuemin={1} aria-valuemax={tabs.length} aria-valuenow={index + 1} aria-valuetext={tabs[index]?.title}
    className={cn('relative flex touch-none select-none outline-none focus-visible:ring-2 focus-visible:ring-ring/40', vertical ? 'h-full w-full cursor-ns-resize flex-col items-end' : 'h-3.5 min-w-0 flex-1 cursor-ew-resize items-end')}
    onPointerDown={(event) => { event.currentTarget.setPointerCapture(event.pointerId); go(indexAt(event)) }}
    onPointerMove={(event) => { const position = indexAt(event); setHover(position); if (event.buttons === 1) go(position) }}
    onPointerLeave={() => setHover(null)}
    onKeyDown={(event) => { const step = event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1 : event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 0; if (step) { event.preventDefault(); go(Math.max(0, Math.min(tabs.length - 1, index + step))) } }}>
    {tabs.map((tab, position) => <span key={tab.id} className={cn('flex flex-1', vertical ? 'min-h-px w-full items-center justify-end' : 'h-full min-w-px items-end justify-center')}><span className={tickClass(position)} /></span>)}
    {vertical && hovered && <Tooltip open><TooltipTrigger asChild><span className="pointer-events-none absolute end-0 size-px" style={{ top: `${((hover! + 0.5) / tabs.length) * 100}%` }} /></TooltipTrigger><TooltipContent side="right" sideOffset={10}><span className="font-instr tabular-nums opacity-70">{pad(hover! + 1)}/{pad(tabs.length)}</span> {hovered.title}</TooltipContent></Tooltip>}
  </div>
  if (vertical) return <div className={cn('flex w-2.5 flex-col', className)} data-part="tab-ruler">{scrubber}</div>
  return <div className={cn('flex items-end gap-2 px-3 font-instr text-[0.7333rem] uppercase tracking-[0.08em] text-muted-foreground tabular-nums rail:hidden', className)} data-part="tab-ruler">
    {scrubber}
    <span className="max-w-[45%] shrink-0 truncate leading-none">{hovered ? hovered.title.slice(0, 18) : <>{pad(index + 1)}<span className="opacity-50">/{pad(tabs.length)}</span></>}</span>
  </div>
}
