import { useState } from 'react'
import { Download as DownloadIcon, FolderOpen, Pause, Play, X } from 'lucide-react'
import { api } from '@/lib/api'
import { downloadStatus, isDownloading, useDownloads } from '@/lib/downloads'
import { useOverlay } from '@/lib/overlay'
import { Button } from './ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from './ui/dialog'
import { Tip } from './ui/tooltip'

export function Downloads({ open, onOpenChange, platform }: { open: boolean; onOpenChange: (open: boolean) => void; platform: string }) {
  const items = useDownloads((state) => state.items)
  const [pending, setPending] = useState<ReadonlySet<number>>(new Set())
  const [errors, setErrors] = useState<Record<number, string>>({})
  useOverlay(open, 'downloads')
  const control = async (id: number, action: 'pause' | 'resume' | 'cancel') => {
    setPending((state) => new Set(state).add(id)); setErrors((state) => ({ ...state, [id]: '' }))
    try { await api.controlDownload(id, action) }
    catch (error) { setErrors((state) => ({ ...state, [id]: String(error) })) }
    finally { setPending((state) => { const next = new Set(state); next.delete(id); return next }) }
  }
  return <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent data-part="downloads" aria-describedby="downloads-description">
      <DialogHeader><DialogTitle className="text-base font-semibold">Downloads</DialogTitle><DialogDescription id="downloads-description">Transfers and saved files from this session. Pause keeps the received data; Cancel discards the partial file.</DialogDescription></DialogHeader>
      <div className="mt-4 min-h-0 overflow-y-auto px-5">
        {!items.length && <div className="flex flex-col items-center gap-2 py-10 text-sm text-muted-foreground"><DownloadIcon className="size-6" /><span>No downloads yet</span>{platform === 'android' && <span>Downloads are also available in your device's Downloads app.</span>}</div>}
        {items.map((item) => { const active = isDownloading(item); const busy = pending.has(item.id)
          return <div key={item.id} className="border-b border-border py-4 last:border-0" data-part="download-item" data-state={item.state}>
            <div className="flex items-start gap-3"><DownloadIcon aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
              <div className="min-w-0 flex-1"><p className="m-0 break-all text-sm font-medium">{item.name}</p><p className="m-0 mt-1 text-xs text-muted-foreground" role={item.state === 'failed' ? 'status' : undefined}>{downloadStatus(item)}</p>
                {item.state === 'done' && <p className="m-0 mt-1 break-all text-xs text-muted-foreground">{item.path}</p>}
              </div>
              <div className="flex shrink-0 gap-1">
                {platform === 'windows' && active && <Tip label="Pause download"><Button variant="ghost" size="icon-sm" className="max-md:size-11" disabled={busy} aria-label={`Pause ${item.name}`} onClick={() => void control(item.id, 'pause')}><Pause /></Button></Tip>}
                {platform === 'windows' && !active && item.canResume && <Tip label="Resume download"><Button variant="ghost" size="icon-sm" className="max-md:size-11" disabled={busy} aria-label={`Resume ${item.name}`} onClick={() => void control(item.id, 'resume')}><Play /></Button></Tip>}
                {platform === 'windows' && (active || item.state === 'paused' || item.canResume) && <Tip label="Cancel download"><Button variant="ghost" size="icon-sm" className="max-md:size-11" disabled={busy} aria-label={`Cancel ${item.name}`} onClick={() => void control(item.id, 'cancel')}><X /></Button></Tip>}
                {platform === 'windows' && item.state === 'done' && <Tip label="Show in folder"><Button variant="ghost" size="icon-sm" className="max-md:size-11" aria-label={`Show ${item.name} in folder`} onClick={() => void api.revealDownload(item.path).catch((error) => setErrors((state) => ({ ...state, [item.id]: String(error) })))}><FolderOpen /></Button></Tip>}
              </div>
            </div>
            {active && <div className="mt-3 h-1 overflow-hidden rounded-full bg-muted" role="progressbar" aria-label={`Downloading ${item.name}`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={item.total > 0 ? Math.min(100, Math.floor(item.received / item.total * 100)) : undefined} aria-valuetext={downloadStatus(item)}>
              <span className={item.total > 0 ? 'block h-full rounded-full bg-foreground/70' : 'block h-full w-2/5 rounded-full bg-foreground/70 [animation:ath-indeterminate_1.1s_var(--ease-snap)_infinite]'} style={item.total > 0 ? { width: `${Math.min(100, item.received / item.total * 100)}%` } : undefined} />
            </div>}
            {errors[item.id] && <p className="m-0 mt-2 text-xs text-destructive" role="alert">{errors[item.id]}</p>}
          </div>
        })}
      </div>
      <DialogFooter className="pt-4"><Button variant="outline" onClick={() => onOpenChange(false)}>Done</Button></DialogFooter>
    </DialogContent>
  </Dialog>
}
