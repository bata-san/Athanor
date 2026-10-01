import { useCallback, useMemo, useRef } from 'react'
import { KeyboardSensor, PointerSensor, pointerWithin, useSensor, useSensors, type CollisionDetection, type DragEndEvent, type DragMoveEvent, type DragStartEvent } from '@dnd-kit/core'
import { create } from 'zustand'
import { api } from './api'
import { useAppStore } from './store'
import type { Snapshot, Tab } from './types'

/**
 * Tab drag and drop, rebuilt around one idea: while dragging, the sidebar always shows exactly where the tab will
 * land (an insertion line, a highlighted folder, the pin area...), and that hint is the single source of truth for
 * what happens on drop. A click never turns into a drag: dragging starts only after the pointer moved a few pixels.
 */
export type DropHint =
  | { kind: 'before'; target: string }
  | { kind: 'after'; target: string }
  | { kind: 'folder'; folder: string }
  | { kind: 'pin' }
  | { kind: 'unfile' }
  | { kind: 'space'; space: string }

interface DragState { dragging: string | null; hint: DropHint | null; setDragging: (id: string | null) => void; setHint: (hint: DropHint | null) => void }
export const useDragState = create<DragState>((set, get) => ({
  dragging: null,
  hint: null,
  setDragging: (dragging) => set({ dragging, hint: null }),
  setHint: (hint) => { const current = get().hint; if (JSON.stringify(current) !== JSON.stringify(hint)) set({ hint }) },
}))

/** Droppable ids. Rows and tiles are `tab-target:<id>`; larger regions are lower priority. */
export const dropId = { tab: (id: string) => `tab-target:${id}`, folder: (id: string) => `folder:${id}`, space: (id: string) => `space:${id}`, pin: 'pinned-drop', unfile: 'root-drop' } as const
const rank = (id: string) => id.startsWith('space:') ? 0 : id.startsWith('tab-target:') ? 1 : id.startsWith('folder:') ? 2 : id === 'pinned-drop' ? 3 : 4

/** Smallest thing under the pointer wins: a row beats its folder, a folder beats the list. */
export const collision: CollisionDetection = (args) => pointerWithin(args).sort((a, b) => rank(String(a.id)) - rank(String(b.id)))

const group = (tab: Tab) => `${tab.space}|${tab.pinned ? 'pin' : tab.folder ?? ''}`

/** The tab that follows `target` inside its own group (what "insert after target" must be placed before). */
function nextInGroup(snapshot: Snapshot, target: Tab, skip: string): string | null {
  const tabs = snapshot.workspace.tabs
  const start = tabs.findIndex((tab) => tab.id === target.id)
  for (let i = start + 1; i < tabs.length; i++) {
    const tab = tabs[i]!
    if (tab.id !== skip && !tab.archived && group(tab) === group(target)) return tab.id
  }
  return null
}

/** What dropping the tab on `hint` means, as a `move_tab` call. Exported for tests. */
export function resolveDrop(snapshot: Snapshot, tabId: string, hint: DropHint) {
  const tabs = snapshot.workspace.tabs
  const moving = tabs.find((tab) => tab.id === tabId)
  if (!moving) return null
  switch (hint.kind) {
    case 'before':
    case 'after': {
      const target = tabs.find((tab) => tab.id === hint.target)
      if (!target || target.id === tabId) return null
      const before = hint.kind === 'before' ? target.id : nextInGroup(snapshot, target, tabId)
      return { tab: tabId, space: target.space, folder: target.pinned ? null : target.folder, pinned: target.pinned, before }
    }
    case 'folder': return { tab: tabId, folder: hint.folder, pinned: false, before: null }
    case 'pin': return { tab: tabId, pinned: true, folder: null, before: null }
    case 'unfile': return { tab: tabId, folder: null, pinned: false, before: null }
    case 'space': return { tab: tabId, space: hint.space, folder: null, before: null }
  }
}

/** Work out the hint for the droppable under the pointer. `x`/`y` are the pointer's client coordinates. */
function hintFor(overId: string, rect: { top: number; height: number; left: number; width: number }, x: number, y: number, tabs: Tab[], dragging: string): DropHint | null {
  if (overId.startsWith('tab-target:')) {
    const id = overId.slice('tab-target:'.length)
    if (id === dragging) return null
    const target = tabs.find((tab) => tab.id === id)
    if (!target) return null
    // Pinned tiles sit in a grid (left/right halves); everything else is a list (upper/lower halves).
    const first = target.pinned ? x < rect.left + rect.width / 2 : y < rect.top + rect.height / 2
    return { kind: first ? 'before' : 'after', target: id }
  }
  if (overId.startsWith('folder:')) return { kind: 'folder', folder: overId.slice('folder:'.length) }
  if (overId.startsWith('space:')) return { kind: 'space', space: overId.slice('space:'.length) }
  if (overId === 'pinned-drop') return { kind: 'pin' }
  if (overId === 'root-drop') return { kind: 'unfile' }
  return null
}

export function useTabDnd() {
  const pointer = useRef({ x: 0, y: 0 })
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor),
  )
  const track = useCallback((event: PointerEvent) => { pointer.current = { x: event.clientX, y: event.clientY } }, [])

  const onDragStart = useCallback((event: DragStartEvent) => {
    const origin = event.activatorEvent as PointerEvent | undefined
    if (origin && 'clientX' in origin) pointer.current = { x: origin.clientX, y: origin.clientY }
    window.addEventListener('pointermove', track)
    useDragState.getState().setDragging(String(event.active.id).replace(/^tab:/, ''))
  }, [track])

  const update = useCallback((event: DragMoveEvent) => {
    const { dragging, setHint } = useDragState.getState()
    const over = event.over
    const snapshot = useAppStore.getState().snapshot
    if (!over || !dragging || !snapshot) { setHint(null); return }
    // `delta` keeps the pointer in step with the drag even before the first native pointermove.
    const origin = event.activatorEvent as PointerEvent | undefined
    const x = origin && 'clientX' in origin ? origin.clientX + event.delta.x : pointer.current.x
    const y = origin && 'clientY' in origin ? origin.clientY + event.delta.y : pointer.current.y
    setHint(hintFor(String(over.id), over.rect, x, y, snapshot.workspace.tabs, dragging))
  }, [])

  const finish = useCallback((event: DragEndEvent | null) => {
    window.removeEventListener('pointermove', track)
    const { dragging, hint, setDragging } = useDragState.getState()
    setDragging(null)
    if (!event || !dragging || !hint) return
    const snapshot = useAppStore.getState().snapshot
    const move = snapshot && resolveDrop(snapshot, dragging, hint)
    if (move) void api.moveTab(move)
  }, [track])

  return useMemo(() => ({ sensors, collisionDetection: collision, onDragStart, onDragMove: update, onDragOver: update, onDragEnd: (event: DragEndEvent) => finish(event), onDragCancel: () => finish(null) }), [sensors, onDragStart, update, finish])
}
