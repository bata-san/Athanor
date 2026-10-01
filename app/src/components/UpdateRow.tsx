import { useState } from 'react'
import { RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { checkAndStage, offerRestart } from '@/lib/updates'

type State = { kind: 'idle' } | { kind: 'checking' } | { kind: 'current' } | { kind: 'ready'; version: string } | { kind: 'error'; message: string }

/** About-page block: check for updates now, and choose whether Athanor does it by itself at start-up. */
export function UpdateRow({ autoUpdate, onAuto }: { autoUpdate: boolean; onAuto: (on: boolean) => void }) {
  const [state, setState] = useState<State>({ kind: 'idle' })
  const check = async () => {
    setState({ kind: 'checking' })
    try {
      const update = await checkAndStage()
      if (update) { setState({ kind: 'ready', version: update.version }); offerRestart(update) } else setState({ kind: 'current' })
    } catch (error) { setState({ kind: 'error', message: String(error) }) }
  }
  const text = state.kind === 'checking' ? 'Checking…' : state.kind === 'current' ? 'You are up to date.' : state.kind === 'ready' ? `Version ${state.version} is downloaded. Restart to install it.` : state.kind === 'error' ? 'Could not check for updates. Try again later.' : ''
  return <div className="mx-auto mb-5 flex max-w-sm flex-col items-center gap-3" data-part="update-row">
    <Button variant="outline" size="sm" disabled={state.kind === 'checking'} onClick={() => void check()}><RefreshCw className={state.kind === 'checking' ? 'animate-spin' : ''} />Check for updates</Button>
    {text && <p className="m-0 text-[0.8667rem] text-muted-foreground" role="status">{text}</p>}
    <label className="flex items-center gap-2 text-[0.8667rem] text-muted-foreground"><Switch checked={autoUpdate} aria-label="Update automatically" onCheckedChange={onAuto} />Update automatically</label>
  </div>
}
