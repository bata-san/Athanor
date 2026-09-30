import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react'
import type * as React from 'react'
import { Toaster, toast } from 'sonner'
import { DndContext, type DragEndEvent } from '@dnd-kit/core'
import { api } from './lib/api'
import { listen } from './lib/events'
import { useAppStore, bootStore } from './lib/store'
import { shortcutFromKeyboard, normalizeShortcut } from './lib/shortcuts'
import { dividerRatioAt } from './lib/splitMath'
import type { Id, PanelInfo, Snapshot, SplitNode, SplitRects, Tab } from './lib/types'
import { AppIcon } from './components/Icons'
import { Button } from './components/ui/button'
import { Input } from './components/ui/input'
import { Dialog, DialogContent } from './components/ui/dialog'
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from './components/ui/command'
import { Sidebar } from './components/Sidebar'
import { Toolbar, MobileBar } from './components/Toolbar'
import { TabSwitcher } from './components/TabSwitcher'
import { NewTabPage } from './components/NewTabPage'
import { SuspenseCard } from './components/SuspenseCard'
const DevPanel = lazy(() => import('./pages/DevTools'))

const SettingsPage = lazy(() => import('./pages/Settings'))
const BoardsPage = lazy(() => import('./pages/Boards'))

type Screen = 'browser' | 'settings' | 'boards' | 'extensions' | 'board-window'
export function App() {
  const snapshot = useAppStore((s) => s.snapshot)
  const ready = useAppStore((s) => s.ready)
  const panels = useAppStore((s) => s.panels)
  const servers = useAppStore((s) => s.servers)
  const [screen, setScreen] = useState<Screen>('browser')
  const [standaloneBoard, setStandaloneBoard] = useState<string | null>(null)
  const [panel, setPanel] = useState<PanelInfo | null>(null)
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [paletteQuery, setPaletteQuery] = useState('')
  const [devOpen, setDevOpen] = useState(false)
  const [switcherOpen, setSwitcherOpen] = useState(false)
  const [menuOverlay, setMenuOverlay] = useState(false)
  const [splitRects, setSplitRects] = useState<SplitRects | null>(null)
  const [density, setDensity] = useState<'compact' | 'comfortable'>(() => localStorage.getItem('athanor-density') === 'compact' ? 'compact' : 'comfortable')
  const [narrow, setNarrow] = useState(() => window.matchMedia('(max-width: 43.75rem)').matches)
  const omniboxRef = useRef<HTMLInputElement>(null)
  const mobile = (snapshot?.platform === 'android' || snapshot?.platform === 'ios') || narrow

  useEffect(() => { void bootStore() }, [])
  useEffect(() => {
    const params = window.location.hash.match(/^#\/board\/([^/]+)/)
    if (params) { setStandaloneBoard(decodeURIComponent(params[1]!)); setScreen('board-window') }
  }, [])
  useEffect(() => { const query = window.matchMedia('(max-width: 43.75rem)'); const update = () => setNarrow(query.matches); query.addEventListener('change', update); return () => query.removeEventListener('change', update) }, [])
  useEffect(() => { void api.setOverlayOpen(paletteOpen || switcherOpen || menuOverlay || devOpen || panel !== null) }, [paletteOpen, switcherOpen, menuOverlay, devOpen, panel])
  useEffect(() => { const update = (event: Event) => { const next = (event as CustomEvent<'compact' | 'comfortable'>).detail; if (next === 'compact' || next === 'comfortable') setDensity(next) }; window.addEventListener('athanor-density', update); return () => window.removeEventListener('athanor-density', update) }, [])
  useEffect(() => { if (!snapshot?.workspace.split) { setSplitRects(null); return }; void api.getSplitRects().then(setSplitRects) }, [snapshot?.workspace.split])
  useEffect(() => { const unlisten = listen('athanor://split-rects', setSplitRects); return () => { void unlisten.then((off) => off()) } }, [])
  useEffect(() => { const content = document.querySelector('[data-part="content"]') as HTMLElement | null; if (!content) return; const report = () => { const rect = content.getBoundingClientRect(); void api.setContentBounds({ x: rect.x, y: rect.y, w: rect.width, h: rect.height }) }; const observer = new ResizeObserver(report); observer.observe(content); report(); return () => observer.disconnect() }, [mobile, snapshot?.settings.sidebarCompact, snapshot?.settings.sidebarWidth, snapshot?.settings.sidebarSide])

  const activeTab = snapshot?.workspace.tabs.find((tab) => tab.id === snapshot.workspace.activeTab) ?? null
  const handleShortcut = useCallback((comboInput: string) => {
    const combo = normalizeShortcut(comboInput)
    const current = useAppStore.getState().snapshot
    const tab = current?.workspace.tabs.find((item) => item.id === current.workspace.activeTab)
    if (combo === 'Ctrl+K') { setPaletteOpen(true); setPaletteQuery('') }
    else if (combo === 'Ctrl+T') { void api.openTab(); setScreen('browser') }
    else if (combo === 'Ctrl+W' && tab) void api.closeTab(tab.id)
    else if (combo === 'Ctrl+L') { setScreen('browser'); requestAnimationFrame(() => { omniboxRef.current?.focus(); omniboxRef.current?.select() }) }
    else if (combo === 'Ctrl+B' && current) void api.setSettings({ sidebarCompact: !current.settings.sidebarCompact })
    else if (combo === 'Ctrl+Shift+D' || combo === 'F12') setDevOpen((value) => !value)
    else if (combo === 'Ctrl+\\' && tab) { const next = current?.workspace.tabs.find((item) => item.space === current.workspace.activeSpace && !item.archived && item.id !== tab.id); if (next) void api.splitWith({ tab: next.id, dir: 'row' }) }
    else if (/^Ctrl\+[1-9]$/.test(combo) && current) { const ix = Number(combo.slice(-1)) - 1; const visible = current.workspace.tabs.filter((item) => item.space === current.workspace.activeSpace && !item.archived); if (visible[ix]) void api.activateTab(visible[ix]!.id) }
    else if (combo === 'Ctrl+Tab' || combo === 'Ctrl+Shift+Tab') {
      if (!current) return
      const visible = current.workspace.tabs.filter((item) => item.space === current.workspace.activeSpace && !item.archived)
      const index = visible.findIndex((item) => item.id === current.workspace.activeTab)
      const direction = combo === 'Ctrl+Tab' ? 1 : -1
      if (visible.length) void api.activateTab(visible[(index + direction + visible.length) % visible.length]!.id)
    }
  }, [])
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      const combo = shortcutFromKeyboard(event)
      if (!combo) return
      if (['Ctrl+K', 'Ctrl+T', 'Ctrl+W', 'Ctrl+L', 'Ctrl+B', 'Ctrl+Shift+D', 'Ctrl+\\', 'Ctrl+Tab', 'Ctrl+Shift+Tab', 'F12'].includes(combo) || /^Ctrl\+[1-9]$/.test(combo)) { event.preventDefault(); handleShortcut(combo) }
    }
    document.addEventListener('keydown', keydown)
    const unlisten = listen('athanor://shortcut', ({ combo }) => handleShortcut(combo))
    return () => { document.removeEventListener('keydown', keydown); void unlisten.then((off) => off()) }
  }, [handleShortcut])
  useEffect(() => {
    const unlisten = listen('athanor://toast', ({ level, message }) => toast[level](message))
    return () => { void unlisten.then((off) => off()) }
  }, [])

  const startDrag = (event: DragEndEvent) => {
    if (!event.over) return
    const activeId = String(event.active.id).replace(/^tab:/, '')
    const target = String(event.over.id)
    if (target === 'pinned-drop') void api.moveTab({ tab: activeId, pinned: true })
    else if (target === 'root-drop') void api.moveTab({ tab: activeId, folder: null })
    else if (target.startsWith('folder:')) void api.moveTab({ tab: activeId, folder: target.slice(7) })
    else if (target.startsWith('space:')) void api.moveTab({ tab: activeId, space: target.slice(6), folder: null })
    else if (target.startsWith('tab:') && event.activatorEvent instanceof MouseEvent && event.activatorEvent.altKey) void api.splitWith({ tab: target.slice(4), dir: 'row' })
  }
  const openTabUrl = (url: string) => { void api.openTab({ url }); setPaletteOpen(false); setSwitcherOpen(false); setPanel(null); setScreen('browser') }
  const openInternalPage = (page: Exclude<Screen, 'browser' | 'board-window'>) => {
    const url = page === 'settings' ? 'athanor://settings' : page === 'boards' ? 'athanor://boards' : 'athanor://extensions'
    const existing = snapshot?.workspace.tabs.find((tab) => tab.url === url)
    setPanel(null); setScreen(page)
    if (existing) void api.activateTab(existing.id); else void api.openTab({ url })
  }
  const runPaletteCommand = (value: string) => {
    if (value.startsWith('cmd:')) {
      const cmd = value.slice(4)
      if (cmd === 'newtab') openTabUrl('athanor://newtab')
      if (cmd === 'settings') { openInternalPage('settings'); setPaletteOpen(false) }
      if (cmd === 'boards') { openInternalPage('boards'); setPaletteOpen(false) }
      if (cmd === 'extensions') { openInternalPage('extensions'); setPaletteOpen(false) }
      if (cmd === 'devtools') { setDevOpen(true); setPaletteOpen(false) }
      if (cmd === 'split' && snapshot) { const next = snapshot.workspace.tabs.find((t) => t.space === snapshot.workspace.activeSpace && t.id !== snapshot.workspace.activeTab && !t.archived); if (next) void api.splitWith({ tab: next.id, dir: 'row' }); setPaletteOpen(false) }
      if (cmd === 'autofile') { void api.autoFileAll(); setPaletteOpen(false) }
      return
    }
    const tab = snapshot?.workspace.tabs.find((item) => item.id === value)
    if (tab) { void api.activateTab(tab.id); setScreen(tab.url === 'athanor://settings' ? 'settings' : tab.url === 'athanor://boards' ? 'boards' : tab.url === 'athanor://extensions' ? 'extensions' : 'browser'); setPaletteOpen(false); return }
    if (value.startsWith('server:')) { const server = servers.find((item) => item.url === value.slice(7)); if (server) openTabUrl(server.url); return }
    if (value.startsWith('ext:')) { const [ext, id] = value.slice(4).split('/'); if (ext && id) void api.runExtensionCommand(ext, id); setPaletteOpen(false); return }
    if (value.startsWith('suggest:')) { const url = value.slice(8); openTabUrl(url); return }
  }
  const shownTab = activeTab
  const currentPage: Screen = screen === 'browser' && shownTab?.url === 'athanor://settings' ? 'settings' : screen === 'browser' && shownTab?.url === 'athanor://boards' ? 'boards' : screen === 'browser' && shownTab?.url === 'athanor://extensions' ? 'extensions' : screen
  const internalPage = shownTab?.url.startsWith('athanor://') ?? false
  const splitActive = Boolean(snapshot?.workspace.split)

  if (!snapshot || !ready) return <div className="page-placeholder"><div className="brand-mark"><AppIcon name="WandSparkles" /></div></div>
  return <DndContext onDragEnd={startDrag}>
    <div className={`${mobile ? 'mobile-shell' : ''} app-shell`} data-part="shell" data-side={snapshot.settings.sidebarSide} data-density={density}>
      {!mobile && <Sidebar snapshot={snapshot} panels={panels} openPage={openInternalPage} openPanel={(selected) => { setPanel(selected); setScreen('browser') }} onOverlay={setMenuOverlay} />}
      <main className="main-column">
        {!mobile && <Toolbar snapshot={snapshot} activeTab={activeTab} omniboxRef={omniboxRef} openPalette={() => { setPaletteOpen(true); setPaletteQuery('') }} openPage={openInternalPage} toggleDev={() => setDevOpen((value) => !value)} onOverlay={setMenuOverlay} />}
        {mobile && <MobileBar snapshot={snapshot} activeTab={activeTab} omniboxRef={omniboxRef} openSwitcher={() => setSwitcherOpen(true)} openPalette={() => { setPaletteOpen(true); setPaletteQuery('') }} onOverlay={setMenuOverlay} />}
        <section className={`content ${mobile ? 'mobile-content' : ''}`} data-part="content" data-split={String(splitActive)}>
          {currentPage === 'browser' && (panel ? <PanelView panel={panel} /> : internalPage ? (shownTab?.url === 'athanor://newtab' || !shownTab ? <NewTabPage servers={servers} onNavigate={openTabUrl} /> : shownTab.url === 'athanor://extensions' ? <ExtensionsPage /> : shownTab.url === 'athanor://boards' ? <Suspense fallback={<SuspenseCard />}><BoardsPage standaloneId={standaloneBoard} /></Suspense> : <Suspense fallback={<SuspenseCard />}><SettingsPage /></Suspense> : <MockPage tab={shownTab} snapshot={snapshot} />)}
          {currentPage === 'settings' && <Suspense fallback={<SuspenseCard />}><SettingsPage /></Suspense>}
          {currentPage === 'boards' && <Suspense fallback={<SuspenseCard />}><BoardsPage standaloneId={standaloneBoard} /></Suspense>}
          {currentPage === 'extensions' && <ExtensionsPage />}
          {currentPage === 'board-window' && <Suspense fallback={<SuspenseCard />}><BoardsPage standaloneId={standaloneBoard} /></Suspense>}
          {snapshot.workspace.split && <SplitOverlay snapshot={snapshot} rects={splitRects} />}
          {devOpen && <Suspense fallback={null}><DevPanel onClose={() => setDevOpen(false)} snapshot={snapshot} /></Suspense>}
        </section>
        {!mobile && <StatusBar snapshot={snapshot} />}
        {mobile && <nav className="mobile-bottom-bar" data-part="toolbar" aria-label="Navigation">
          <IconAction title="Back" onClick={() => activeTab && api.goBack(activeTab.id)}><AppIcon name="ArrowLeft" /></IconAction>
          <IconAction title="Forward" onClick={() => activeTab && api.goForward(activeTab.id)}><AppIcon name="ArrowRight" /></IconAction>
          <IconAction title="New tab" onClick={() => api.openTab()}><AppIcon name="Plus" /></IconAction>
          <button className="tab-count" data-part="tab-count" aria-label="Open tabs" onClick={() => setSwitcherOpen(true)}>{snapshot.workspace.tabs.filter((t) => !t.archived).length}</button>
          <IconAction title="Menu" onClick={() => { setPaletteOpen(true); setPaletteQuery('') }}><AppIcon name="Menu" /></IconAction>
        </nav>}
      </main>
      <CommandPalette open={paletteOpen} setOpen={setPaletteOpen} query={paletteQuery} setQuery={setPaletteQuery} snapshot={snapshot} servers={servers} run={runPaletteCommand} />
      {mobile && <TabSwitcher open={switcherOpen} onClose={() => setSwitcherOpen(false)} snapshot={snapshot} />}
      <Toaster className="toast-root" position={mobile ? 'top-center' : 'bottom-right'} theme={document.documentElement.dataset.themeDark === 'false' ? 'light' : 'dark'} />
    </div>
  </DndContext>
}

function IconAction({ title, children, onClick }: { title: string; children: React.ReactNode; onClick: () => void }) { return <button className="icon-button" data-part="nav-button" aria-label={title} title={title} onClick={onClick}>{children}</button> }
function MockPage({ tab, snapshot }: { tab: Tab; snapshot: Snapshot }) {
  const runtime = snapshot.runtime[tab.id]
  return <div className="page-placeholder"><article className="placeholder-card" data-part="new-tab-page"><span className="placeholder-eyebrow">Mock browser preview</span><h2>{tab.title}</h2><span className="placeholder-url">{tab.url}</span><p className="muted-copy">The native page webview appears here when Athanor runs inside Tauri. This preview keeps the shell layout usable in a regular browser.</p><div className="placeholder-preview"><AppIcon name="ShieldCheck" /> {runtime?.blocked ?? 0} requests blocked {runtime?.secure ? '· secure connection' : ''}</div></article></div>
}
function StatusBar({ snapshot }: { snapshot: Snapshot }) { return <div className="statusbar" data-part="statusbar"><span>{snapshot.workspace.split ? 'Split view active' : 'Athanor is ready'}</span><span>{snapshot.version} · {snapshot.platform}</span></div> }
function SplitOverlay({ snapshot, rects }: { snapshot: Snapshot; rects: SplitRects | null }) {
  const split = snapshot.workspace.split
  if (!split || !rects) return null
  const focusedPane = rects.panes.find((pane) => pane.tab === split.focused)
  const nodeAt = (root: SplitNode, path: boolean[]) => path.reduce<SplitNode | null>((node, branch) => node?.kind === 'split' ? branch ? node.b : node.a : null, root)
  const leaves = (node: SplitNode | null): string[] => !node ? [] : node.kind === 'leaf' ? [node.tab] : [...leaves(node.a), ...leaves(node.b)]
  return <>
    {focusedPane && <div className="split-focus-ring" aria-hidden="true" style={{ left: focusedPane.rect.x, top: focusedPane.rect.y, width: focusedPane.rect.w, height: focusedPane.rect.h }} />}
    {rects.dividers.map((divider, index) => <button key={`${divider.path.join('.')}-${index}`} className="split-divider" data-part="split-divider" data-dir={divider.dir} aria-label="Resize split panes" style={{ left: divider.rect.x, top: divider.rect.y, width: divider.rect.w, height: divider.rect.h }} onPointerDown={(event) => {
      const parent = event.currentTarget.parentElement; if (!parent) return
      event.currentTarget.setPointerCapture(event.pointerId)
      const regionNode = nodeAt(split.root, divider.path), childIds = new Set(leaves(regionNode)), boxes = rects.panes.filter((pane) => childIds.has(pane.tab)).map((pane) => pane.rect)
      if (!boxes.length) return
      const region = { x: Math.min(...boxes.map((box) => box.x)), y: Math.min(...boxes.map((box) => box.y)), w: Math.max(...boxes.map((box) => box.x + box.w)) - Math.min(...boxes.map((box) => box.x)), h: Math.max(...boxes.map((box) => box.y + box.h)) - Math.min(...boxes.map((box) => box.y)) }
      const move = (e: PointerEvent) => { const area = parent.getBoundingClientRect(); const value = dividerRatioAt(divider.dir, { x: e.clientX - area.left, y: e.clientY - area.top }, region); void api.setSplitRatio(divider.path, value) }
      const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up) }
      window.addEventListener('pointermove', move); window.addEventListener('pointerup', up)
    }} />)}
    {rects.panes.map((pane) => { const tab = snapshot.workspace.tabs.find((item) => item.id === pane.tab); if (!tab) return null; return <div className="pane-toolbar" key={pane.tab} style={{ left: pane.rect.x + 8, top: pane.rect.y + 8 }}><span className="muted-copy">{tab.title}</span><IconAction title="Focus pane" onClick={() => void api.focusPane(tab.id)}><AppIcon name="Split" /></IconAction><IconAction title="Close pane tab" onClick={() => void api.closeTab(tab.id)}><AppIcon name="X" /></IconAction></div> })}
    <div className="split-toolbar-global"><span className="muted-copy">Split view</span><IconAction title="Remove split" onClick={() => void api.unsplit()}><AppIcon name="X" /></IconAction></div>
  </>
}
function PanelView({ panel }: { panel: PanelInfo }) {
  const frame = useRef<HTMLIFrameElement>(null)
  useEffect(() => {
    const listener = async (event: MessageEvent) => {
      if (event.source !== frame.current?.contentWindow || !event.data || event.data.athanor !== 1 || typeof event.data.id !== 'string' || typeof event.data.method !== 'string') return
      try { const result = await api.extensionRpc(panel.ext, event.data.method, event.data.params); frame.current?.contentWindow?.postMessage({ athanor: 1, id: event.data.id, result }, '*') }
      catch (error) { frame.current?.contentWindow?.postMessage({ athanor: 1, id: event.data.id, error: String(error) }, '*') }
    }
    window.addEventListener('message', listener)
    const unlisten = listen('athanor://extension-event', (event) => { if (event.ext === panel.ext) frame.current?.contentWindow?.postMessage({ athanor: 1, event: event.type, data: event.data }, '*') })
    return () => { window.removeEventListener('message', listener); void unlisten.then((off) => off()) }
  }, [panel])
  return <iframe ref={frame} className="extension-panel" data-part="extension-panel" title={panel.title} src={panel.url} sandbox="allow-scripts" />
}
function ExtensionsPage() {
  const [extensions, setExtensions] = useState<import('./lib/types').ExtensionInfo[]>([])
  useEffect(() => { void api.listExtensions().then(setExtensions) }, [])
  return <div className="page-scroll"><header className="page-header"><div><h1>Extensions</h1><p className="muted-copy">Small tools that extend your browser, with clear permissions.</p></div></header>{extensions.map((extension) => <section key={extension.id} className="page-section"><div className="switch-row"><div><strong>{extension.name}</strong><p>{extension.description}</p></div><button className="switch" data-checked={String(extension.enabled)} aria-label={`${extension.enabled ? 'Disable' : 'Enable'} ${extension.name}`} onClick={() => { void api.setExtensionEnabled(extension.id, !extension.enabled).then(() => api.listExtensions().then(setExtensions)) }} /></div><span className="muted-copy">Permissions: {extension.permissions.join(', ') || 'None'} · {extension.version}</span></section>)}</div>
}
function CommandPalette({ open, setOpen, query, setQuery, snapshot, servers, run }: { open: boolean; setOpen: (open: boolean) => void; query: string; setQuery: (query: string) => void; snapshot: Snapshot; servers: import('./lib/types').DevServer[]; run: (value: string) => void }) {
  const [suggestions, setSuggestions] = useState<import('./lib/types').Suggestion[]>([])
  useEffect(() => { if (!open) return; const timeout = window.setTimeout(() => { void api.omniboxSuggest(query).then(setSuggestions) }, 60); return () => window.clearTimeout(timeout) }, [query, open])
  const current = snapshot.workspace.tabs.filter((tab) => tab.space === snapshot.workspace.activeSpace && !tab.archived)
  const commands = [{ id: 'newtab', label: 'New tab', shortcut: 'Ctrl+T', icon: 'Plus' }, { id: 'settings', label: 'Open settings', icon: 'Settings' }, { id: 'boards', label: 'Open reference boards', icon: 'PanelsTopLeft' }, { id: 'extensions', label: 'Manage extensions', icon: 'Zap' }, { id: 'devtools', label: 'Toggle developer panel', shortcut: 'Ctrl+Shift+D', icon: 'SquareCode' }, { id: 'split', label: 'Split with next tab', shortcut: 'Ctrl+\\', icon: 'Split' }, { id: 'autofile', label: 'File tabs into folders', icon: 'Folder' }]
  return <Dialog open={open} onOpenChange={setOpen}><DialogContent aria-label="Command palette"><Command shouldFilter={false}><CommandInput value={query} onValueChange={setQuery} placeholder="Search tabs, commands, and addresses…" /><CommandList><CommandEmpty>No matches. Press Enter to search the web.</CommandEmpty>{suggestions.length > 0 && <CommandGroup heading="Suggestions">{suggestions.map((suggestion, index) => <CommandItem key={`${suggestion.kind}-${index}`} value={`suggest:${suggestion.url ?? ''}`} onSelect={run}><AppIcon name={suggestion.kind === 'tab' ? 'PanelsTopLeft' : suggestion.kind === 'search' ? 'Search' : 'Globe2'} /><div>{suggestion.title}<span className="command-subtitle">{suggestion.subtitle}</span></div></CommandItem>)}</CommandGroup>}{!query && <CommandGroup heading="Commands">{commands.map((item) => <CommandItem key={item.id} value={`cmd:${item.id}`} onSelect={run}><AppIcon name={item.icon} /><span>{item.label}</span>{item.shortcut && <kbd>{item.shortcut}</kbd>}</CommandItem>)}</CommandGroup>}{!query && <CommandGroup heading="Open tabs">{current.map((tab) => <CommandItem key={tab.id} value={tab.id} onSelect={run}><AppIcon name={tab.pinned ? 'Layers3' : 'Globe2'} /><div>{tab.title}<span className="command-subtitle">{tab.url}</span></div></CommandItem>)}</CommandGroup>}{!query && servers.length > 0 && <CommandGroup heading="Dev servers">{servers.map((server) => <CommandItem key={server.url} value={`server:${server.url}`} onSelect={run}><AppIcon name="Terminal" /><div>{server.title ?? `localhost:${server.port}`}<span className="command-subtitle">{server.url}</span></div></CommandItem>)}</CommandGroup>}</CommandList></Command></DialogContent></Dialog>
}
