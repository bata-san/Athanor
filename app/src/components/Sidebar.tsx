import { useEffect, useMemo, useState } from 'react'
import type * as React from 'react'
import { useDraggable, useDroppable } from '@dnd-kit/core'
import { CSS } from '@dnd-kit/utilities'
import type { PanelInfo, Snapshot, Tab } from '@/lib/types'
import { groupSidebarTabs } from '@/lib/sidebarModel'
import { api } from '@/lib/api'
import { cssToken } from '@/lib/utils'
import { AppIcon } from './Icons'

type Page = 'settings' | 'boards' | 'extensions'
type Props = { snapshot: Snapshot; panels: PanelInfo[]; toolbar: React.ReactNode; openPage: (page: Page) => void; openPanel: (panel: PanelInfo) => void; onOverlay: (open: boolean) => void }
export function Sidebar({ snapshot, panels, toolbar, openPage, openPanel, onOverlay }: Props) {
  const [menu, setMenu] = useState<{ x: number; y: number; tab?: string; folder?: string; space?: string } | null>(null)
  const [archiveOpen, setArchiveOpen] = useState(false)
  const [panelOpen, setPanelOpen] = useState(true)
  const [pinOpen, setPinOpen] = useState(true)
  const [folderOpen, setFolderOpen] = useState(true)
  const settings = snapshot.settings
  const groups = useMemo(() => groupSidebarTabs(snapshot.workspace.tabs, snapshot.workspace.folders, snapshot.workspace.activeSpace), [snapshot.workspace.tabs, snapshot.workspace.folders, snapshot.workspace.activeSpace])
  const activeId = snapshot.workspace.activeTab
  const activeSpace = snapshot.workspace.spaces.find((space) => space.id === snapshot.workspace.activeSpace)
  useEffect(() => { onOverlay(Boolean(menu)) }, [menu, onOverlay])
  useEffect(() => {
    if (!menu) return
    const close = () => setMenu(null)
    window.addEventListener('pointerdown', close)
    return () => window.removeEventListener('pointerdown', close)
  }, [menu])

  const showMenu = (event: React.MouseEvent, detail: NonNullable<typeof menu>) => { event.preventDefault(); event.stopPropagation(); setMenu({ x: event.clientX, y: event.clientY, ...detail }) }
  const runTabMenu = (action: string, tabId: string) => {
    const tab = snapshot.workspace.tabs.find((entry) => entry.id === tabId)
    if (!tab) return
    if (action === 'pin') void api.setPinned(tab.id, !tab.pinned)
    if (action === 'mute') void api.setMuted(tab.id, !tab.muted)
    if (action === 'duplicate') void api.duplicateTab(tab.id)
    if (action === 'close') void api.closeTab(tab.id)
    if (action === 'copy') void api.copyUrl(tab.id)
    if (action === 'close-others') void api.closeOtherTabs(tab.id)
    if (action === 'close-below') void api.closeTabsBelow(tab.id)
    if (action === 'move-space') { const space = window.prompt('Move to which space?', snapshot.workspace.spaces.find((entry) => entry.id === tab.space)?.name); const target = snapshot.workspace.spaces.find((entry) => entry.name.toLowerCase() === space?.trim().toLowerCase()); if (target) void api.moveTab({ tab: tab.id, space: target.id, folder: null }) }
    if (action === 'close-below') void api.closeTabsBelow(tab.id)
    if (action === 'split') { const active = snapshot.workspace.tabs.find((entry) => entry.id === activeId); if (active && active.id !== tab.id) void api.splitWith({ tab: tab.id, dir: 'row' }) }
    setMenu(null)
  }
  const runFolderMenu = (action: string, id: string) => {
    const folder = snapshot.workspace.folders.find((entry) => entry.id === id)
    if (!folder) return
    if (action === 'rename') { const name = window.prompt('Rename folder', folder.name); if (name?.trim()) void api.renameFolder(id, name.trim()) }
    if (action === 'color') { const color = window.prompt('Folder color (CSS color)', folder.color ?? cssToken('--ath-space-default-color')); if (color !== null) void api.setFolderColor(id, color || null) }
    if (action === 'close') snapshot.workspace.tabs.filter((tab) => tab.folder === id).forEach((tab) => void api.closeTab(tab.id))
    if (action === 'delete') { const closeTabs = window.confirm(`Close tabs in “${folder.name}” too?`); void api.deleteFolder(id, closeTabs) }
    setMenu(null)
  }
  const createFolder = () => { const name = window.prompt('New folder name'); if (name?.trim()) void api.createFolder(snapshot.workspace.activeSpace, name.trim()) }
  const createSpace = () => { const name = window.prompt('New space name'); if (name?.trim()) void api.addSpace(name.trim(), 'Sparkles', cssToken('--ath-space-default-color')) }
  const resizeStart = (event: React.PointerEvent) => {
    const element = event.currentTarget as HTMLElement
    element.setPointerCapture(event.pointerId)
    const move = (moveEvent: PointerEvent) => { const width = Math.max(208, Math.min(400, snapshot.settings.sidebarSide === 'left' ? moveEvent.clientX : window.innerWidth - moveEvent.clientX)); void api.setSettings({ sidebarWidth: width }) }
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up) }
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up)
  }
  return <aside className="sidebar" data-part="sidebar" data-collapsed={String(settings.sidebarCompact)} style={{ '--ath-sidebar-width': `${settings.sidebarWidth}px` } as React.CSSProperties}>
    <div className="titlebar" data-part="titlebar" onPointerDown={(event) => { if ((event.target as HTMLElement).closest('button')) return; void api.windowStartDrag() }}>
      <div className="titlebar-spacer" />
      <button className="window-control" data-part="window-minimize" aria-label="Minimize" onClick={() => void api.windowMinimize()}><AppIcon name="Minus" /></button>
      <WindowMaximize />
      <button className="window-control" data-part="window-close" aria-label="Close" onClick={() => void api.windowClose()}><AppIcon name="X" /></button>
    </div>
    <div className="sidebar-header" data-part="sidebar-header">
      <div className="brand-lockup"><span className="brand-mark"><AppIcon name="WandSparkles" /></span><span className="sidebar-copy">Athanor</span></div>
      <button className="icon-button" aria-label={settings.sidebarCompact ? 'Expand sidebar' : 'Collapse sidebar'} title="Toggle sidebar (Ctrl+B)" onClick={() => void api.setSettings({ sidebarCompact: !settings.sidebarCompact })}><AppIcon name={settings.sidebarCompact ? 'PanelLeft' : 'PanelLeftClose'} /></button>
    </div>
    {toolbar}
    <div className="sidebar-main">
      <div className="tab-section" data-part="pinned-grid" onContextMenu={(event) => showMenu(event, {})}>
        <div className="section-heading"><button onClick={() => setPinOpen((value) => !value)} aria-expanded={pinOpen}><AppIcon name={pinOpen ? 'ChevronDown' : 'ChevronRight'} /> <span className="sidebar-label">Pinned</span></button><button aria-label="Create pinned tab" onClick={() => void api.openTab({ pinned: true })}><AppIcon name="Plus" /></button></div>
        {pinOpen && <PinnedDrop><div className="pinned-grid">{groups.pinned.map((tab) => <PinnedTile key={tab.id} tab={tab} active={tab.id === activeId} onActivate={() => void api.activateTab(tab.id)} onContext={(event) => showMenu(event, { tab: tab.id })} />)}</div></PinnedDrop>}
      </div>
      <div className="tab-section">
        <div className="section-heading"><button onClick={() => setFolderOpen((value) => !value)} aria-expanded={folderOpen}><AppIcon name={folderOpen ? 'ChevronDown' : 'ChevronRight'} /> <span className="sidebar-label">Folders</span></button><button aria-label="Create folder" onClick={createFolder}><AppIcon name="FolderPlus" /></button></div>
        {folderOpen && groups.folders.map(({ folder, tabs }) => <FolderGroup key={folder.id} id={folder.id} name={folder.name} color={folder.color} collapsed={folder.collapsed} auto={folder.auto} onToggle={() => void api.toggleFolder(folder.id)} onContext={(event) => showMenu(event, { folder: folder.id })}>
          {!folder.collapsed && <div className="folder-children">{tabs.map((tab) => <TabRow key={tab.id} tab={tab} active={tab.id === activeId} runtime={snapshot.runtime[tab.id]} onActivate={() => void api.activateTab(tab.id)} onClose={() => void api.closeTab(tab.id)} onContext={(event) => showMenu(event, { tab: tab.id })} />)}</div>}
        </FolderGroup>)}
      </div>
      <div className="tab-section" data-part="tab-list">
        <div className="section-heading"><span className="sidebar-label">Tabs</span><DropTarget id="root-drop" className="root-drop" label="Drop here to unfile" /></div>
        {groups.root.map((tab) => <TabRow key={tab.id} tab={tab} active={tab.id === activeId} runtime={snapshot.runtime[tab.id]} onActivate={() => void api.activateTab(tab.id)} onClose={() => void api.closeTab(tab.id)} onContext={(event) => showMenu(event, { tab: tab.id })} />)}
        <button className="new-tab-button" data-part="new-tab-button" onClick={() => void api.openTab()}><AppIcon name="Plus" /><span className="sidebar-copy">New tab</span><kbd className="sidebar-copy">Ctrl+T</kbd></button>
      </div>
      <div className="tab-section">
        <div className="section-heading"><button onClick={() => setArchiveOpen((value) => !value)} aria-expanded={archiveOpen}><AppIcon name={archiveOpen ? 'ChevronDown' : 'ChevronRight'} /><AppIcon name="Archive" /><span className="sidebar-label">Archive</span><span className="badge">{groups.archived.length}</span></button><button aria-label="Archive inactive tabs now" title="Archive inactive tabs" onClick={() => void api.archiveInactiveNow()}><AppIcon name="History" /></button></div>
        {archiveOpen && groups.archived.map((tab) => <button key={tab.id} className="archive-row" data-archived="true" onClick={() => void api.restoreTab(tab.id)} onContextMenu={(event) => showMenu(event, { tab: tab.id })}><AppIcon name="Archive" /><span className="tab-label">{tab.title}</span><AppIcon name="RotateCcw" /></button>)}
      </div>
      <div className="tab-section">
        <div className="section-heading"><button onClick={() => setPanelOpen((value) => !value)} aria-expanded={panelOpen}><AppIcon name={panelOpen ? 'ChevronDown' : 'ChevronRight'} /><AppIcon name="PanelsTopLeft" /><span className="sidebar-label">Panels</span></button></div>
        {panelOpen && panels.filter((item) => item.ext).map((item) => <button className="panel-row" key={`${item.ext}/${item.id}`} onClick={() => openPanel(item)}><AppIcon name={item.icon} /><span className="tab-label">{item.title}</span><AppIcon name="ChevronRight" /></button>)}
      </div>
      <div className="tab-section">
        <div className="section-heading"><span className="sidebar-label">Collections</span></div>
        <button className="panel-row" data-part="board" onClick={() => openPage('boards')}><AppIcon name="PanelsTopLeft" /><span className="tab-label">Reference boards</span></button>
      </div>
    </div>
    <footer className="sidebar-footer" data-part="space-switcher">
      <div className="space-switcher">{snapshot.workspace.spaces.map((space) => <SpaceChip key={space.id} space={space} active={space.id === snapshot.workspace.activeSpace} onSwitch={() => void api.switchSpace(space.id)} onContext={(event) => showMenu(event, { space: space.id })} />)}<button className="space-chip space-add" aria-label="Add space" title="Add space" onClick={createSpace}><AppIcon name="Plus" /></button></div>
      <div className="footer-actions"><button className="icon-button" aria-label="Developer tools" title="Developer panel" onClick={() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'd', ctrlKey: true, shiftKey: true }))}><AppIcon name="Terminal" /></button><span className="sidebar-copy muted-copy">{activeSpace?.name ?? 'Space'} · {snapshot.workspace.tabs.filter((tab) => tab.space === snapshot.workspace.activeSpace && !tab.archived).length} tabs</span><button className="icon-button" aria-label="Settings" onClick={() => openPage('settings')}><AppIcon name="Settings" /></button></div>
    </footer>
    <div className="sidebar-resize" role="separator" aria-label="Resize sidebar" onPointerDown={resizeStart} />
    {menu && <div className="floating-menu" role="menu" style={{ left: menu.x, top: menu.y }} onPointerDown={(event) => event.stopPropagation()}>
      {menu.tab && <>
        <MenuButton icon="Layers3" text={snapshot.workspace.tabs.find((tab) => tab.id === menu.tab)?.pinned ? 'Unpin tab' : 'Pin tab'} onClick={() => runTabMenu('pin', menu.tab!)} />
        <MenuButton icon="VolumeX" text="Mute tab" onClick={() => runTabMenu('mute', menu.tab!)} />
        <MenuButton icon="Copy" text="Duplicate tab" onClick={() => runTabMenu('duplicate', menu.tab!)} />
        <MenuButton icon="Split" text="Split with active" onClick={() => runTabMenu('split', menu.tab!)} />
        <MenuButton icon="Briefcase" text="Move to space…" onClick={() => runTabMenu('move-space', menu.tab!)} />
        <MenuButton icon="Copy" text="Copy URL" onClick={() => runTabMenu('copy', menu.tab!)} />
        <MenuButton icon="XCircle" text="Close other tabs" onClick={() => runTabMenu('close-others', menu.tab!)} />
        <MenuButton icon="ArrowDown" text="Close tabs below" onClick={() => runTabMenu('close-below', menu.tab!)} />
        <MenuButton icon="X" text="Close tab" onClick={() => runTabMenu('close', menu.tab!)} />
      </>}
      {menu.folder && <>
        <MenuButton icon="WandSparkles" text="Rename" onClick={() => runFolderMenu('rename', menu.folder!)} />
        <MenuButton icon="Sun" text="Set color" onClick={() => runFolderMenu('color', menu.folder!)} />
        <MenuButton icon="XCircle" text="Close all tabs" onClick={() => runFolderMenu('close', menu.folder!)} />
        <MenuButton icon="Trash2" text="Delete folder" onClick={() => runFolderMenu('delete', menu.folder!)} />
      </>}
      {menu.space && <>
        <MenuButton icon="WandSparkles" text="Rename space" onClick={() => { const space = snapshot.workspace.spaces.find((entry) => entry.id === menu.space); const name = window.prompt('Rename space', space?.name); if (name?.trim()) void api.renameSpace(menu.space!, name.trim()); setMenu(null) }} />
        <MenuButton icon="Trash2" text="Delete space" onClick={() => { if (window.confirm('Delete this space and its tabs?')) void api.removeSpace(menu.space!); setMenu(null) }} />
      </>}
    </div>}
  </aside>
}
function WindowMaximize() { const [max, setMax] = useState(false); useEffect(() => { void api.windowIsMaximized().then(setMax) }, []); return <button className="window-control" data-part="window-maximize" aria-label={max ? 'Restore window' : 'Maximize window'} onClick={() => { void api.windowToggleMaximize(); setMax((value) => !value) }}><AppIcon name={max ? 'Square' : 'Maximize2'} /></button> }
function PinnedDrop({ children }: { children: React.ReactNode }) { const { setNodeRef, isOver } = useDroppable({ id: 'pinned-drop' }); return <div ref={setNodeRef} className="pinned-drop" data-over={String(isOver)}>{children}</div> }
function SpaceChip({ space, active, onSwitch, onContext }: { space: Snapshot['workspace']['spaces'][number]; active: boolean; onSwitch: () => void; onContext: (event: React.MouseEvent) => void }) { const { setNodeRef, isOver } = useDroppable({ id: `space:${space.id}` }); return <button ref={setNodeRef} className="space-chip" data-part="space" data-active={String(active)} data-over={String(isOver)} title={`${space.name} · drop tabs here`} aria-label={`Switch to ${space.name}`} style={{ '--space-color': space.color } as React.CSSProperties} onClick={onSwitch} onContextMenu={onContext}><AppIcon name={space.icon} /></button> }
function PinnedTile({ tab, active, onActivate, onContext }: { tab: Tab; active: boolean; onActivate: () => void; onContext: (event: React.MouseEvent) => void }) {
  const { attributes, listeners, setNodeRef, transform } = useDraggable({ id: `tab:${tab.id}` })
  return <button ref={setNodeRef} {...attributes} {...listeners} className="pinned-tab" data-part="pinned-tab" data-pinned="true" data-active={String(active)} style={{ transform: CSS.Transform.toString(transform) }} onClick={onActivate} onContextMenu={onContext} title={tab.url}><span className="pinned-favicon">{tab.favicon ? <img src={tab.favicon} alt="" /> : <AppIcon name="Globe2" />}</span><span className="pinned-label">{tab.title}</span></button>
}
function FolderGroup({ id, name, color, collapsed, auto, onToggle, onContext, children }: { id: string; name: string; color: string | null; collapsed: boolean; auto: boolean; onToggle: () => void; onContext: (event: React.MouseEvent) => void; children?: React.ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({ id: `folder:${id}` })
  return <div ref={setNodeRef} className="folder-group" data-part="folder" data-over={String(isOver)}><button className="folder-row" data-part="folder-header" data-collapsed={String(collapsed)} onClick={onToggle} onContextMenu={onContext}><AppIcon name={collapsed ? 'ChevronRight' : 'ChevronDown'} /><AppIcon name="Folder" /><span className="folder-accent" style={{ '--folder-color': color ?? undefined } as React.CSSProperties} /><span className="tab-label">{name}</span>{auto && <span className="auto-tag">auto</span>}<span className="badge">{isOver ? 'Drop' : ''}</span></button>{children}</div>
}
function TabRow({ tab, active, runtime, onActivate, onClose, onContext }: { tab: Tab; active: boolean; runtime: Snapshot['runtime'][string] | undefined; onActivate: () => void; onClose: () => void; onContext: (event: React.MouseEvent) => void }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: `tab:${tab.id}` })
  const { setNodeRef: setDropRef, isOver } = useDroppable({ id: `tab-target:${tab.id}` })
  return <div ref={(element) => { setNodeRef(element); setDropRef(element) }} role="group" aria-label={`${tab.title} tab`} className="tab-row" data-part="tab" data-active={String(active)} data-pinned={String(tab.pinned)} data-loading={String(runtime?.loading ?? false)} data-audible={String(runtime?.audible ?? false)} data-archived={String(tab.archived)} data-over={String(isOver)} style={{ transform: CSS.Transform.toString(transform), opacity: isDragging ? 0.45 : undefined }} onContextMenu={onContext}>
    <button {...attributes} {...listeners} className="tab-main" onClick={onActivate} onAuxClick={(event) => { if (event.button === 1) { event.preventDefault(); onClose() } }} title={tab.url}>
      <span className="tab-favicon" data-part="tab-favicon" data-loading={String(runtime?.loading ?? false)}>{runtime?.loading ? <AppIcon name="Activity" /> : tab.favicon ? <img src={tab.favicon} alt="" /> : tab.url.startsWith('athanor://') ? <AppIcon name="WandSparkles" /> : <AppIcon name={runtime?.secure ? 'LockKeyhole' : 'Globe2'} />}</span>
      <span className="tab-label" data-part="tab-title">{tab.title}</span>
    </button>
    {runtime?.audible && <button className="tab-sound" aria-label="Mute audible tab" title="Mute tab" onPointerDown={(event) => event.stopPropagation()} onClick={() => void api.setMuted(tab.id, true)}><AppIcon name="AudioLines" /></button>}
    {tab.muted && <button className="tab-sound" aria-label="Unmute tab" title="Tab muted" onPointerDown={(event) => event.stopPropagation()} onClick={() => void api.setMuted(tab.id, false)}><AppIcon name="VolumeX" /></button>}
    <span className="tab-actions"><button className="tab-close" data-part="tab-close" aria-label={`Close ${tab.title}`} onPointerDown={(event) => event.stopPropagation()} onClick={onClose}><AppIcon name="X" /></button></span>
  </div>
}
function DropTarget({ id, className, label }: { id: string; className?: string; label: string }) { const { setNodeRef, isOver } = useDroppable({ id }); return <span ref={setNodeRef} className={className} data-over={String(isOver)} aria-label={label} /> }
function MenuButton({ icon, text, onClick }: { icon: string; text: string; onClick: () => void }) { return <button className="menu-item" role="menuitem" onClick={onClick}><AppIcon name={icon} />{text}</button> }
