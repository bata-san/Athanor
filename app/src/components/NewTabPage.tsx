import { useState } from 'react'
import type { DevServer } from '@/lib/types'
import { AppIcon } from './Icons'
import { Input } from './ui/input'
import { useAppStore } from '@/lib/store'
import { api } from '@/lib/api'

export function NewTabPage({ servers, onNavigate }: { servers: DevServer[]; onNavigate: (url: string) => void }) {
  const snapshot = useAppStore((state) => state.snapshot)
  const [query, setQuery] = useState('')
  const tabs = snapshot?.workspace.tabs ?? []
  const pinned = tabs.filter((tab) => tab.pinned && !tab.archived).slice(0, 8)
  const recent = tabs.filter((tab) => !tab.pinned && !tab.archived && tab.url !== 'athanor://newtab').sort((a, b) => b.lastActive - a.lastActive).slice(0, 4)
  const submit = () => { if (!query.trim()) return; const tab = snapshot?.workspace.tabs.find((entry) => entry.id === snapshot.workspace.activeTab); if (tab) void api.navigate(tab.id, query); else onNavigate(query); setQuery('') }
  return <div className="newtab-page" data-part="new-tab-page">
    <div className="newtab-identity"><span className="brand-mark"><AppIcon name="WandSparkles" /></span><div><strong>Athanor</strong><span className="muted-copy">A little room to think.</span></div></div>
    <form className="newtab-search" onSubmit={(event) => { event.preventDefault(); submit() }}><AppIcon name="Search" /><Input aria-label="Search the web" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search or enter an address" /><kbd>Enter</kbd></form>
    {servers.length > 0 && <div className="server-row" aria-label="Development servers">{servers.map((server) => <button key={server.url} className="server-chip" onClick={() => onNavigate(server.url)}><AppIcon name="Terminal" />{server.title ?? `localhost:${server.port}`}<AppIcon name="ArrowUp" /></button>)}</div>}
    {(pinned.length > 0 || recent.length > 0) && <div className="speed-dial">{[...pinned, ...recent].map((tab) => <button key={tab.id} className="speed-item" onClick={() => void api.activateTab(tab.id)} title={tab.url}><span className="speed-icon"><AppIcon name={tab.pinned ? 'Layers3' : 'Globe2'} /></span><span className="pinned-label">{tab.title}</span></button>)}</div>}
    <div className="newtab-bottom"><span>Ctrl+K opens the command palette</span><button className="button button-ghost button-small" onClick={() => { void api.openTab({ url: 'athanor://boards' }) }}><AppIcon name="PanelsTopLeft" />Boards</button></div>
  </div>
}
