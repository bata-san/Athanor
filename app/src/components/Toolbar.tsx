import { useEffect, useMemo, useState } from 'react'
import type * as React from 'react'
import type { RefObject } from 'react'
import { ArrowLeft, ArrowRight, Columns2, Command, Globe, LayoutPanelTop, Lock, MoreHorizontal, PanelLeft, PanelsTopLeft, Puzzle, RotateCw, Search, Settings, ShieldAlert, ShieldCheck, SquareTerminal, X } from 'lucide-react'
import type { Snapshot, Suggestion, Tab } from '@/lib/types'
import { api } from '@/lib/api'
import { useOverlay } from '@/lib/overlay'
import { cn } from '@/lib/utils'
import { Button } from './ui/button'
import { DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuShortcut, DropdownMenuTrigger } from './ui/dropdown-menu'
import { Input } from './ui/input'
import { Popover, PopoverAnchor, PopoverContent } from './ui/popover'
import { Switch } from './ui/switch'
import { Tip } from './ui/tooltip'
import { OverlayDropdownMenu } from './overlay-menus'
import { dragWindow, toggleWindow } from './WindowControls'

type Page = 'settings' | 'boards' | 'extensions'
type Props = { snapshot: Snapshot; activeTab: Tab | null; omniboxRef: RefObject<HTMLInputElement | null>; openPalette: () => void; openPage: (page: Page) => void; toggleDev: () => void; windowControls?: React.ReactNode }

export function Toolbar({ snapshot, activeTab, omniboxRef, openPalette, openPage, toggleDev, windowControls }: Props) {
  const runtime = activeTab ? snapshot.runtime[activeTab.id] : undefined
  const loading = runtime?.loading ?? false
  const split = () => { const next = snapshot.workspace.tabs.find((tab) => tab.id !== activeTab?.id && tab.space === snapshot.workspace.activeSpace && !tab.archived); if (snapshot.workspace.split) void api.unsplit(); else if (next) void api.splitWith({ tab: next.id, dir: 'row' }) }
  return <div className="flex h-12 shrink-0 items-center gap-1 bg-sidebar ps-3 pe-0" data-part="toolbar" onPointerDown={dragWindow} onDoubleClick={toggleWindow}>
    <div className="flex items-center gap-0.5" data-no-drag>
      <NavButton label="Back" shortcut="Alt+Left" disabled={!activeTab || !runtime?.canGoBack} onClick={() => activeTab && void api.goBack(activeTab.id)}><ArrowLeft /></NavButton>
      <NavButton label="Forward" shortcut="Alt+Right" disabled={!activeTab || !runtime?.canGoForward} onClick={() => activeTab && void api.goForward(activeTab.id)}><ArrowRight /></NavButton>
      <NavButton label={loading ? 'Stop loading' : 'Reload'} shortcut="Ctrl+R" disabled={!activeTab} onClick={() => activeTab && void (loading ? api.stop(activeTab.id) : api.reload(activeTab.id))}>{loading ? <X /> : <RotateCw />}</NavButton>
    </div>
    <div className="mx-auto flex min-w-0 flex-1 justify-center px-2" data-no-drag><Omnibox snapshot={snapshot} activeTab={activeTab} inputRef={omniboxRef} openPage={openPage} /></div>
    <div className="flex items-center gap-0.5" data-no-drag>
      <NavButton label={snapshot.workspace.split ? 'Close split view' : 'Split view'} shortcut="Ctrl+\" active={Boolean(snapshot.workspace.split)} onClick={split}><Columns2 /></NavButton>
      <NavButton label="Developer panel" shortcut="Ctrl+Shift+D" onClick={toggleDev}><SquareTerminal /></NavButton>
      <NavButton label="Command palette" shortcut="Ctrl+K" onClick={openPalette}><Command /></NavButton>
      <OverlayDropdownMenu>
        <Tip label="More"><DropdownMenuTrigger asChild><Button variant="ghost" size="icon" className="size-9 data-[state=open]:bg-accent data-[state=open]:text-foreground" aria-label="More" data-part="nav-button"><MoreHorizontal /></Button></DropdownMenuTrigger></Tip>
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
    {windowControls ?? <div className="w-1.5" />}
  </div>
}

export function MobileBar({ snapshot, activeTab, omniboxRef, openSwitcher, openPalette, openPage }: { snapshot: Snapshot; activeTab: Tab | null; omniboxRef: RefObject<HTMLInputElement | null>; openSwitcher: () => void; openPalette: () => void; openPage: (page: Page) => void }) {
  return <div className="flex h-[var(--ath-mobile-top-height)] shrink-0 items-center gap-1.5 border-b border-border bg-background px-3" data-part="toolbar">
    <Omnibox snapshot={snapshot} activeTab={activeTab} inputRef={omniboxRef} mobile openPage={openPage} />
    <Button variant="ghost" size="touch" className="px-0" aria-label="Open tabs" data-part="nav-button" onClick={openSwitcher}><PanelsTopLeft /></Button>
    <Button variant="ghost" size="touch" className="px-0" aria-label="Menu" data-part="nav-button" onClick={openPalette}><Command /></Button>
  </div>
}

function NavButton({ label, shortcut, disabled, active, onClick, children }: { label: string; shortcut?: string; disabled?: boolean; active?: boolean; onClick: () => void; children: React.ReactNode }) {
  return <Tip label={label} shortcut={shortcut}><span className="inline-flex"><Button variant="ghost" size="icon" className={cn('size-9 [&_svg]:size-[18px]', active && 'bg-accent text-foreground')} data-part="nav-button" data-active={active === undefined ? undefined : String(active)} aria-label={label} disabled={disabled} onClick={onClick}>{children}</Button></span></Tip>
}

function Omnibox({ snapshot, activeTab, inputRef, mobile = false, openPage }: { snapshot: Snapshot; activeTab: Tab | null; inputRef: RefObject<HTMLInputElement | null>; mobile?: boolean; openPage: (page: Page) => void }) {
  const [value, setValue] = useState('')
  const [focused, setFocused] = useState(false)
  const [suggestions, setSuggestions] = useState<Suggestion[]>([])
  const [shieldOpen, setShieldOpen] = useState(false)
  const [shieldEnabled, setShieldEnabled] = useState(true)
  const activeHost = useMemo(() => { try { const url = new URL(activeTab?.url ?? ''); return url.protocol === 'athanor:' ? '' : url.host } catch { return '' } }, [activeTab?.url])
  const runtime = activeTab ? snapshot.runtime[activeTab.id] : undefined
  const showList = focused && suggestions.length > 0
  useOverlay(showList, 'omnibox')
  useOverlay(shieldOpen, 'shield')
  useEffect(() => { setValue('') }, [activeTab?.id])
  useEffect(() => {
    if (!focused || !value.trim()) { setSuggestions([]); return }
    const timer = window.setTimeout(() => { void api.omniboxSuggest(value).then(setSuggestions) }, 60)
    return () => window.clearTimeout(timer)
  }, [focused, value])
  useEffect(() => { if (shieldOpen && activeHost) void api.getSiteShield(activeHost).then(setShieldEnabled) }, [shieldOpen, activeHost])
  const navigate = (input = value) => {
    if (!input.trim()) return
    if (activeTab) void api.navigate(activeTab.id, input); else void api.openTab({ url: input })
    setFocused(false); setSuggestions([]); setValue('')
  }
  const selectSuggestion = (item: Suggestion) => { if (item.tab) void api.activateTab(item.tab); else if (item.url) navigate(item.url); setFocused(false); setSuggestions([]); setValue('') }
  const blocked = runtime?.blocked ?? 0
  const internal = activeTab?.url.startsWith('athanor://') ?? false
  return <div className={cn('relative w-full', mobile ? 'min-w-0 flex-1' : 'max-w-[var(--ath-toolbar-omnibox)]')} data-part="omnibox">
    <Popover open={shieldOpen} onOpenChange={setShieldOpen}>
      <PopoverAnchor asChild>
        <div className="group/omni flex h-9 items-center gap-1 rounded-lg border border-border/80 bg-background ps-1 pe-1 shadow-xs transition-[border-color,box-shadow] hover:border-border focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/20 max-md:h-11">
          <Tip label={runtime?.secure ? 'Secure connection' : 'Connection'}><button type="button" className="grid size-7 shrink-0 place-items-center rounded-md text-muted-foreground outline-none transition-colors hover:bg-foreground/8 hover:text-foreground [&_svg]:size-4" aria-label="Connection security" onClick={() => activeHost && setShieldOpen((open) => !open)}>{internal ? <Search /> : runtime?.secure ? <Lock /> : <Globe />}</button></Tip>
          <Input ref={inputRef} className="h-full min-w-0 flex-1 rounded-none border-0 bg-transparent px-1 text-[13px] shadow-none placeholder:text-muted-foreground focus-visible:ring-0 max-md:text-sm" data-part="omnibox-input" aria-label="Address and search" value={value} placeholder={activeHost || 'Search or enter address'}
            onFocus={() => setFocused(true)} onBlur={() => window.setTimeout(() => setFocused(false), 140)} onChange={(event) => setValue(event.target.value)}
            onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); navigate() } if (event.key === 'Escape') { setValue(''); setFocused(false); inputRef.current?.blur() } }} />
          {activeHost && <Tip label={`${blocked} blocked`}><button type="button" className={cn('flex h-7 shrink-0 items-center gap-1 rounded-md px-1.5 text-muted-foreground outline-none transition-colors hover:bg-foreground/8 hover:text-foreground [&_svg]:size-4', !shieldEnabled && 'text-muted-foreground/60')} data-part="shield-badge" aria-label={`${blocked} requests blocked`} onClick={() => setShieldOpen((open) => !open)}>{shieldEnabled ? <ShieldCheck /> : <ShieldAlert />}{blocked > 0 && <span className="text-xs font-medium tabular-nums">{blocked}</span>}</button></Tip>}
        </div>
      </PopoverAnchor>
      {activeHost && <PopoverContent align="end" className="w-80" role="dialog" aria-label={`Protection for ${activeHost}`} onOpenAutoFocus={(event) => event.preventDefault()}>
        <div className="flex items-center gap-3">
          <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-secondary [&_svg]:size-[18px]">{shieldEnabled ? <ShieldCheck /> : <ShieldAlert />}</span>
          <div className="min-w-0 flex-1"><h3 className="m-0 truncate text-sm font-semibold">{activeHost}</h3><span className="text-xs text-muted-foreground">{runtime?.secure ? 'Secure connection' : 'Not secure'}</span></div>
          <Switch checked={shieldEnabled} aria-label="Block ads and trackers" onCheckedChange={(enabled) => { setShieldEnabled(enabled); void api.setSiteShield(activeHost, enabled) }} />
        </div>
        <div className="mt-4 grid grid-cols-2 gap-2">
          <div className="rounded-lg border border-border p-3"><strong className="block text-xl font-semibold tabular-nums">{blocked}</strong><span className="text-xs text-muted-foreground">This page</span></div>
          <div className="rounded-lg border border-border p-3"><strong className="block text-xl font-semibold tabular-nums">{snapshot.blockedTotal}</strong><span className="text-xs text-muted-foreground">All time</span></div>
        </div>
        <Button variant="ghost" size="sm" className="mt-3 w-full justify-start text-foreground" onClick={() => { setShieldOpen(false); openPage('settings') }}><Settings />Protection settings</Button>
      </PopoverContent>}
    </Popover>
    {showList && <div className="absolute inset-x-0 top-[calc(100%+0.375rem)] z-50 flex flex-col origin-top animate-in rounded-xl border border-border bg-popover p-1.5 shadow-menu" role="listbox">
      {suggestions.map((item, index) => <button key={`${item.kind}-${index}`} type="button" role="option" aria-selected="false" className="flex min-h-10 items-center gap-3 rounded-lg px-2.5 py-1.5 text-start outline-none hover:bg-accent focus-visible:bg-accent [&_svg]:size-4 [&_svg]:shrink-0 [&_svg]:text-muted-foreground" onMouseDown={(event) => event.preventDefault()} onClick={() => selectSuggestion(item)}>
        {item.kind === 'tab' ? <PanelsTopLeft /> : item.kind === 'search' ? <Search /> : <Globe />}
        <span className="flex min-w-0 flex-col"><strong className="truncate text-[13px] font-medium">{item.title}</strong><small className="truncate text-xs text-muted-foreground">{item.subtitle}</small></span>
      </button>)}
    </div>}
  </div>
}
