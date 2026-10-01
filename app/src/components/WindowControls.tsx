import { useEffect, useState } from 'react'
import { Copy, Minus, Square, X } from 'lucide-react'
import { api } from '@/lib/api'
import { cn } from '@/lib/utils'

const base = 'grid h-10 w-11 place-items-center text-muted-foreground outline-none transition-colors hover:bg-accent hover:text-foreground focus-visible:bg-accent [&_svg]:size-[1rem] [&_svg]:stroke-[1.6]'

/** Minimise / maximise / close for the frameless window. */
export function WindowControls({ className }: { className?: string }) {
  const [maximized, setMaximized] = useState(false)
  useEffect(() => { void api.windowIsMaximized().then(setMaximized) }, [])
  return <div className={cn('flex shrink-0 [-webkit-app-region:no-drag]', className)} data-part="window-controls">
    <button type="button" className={base} data-part="window-minimize" aria-label="Minimize" onClick={() => void api.windowMinimize()}><Minus /></button>
    <button type="button" className={base} data-part="window-maximize" aria-label={maximized ? 'Restore window' : 'Maximize window'} onClick={() => { void api.windowToggleMaximize(); setMaximized((value) => !value) }}>{maximized ? <Copy className="-scale-x-100" /> : <Square className="!size-3" />}</button>
    <button type="button" className={cn(base, 'hover:bg-destructive hover:text-destructive-foreground focus-visible:bg-destructive focus-visible:text-destructive-foreground')} data-part="window-close" aria-label="Close" onClick={() => void api.windowClose()}><X /></button>
  </div>
}

/** Pointer handler for empty window chrome: drags the window, double-click toggles maximise. */
export function dragWindow(event: React.PointerEvent) {
  if (event.button !== 0 || (event.target as HTMLElement).closest('button, input, textarea, a, [role="menuitem"], [data-no-drag]')) return
  const surface = event.currentTarget as HTMLElement
  const pointer = event.pointerId
  const start = { x: event.screenX, y: event.screenY }
  let origin: [number, number] | null = null
  let latest = start
  let moving = false
  let frame = 0
  let maximized: boolean | null = null
  const apply = () => { frame = 0; if (origin) void api.windowMoveTo(origin[0] + latest.x - start.x, origin[1] + latest.y - start.y) }
  const move = (next: PointerEvent) => {
    latest = { x: next.screenX, y: next.screenY }
    if (!moving) {
      // A press that barely moves is a click (or the first half of a double-click), not a drag.
      if (Math.hypot(latest.x - start.x, latest.y - start.y) < 4) return
      moving = true
      void api.windowIsMaximized().then((is) => {
        maximized = is
        // A maximised window is restored by the system's own drag; otherwise follow the pointer here.
        if (is) { finish(); void api.windowStartDrag() } else void api.windowGetPosition().then((at) => { origin = at; apply() })
      })
    }
    if (maximized === false && origin && !frame) frame = requestAnimationFrame(apply)
  }
  const finish = () => {
    surface.removeEventListener('pointermove', move); surface.removeEventListener('pointerup', finish); surface.removeEventListener('pointercancel', finish)
    if (frame) cancelAnimationFrame(frame)
    try { surface.releasePointerCapture(pointer) } catch { /* already released */ }
  }
  try { surface.setPointerCapture(pointer) } catch { /* not capturable: moves on the surface still work */ }
  surface.addEventListener('pointermove', move); surface.addEventListener('pointerup', finish); surface.addEventListener('pointercancel', finish)
}
export function toggleWindow(event: React.MouseEvent) {
  if ((event.target as HTMLElement).closest('button, input, textarea, a, [data-no-drag]')) return
  void api.windowToggleMaximize()
}
