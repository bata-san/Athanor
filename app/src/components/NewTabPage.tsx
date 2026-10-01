import { useState } from 'react'
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
  const recent = tabs.filter((tab) => !tab.pinned && !tab.archived && tab.url !== 'athanor://newtab').sort((a, b) => b.lastActive - a.lastActive).slice(0, 4)
  const submit = () => { if (!query.trim()) return; const tab = snapshot?.workspace.tabs.find((entry) => entry.id === snapshot.workspace.activeTab); if (tab) void api.navigate(tab.id, query); else onNavigate(query); setQuery('') }

  return <div className="flex h-full w-full flex-col items-center overflow-y-auto bg-background px-5 pb-7 pt-[clamp(3rem,10vh,7rem)] text-foreground" data-part="new-tab-page">
    <div className="flex w-full max-w-2xl flex-col items-center">
      <div className="flex size-12 items-center justify-center rounded-2xl bg-primary text-primary-foreground"><AthanorMark className="size-6" /></div>
      <h1 className="mt-3 text-lg font-semibold tracking-tight">Athanor</h1>

      <form className="mt-10 flex h-12 w-full items-center gap-3 rounded-2xl border border-border bg-card px-4 transition-colors focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/25" onSubmit={(event) => { event.preventDefault(); submit() }}>
        <AppIcon name="Search" className="size-5 shrink-0 text-muted-foreground" />
        <Input aria-label="Search the web" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search or enter an address" className="h-full flex-1 border-0 bg-transparent px-0 shadow-none focus-visible:border-transparent focus-visible:ring-0" />
        <Kbd className="hidden sm:inline-flex">Enter</Kbd>
      </form>

      {servers.length > 0 && <div className="mt-5 flex w-full flex-wrap justify-center gap-2" aria-label="Development servers">{servers.map((server) => <Button key={server.url} variant="outline" size="sm" className="h-9 max-w-full rounded-full px-3 max-md:min-h-11" onClick={() => onNavigate(server.url)}><AppIcon name="Terminal" /><span className="truncate">{server.title ?? `localhost:${server.port}`}</span></Button>)}</div>}

      {(pinned.length > 0 || recent.length > 0) && <div className="mt-10 grid w-full grid-cols-2 gap-3 sm:grid-cols-4">{[...pinned, ...recent].map((tab) => <button key={tab.id} type="button" className="flex min-h-28 min-w-0 flex-col items-center justify-center gap-3 rounded-xl border border-border bg-card p-4 text-sm transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40" onClick={() => void api.activateTab(tab.id)} title={tab.url}><span className="flex size-9 items-center justify-center rounded-xl bg-muted text-foreground"><AppIcon name={tab.pinned ? 'Layers3' : 'Globe2'} className="size-5" /></span><span className="w-full truncate text-center font-medium">{tab.title}</span></button>)}</div>}

      <div className="mt-8 flex w-full items-center justify-between gap-3 text-xs text-muted-foreground"><span className="flex items-center gap-2"><Kbd>Ctrl+K</Kbd><span>Command palette</span></span><Tip label="Open boards"><Button variant="ghost" size="touch" className="gap-2 px-3" onClick={() => { void api.openTab({ url: 'athanor://boards' }) }}><AppIcon name="PanelsTopLeft" /><span>Boards</span></Button></Tip></div>
    </div>
  </div>
}
