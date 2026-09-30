import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react'
import type * as React from 'react'
import { Toaster, toast } from 'sonner'
import { DndContext, type DragEndEvent } from '@dnd-kit/core'
import { api } from './lib/api'
import { listen } from './lib/events'
import { useAppStore, bootStore } from './lib/store'
import { shortcutFromKeyboard, normalizeShortcut } from './lib/shortcuts'
import { dividerRatioAt } from './lib/splitMath'
import type { PanelInfo, Snapshot, SplitNode, SplitRects, Tab } from './lib/types'
import { AppIcon } from './components/Icons'
import { Button } from './components/ui/button'
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
const ExtensionsPage = lazy(() => import('./pages/Extensions'))

type Screen = 'browser' | 'settings' | 'boards' | 'extensions' | 'board-window'
export function App() {
  const snapshot = useAppStore((s) => s.snapshot)
  const ready = useAppStore((s) => s.ready)
  const panels = useAppStore((s) => s.panels)
  const extensionCommands = useAppStore((s) => s.commands)
  const servers = useAppStore((s) => s.servers)
  const isMock = useAppStore((s) => s.isMock)
  const [screen, setScreen] = useState<Screen>('browser')
  const [standaloneBoard, setStandaloneBoard] = useState<string | null>(null)
  const [panel, setPanel] = useState<PanelInfo | null>(null)
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [paletteQuery, setPaletteQuery] = useState('')
  const [devOpen, setDevOpen] = useState(false)
  const [switcherOpen, setSwitcherOpen] = useState(false)
  const [overlaySources, setOverlaySources] = useState({ menu: false, omnibox: false })
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
  useEffect(() => { void api.setOverlayOpen(paletteOpen || switcherOpen || overlaySources.menu || overlaySources.omnibox || devOpen || panel !== null) }, [paletteOpen, switcherOpen, overlaySources, devOpen, panel])
  useEffect(() => { const update = (event: Event) => { const next = (event as CustomEvent<'compact' | 'comfortable'>).detail; if (next === 'compact' || next === 'comfortable') setDensity(next) }; window.addEventListener('athanor-density', update); return () => window.removeEventListener('athanor-density', update) }, [])
  useEffect(() => { if (!snapshot?.workspace.split) { setSplitRects(null); return }; void api.getSplitRects().then(setSplitRects) }, [snapshot?.workspace.split])
  useEffect(() => { const unlisten = listen('athanor://split-rects', setSplitRects); return () => { void unlisten.then((off) => off()) } }, [])
  useEffect(() => { const content = document.querySelector('[data-part="content"]') as HTMLElement | null; if (!content) return; const report = () => { const rect = content.getBoundingClientRect(); void api.setContentBounds({ x: rect.x, y: rect.y, w: rect.width, h: rect.height }).then(() => { if (useAppStore.getState().snapshot?.workspace.split) void api.getSplitRects().then(setSplitRects) }) }; const observer = new ResizeObserver(report); observer.observe(content); report(); return () => observer.disconnect() }, [mobile, snapshot?.settings.sidebarCompact, snapshot?.settings.sidebarWidth, snapshot?.settings.sidebarSide])

  const activeTab = snapshot?.workspace.tabs.find((tab) => tab.id === snapshot.workspace.activeTab) ?? null
  const setMenuOverlay = useCallback((open: boolean) => setOverlaySources((current) => ({ ...current, menu: open })), [])
  const setOmniboxOverlay = useCallback((open: boolean) => setOverlaySources((current) => ({ ...current, omnibox: open })), [])
  useEffect(() => { if (standaloneBoard) return; if (activeTab?.url === 'athanor://settings') setScreen('settings'); else if (activeTab?.url === 'athanor://boards') setScreen('boards'); else if (activeTab?.url === 'athanor://extensions') setScreen('extensions'); else setScreen('browser') }, [activeTab?.url, standaloneBoard])
  const handleShortcut = useCallback((comboInput: string, fromNative = false) => {
    const combo = normalizeShortcut(comboInput)
    if (fromNative && !['Ctrl+L', 'Ctrl+K', 'Ctrl+B', 'Ctrl+Shift+D'].includes(combo)) return
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
    const unlisten = listen('athanor://shortcut', ({ combo }) => handleShortcut(combo, true))
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
    else if (target.startsWith('tab-target:') && event.activatorEvent instanceof MouseEvent && event.activatorEvent.altKey) void api.splitWith({ tab: target.slice(11), dir: 'row' })
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
  const standaloneBoardWindow = screen === 'board-window'
  const splitActive = Boolean(snapshot?.workspace.split)

  if (!snapshot || !ready) return <div className="page-placeholder"><div className="brand-mark"><AppIcon name="WandSparkles" /></div></div>
  return <DndContext onDragEnd={startDrag}>
    <div className={`${mobile ? 'mobile-shell' : ''} ${standaloneBoardWindow ? 'standalone-board-shell' : ''} app-shell`} data-part="shell" data-side={snapshot.settings.sidebarSide} data-density={density}>
      {!mobile && !standaloneBoardWindow && <Sidebar snapshot={snapshot} panels={panels} toolbar={<Toolbar snapshot={snapshot} activeTab={activeTab} omniboxRef={omniboxRef} openPalette={() => { setPaletteOpen(true); setPaletteQuery('') }} openPage={openInternalPage} toggleDev={() => setDevOpen((value) => !value)} onOverlay={setOmniboxOverlay} />} openPage={openInternalPage} openPanel={(selected) => { setPanel(selected); setScreen('browser') }} onOverlay={setMenuOverlay} />}
      <main className="main-column">
        {standaloneBoardWindow && !mobile && <StandaloneTitlebar />}
        {mobile && !standaloneBoardWindow && <MobileBar snapshot={snapshot} activeTab={activeTab} omniboxRef={omniboxRef} openSwitcher={() => setSwitcherOpen(true)} openPalette={() => { setPaletteOpen(true); setPaletteQuery('') }} onOverlay={setOmniboxOverlay} openPage={openInternalPage} />}
        <section className={`content ${mobile ? 'mobile-content' : ''}`} data-part="content" data-split={String(splitActive)}>
          {currentPage === 'browser' && (panel
            ? <PanelView panel={panel} />
            : !internalPage ? (isMock ? shownTab ? <MockPage tab={shownTab} snapshot={snapshot} /> : <NewTabPage servers={servers} onNavigate={openTabUrl} /> : null)
              : !shownTab || shownTab.url === 'athanor://newtab' ? <NewTabPage servers={servers} onNavigate={openTabUrl} />
                : shownTab.url === 'athanor://extensions' ? <Suspense fallback={<SuspenseCard />}><ExtensionsPage /></Suspense>
                  : shownTab.url === 'athanor://boards' ? <Suspense fallback={<SuspenseCard />}><BoardsPage standaloneId={standaloneBoard} /></Suspense>
                    : <Suspense fallback={<SuspenseCard />}><SettingsPage /></Suspense>)}
          {currentPage === 'settings' && <Suspense fallback={<SuspenseCard />}><SettingsPage /></Suspense>}
          {currentPage === 'boards' && <Suspense fallback={<SuspenseCard />}><BoardsPage standaloneId={standaloneBoard} /></Suspense>}
          {currentPage === 'extensions' && <Suspense fallback={<SuspenseCard />}><ExtensionsPage /></Suspense>}
          {currentPage === 'board-window' && <Suspense fallback={<SuspenseCard />}><BoardsPage standaloneId={standaloneBoard} /></Suspense>}
          {snapshot.workspace.split && !standaloneBoardWindow && <SplitOverlay snapshot={snapshot} rects={splitRects} />}
          {devOpen && !standaloneBoardWindow && <Suspense fallback={null}><DevPanel onClose={() => setDevOpen(false)} snapshot={snapshot} /></Suspense>}
        </section>
        {!mobile && !standaloneBoardWindow && <StatusBar snapshot={snapshot} />}
        {mobile && !standaloneBoardWindow && <nav className="mobile-bottom-bar" data-part="toolbar" aria-label="Navigation">
          <IconAction title="Back" onClick={() => activeTab && api.goBack(activeTab.id)}><AppIcon name="ArrowLeft" /></IconAction>
          <IconAction title="Forward" onClick={() => activeTab && api.goForward(activeTab.id)}><AppIcon name="ArrowRight" /></IconAction>
          <IconAction title="New tab" onClick={() => api.openTab()}><AppIcon name="Plus" /></IconAction>
          <button className="tab-count" data-part="tab-count" aria-label="Open tabs" onClick={() => setSwitcherOpen(true)}>{snapshot.workspace.tabs.filter((t) => !t.archived).length}</button>
          <IconAction title="Menu" onClick={() => { setPaletteOpen(true); setPaletteQuery('') }}><AppIcon name="Menu" /></IconAction>
        </nav>}
      </main>
      <CommandPalette open={paletteOpen} setOpen={setPaletteOpen} query={paletteQuery} setQuery={setPaletteQuery} snapshot={snapshot} servers={servers} extensionCommands={extensionCommands} run={runPaletteCommand} />
      {mobile && !standaloneBoardWindow && <TabSwitcher open={switcherOpen} onClose={() => setSwitcherOpen(false)} snapshot={snapshot} />}
      <Toaster className="toast-root" position={mobile ? 'top-center' : 'bottom-right'} theme={document.documentElement.dataset.themeDark === 'false' ? 'light' : 'dark'} />
    </div>
  </DndContext>
}

function IconAction({ title, children, onClick }: { title: string; children: React.ReactNode; onClick: () => void }) { return <button className="icon-button" data-part="nav-button" aria-label={title} title={title} onClick={onClick}>{children}</button> }
function StandaloneTitlebar() { const [maximized, setMaximized] = useState(false); useEffect(() => { void api.windowIsMaximized().then(setMaximized) }, []); return <div className="board-window-titlebar" data-part="titlebar" onPointerDown={(event) => { if (!(event.target as HTMLElement).closest('button')) void api.windowStartDrag() }}><span>Reference board</span><span className="titlebar-spacer" /><button className="window-control" aria-label="Minimize window" onClick={() => void api.windowMinimize()}><AppIcon name="Minus" /></button><button className="window-control" aria-label={maximized ? 'Restore window' : 'Maximize window'} onClick={() => { void api.windowToggleMaximize(); setMaximized((value) => !value) }}><AppIcon name={maximized ? 'Square' : 'Maximize2'} /></button><button className="window-control" data-part="window-close" aria-label="Close window" onClick={() => void api.windowClose()}><AppIcon name="X" /></button></div> }
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
  const isMock = useAppStore((state) => state.isMock)
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
  const mockSrc = `<!doctype html><html><body><h2>${panel.title}</h2><p>Sandboxed extension preview</p><textarea id="note" placeholder="Write a quick note"></textarea><button id="read">Test storage bridge</button><pre id="result"></pre><script>document.getElementById('read').onclick=()=>parent.postMessage({athanor:1,id:'mock-read',method:'storage.get',params:{key:'note'}},'*');addEventListener('message',e=>{if(e.data&&e.data.athanor===1&&e.data.id==='mock-read')document.getElementById('result').textContent=JSON.stringify(e.data.result||e.data.error)})</script></body></html>`
  return <iframe ref={frame} className="extension-panel" data-part="extension-panel" title={panel.title} src={isMock ? undefined : panel.url} srcDoc={isMock ? mockSrc : undefined} sandbox="allow-scripts" />
}
function fuzzyMatch(query: string, candidate: string) {
  const text = candidate.toLocaleLowerCase()
  return query.trim().toLocaleLowerCase().split(/\s+/).every((part) => {
    let cursor = 0
    for (const character of part) {
      cursor = text.indexOf(character, cursor)
      if (cursor < 0) return false
      cursor += 1
    }
    return true
  })
}
function CommandPalette({ open, setOpen, query, setQuery, snapshot, servers, extensionCommands, run }: { open: boolean; setOpen: (open: boolean) => void; query: string; setQuery: (query: string) => void; snapshot: Snapshot; servers: import('./lib/types').DevServer[]; extensionCommands: import('./lib/types').CommandInfo[]; run: (value: string) => void }) {
  const [suggestions, setSuggestions] = useState<import('./lib/types').Suggestion[]>([])
  const [activeTool, setActiveTool] = useState<import('./lib/types').DevTool | null>(null)
  const [toolInput, setToolInput] = useState('')
  const [toolOutput, setToolOutput] = useState('')
  const [copied, setCopied] = useState(false)
  useEffect(() => { if (!open) return; const timeout = window.setTimeout(() => { void api.omniboxSuggest(query).then(setSuggestions) }, 60); return () => window.clearTimeout(timeout) }, [query, open])
  const current = snapshot.workspace.tabs.filter((tab) => tab.space === snapshot.workspace.activeSpace && !tab.archived)
  const commands = [{ id: 'newtab', label: 'New tab', shortcut: 'Ctrl+T', icon: 'Plus' }, { id: 'settings', label: 'Open settings', icon: 'Settings' }, { id: 'boards', label: 'Open reference boards', icon: 'PanelsTopLeft' }, { id: 'extensions', label: 'Manage extensions', icon: 'Zap' }, { id: 'devtools', label: 'Toggle developer panel', shortcut: 'Ctrl+Shift+D', icon: 'SquareCode' }, { id: 'split', label: 'Split with next tab', shortcut: 'Ctrl+\\', icon: 'Split' }, { id: 'autofile', label: 'File tabs into folders', icon: 'Folder' }]
  const matches = (text: string) => fuzzyMatch(query, text)
  const select = (value: string) => { if (value.startsWith('devtool:')) { setActiveTool(value.slice(8) as import('./lib/types').DevTool); setToolOutput(''); return }; if (value.startsWith('suggest-command:')) { run(value.slice(16)); return }; run(value) }
  const devTools: import('./lib/types').DevTool[] = ['json-pretty', 'json-minify', 'base64-encode', 'base64-decode', 'url-encode', 'url-decode', 'jwt', 'timestamp', 'uuid', 'sha256', 'color']
  return <Dialog open={open} onOpenChange={(value) => { setOpen(value); if (!value) setActiveTool(null) }}><DialogContent aria-label="Command palette" data-part="palette"><Command shouldFilter={false}><CommandInput value={query} onValueChange={setQuery} placeholder="Search tabs, commands, and addresses…" /><CommandList><CommandEmpty>No matches. Press Enter to search the web.</CommandEmpty>{suggestions.length > 0 && <CommandGroup heading="Suggestions">{suggestions.filter((item) => matches(`${item.title} ${item.subtitle}`)).map((suggestion, index) => <CommandItem data-part="palette-item" key={`${suggestion.kind}-${index}`} value={suggestion.command ? `suggest-command:${suggestion.command}` : `suggest:${suggestion.url ?? ''}`} onSelect={select}><AppIcon name={suggestion.kind === 'tab' ? 'PanelsTopLeft' : suggestion.kind === 'search' ? 'Search' : 'Globe2'} /><div>{suggestion.title}<span className="command-subtitle">{suggestion.subtitle}</span></div></CommandItem>)}</CommandGroup>}
      <CommandGroup heading="Commands">{commands.filter((item) => matches(item.label)).map((item) => <CommandItem data-part="palette-item" key={item.id} value={`cmd:${item.id}`} onSelect={select}><AppIcon name={item.icon} /><span>{item.label}</span>{item.shortcut && <kbd>{item.shortcut}</kbd>}</CommandItem>)}{extensionCommands.filter((item) => matches(item.title)).map((item) => <CommandItem data-part="palette-item" key={`${item.ext}/${item.id}`} value={`ext:${item.ext}/${item.id}`} onSelect={select}><AppIcon name="Zap" /><span>{item.title}</span>{item.keybinding && <kbd>{item.keybinding}</kbd>}</CommandItem>)}</CommandGroup>
      <CommandGroup heading="Developer tools">{devTools.filter((item) => matches(item.replaceAll('-', ' '))).map((item) => <CommandItem data-part="palette-item" key={item} value={`devtool:${item}`} onSelect={select}><AppIcon name="SquareCode" /><span>{item.replaceAll('-', ' ')}</span></CommandItem>)}</CommandGroup>
      <CommandGroup heading="Open tabs">{current.filter((tab) => matches(`${tab.title} ${tab.url}`)).map((tab) => <CommandItem data-part="palette-item" key={tab.id} value={tab.id} onSelect={select}><AppIcon name={tab.pinned ? 'Layers3' : 'Globe2'} /><div>{tab.title}<span className="command-subtitle">{tab.url}</span></div></CommandItem>)}</CommandGroup>
      {servers.length > 0 && <CommandGroup heading="Dev servers">{servers.filter((server) => matches(`${server.title ?? ''} ${server.url}`)).map((server) => <CommandItem data-part="palette-item" key={server.url} value={`server:${server.url}`} onSelect={select}><AppIcon name="Terminal" /><div>{server.title ?? `localhost:${server.port}`}<span className="command-subtitle">{server.url}</span></div></CommandItem>)}</CommandGroup>}</CommandList></Command>
      {activeTool && <div className="palette-tool-area"><div className="palette-tool-heading"><strong>{activeTool.replaceAll('-', ' ')}</strong><button className="button button-ghost button-small" onClick={() => setActiveTool(null)}>Back to results</button></div><textarea className="textarea" aria-label="Developer tool input" value={toolInput} onChange={(event) => setToolInput(event.target.value)} placeholder="Input" /><div className="dev-actions"><Button onClick={() => void api.runDevTool(activeTool, toolInput).then(setToolOutput)}>Run</Button><Button variant="outline" size="sm" disabled={!toolOutput} onClick={() => { void navigator.clipboard.writeText(toolOutput); setCopied(true); window.setTimeout(() => setCopied(false), 1200) }}><AppIcon name={copied ? 'Check' : 'Copy'} />Copy output</Button></div><pre className="palette-tool-output">{toolOutput || 'Your result will appear here.'}</pre></div>}
    </DialogContent></Dialog>
}
