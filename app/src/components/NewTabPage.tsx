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
import { CropMarks, DayScale } from './Instrument'

export function NewTabPage({ servers, onNavigate }: { servers: DevServer[]; onNavigate: (url: string) => void }) {
  const snapshot = useAppStore((state) => state.snapshot)
  const [query, setQuery] = useState('')
  const tabs = snapshot?.workspace.tabs ?? []
  const pinned = tabs.filter((tab) => tab.pinned && !tab.archived).slice(0, 8)
  const recent = tabs.filter((tab) => !tab.pinned && !tab.archived && tab.url !== 'athanor://newtab').sort((a, b) => b.lastActive - a.lastActive).slice(0, 8 - pinned.length > 0 ? 8 - pinned.length : 0)
  const submit = () => { if (!query.trim()) return; const tab = snapshot?.workspace.tabs.find((entry) => entry.id === snapshot.workspace.activeTab); if (tab) void api.navigate(tab.id, query); else onNavigate(query); setQuery('') }
  const open = tabs.filter((tab) => !tab.archived).length

  return <div className="relative flex h-full w-full flex-col items-center overflow-y-auto bg-background px-6 pb-12 pt-[clamp(4.5rem,14vh,8rem)] text-foreground" data-part="new-tab-page">
    <CropMarks />
    <DayScale className="absolute inset-x-0 top-5 mx-auto w-[min(34rem,calc(100%-6rem))]" />

    <div className="flex w-full max-w-xl flex-col items-center">
      <div className="flex size-10 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-sm"><AthanorMark className="size-5" /></div>
      <h1 className="mt-2.5 font-instr text-[11px] font-medium uppercase tracking-[0.32em] text-muted-foreground">Athanor</h1>

      <form className="mt-7 flex h-11 w-full items-center gap-2.5 rounded-xl border border-border bg-card px-3.5 shadow-xs transition-colors focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/25" onSubmit={(event) => { event.preventDefault(); submit() }}>
        <AppIcon name="Search" className="size-4 shrink-0 text-muted-foreground" />
        <Input aria-label="Search the web" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search or enter an address" className="h-full flex-1 border-0 bg-transparent px-0 text-sm shadow-none focus-visible:border-transparent focus-visible:ring-0" />
        <Kbd className="hidden border-0 bg-transparent font-instr sm:inline-flex">Enter</Kbd>
      </form>

      {servers.length > 0 && <div className="mt-3 flex w-full flex-wrap justify-center gap-1.5" aria-label="Development servers">{servers.map((server) => <Button key={server.url} variant="outline" size="sm" className="max-w-full rounded-full px-2.5 max-md:min-h-11" onClick={() => onNavigate(server.url)}><AppIcon name="Terminal" /><span className="truncate">{server.title ?? `localhost:${server.port}`}</span><span className="font-instr text-[10px] text-muted-foreground">:{server.port}</span></Button>)}</div>}

      {(pinned.length > 0 || recent.length > 0) && <div className="mt-7 grid w-full grid-cols-2 gap-2 sm:grid-cols-4">{[...pinned, ...recent].map((tab, index) => <button key={tab.id} type="button" className="group relative flex min-h-[4.5rem] min-w-0 flex-col items-center justify-center gap-1.5 rounded-lg border border-border bg-card p-3 text-[13px] transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40" onClick={() => void api.activateTab(tab.id)} title={tab.url}>
        <span className="absolute start-1.5 top-1 font-instr text-[9px] tracking-wider text-muted-foreground/60 tabular-nums">{String(index + 1).padStart(2, '0')}</span>
        <span className="flex size-7 items-center justify-center rounded-md bg-muted text-foreground"><AppIcon name={tab.pinned ? 'Layers3' : 'Globe2'} className="size-4" /></span>
        <span className="w-full truncate text-center font-medium">{tab.title}</span>
      </button>)}</div>}

      <div className="mt-6 flex w-full items-center justify-between gap-3 text-xs text-muted-foreground"><span className="flex items-center gap-2"><Kbd className="font-instr">Ctrl+K</Kbd><span>Command bar</span></span><Tip label="Open boards"><Button variant="ghost" size="sm" className="gap-1.5 px-2 max-md:min-h-11" onClick={() => { void api.openTab({ url: 'athanor://boards' }) }}><AppIcon name="PanelsTopLeft" /><span>Boards</span></Button></Tip></div>
    </div>

    <div className="absolute inset-x-0 bottom-5 mx-auto flex w-[min(34rem,calc(100%-6rem))] select-none justify-between font-instr text-[9.5px] uppercase tracking-[0.1em] text-muted-foreground/70 tabular-nums" data-part="new-tab-caption">
      <span>ATH {snapshot?.version ?? ''}</span>
      <span>{snapshot?.platform ?? ''}</span>
      <span>{String(open).padStart(2, '0')} tabs · {(snapshot?.blockedTotal ?? 0).toLocaleString()} blocked</span>
    </div>
  </div>
}
