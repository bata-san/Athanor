import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { api } from '@/lib/api'
import { listen } from '@/lib/events'
import { useOverlay } from '@/lib/overlay'
import { useHover } from '@/lib/hover'
import type { DownloadEvent, PermissionPrompt, ScriptDialogEvent } from '@/lib/types'
import { Button } from './ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from './ui/dialog'
import { Input } from './ui/input'
import { Switch } from './ui/switch'

const hostOf = (origin: string) => { try { return new URL(origin).host || origin } catch { return origin } }

/** What a permission request says, in words ("example.com wants to use your camera"). */
const ASKS: Record<string, string> = {
  camera: 'use your camera', microphone: 'use your microphone', location: 'know your location', notifications: 'show notifications',
  clipboard: 'see text and images you copy', 'motion sensors': 'use motion sensors', 'multiple downloads': 'download several files',
  files: 'edit files on your device', 'MIDI devices': 'use your MIDI devices',
}

/**
 * Everything the web engine would otherwise show in its own (Edge-looking) windows, drawn here instead:
 * JavaScript dialogs, permission prompts, download progress and the link-under-the-pointer preview.
 */
export function NativeUi() {
  const [dialogs, setDialogs] = useState<ScriptDialogEvent[]>([])
  const [prompts, setPrompts] = useState<PermissionPrompt[]>([])
  const names = useRef(new Map<number, string>())

  useEffect(() => {
    const offs = [
      listen('athanor://script-dialog', (event) => setDialogs((queue) => [...queue.filter((item) => item.tab !== event.tab), event])),
      listen('athanor://permission', (prompt) => setPrompts((queue) => [...queue, prompt])),
      listen('athanor://status-text', (event) => useHover.getState().set(event.tab, event.text)),
      listen('athanor://download', (event) => handleDownload(event, names.current)),
    ]
    return () => { for (const off of offs) void off.then((fn) => fn()) }
  }, [])

  const dialog = dialogs[0]
  const prompt = prompts[0]
  useOverlay(Boolean(dialog), 'script-dialog')
  useOverlay(Boolean(prompt), 'permission')
  return <>
    {dialog && <ScriptDialog key={`${dialog.tab}:${dialog.message}`} event={dialog} onDone={(accept, text) => { void api.resolveScriptDialog(dialog.tab, accept, text); setDialogs((queue) => queue.slice(1)) }} />}
    {prompt && <PermissionDialog key={prompt.id} prompt={prompt} onDone={(allow, remember) => { void api.resolvePermission(prompt.tab, prompt.id, allow, remember, prompt.origin, prompt.kind); setPrompts((queue) => queue.slice(1)) }} />}
  </>
}

function handleDownload(event: DownloadEvent, names: Map<number, string>) {
  const id = `download-${event.id}`
  names.set(event.id, event.name)
  const percent = event.total > 0 ? Math.min(99, Math.floor((event.received / event.total) * 100)) : null
  if (event.state === 'started') toast.loading(`Downloading ${event.name}`, { id, description: 'Starting…' })
  else if (event.state === 'progress') toast.loading(`Downloading ${event.name}`, { id, description: percent === null ? `${(event.received / 1048576).toFixed(1)} MB` : `${percent}%` })
  else if (event.state === 'done') toast.success(`Downloaded ${event.name}`, { id, description: undefined, duration: 9000, action: { label: 'Show in folder', onClick: () => { void api.revealDownload(event.path) } } })
  else toast.error(`Could not download ${event.name}`, { id, description: undefined, duration: 7000 })
}

function ScriptDialog({ event, onDone }: { event: ScriptDialogEvent; onDone: (accept: boolean, text: string) => void }) {
  const [text, setText] = useState(event.defaultText)
  const input = useRef<HTMLInputElement>(null)
  useEffect(() => { const id = requestAnimationFrame(() => { input.current?.focus(); input.current?.select() }); return () => cancelAnimationFrame(id) }, [])
  const leave = event.kind === 'beforeunload'
  const title = leave ? 'Leave this page?' : hostOf(event.origin)
  const ask = event.kind !== 'alert'
  return <Dialog open onOpenChange={(open) => { if (!open) onDone(false, '') }}>
    <DialogContent className="top-[22vh] w-[min(27rem,calc(100vw-1.25rem))]" data-part="script-dialog" aria-describedby={undefined}>
      <form onSubmit={(submit) => { submit.preventDefault(); onDone(true, text) }}>
        <DialogHeader>
          <DialogTitle className="text-base font-semibold">{title}</DialogTitle>
          <DialogDescription className="whitespace-pre-wrap break-words text-[13px] text-foreground/80">{leave ? 'Changes you made may not be saved.' : event.message}</DialogDescription>
        </DialogHeader>
        {event.kind === 'prompt' && <div className="px-5 pt-4"><Input ref={input} value={text} aria-label="Answer" onChange={(change) => setText(change.target.value)} /></div>}
        <DialogFooter className="pt-5">
          {ask && <Button type="button" variant="outline" onClick={() => onDone(false, '')}>{leave ? 'Stay' : 'Cancel'}</Button>}
          <Button type="submit" autoFocus={event.kind !== 'prompt'}>{leave ? 'Leave' : 'OK'}</Button>
        </DialogFooter>
      </form>
    </DialogContent>
  </Dialog>
}

function PermissionDialog({ prompt, onDone }: { prompt: PermissionPrompt; onDone: (allow: boolean, remember: boolean) => void }) {
  const [remember, setRemember] = useState(true)
  return <Dialog open onOpenChange={(open) => { if (!open) onDone(false, false) }}>
    <DialogContent className="top-[22vh] w-[min(26rem,calc(100vw-1.25rem))]" data-part="permission-dialog" aria-describedby={undefined}>
      <DialogHeader>
        <DialogTitle className="text-base font-semibold">{prompt.host} wants to {ASKS[prompt.kind] ?? `use ${prompt.kind}`}</DialogTitle>
        <DialogDescription className="text-[13px] text-muted-foreground">You can change this later in Settings → Privacy.</DialogDescription>
      </DialogHeader>
      <label className="flex items-center gap-2.5 px-5 pt-4 text-[13px]"><Switch checked={remember} onCheckedChange={setRemember} aria-label="Remember for this site" />Remember for this site</label>
      <DialogFooter className="pt-5">
        <Button type="button" variant="outline" onClick={() => onDone(false, remember)}>Block</Button>
        <Button type="button" autoFocus onClick={() => onDone(true, remember)}>Allow</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
}
