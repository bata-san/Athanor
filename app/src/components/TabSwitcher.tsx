import { useRef, useState } from 'react'
import type { Snapshot, Tab } from '@/lib/types'
import { groupSidebarTabs } from '@/lib/sidebarModel'
import { api } from '@/lib/api'
import { AppIcon } from './Icons'

export function TabSwitcher({ open, onClose, snapshot }: { open: boolean; onClose: () => void; snapshot: Snapshot }) {
  const [spaceId, setSpaceId] = useState(snapshot.workspace.activeSpace)
  const touchStart = useRef<{ id: string; x: number; y: number } | null>(null)
  const groups = groupSidebarTabs(snapshot.workspace.tabs, snapshot.workspace.folders, spaceId)
  if (!open) return null
  const activate = (tab: Tab) => { void api.activateTab(tab.id); onClose() }
  const swipeClose = (event: React.TouchEvent, tab: Tab) => { const start = touchStart.current; touchStart.current = null; if (start?.id === tab.id && (Math.abs(event.changedTouches[0]!.clientX - start.x) > 70 || Math.abs(event.changedTouches[0]!.clientY - start.y) > 70)) void api.closeTab(tab.id) }
  const card = (tab: Tab) => <article key={tab.id} className="mobile-tab-card" data-part="tab" data-active={String(tab.id === snapshot.workspace.activeTab)} data-pinned={String(tab.pinned)} data-archived={String(tab.archived)} onTouchStart={(event) => { touchStart.current = { id: tab.id, x: event.touches[0]!.clientX, y: event.touches[0]!.clientY } }} onTouchEnd={(event) => swipeClose(event, tab)} onContextMenu={(event) => { event.preventDefault(); const action = window.prompt(`${tab.title}\nType: pin, mute, duplicate, split, close`); if (action === 'pin') void api.setPinned(tab.id, !tab.pinned); if (action === 'mute') void api.setMuted(tab.id, !tab.muted); if (action === 'duplicate') void api.duplicateTab(tab.id); if (action === 'split') { const active = snapshot.workspace.activeTab; if (active && active !== tab.id) void api.splitWith({ tab: tab.id, dir: 'row' }) } if (action === 'close') void api.closeTab(tab.id) }}>
      <button className="tab-close" aria-label={`Close ${tab.title}`} onClick={() => void api.closeTab(tab.id)}><AppIcon name="X" /></button>
      <button className="mobile-tab-main" onClick={() => activate(tab)}><span className="speed-icon"><AppIcon name={tab.pinned ? 'Layers3' : 'Globe2'} /></span><strong>{tab.title}</strong><span className="muted-copy">{tab.url}</span></button>
    </article>
  return <section className="tab-switcher" role="dialog" aria-modal="true" aria-label="Open tabs" data-part="tab-switcher">
    <header className="tab-switcher-head"><div><h2>Tabs</h2><span className="muted-copy">{snapshot.workspace.tabs.filter((tab) => !tab.archived).length} open</span></div><button className="icon-button" aria-label="Close tab switcher" onClick={onClose}><AppIcon name="X" /></button></header>
    <div className="space-chips">{snapshot.workspace.spaces.map((space) => <button key={space.id} className="space-pill" data-active={String(spaceId === space.id)} onClick={() => { setSpaceId(space.id); void api.switchSpace(space.id) }}><AppIcon name={space.icon} /> {space.name}</button>)}<button className="space-pill" onClick={() => { const name = window.prompt('New space name'); if (name?.trim()) void api.addSpace(name.trim(), 'Sparkles', '#d99a5e').then(setSpaceId) }}><AppIcon name="Plus" /> New space</button></div>
    {groups.pinned.length > 0 && <><h3>Pinned</h3><div className="mobile-tab-grid">{groups.pinned.map(card)}</div></>}
    {groups.folders.filter((entry) => entry.tabs.length).map(({ folder, tabs }) => <section key={folder.id}><h3>{folder.name}{folder.auto && <span className="auto-tag">auto</span>}</h3><div className="mobile-tab-grid">{tabs.map(card)}</div></section>)}
    {groups.root.length > 0 && <><h3>Open tabs</h3><div className="mobile-tab-grid">{groups.root.map(card)}</div></>}
    {groups.archived.length > 0 && <><h3>Archive</h3><div className="mobile-tab-grid">{groups.archived.map((tab) => <article key={tab.id} className="mobile-tab-card" data-archived="true"><button className="mobile-tab-main" onClick={() => { void api.restoreTab(tab.id); void api.activateTab(tab.id); onClose() }}><strong>{tab.title}</strong><span className="muted-copy">Restore from archive</span></button></article>)}</div></>}
    <button className="button button-primary mobile-new-tab" onClick={() => { void api.openTab(); onClose() }}><AppIcon name="Plus" /> New tab</button>
  </section>
}
