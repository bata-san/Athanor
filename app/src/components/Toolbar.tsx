import type * as React from 'react'
import { LayoutGrid, ArrowLeft, ArrowRight, Columns2, Command, LayoutPanelTop, MoreHorizontal, PanelLeft, PanelsTopLeft, Puzzle, RotateCw, Settings, SquareTerminal, X } from 'lucide-react'
import type { Snapshot, Tab } from '@/lib/types'
import { toast } from 'sonner'
import { api } from '@/lib/api'
import { cn } from '@/lib/utils'
import { Button } from './ui/button'
import { DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuShortcut, DropdownMenuTrigger } from './ui/dropdown-menu'
import { Tip } from './ui/tooltip'
import { OverlayDropdownMenu } from './overlay-menus'
import { UrlPill } from './UrlPill'
import { dragWindow, toggleWindow } from './WindowControls'

type Page = 'settings' | 'boards' | 'extensions'

/** An icon button with a tooltip; a disabled one explains itself instead of staying mute. */
export function NavButton({ label, shortcut, hint, disabled, active, side = 'bottom', className, onClick, children }: { label: string; shortcut?: string; hint?: string; disabled?: boolean; active?: boolean; side?: 'top' | 'right' | 'bottom' | 'left'; className?: string; onClick: () => void; children: React.ReactNode }) {
  return <Tip label={disabled && hint ? `${label} — ${hint}` : label} shortcut={shortcut} side={side}><span className="inline-flex"><Button variant="ghost" size="icon" className={cn('size-7 rounded-md [&_svg]:size-[1rem]', active && 'bg-foreground/[0.07] text-foreground', className)} data-part="nav-button" data-active={active === undefined ? undefined : String(active)} aria-label={label} aria-keyshortcuts={shortcut} disabled={disabled} onClick={onClick}>{children}</Button></span></Tip>
}

/** Back / forward / reload for the active tab. */
export function NavCluster({ snapshot, activeTab, className }: { snapshot: Snapshot; activeTab: Tab | null; className?: string }) {
  const runtime = activeTab ? snapshot.runtime[activeTab.id] : undefined
  const loading = runtime?.loading ?? false
  return <div className={cn('flex items-center', className)} data-no-drag>
    <NavButton label="Back" shortcut="Alt+Left" disabled={!activeTab || !runtime?.canGoBack} hint={!activeTab ? 'no page is open' : 'nothing to go back to'} onClick={() => activeTab && void api.goBack(activeTab.id)}><ArrowLeft aria-hidden="true" /></NavButton>
    <NavButton label="Forward" shortcut="Alt+Right" disabled={!activeTab || !runtime?.canGoForward} hint={!activeTab ? 'no page is open' : 'nothing to go forward to'} onClick={() => activeTab && void api.goForward(activeTab.id)}><ArrowRight aria-hidden="true" /></NavButton>
    <NavButton label={loading ? 'Stop loading' : 'Reload'} shortcut="Ctrl+R" disabled={!activeTab} hint="no page is open" onClick={() => activeTab && void (loading ? api.stop(activeTab.id) : api.reload(activeTab.id))}>{loading ? <X aria-hidden="true" /> : <RotateCw aria-hidden="true" />}</NavButton>
  </div>
}

/**
 * The slim strip above the page: the page's title on the left (also the drag handle), tools and the window
 * buttons on the right. Everything you type goes through the address pill / command bar instead.
 */
export function StageBar({ snapshot, activeTab, openBar, openPage, toggleDev, openOverview, windowControls }: { snapshot: Snapshot; activeTab: Tab | null; openBar: () => void; openOverview: () => void; openPage: (page: Page) => void; toggleDev: () => void; windowControls?: React.ReactNode }) {
  const split = () => { const next = snapshot.workspace.tabs.find((tab) => tab.id !== activeTab?.id && tab.space === snapshot.workspace.activeSpace && !tab.archived); if (snapshot.workspace.split) void api.unsplit(); else if (next) void api.splitWith({ tab: next.id, dir: 'row' }); else toast('Open another tab to use Split View', { duration: 2400 }) }
  return <div className="flex h-9 shrink-0 items-center gap-1 ps-1.5" data-part="toolbar" onPointerDown={dragWindow} onDoubleClick={toggleWindow}>
    <NavCluster snapshot={snapshot} activeTab={activeTab} className="shrink-0" />
    <div className="flex min-w-0 flex-1 justify-center px-1" data-no-drag>
      <UrlPill snapshot={snapshot} activeTab={activeTab} onOpen={openBar} onSettings={() => openPage('settings')} className="w-full max-w-[44rem]" />
    </div>
    <div className="flex items-center" data-no-drag>
      <NavButton label={snapshot.workspace.split ? 'Close split view' : 'Split view'} shortcut={'Ctrl+\\'} active={Boolean(snapshot.workspace.split)} onClick={split}><Columns2 aria-hidden="true" /></NavButton>
      <NavButton label="Show all tabs" shortcut="Ctrl+Space" onClick={openOverview}><LayoutGrid aria-hidden="true" /></NavButton>
      <NavButton label="Developer panel" shortcut="Ctrl+Shift+D" onClick={toggleDev}><SquareTerminal aria-hidden="true" /></NavButton>
      <NavButton label="Command bar" shortcut="Ctrl+K" onClick={openBar}><Command aria-hidden="true" /></NavButton>
      <OverlayDropdownMenu>
        <Tip label="More"><DropdownMenuTrigger asChild><Button variant="ghost" size="icon" className="size-7 rounded-md data-[state=open]:bg-foreground/[0.07] data-[state=open]:text-foreground [&_svg]:size-[1rem]" aria-label="More" data-part="nav-button"><MoreHorizontal aria-hidden="true" /></Button></DropdownMenuTrigger></Tip>
        <DropdownMenuContent align="end" className="w-60">
          <DropdownMenuItem onSelect={() => openPage('boards')}><LayoutPanelTop aria-hidden="true" />Reference Boards</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => openPage('extensions')}><Puzzle aria-hidden="true" />Extensions</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => void api.setSettings({ sidebarCompact: !snapshot.settings.sidebarCompact })}><PanelLeft aria-hidden="true" />{snapshot.settings.sidebarCompact ? 'Show Sidebar' : 'Hide Sidebar'}<DropdownMenuShortcut>Ctrl+B</DropdownMenuShortcut></DropdownMenuItem>
          <DropdownMenuItem disabled={!activeTab} onSelect={() => activeTab && void api.openDevtools(activeTab.id)}><PanelsTopLeft aria-hidden="true" />Page Inspector<DropdownMenuShortcut>F12</DropdownMenuShortcut></DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => openPage('settings')}><Settings aria-hidden="true" />Settings</DropdownMenuItem>
        </DropdownMenuContent>
      </OverlayDropdownMenu>
    </div>
    {windowControls ?? <div className="w-1" />}
  </div>
}

export function MobileBar({ snapshot, activeTab, openBar, openSwitcher, openMenu, openPage }: { snapshot: Snapshot; activeTab: Tab | null; openBar: () => void; openSwitcher: () => void; openMenu: () => void; openPage: (page: Page) => void }) {
  return <div className="flex h-[var(--ath-mobile-top-height)] shrink-0 items-center gap-1.5 px-3" data-part="toolbar">
    <UrlPill snapshot={snapshot} activeTab={activeTab} onOpen={openBar} onSettings={() => openPage('settings')} className="flex-1" />
    <Button variant="ghost" size="touch" className="px-0" aria-label="Open tabs" data-part="nav-button" onClick={openSwitcher}><PanelsTopLeft aria-hidden="true" /></Button>
    <Button variant="ghost" size="touch" className="px-0" aria-label="Menu" data-part="nav-button" onClick={openMenu}><Command aria-hidden="true" /></Button>
  </div>
}
