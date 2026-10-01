import { useEffect, useState } from 'react'
import { Copy, Minus, Square, X } from 'lucide-react'
import { api } from '@/lib/api'
import { cn } from '@/lib/utils'

const base = 'grid h-10 w-11 place-items-center text-muted-foreground outline-none transition-colors hover:bg-accent hover:text-foreground focus-visible:bg-accent [&_svg]:size-[15px] [&_svg]:stroke-[1.6]'

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
  void api.windowStartDrag()
}
export function toggleWindow(event: React.MouseEvent) {
  if ((event.target as HTMLElement).closest('button, input, textarea, a, [data-no-drag]')) return
  void api.windowToggleMaximize()
}
