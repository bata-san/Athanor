import type * as React from 'react'
import { ArrowLeft, ArrowRight, Columns2, Command, LayoutPanelTop, MoreHorizontal, PanelLeft, PanelsTopLeft, Puzzle, RotateCw, Settings, SquareTerminal, X } from 'lucide-react'
import type { Snapshot, Tab } from '@/lib/types'
import { api } from '@/lib/api'
import { cn } from '@/lib/utils'
import { Button } from './ui/button'
import { DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuShortcut, DropdownMenuTrigger } from './ui/dropdown-menu'
import { Tip } from './ui/tooltip'
import { OverlayDropdownMenu } from './overlay-menus'
import { UrlPill } from './UrlPill'
import { dragWindow, toggleWindow } from './WindowControls'

type Page = 'settings' | 'boards' | 'extensions'

export function NavButton({ label, shortcut, disabled, active, side = 'bottom', className, onClick, children }: { label: string; shortcut?: string; disabled?: boolean; active?: boolean; side?: 'top' | 'right' | 'bottom' | 'left'; className?: string; onClick: () => void; children: React.ReactNode }) {
  return <Tip label={label} shortcut={shortcut} side={side}><span className="inline-flex"><Button variant="ghost" size="icon" className={cn('size-8 rounded-lg [&_svg]:size-[17px]', active && 'bg-foreground/[0.07] text-foreground', className)} data-part="nav-button" data-active={active === undefined ? undefined : String(active)} aria-label={label} disabled={disabled} onClick={onClick}>{children}</Button></span></Tip>
}

/** Back / forward / reload for the active tab. */
export function NavCluster({ snapshot, activeTab, className }: { snapshot: Snapshot; activeTab: Tab | null; className?: string }) {
  const runtime = activeTab ? snapshot.runtime[activeTab.id] : undefined
  const loading = runtime?.loading ?? false
  return <div className={cn('flex items-center', className)} data-no-drag>
    <NavButton label="Back" shortcut="Alt+Left" disabled={!activeTab || !runtime?.canGoBack} onClick={() => activeTab && void api.goBack(activeTab.id)}><ArrowLeft /></NavButton>
    <NavButton label="Forward" shortcut="Alt+Right" disabled={!activeTab || !runtime?.canGoForward} onClick={() => activeTab && void api.goForward(activeTab.id)}><ArrowRight /></NavButton>
    <NavButton label={loading ? 'Stop loading' : 'Reload'} shortcut="Ctrl+R" disabled={!activeTab} onClick={() => activeTab && void (loading ? api.stop(activeTab.id) : api.reload(activeTab.id))}>{loading ? <X /> : <RotateCw />}</NavButton>
  </div>
}

/**
 * The slim strip above the page: the page's title on the left (also the drag handle), tools and the window
 * buttons on the right. Everything you type goes through the address pill / command bar instead.
 */
export function StageBar({ snapshot, activeTab, openBar, openPage, toggleDev, windowControls }: { snapshot: Snapshot; activeTab: Tab | null; openBar: () => void; openPage: (page: Page) => void; toggleDev: () => void; windowControls?: React.ReactNode }) {
  const split = () => { const next = snapshot.workspace.tabs.find((tab) => tab.id !== activeTab?.id && tab.space === snapshot.workspace.activeSpace && !tab.archived); if (snapshot.workspace.split) void api.unsplit(); else if (next) void api.splitWith({ tab: next.id, dir: 'row' }) }
  return <div className="flex h-10 shrink-0 items-center justify-between gap-2 ps-3" data-part="toolbar" onPointerDown={dragWindow} onDoubleClick={toggleWindow}>
    <span className="min-w-0 truncate text-xs font-medium text-muted-foreground" data-part="page-title">{activeTab?.title ?? ''}</span>
    <div className="flex items-center" data-no-drag>
      <NavButton label={snapshot.workspace.split ? 'Close split view' : 'Split view'} shortcut={'Ctrl+\\'} active={Boolean(snapshot.workspace.split)} onClick={split}><Columns2 /></NavButton>
      <NavButton label="Developer panel" shortcut="Ctrl+Shift+D" onClick={toggleDev}><SquareTerminal /></NavButton>
      <NavButton label="Command bar" shortcut="Ctrl+K" onClick={openBar}><Command /></NavButton>
      <OverlayDropdownMenu>
        <Tip label="More"><DropdownMenuTrigger asChild><Button variant="ghost" size="icon" className="size-8 rounded-lg data-[state=open]:bg-foreground/[0.07] data-[state=open]:text-foreground [&_svg]:size-[17px]" aria-label="More" data-part="nav-button"><MoreHorizontal /></Button></DropdownMenuTrigger></Tip>
        <DropdownMenuContent align="end" className="w-60">
          <DropdownMenuItem onSelect={() => openPage('boards')}><LayoutPanelTop />Reference boards</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => openPage('extensions')}><Puzzle />Extensions</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => void api.setSettings({ sidebarCompact: !snapshot.settings.sidebarCompact })}><PanelLeft />Toggle sidebar<DropdownMenuShortcut>Ctrl+B</DropdownMenuShortcut></DropdownMenuItem>
          <DropdownMenuItem disabled={!activeTab} onSelect={() => activeTab && void api.openDevtools(activeTab.id)}><PanelsTopLeft />Page inspector<DropdownMenuShortcut>F12</DropdownMenuShortcut></DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => openPage('settings')}><Settings />Settings</DropdownMenuItem>
        </DropdownMenuContent>
      </OverlayDropdownMenu>
    </div>
    {windowControls ?? <div className="w-1" />}
  </div>
}

export function MobileBar({ snapshot, activeTab, openBar, openSwitcher, openMenu, openPage }: { snapshot: Snapshot; activeTab: Tab | null; openBar: () => void; openSwitcher: () => void; openMenu: () => void; openPage: (page: Page) => void }) {
  return <div className="flex h-[var(--ath-mobile-top-height)] shrink-0 items-center gap-1.5 px-3" data-part="toolbar">
    <UrlPill snapshot={snapshot} activeTab={activeTab} onOpen={openBar} onSettings={() => openPage('settings')} className="flex-1" />
    <Button variant="ghost" size="touch" className="px-0" aria-label="Open tabs" data-part="nav-button" onClick={openSwitcher}><PanelsTopLeft /></Button>
    <Button variant="ghost" size="touch" className="px-0" aria-label="Menu" data-part="nav-button" onClick={openMenu}><Command /></Button>
  </div>
}
