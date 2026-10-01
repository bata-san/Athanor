import { useEffect, useRef, useState } from 'react'
import { create } from 'zustand'
import { Button } from './ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from './ui/dialog'
import { Input } from './ui/input'
import { useOverlay } from '@/lib/overlay'

/** Promise-based replacements for window.prompt / window.confirm, drawn with shadcn dialogs. */
type Request =
  | { kind: 'prompt'; title: string; description?: string; label?: string; initial: string; placeholder?: string; confirm: string; resolve: (value: string | null) => void }
  | { kind: 'confirm'; title: string; description?: string; confirm: string; destructive: boolean; resolve: (value: boolean) => void }

const useDialogs = create<{ request: Request | null; show: (request: Request) => void; close: () => void }>((set) => ({ request: null, show: (request) => set({ request }), close: () => set({ request: null }) }))

export function askText(options: { title: string; description?: string; label?: string; initial?: string; placeholder?: string; confirm?: string }): Promise<string | null> {
  return new Promise((resolve) => useDialogs.getState().show({ kind: 'prompt', title: options.title, description: options.description, label: options.label, initial: options.initial ?? '', placeholder: options.placeholder, confirm: options.confirm ?? 'Save', resolve }))
}

export function askConfirm(options: { title: string; description?: string; confirm?: string; destructive?: boolean }): Promise<boolean> {
  return new Promise((resolve) => useDialogs.getState().show({ kind: 'confirm', title: options.title, description: options.description, confirm: options.confirm ?? 'Continue', destructive: options.destructive ?? false, resolve }))
}

export function DialogHost() {
  const request = useDialogs((state) => state.request)
  const close = useDialogs((state) => state.close)
  useOverlay(request !== null, 'dialog')
  if (!request) return null
  const finish = (value: string | boolean | null) => { (request.resolve as (v: string | boolean | null) => void)(value); close() }
  return request.kind === 'prompt'
    ? <PromptDialog request={request} onDone={finish} />
    : <Dialog open onOpenChange={(open) => { if (!open) finish(false) }}>
      <DialogContent className="top-[22vh] w-[min(26rem,calc(100vw-1.25rem))]" aria-describedby={request.description ? undefined : undefined}>
        <DialogHeader><DialogTitle className="text-base font-semibold">{request.title}</DialogTitle>{request.description && <DialogDescription className="text-[0.8667rem] text-muted-foreground">{request.description}</DialogDescription>}</DialogHeader>
        <DialogFooter className="pt-5"><Button variant="outline" onClick={() => finish(false)}>Cancel</Button><Button variant={request.destructive ? 'destructive' : 'default'} autoFocus onClick={() => finish(true)}>{request.confirm}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
}

function PromptDialog({ request, onDone }: { request: Extract<Request, { kind: 'prompt' }>; onDone: (value: string | null) => void }) {
  const [value, setValue] = useState(request.initial)
  const input = useRef<HTMLInputElement>(null)
  useEffect(() => { const id = requestAnimationFrame(() => { input.current?.focus(); input.current?.select() }); return () => cancelAnimationFrame(id) }, [])
  const submit = () => { const trimmed = value.trim(); onDone(trimmed ? trimmed : null) }
  return <Dialog open onOpenChange={(open) => { if (!open) onDone(null) }}>
    <DialogContent className="top-[22vh] w-[min(26rem,calc(100vw-1.25rem))]">
      <form onSubmit={(event) => { event.preventDefault(); submit() }}>
        <DialogHeader><DialogTitle className="text-base font-semibold">{request.title}</DialogTitle>{request.description && <DialogDescription className="text-[0.8667rem] text-muted-foreground">{request.description}</DialogDescription>}</DialogHeader>
        <div className="px-5 pt-4">
          {request.label && <label htmlFor="athanor-prompt" className="mb-1.5 block text-[0.8667rem] font-medium">{request.label}</label>}
          <Input id="athanor-prompt" ref={input} value={value} placeholder={request.placeholder} onChange={(event) => setValue(event.target.value)} />
        </div>
        <DialogFooter className="pt-5"><Button type="button" variant="outline" onClick={() => onDone(null)}>Cancel</Button><Button type="submit" disabled={!value.trim()}>{request.confirm}</Button></DialogFooter>
      </form>
    </DialogContent>
  </Dialog>
}
