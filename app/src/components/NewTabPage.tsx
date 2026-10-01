import { useState } from 'react'
import { toast } from 'sonner'
import type { DevServer } from '@/lib/types'
import { useAppStore } from '@/lib/store'
import { api } from '@/lib/api'
import { AthanorMark } from './AthanorMark'
import { AppIcon } from './Icons'
import { Button } from './ui/button'
import { Input } from './ui/input'
import { Kbd } from './ui/kbd'
import { Tip } from './ui/tooltip'

export function NewTabPage({ servers, onNavigate }: { servers: DevServer[]; onNavigate: (url: string) => void }) {
  const snapshot = useAppStore((state) => state.snapshot)
  const [query, setQuery] = useState('')
  const tabs = snapshot?.workspace.tabs ?? []
  const pinned = tabs.filter((tab) => tab.pinned && !tab.archived).slice(0, 8)
  const recent = tabs.filter((tab) => !tab.pinned && !tab.archived && tab.url !== 'athanor://newtab').sort((a, b) => b.lastActive - a.lastActive).slice(0, 8 - pinned.length > 0 ? 8 - pinned.length : 0)
  // Opening a page is only visible once it is open, so a refusal is the one thing worth saying out loud.
  const submit = () => {
    if (!query.trim()) return
    const tab = snapshot?.workspace.tabs.find((entry) => entry.id === snapshot.workspace.activeTab)
    const input = query
    setQuery('')
    if (tab) void api.navigate(tab.id, input).catch((error) => { setQuery(input); toast.error(why(error)) })
    else onNavigate(input)
  }
  const open = (id: string) => void api.activateTab(id).catch((error) => toast.error(why(error)))

  return <div className="relative flex h-full w-full flex-col items-center overflow-y-auto bg-background px-6 pb-12 pt-[clamp(4rem,16vh,9rem)] text-foreground" data-part="new-tab-page">
    <div className="flex w-full max-w-xl flex-col items-center">
      <div className="flex size-10 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-sm"><AthanorMark className="size-5" /></div>
      <h1 className="mt-2.5 text-[1rem] font-semibold tracking-tight">Athanor</h1>

      <form className="mt-7 flex h-11 w-full items-center gap-2.5 rounded-xl border border-border bg-card px-3.5 shadow-xs transition-colors focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/25" onSubmit={(event) => { event.preventDefault(); submit() }}>
        <AppIcon name="Search" className="size-4 shrink-0 text-muted-foreground" />
        <Input aria-label="Search the web" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search or enter an address" className="h-full flex-1 border-0 bg-transparent px-0 text-sm shadow-none focus-visible:border-transparent focus-visible:ring-0" />
        <Kbd className="hidden border-0 bg-transparent sm:inline-flex">Enter</Kbd>
      </form>

      {servers.length > 0 && <nav aria-label="Development servers" className="mt-3 flex w-full flex-wrap justify-center gap-1.5">{servers.map((server) => <Button key={server.url} variant="outline" size="sm" className="max-w-full rounded-full px-2.5 max-md:min-h-11" onClick={() => onNavigate(server.url)}><AppIcon name="Terminal" /><span className="truncate">{server.title ?? `localhost:${server.port}`}</span><span className="font-instr text-[0.7333rem] text-muted-foreground">:{server.port}</span></Button>)}</nav>}

      {(pinned.length > 0 || recent.length > 0) && <nav aria-label="Open tabs" className="mt-7 grid w-full grid-cols-2 gap-2 sm:grid-cols-4">{[...pinned, ...recent].map((tab) => <button key={tab.id} type="button" className="group relative flex min-h-[4.5rem] min-w-0 flex-col items-center justify-center gap-1.5 rounded-lg border border-border bg-card p-3 text-[0.8667rem] transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40" aria-label={tab.title || tab.url} title={tab.url} onClick={() => open(tab.id)}>
        <span className="flex size-7 items-center justify-center rounded-md bg-muted text-foreground"><AppIcon name={tab.pinned ? 'Layers3' : 'Globe2'} className="size-4" /></span>
        <span className="w-full truncate text-center font-medium">{tab.title}</span>
      </button>)}</nav>}

      <div className="mt-6 flex w-full items-center justify-between gap-3 text-xs text-muted-foreground"><span className="flex items-center gap-2"><Kbd>Ctrl+K</Kbd><span>Command bar</span></span><Tip label="Open boards"><Button variant="ghost" size="sm" className="gap-1.5 px-2 max-md:min-h-11" onClick={() => { void api.openTab({ url: 'athanor://boards' }).catch((error) => toast.error(why(error))) }}><AppIcon name="PanelsTopLeft" /><span>Boards</span></Button></Tip></div>
    </div>

  </div>
}

/** The reason the backend gave, in the words Settings shows. */
function why(error: unknown) { return error instanceof Error ? error.message : String(error) }
