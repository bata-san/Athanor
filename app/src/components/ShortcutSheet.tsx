import { useMemo } from 'react'
import { useOverlay } from '@/lib/overlay'
import { SHORTCUTS, comboKeys, type ShortcutGroup } from '@/lib/shortcuts'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from './ui/dialog'
import { KeyCap, Kbd } from './ui/kbd'

const GROUPS: ShortcutGroup[] = ['Tabs', 'Navigation', 'Page', 'Window']

/** Every Athanor shortcut on one sheet (Ctrl+/). Reads the same list the key handlers use, so it cannot drift. */
export function ShortcutSheet({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  useOverlay(open, 'shortcuts')
  const groups = useMemo(() => GROUPS.map((group) => ({ group, items: SHORTCUTS.filter((item) => item.group === group) })), [])
  return <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent aria-describedby={undefined} data-part="shortcut-sheet" className="top-[9vh] max-h-[82dvh] w-[min(46rem,calc(100vw-1.25rem))] rounded-xl border-border/70 bg-popover/95 backdrop-blur-xl">
      <DialogTitle className="px-5 pt-4 text-[1rem] font-semibold">Keyboard shortcuts</DialogTitle>
      <DialogDescription className="sr-only">Every Athanor keyboard shortcut. Press Escape or Ctrl+/ to close.</DialogDescription>
      <div className="grid min-h-0 grid-cols-2 gap-x-8 gap-y-5 overflow-y-auto px-5 pb-5 pt-3 max-md:grid-cols-1">
        {groups.map(({ group, items }) => <section key={group} aria-label={group}>
          <h3 className="m-0 mb-1.5 font-instr text-[0.7333rem] font-medium uppercase tracking-[0.08em] text-muted-foreground">{group}</h3>
          <ul className="m-0 flex list-none flex-col p-0">
            {/* A long explanation wraps; only the keys keep to one line. */}
            {items.map((item) => <li key={item.combo} className="flex min-h-7 items-center justify-between gap-3 border-b border-border/50 py-1 text-[0.8667rem] last:border-b-0">
              <span className="min-w-0 flex-1">{item.label}</span>
              <span className="flex shrink-0 gap-1">{comboKeys(item.combo).map((key, index) => <KeyCap key={index} k={key} />)}</span>
            </li>)}
          </ul>
        </section>)}
      </div>
      <div className="flex items-center gap-4 border-t border-border px-5 py-2 text-xs text-muted-foreground">
        <span className="flex items-center gap-1.5"><Kbd>Esc</Kbd>close</span>
        <span className="flex items-center gap-1.5"><Kbd>Ctrl</Kbd><Kbd>/</Kbd>open or close</span>
        <span className="ms-auto font-instr tabular-nums">{SHORTCUTS.length} shortcuts</span>
      </div>
    </DialogContent>
  </Dialog>
}
