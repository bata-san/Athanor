import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react'
import type * as React from 'react'
import { Toaster, toast } from 'sonner'
import { DndContext, DragOverlay } from '@dnd-kit/core'
import { ArrowLeft, ArrowRight, Command as CommandIcon, Plus, ShieldCheck } from 'lucide-react'
import { AnimatePresence } from 'motion/react'
import { api } from './lib/api'
import { listen } from './lib/events'
import { useAppStore, bootStore } from './lib/store'
import { shortcutFromKeyboard, normalizeShortcut } from './lib/shortcuts'
import { dividerRatioAt } from './lib/splitMath'
import { useAnyOverlay, useOverlay, useOverlayStore } from './lib/overlay'
import { isDarkTheme } from './lib/theme'
import { mockPageContextMenu } from './lib/mock/backend'
import type { PageContextMenu, PanelInfo, Rect, Snapshot, SplitNode, SplitRects, Tab } from './lib/types'
import { cn } from './lib/utils'
import { AthanorMark } from './components/AthanorMark'
import { Button } from './components/ui/button'
import { TooltipProvider } from './components/ui/tooltip'
import { Sidebar, DragGhost } from './components/Sidebar'
import { useDragState, useTabDnd } from './lib/tabDnd'
import { StageBar, MobileBar } from './components/Toolbar'
import { CommandBar, type BarMode } from './components/CommandBar'
import { hostOf } from './components/UrlPill'
import { TabSwitcher } from './components/TabSwitcher'
import { NewTabPage } from './components/NewTabPage'
import { SuspenseCard } from './components/SuspenseCard'
import { PageContextMenuView } from './components/PageContextMenu'
import { DialogHost } from './components/dialogs'
import { Welcome } from './components/welcome/Welcome'
import { WindowControls, dragWindow, toggleWindow } from './components/WindowControls'
const DevPanel = lazy(() => import('./pages/DevTools'))

const SettingsPage = lazy(() => import('./pages/Settings'))
const BoardsPage = lazy(() => import('./pages/Boards'))
const ExtensionsPage = lazy(() => import('./pages/Extensions'))

type Screen = 'browser' | 'settings' | 'boards' | 'extensions' | 'board-window'
type Frame = { tab: string; src: string; rect: Rect }

/**
 * Native tab webviews sit above the shell, so while any shell popup is open they are hidden. To keep the page
 * from vanishing, each visible page is captured first and shown as a still image underneath the popup.
 */
function useFreezeFrames(targets: () => { tab: string; rect: Rect }[]) {
  const [frames, setFrames] = useState<Frame[]>([])
  const desired = useRef(false)
  const applied = useRef(false)
  const targetsRef = useRef(targets)
  targetsRef.current = targets
  const freeze = useCallback(async (capture = true) => {
    desired.current = true
    if (applied.current) return
    applied.current = true
    const shots = capture ? await Promise.all(targetsRef.current().map(async (target) => {
      try {
        const src = await Promise.race([api.captureFrame(target.tab), new Promise<null>((resolve) => window.setTimeout(() => resolve(null), 1600))])
        return src ? { ...target, src } : null
      } catch { return null }
    })) : []
    if (!desired.current) { applied.current = false; return }
    setFrames(shots.filter((shot): shot is Frame => shot !== null))
    await api.setOverlayOpen(true)
  }, [])
  const thaw = useCallback(async () => {
    desired.current = false
    if (!applied.current) return
    applied.current = false
    await api.setOverlayOpen(false)
    window.setTimeout(() => { if (!desired.current) setFrames([]) }, 90)
  }, [])
  return { frames, freeze, thaw }
}

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
  const [bar, setBar] = useState<{ open: boolean; mode: BarMode; seed: string }>({ open: false, mode: 'navigate', seed: '' })
  const paletteOpen = bar.open
  const setPaletteOpen = useCallback((open: boolean) => setBar((current) => ({ ...current, open })), [])
  const openBar = useCallback((mode: BarMode = 'navigate', seed = '') => setBar({ open: true, mode, seed }), [])
  const [devOpen, setDevOpen] = useState(false)
  const [tour, setTour] = useState(false)
  const [switcherOpen, setSwitcherOpen] = useState(false)
  const [splitRects, setSplitRects] = useState<SplitRects | null>(null)
  const [pageMenu, setPageMenu] = useState<{ request: PageContextMenu; anchor: { x: number; y: number } } | null>(null)
  const [density, setDensity] = useState<'compact' | 'comfortable'>(() => localStorage.getItem('athanor-density') === 'compact' ? 'compact' : 'comfortable')
  const [narrow, setNarrow] = useState(() => window.matchMedia('(max-width: 43.75rem)').matches)
  const contentRef = useRef<HTMLElement>(null)
  const mobile = (snapshot?.platform === 'android' || snapshot?.platform === 'ios') || narrow
  const anyOverlay = useAnyOverlay()
  const dnd = useTabDnd()
  const draggingId = useDragState((state) => state.dragging)
  const splitRectsRef = useRef(splitRects)
  splitRectsRef.current = splitRects

  const freezeTargets = useCallback(() => {
    const current = useAppStore.getState().snapshot
    const content = contentRef.current?.getBoundingClientRect()
    if (!current || !content) return []
    const split = current.workspace.split ? splitRectsRef.current : null
    if (split) return split.panes.filter((pane) => !current.workspace.tabs.find((tab) => tab.id === pane.tab)?.url.startsWith('athanor://')).map((pane) => ({ tab: pane.tab, rect: pane.rect }))
    const active = current.workspace.tabs.find((tab) => tab.id === current.workspace.activeTab)
    if (!active || active.url.startsWith('athanor://')) return []
    return [{ tab: active.id, rect: { x: 0, y: 0, w: content.width, h: content.height } }]
  }, [])
  const { frames, freeze, thaw } = useFreezeFrames(freezeTargets)

  useEffect(() => { void bootStore() }, [])
  useEffect(() => {
    const params = window.location.hash.match(/^#\/board\/([^/]+)/)
    if (params) { setStandaloneBoard(decodeURIComponent(params[1]!)); setScreen('board-window') }
  }, [])
  useEffect(() => { const query = window.matchMedia('(max-width: 43.75rem)'); const update = () => setNarrow(query.matches); query.addEventListener('change', update); return () => query.removeEventListener('change', update) }, [])
  useOverlay(paletteOpen, 'palette')
  useOverlay(devOpen, 'dev-panel')
  useOverlay(switcherOpen, 'tab-switcher')
  useOverlay(panel !== null, 'extension-panel')
  // Popups that cover only part of the page get a frozen frame; the full-screen ones (mobile switcher, extension panel) just hide it.
  const overlayOpen = anyOverlay
  const frameWanted = overlayOpen && !mobile && !(panel !== null && !paletteOpen && !devOpen)
  useEffect(() => { if (overlayOpen) void freeze(frameWanted); else void thaw() }, [overlayOpen, frameWanted, freeze, thaw])
  useEffect(() => { const update = (event: Event) => { const next = (event as CustomEvent<'compact' | 'comfortable'>).detail; if (next === 'compact' || next === 'comfortable') setDensity(next) }; window.addEventListener('athanor-density', update); return () => window.removeEventListener('athanor-density', update) }, [])
  useEffect(() => { if (!snapshot?.workspace.split) { setSplitRects(null); return }; void api.getSplitRects().then(setSplitRects) }, [snapshot?.workspace.split])
  useEffect(() => { const unlisten = listen('athanor://split-rects', setSplitRects); return () => { void unlisten.then((off) => off()) } }, [])
  // The page views are clipped to the stage's corner radius so the native page sits inside the rounded card.
  useEffect(() => {
    const content = contentRef.current; if (!content) return
    const apply = () => { const radius = parseFloat(getComputedStyle(content).borderTopLeftRadius) || 0; void api.setPageRadius(Math.round(radius * (window.devicePixelRatio || 1))) }
    apply(); window.addEventListener('resize', apply)
    return () => window.removeEventListener('resize', apply)
  }, [mobile, ready])
  useEffect(() => { const content = contentRef.current; if (!content) return; const report = () => { const rect = content.getBoundingClientRect(); void api.setContentBounds({ x: rect.x, y: rect.y, w: rect.width, h: rect.height }).then(() => { if (useAppStore.getState().snapshot?.workspace.split) void api.getSplitRects().then(setSplitRects) }) }; const observer = new ResizeObserver(report); observer.observe(content); report(); return () => observer.disconnect() }, [mobile, ready, snapshot?.settings.sidebarCompact, snapshot?.settings.sidebarWidth, snapshot?.settings.sidebarSide])

  // The page's right-click menu: freeze the page, then draw the menu over the still image.
  useEffect(() => {
    const unlisten = listen('athanor://context-menu', (request) => {
      void (async () => {
        const content = contentRef.current?.getBoundingClientRect()
        if (!content) { void api.resolveContextMenu(request.tab, null); return }
        const pane = useAppStore.getState().snapshot?.workspace.split ? splitRectsRef.current?.panes.find((candidate) => candidate.tab === request.tab)?.rect : undefined
        const dpr = window.devicePixelRatio || 1
        const anchor = { x: content.x + (pane?.x ?? 0) + request.x / dpr, y: content.y + (pane?.y ?? 0) + request.y / dpr }
        try { await freeze(true); setPageMenu({ request, anchor }) } catch { void api.resolveContextMenu(request.tab, null) }
      })()
    })
    return () => { void unlisten.then((off) => off()) }
  }, [freeze])
  // The shell never shows the browser's own context menu, except in text fields where cut/copy/paste are useful.
  useEffect(() => {
    const suppress = (event: MouseEvent) => { const target = event.target as HTMLElement | null; if (!target?.closest('input, textarea, [contenteditable="true"]')) event.preventDefault() }
    document.addEventListener('contextmenu', suppress)
    return () => document.removeEventListener('contextmenu', suppress)
  }, [])

  const activeTab = snapshot?.workspace.tabs.find((tab) => tab.id === snapshot.workspace.activeTab) ?? null
  useEffect(() => { if (standaloneBoard) return; if (activeTab?.url === 'athanor://settings') setScreen('settings'); else if (activeTab?.url === 'athanor://boards') setScreen('boards'); else if (activeTab?.url === 'athanor://extensions') setScreen('extensions'); else setScreen('browser') }, [activeTab?.url, standaloneBoard])
  const handleShortcut = useCallback((comboInput: string, fromNative = false) => {
    const combo = normalizeShortcut(comboInput)
    if (fromNative && !['Ctrl+L', 'Ctrl+K', 'Ctrl+T', 'Ctrl+B', 'Ctrl+Shift+D'].includes(combo)) return
    const current = useAppStore.getState().snapshot
    const tab = current?.workspace.tabs.find((item) => item.id === current.workspace.activeTab)
    if (combo === 'Ctrl+K') openBar('navigate', '')
    else if (combo === 'Ctrl+T') { setScreen('browser'); openBar('new-tab', '') }
    else if (combo === 'Ctrl+W' && tab) void api.closeTab(tab.id)
    else if (combo === 'Ctrl+L') { const url = tab?.url ?? ''; openBar('navigate', url.startsWith('athanor://') ? '' : url) }
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
  }, [openBar])
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
      if (cmd === 'newtab') { void api.openTab(); setPaletteOpen(false) }
      if (cmd === 'settings') { openInternalPage('settings'); setPaletteOpen(false) }
      if (cmd === 'boards') { openInternalPage('boards'); setPaletteOpen(false) }
      if (cmd === 'extensions') { openInternalPage('extensions'); setPaletteOpen(false) }
      if (cmd === 'devtools') { setDevOpen(true); setPaletteOpen(false) }
      if (cmd === 'split' && snapshot) { const next = snapshot.workspace.tabs.find((t) => t.space === snapshot.workspace.activeSpace && t.id !== snapshot.workspace.activeTab && !t.archived); if (next) void api.splitWith({ tab: next.id, dir: 'row' }); setPaletteOpen(false) }
      if (cmd === 'autofile') { void api.autoFileAll(); setPaletteOpen(false) }
      if (cmd === 'welcome') { setPaletteOpen(false); setTour(true) }
      return
    }
    const tab = snapshot?.workspace.tabs.find((item) => item.id === value)
    if (tab) { void api.activateTab(tab.id); setScreen(tab.url === 'athanor://settings' ? 'settings' : tab.url === 'athanor://boards' ? 'boards' : tab.url === 'athanor://extensions' ? 'extensions' : 'browser'); setPaletteOpen(false); return }
    if (value.startsWith('server:')) { const server = servers.find((item) => item.url === value.slice(7)); if (server) openTabUrl(server.url); return }
    if (value.startsWith('ext:')) { const [ext, id] = value.slice(4).split('/'); if (ext && id) void api.runExtensionCommand(ext, id); setPaletteOpen(false); return }
    if (value.startsWith('suggest:')) { const url = value.slice(8); openTabUrl(url); return }
  }
  const closePageMenu = useCallback(() => { setPageMenu(null); if (useOverlayStore.getState().open.size === 0) void thaw() }, [thaw])
  const shownTab = activeTab
  const currentPage: Screen = screen === 'browser' && shownTab?.url === 'athanor://settings' ? 'settings' : screen === 'browser' && shownTab?.url === 'athanor://boards' ? 'boards' : screen === 'browser' && shownTab?.url === 'athanor://extensions' ? 'extensions' : screen
  const internalPage = shownTab?.url.startsWith('athanor://') ?? false
  const standaloneBoardWindow = screen === 'board-window'
  const splitActive = Boolean(snapshot?.workspace.split)

  if (!snapshot || !ready) return <div className="grid h-dvh w-full place-items-center bg-background text-foreground"><span className="grid size-10 place-items-center rounded-xl bg-primary text-primary-foreground"><AthanorMark className="size-5" /></span></div>
  const sidebarRight = snapshot.settings.sidebarSide === 'right'
  const controls = !mobile ? <WindowControls /> : undefined
  const controlsInSidebar = sidebarRight && !snapshot.settings.sidebarCompact
  const framed = !mobile && !standaloneBoardWindow
  const urlSeed = (() => { const url = activeTab?.url ?? ''; return url.startsWith('athanor://') || !hostOf(url) ? '' : url })()
  const showBar = () => openBar('navigate', urlSeed)
  return <TooltipProvider><DndContext {...dnd}>
    <div className={cn('app-shell ath-chrome flex h-dvh w-full min-h-0 text-foreground', mobile && 'mobile-shell flex-col pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]', !mobile && sidebarRight && 'flex-row-reverse', standaloneBoardWindow && 'standalone-board-shell')} data-part="shell" data-side={snapshot.settings.sidebarSide} data-density={density}>
      {framed && <Sidebar snapshot={snapshot} panels={panels} openPage={openInternalPage} openPanel={(selected) => { setPanel(selected); setScreen('browser') }} openBar={showBar} windowControls={controlsInSidebar ? controls : undefined} />}
      <main className={cn('main-column relative flex min-h-0 min-w-0 flex-1 flex-col', framed && (sidebarRight ? 'ps-2 pb-2' : 'pe-2 pb-2'))}>
        {framed && <StageBar snapshot={snapshot} activeTab={activeTab} openBar={() => openBar('navigate', '')} openPage={openInternalPage} toggleDev={() => setDevOpen((value) => !value)} windowControls={controlsInSidebar ? undefined : controls} />}
        {standaloneBoardWindow && !mobile && <StandaloneTitlebar />}
        {mobile && !standaloneBoardWindow && <MobileBar snapshot={snapshot} activeTab={activeTab} openBar={showBar} openSwitcher={() => setSwitcherOpen(true)} openMenu={() => openBar('navigate', '')} openPage={openInternalPage} />}
        <section ref={contentRef} className={cn('content relative min-h-0 min-w-0 flex-1 overflow-hidden bg-background', mobile ? 'mobile-content' : standaloneBoardWindow ? '' : 'rounded-[var(--ath-stage-radius)] shadow-[var(--ath-stage-shadow)]')} data-part="content" data-split={String(splitActive)}>
          <div key={`${currentPage}|${panel?.id ?? ''}|${internalPage ? shownTab?.url : 'web'}`} className="absolute inset-0 animate-[ath-rise_220ms_var(--ease-spring)_both]">
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
          </div>
          {frames.map((frame) => <img key={frame.tab} src={frame.src} alt="" aria-hidden="true" draggable={false} className="pointer-events-none absolute z-[1] select-none object-fill" data-part="frozen-page" style={{ left: frame.rect.x, top: frame.rect.y, width: frame.rect.w, height: frame.rect.h }} />)}
          {snapshot.workspace.split && !standaloneBoardWindow && <SplitOverlay snapshot={snapshot} rects={splitRects} />}
          {devOpen && !standaloneBoardWindow && <Suspense fallback={null}><DevPanel onClose={() => setDevOpen(false)} snapshot={snapshot} /></Suspense>}
        </section>
        {mobile && !standaloneBoardWindow && <nav className="flex h-[var(--ath-mobile-bottom-height)] shrink-0 items-center justify-around bg-background/60" data-part="toolbar" aria-label="Navigation">
          <IconAction title="Back" onClick={() => activeTab && api.goBack(activeTab.id)}><ArrowLeft /></IconAction>
          <IconAction title="Forward" onClick={() => activeTab && api.goForward(activeTab.id)}><ArrowRight /></IconAction>
          <IconAction title="New tab" onClick={() => openBar('new-tab', '')}><Plus /></IconAction>
          <button type="button" className="grid h-8 min-w-8 place-items-center rounded-lg border-2 border-foreground/70 px-1.5 text-xs font-semibold tabular-nums" data-part="tab-count" aria-label="Open tabs" onClick={() => setSwitcherOpen(true)}>{snapshot.workspace.tabs.filter((t) => !t.archived).length}</button>
          <IconAction title="Menu" onClick={() => openBar('navigate', '')}><CommandIcon /></IconAction>
        </nav>}
      </main>
      <CommandBar open={bar.open} onOpenChange={setPaletteOpen} mode={bar.mode} seed={bar.seed} snapshot={snapshot} servers={servers} extensionCommands={extensionCommands} run={runPaletteCommand} />
      {mobile && !standaloneBoardWindow && <TabSwitcher open={switcherOpen} onClose={() => setSwitcherOpen(false)} snapshot={snapshot} />}
      <PageContextMenuView request={pageMenu?.request ?? null} anchor={pageMenu?.anchor ?? null} searchEngine={snapshot.settings.searchEngine} onClose={closePageMenu} />
      <DialogHost />
      <AnimatePresence>{(!snapshot.settings.onboarded || tour) && <Welcome key="welcome" snapshot={snapshot} onDone={() => { setTour(false); void api.setSettings({ onboarded: true }) }} />}</AnimatePresence>
      <DragOverlay dropAnimation={null} zIndex={80}>{draggingId ? (() => { const tab = snapshot.workspace.tabs.find((entry) => entry.id === draggingId); return tab ? <DragGhost tab={tab} /> : null })() : null}</DragOverlay>
      <Toaster className="toast-root" position={mobile ? 'top-center' : 'bottom-right'} theme={isDarkTheme() ? 'dark' : 'light'} style={{ '--normal-bg': 'var(--popover)', '--normal-text': 'var(--popover-foreground)', '--normal-border': 'var(--border)', '--border-radius': 'var(--radius)', fontFamily: 'var(--font-ui)' } as React.CSSProperties} />
    </div>
  </DndContext></TooltipProvider>
}

function IconAction({ title, children, onClick }: { title: string; children: React.ReactNode; onClick: () => void }) { return <Button variant="ghost" size="touch" className="px-0 [&_svg]:size-5" data-part="nav-button" aria-label={title} title={title} onClick={onClick}>{children}</Button> }

function StandaloneTitlebar() {
  return <div className="flex h-10 shrink-0 items-center gap-2 border-b border-border bg-sidebar ps-4 text-sm font-medium" data-part="titlebar" onPointerDown={dragWindow} onDoubleClick={toggleWindow}>
    <span className="grid size-5 place-items-center rounded bg-primary text-primary-foreground"><AthanorMark className="size-3" /></span>Reference board<span className="flex-1" /><WindowControls />
  </div>
}

function MockPage({ tab, snapshot }: { tab: Tab; snapshot: Snapshot }) {
  const runtime = snapshot.runtime[tab.id]
  const menu = (kind: 'page' | 'image' | 'selection') => (event: React.MouseEvent) => {
    event.preventDefault(); event.stopPropagation()
    const box = (event.currentTarget.closest('[data-mock-page]') as HTMLElement).getBoundingClientRect()
    const dpr = window.devicePixelRatio || 1
    mockPageContextMenu(tab.id, (event.clientX - box.x) * dpr, (event.clientY - box.y) * dpr, kind)
  }
  return <div className="grid size-full place-items-center overflow-auto bg-secondary/40 p-8" data-mock-page onContextMenu={menu('page')}>
    <article className="flex w-full max-w-lg flex-col gap-3 rounded-2xl border border-border bg-card p-6" data-part="new-tab-page">
      <span className="text-xs font-medium text-muted-foreground">Mock browser preview</span>
      <h2 className="m-0 text-xl font-semibold">{tab.title}</h2>
      <span className="break-all text-sm text-muted-foreground">{tab.url}</span>
      <p className="m-0 text-sm text-muted-foreground" onContextMenu={menu('selection')}>The native page webview appears here when Athanor runs inside Tauri. Right-click this text, the image, or the empty area to try the page menu.</p>
      <img alt="" className="h-24 w-full rounded-lg bg-muted object-cover" src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='400' height='100'%3E%3Crect width='400' height='100' fill='%23d4d4d8'/%3E%3C/svg%3E" onContextMenu={menu('image')} />
      <div className="flex items-center gap-2 border-t border-border pt-3 text-sm text-muted-foreground"><ShieldCheck className="size-4" />{runtime?.blocked ?? 0} requests blocked{runtime?.secure ? ' · secure connection' : ''}</div>
    </article>
  </div>
}

function SplitOverlay({ snapshot, rects }: { snapshot: Snapshot; rects: SplitRects | null }) {
  const split = snapshot.workspace.split
  if (!split || !rects) return null
  const focusedPane = rects.panes.find((pane) => pane.tab === split.focused)
  const nodeAt = (root: SplitNode, path: boolean[]) => path.reduce<SplitNode | null>((node, branch) => node?.kind === 'split' ? branch ? node.b : node.a : null, root)
  const leaves = (node: SplitNode | null): string[] => !node ? [] : node.kind === 'leaf' ? [node.tab] : [...leaves(node.a), ...leaves(node.b)]
  return <>
    {focusedPane && <div className="pointer-events-none absolute z-[2] rounded-lg border-2 border-foreground/25" aria-hidden="true" data-part="split-focus" style={{ left: focusedPane.rect.x, top: focusedPane.rect.y, width: focusedPane.rect.w, height: focusedPane.rect.h }} />}
    {rects.dividers.map((divider, index) => <button key={`${divider.path.join('.')}-${index}`} type="button"
      className={cn('absolute z-[3] border-0 bg-border p-0 transition-colors hover:bg-foreground/40 active:bg-foreground', divider.dir === 'row' ? 'cursor-col-resize' : 'cursor-row-resize')}
      data-part="split-divider" data-dir={divider.dir} aria-label="Resize split panes" style={{ left: divider.rect.x, top: divider.rect.y, width: divider.rect.w, height: divider.rect.h }} onPointerDown={(event) => {
        const parent = event.currentTarget.parentElement; if (!parent) return
        event.currentTarget.setPointerCapture(event.pointerId)
        const regionNode = nodeAt(split.root, divider.path), childIds = new Set(leaves(regionNode)), boxes = rects.panes.filter((pane) => childIds.has(pane.tab)).map((pane) => pane.rect)
        if (!boxes.length) return
        const region = { x: Math.min(...boxes.map((box) => box.x)), y: Math.min(...boxes.map((box) => box.y)), w: Math.max(...boxes.map((box) => box.x + box.w)) - Math.min(...boxes.map((box) => box.x)), h: Math.max(...boxes.map((box) => box.y + box.h)) - Math.min(...boxes.map((box) => box.y)) }
        const move = (e: PointerEvent) => { const area = parent.getBoundingClientRect(); const value = dividerRatioAt(divider.dir, { x: e.clientX - area.left, y: e.clientY - area.top }, region); void api.setSplitRatio(divider.path, value) }
        const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up) }
        window.addEventListener('pointermove', move); window.addEventListener('pointerup', up)
      }} />)}
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
  return <iframe ref={frame} className="relative z-[2] size-full min-h-16 flex-1 border-0 bg-background" data-part="extension-panel" title={panel.title} src={isMock ? undefined : panel.url} srcDoc={isMock ? mockSrc : undefined} sandbox="allow-scripts" />
}
