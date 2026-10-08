import { useEffect, useRef, useState } from 'react'
import type * as React from 'react'
import { Bell, Download, KeyRound, LayoutGrid, ArrowLeft, ArrowRight, Columns2, Command, FolderInput, LayoutPanelTop, MoreHorizontal, PanelLeft, PanelsTopLeft, Pause, Play, Puzzle, RotateCw, Settings, SquareTerminal, Volume2, VolumeX, X } from 'lucide-react'
import type { Download as DownloadItem, MediaState, NavHistory, Snapshot, Tab } from '@/lib/types'
import { listen } from '@/lib/events'
import { toast } from 'sonner'
import { api } from '@/lib/api'
import { fileTabs } from '@/lib/filing'
import { cn } from '@/lib/utils'
import { activeTransfers, downloadStatus, formatBytes, isDownloading, useDownloads } from '@/lib/downloads'
import { Button } from './ui/button'
import { DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuShortcut, DropdownMenuTrigger } from './ui/dropdown-menu'
import { Tip } from './ui/tooltip'
import { OverlayDropdownMenu } from './overlay-menus'
import { UrlPill } from './UrlPill'
import { useNotices } from './Notifications'
import { dragWindow, toggleWindow } from './WindowControls'

type Page = 'settings' | 'boards' | 'extensions'

/** An icon button with a tooltip; a disabled one explains itself instead of staying mute. */
export function NavButton({ label, shortcut, hint, disabled, active, side = 'bottom', className, onClick, children }: { label: string; shortcut?: string; hint?: string; disabled?: boolean; active?: boolean; side?: 'top' | 'right' | 'bottom' | 'left'; className?: string; onClick: () => void; children: React.ReactNode }) {
  return <Tip label={disabled && hint ? `${label} — ${hint}` : label} shortcut={shortcut} side={side}><span className="inline-flex"><Button variant="ghost" size="icon" className={cn('size-7 rounded-md [&_svg]:size-[1rem]', active && 'bg-foreground/[0.07] text-foreground', className)} data-part="nav-button" data-active={active === undefined ? undefined : String(active)} aria-label={label} aria-keyshortcuts={shortcut} disabled={disabled} onClick={onClick}>{children}</Button></span></Tip>
}

/**
 * Back or Forward that also answers a press-and-hold (or a right-click) with the list of pages behind / ahead,
 * like the arrows of every desktop browser. A plain click still just goes one step.
 */
function HistoryButton({ direction, tab, disabled }: { direction: 'back' | 'forward'; tab: Tab | null; disabled: boolean }) {
  const [open, setOpen] = useState(false)
  const [entries, setEntries] = useState<NavHistory['entries']>([])
  const timer = useRef<number | null>(null)
  const held = useRef(false)
  const back = direction === 'back'
  useEffect(() => {
    const off = listen('athanor://nav-history', (history) => {
      if (history.tab !== tab?.id) return
      // Pages in the direction asked for, nearest first; error pages and blanks are not places.
      const shown = (back ? history.entries.slice(0, history.current).reverse() : history.entries.slice(history.current + 1))
        .filter((entry) => entry.url && entry.url !== 'about:blank' && !entry.url.startsWith('data:'))
        .slice(0, 14)
      setEntries(shown)
      if (shown.length) setOpen(true)
    })
    return () => { void off.then((fn) => fn()) }
  }, [tab?.id, back])
  const cancel = () => { if (timer.current !== null) { window.clearTimeout(timer.current); timer.current = null } }
  const ask = () => { if (tab && !disabled) void api.navHistory(tab.id) }
  const label = back ? 'Back' : 'Forward'
  return <OverlayDropdownMenu open={open} onOpenChange={(next) => { if (!next) setOpen(false) }}>
    <Tip label={label} shortcut={back ? 'Alt+Left' : 'Alt+Right'} side="bottom">
      <span className="inline-flex" onContextMenu={(event) => { event.preventDefault(); ask() }}>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" className="size-7 rounded-md [&_svg]:size-[1.0rem]" data-part="nav-button" aria-label={label} aria-haspopup="menu" disabled={disabled}
            onPointerDown={(event) => { if (event.button !== 0) return; held.current = false; cancel(); timer.current = window.setTimeout(() => { held.current = true; ask() }, 450) }}
            onPointerUp={cancel} onPointerLeave={cancel}
            onClick={(event) => {
              // The press that opened the list must not also navigate; Radix would toggle the menu on click, so keep it ours.
              event.preventDefault()
              if (held.current) { held.current = false; return }
              if (tab) void (back ? api.goBack(tab.id) : api.goForward(tab.id))
            }}
            onKeyDown={(event) => { if (event.key === 'ArrowDown') { event.preventDefault(); ask() } }}
          >{back ? <ArrowLeft /> : <ArrowRight />}</Button>
        </DropdownMenuTrigger>
      </span>
    </Tip>
    <DropdownMenuContent align="start" className="w-72" aria-label={back ? 'Pages behind' : 'Pages ahead'}>
      {entries.map((entry) => <DropdownMenuItem key={entry.id} onSelect={() => { if (tab) void api.navHistoryGo(tab.id, entry.id) }}>
        <span className="min-w-0 flex-1"><span className="block truncate">{entry.title || hostOfUrl(entry.url)}</span><span className="block truncate font-mono text-[0.7333rem] text-muted-foreground">{hostOfUrl(entry.url)}</span></span>
      </DropdownMenuItem>)}
    </DropdownMenuContent>
  </OverlayDropdownMenu>
}

const hostOfUrl = (url: string) => { try { return new URL(url).host || url } catch { return url } }

/** Back / forward / reload for the active tab. */
export function NavCluster({ snapshot, activeTab, className }: { snapshot: Snapshot; activeTab: Tab | null; className?: string }) {
  const runtime = activeTab ? snapshot.runtime[activeTab.id] : undefined
  const loading = runtime?.loading ?? false
  return <div className={cn('flex items-center', className)} data-no-drag>
    <HistoryButton direction="back" tab={activeTab} disabled={!activeTab || !runtime?.canGoBack} />
    <HistoryButton direction="forward" tab={activeTab} disabled={!activeTab || !runtime?.canGoForward} />
    <NavButton label={loading ? 'Stop loading' : 'Reload'} shortcut="Ctrl+R" disabled={!activeTab} onClick={() => activeTab && void (loading ? api.stop(activeTab.id) : api.reload(activeTab.id))}>{loading ? <X /> : <RotateCw />}</NavButton>
  </div>
}

/**
 * The slim strip above the page: the page's title on the left (also the drag handle), tools and the window
 * buttons on the right. Everything you type goes through the address pill / command bar instead.
 */
export function StageBar({ snapshot, activeTab, openBar, openPage, toggleDev, openOverview, openDownloads, openNotifications, openPasswords, windowControls }: { snapshot: Snapshot; activeTab: Tab | null; openBar: () => void; openOverview: () => void; openDownloads: () => void; openNotifications: () => void; openPasswords: () => void; openPage: (page: Page) => void; toggleDev: () => void; windowControls?: React.ReactNode }) {
  const notificationError = useNotices((state) => state.displayError)
  const media = usePageMedia(snapshot, activeTab)
  // Page sound controls only join the More menu when the page has something to play or is already muted.
  const pageSound = Boolean(activeTab && (media.media?.available || activeTab.muted || snapshot.runtime[activeTab.id]?.audible))
  const split = () => { const next = snapshot.workspace.tabs.find((tab) => tab.id !== activeTab?.id && tab.space === snapshot.workspace.activeSpace && !tab.archived); if (snapshot.workspace.split) void api.unsplit(); else if (next) void api.splitWith({ tab: next.id, dir: 'row' }); else toast('Open another tab to use Split View', { duration: 2400 }) }
  return <div className="flex h-9 shrink-0 items-center gap-1 ps-1.5" style={{ containerType: 'inline-size', containerName: 'ath-toolbar' }} data-part="toolbar" onPointerDown={dragWindow} onDoubleClick={toggleWindow}>
    <NavCluster snapshot={snapshot} activeTab={activeTab} className="shrink-0" />
    {/* The address and what the page is doing right now share one row: the pill is the place, the hub is its live status. */}
    <div className="flex min-w-0 flex-1 items-center justify-center gap-1.5 px-1">
      <UrlPill snapshot={snapshot} activeTab={activeTab} onOpen={openBar} onSettings={() => openPage('settings')} className="min-w-[9rem] max-w-[44rem] flex-1" />
      <ActivityHub snapshot={snapshot} activeTab={activeTab} media={media} onOpenDownloads={openDownloads} />
    </div>
    {notificationError && <div data-no-drag><NavButton label="Read notifications: toast display unavailable" onClick={openNotifications}><Bell aria-hidden="true" /></NavButton></div>}
    <div className="flex items-center" data-no-drag>
      <NavButton label="File tabs into folders" shortcut="Ctrl+Shift+F" className="ath-optional-tool" onClick={() => void fileTabs()}><FolderInput aria-hidden="true" /></NavButton>
      <NavButton label={snapshot.workspace.split ? 'Close split view' : 'Split view'} shortcut={'Ctrl+\\'} active={Boolean(snapshot.workspace.split)} className="ath-optional-tool" onClick={split}><Columns2 aria-hidden="true" /></NavButton>
      <NavButton label="Show all tabs" shortcut="Ctrl+Space" className="ath-optional-tool" onClick={openOverview}><LayoutGrid aria-hidden="true" /></NavButton>
      <NavButton label="Developer panel" shortcut="Ctrl+Shift+D" className="ath-optional-tool" onClick={toggleDev}><SquareTerminal aria-hidden="true" /></NavButton>
      <NavButton label="Command bar" shortcut="Ctrl+K" className="ath-optional-tool" onClick={openBar}><Command aria-hidden="true" /></NavButton>
      <OverlayDropdownMenu>
        <Tip label="More"><DropdownMenuTrigger asChild><Button variant="ghost" size="icon" className="size-7 rounded-md data-[state=open]:bg-foreground/[0.07] data-[state=open]:text-foreground [&_svg]:size-[1rem]" aria-label="More" data-part="nav-button"><MoreHorizontal aria-hidden="true" /></Button></DropdownMenuTrigger></Tip>
        <DropdownMenuContent align="end" className="w-72">
          {/* What the page is doing comes first, so the same controls stay reachable when the hub is hidden by a narrow window. */}
          {activeTab && media.media?.available && <DropdownMenuItem disabled={media.pending} onSelect={media.toggle}>{media.media.paused || media.media.ended ? <Play aria-hidden="true" /> : <Pause aria-hidden="true" />}{media.media.paused || media.media.ended ? 'Play Page Media' : 'Pause Page Media'}</DropdownMenuItem>}
          {activeTab && pageSound && <DropdownMenuItem onSelect={() => void api.setMuted(activeTab.id, !activeTab.muted).catch((error) => toast.error('Could not change page audio', { description: String(error) }))}>{activeTab.muted ? <Volume2 aria-hidden="true" /> : <VolumeX aria-hidden="true" />}{activeTab.muted ? 'Unmute Page' : 'Mute Page'}</DropdownMenuItem>}
          {activeTab && pageSound && <DropdownMenuSeparator />}
          <DropdownMenuItem onSelect={openDownloads}><Download aria-hidden="true" />Downloads<DropdownMenuShortcut>Ctrl+J</DropdownMenuShortcut></DropdownMenuItem>
          <DropdownMenuItem onSelect={openNotifications}><Bell aria-hidden="true" />Notifications</DropdownMenuItem>
          {snapshot.platform === 'windows' && <DropdownMenuItem onSelect={openPasswords}><KeyRound aria-hidden="true" />Passwords</DropdownMenuItem>}
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => void fileTabs()}><FolderInput aria-hidden="true" />File Tabs into Folders<DropdownMenuShortcut>Ctrl+Shift+F</DropdownMenuShortcut></DropdownMenuItem>
          <DropdownMenuItem onSelect={split}><Columns2 aria-hidden="true" />{snapshot.workspace.split ? 'Close Split View' : 'Split View'}<DropdownMenuShortcut>Ctrl+\</DropdownMenuShortcut></DropdownMenuItem>
          <DropdownMenuItem onSelect={openOverview}><LayoutGrid aria-hidden="true" />Show All Tabs<DropdownMenuShortcut>Ctrl+Space</DropdownMenuShortcut></DropdownMenuItem>
          <DropdownMenuItem onSelect={openBar}><Command aria-hidden="true" />Command Bar<DropdownMenuShortcut>Ctrl+K</DropdownMenuShortcut></DropdownMenuItem>
          <DropdownMenuItem onSelect={toggleDev}><SquareTerminal aria-hidden="true" />Developer Panel<DropdownMenuShortcut>Ctrl+Shift+D</DropdownMenuShortcut></DropdownMenuItem>
          <DropdownMenuSeparator />
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

/**
 * Asks the active page whether it has a playable media element, once every two seconds. The hub and the More menu
 * read the same answer, so the two places never disagree about what the page can do.
 */
function usePageMedia(snapshot: Snapshot, activeTab: Tab | null) {
  const [media, setMedia] = useState<MediaState | null>(null)
  const [pending, setPending] = useState(false)
  const currentTab = useRef(activeTab?.id)
  currentTab.current = activeTab?.id
  const runtime = activeTab ? snapshot.runtime[activeTab.id] : undefined
  useEffect(() => {
    setMedia(null)
    if (!activeTab || !/^https?:/.test(activeTab.url) || runtime?.failed) return
    let alive = true
    let timer = 0
    const tab = activeTab.id
    const poll = async () => {
      try { const value = await api.pageMedia(tab); if (alive) { setMedia(value); if (value.error) toast('Playback could not start', { description: value.error }) } } catch { if (alive) setMedia(null) }
      if (alive) timer = window.setTimeout(() => void poll(), 2000)
    }
    void poll()
    return () => { alive = false; window.clearTimeout(timer) }
  }, [activeTab?.id, activeTab?.url, runtime?.failed])
  const toggle = () => {
    if (!activeTab) return
    const tab = activeTab.id
    setPending(true)
    void api.pageMedia(tab, 'toggle-play').then((state) => { if (currentTab.current === tab) { setMedia(state); if (state.error) toast('Playback could not start', { description: state.error }); else if (!state.available) toast('Use the player on the page to control playback') } }).catch((error) => toast.error('Could not control playback', { description: String(error) })).finally(() => setPending(false))
  }
  return { media, pending, toggle }
}
type PageMedia = ReturnType<typeof usePageMedia>

/**
 * Live status of the current page and its transfers, in one capsule beside the address. It only appears while
 * there is something to show (page audio or media, a running or resumable download) and folds away when there is not.
 */
function ActivityHub({ snapshot, activeTab, media, onOpenDownloads }: { snapshot: Snapshot; activeTab: Tab | null; media: PageMedia; onOpenDownloads: () => void }) {
  const items = useDownloads((state) => state.items)
  const runtime = activeTab ? snapshot.runtime[activeTab.id] : undefined
  const pageMedia = Boolean(activeTab && (media.media?.available || runtime?.audible))
  const transfers = activeTransfers(items)
  if (!pageMedia && !transfers.length) return null
  return <div className="flex h-8 min-w-0 shrink items-center gap-0.5 rounded-full bg-foreground/[0.055] px-1" data-part="activity-hub" data-no-drag role="group" aria-label="Page and transfers">
    {activeTab && pageMedia && <MediaButtons tab={activeTab} media={media} />}
    {transfers.length > 0 && <DownloadActivity active={transfers} onOpen={onOpenDownloads} />}
  </div>
}

function MediaButtons({ tab, media }: { tab: Tab; media: PageMedia }) {
  const paused = media.media?.paused || media.media?.ended
  return <div className="flex shrink-0 items-center" data-part="media-controls">
    {media.media?.available && <NavButton label={paused ? 'Play' : 'Pause'} disabled={media.pending} onClick={media.toggle}>{paused ? <Play aria-hidden="true" /> : <Pause aria-hidden="true" />}</NavButton>}
    <NavButton label={tab.muted ? 'Unmute page' : 'Mute page'} disabled={media.pending} onClick={() => void api.setMuted(tab.id, !tab.muted).catch((error) => toast.error('Could not change page audio', { description: String(error) }))}>{tab.muted ? <VolumeX aria-hidden="true" /> : <Volume2 aria-hidden="true" />}</NavButton>
  </div>
}

/** Transfers stay visible in the existing toolbar without covering or hiding the page. */
function DownloadActivity({ active, onOpen }: { active: DownloadItem[]; onOpen: () => void }) {
  const [pending, setPending] = useState(false)
  const item = active.find(isDownloading) ?? active[0]!
  const determinate = item.total > 0
  const percent = determinate ? Math.min(100, Math.max(0, item.received / item.total * 100)) : 0
  const label = `${item.name} · ${downloadStatus(item)}${active.length > 1 ? ` · ${active.length} transfers` : ''}`
  return <div className="flex h-7 min-w-0 w-[clamp(6rem,12vw,12rem)] shrink items-center" data-part="download-activity" data-no-drag><Button variant="ghost" className="h-7 min-w-0 flex-1 shrink gap-2 px-1.5 text-start" aria-label={label} title={label} onClick={onOpen}>
    <Download className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
    <span className="flex min-w-0 flex-1 flex-col gap-1">
      <span className="flex min-w-0 items-center gap-1 text-[0.7333rem]"><span className="truncate">{item.name}</span><span className="shrink-0 text-muted-foreground">{item.state === 'paused' ? 'Paused' : item.state === 'failed' ? 'Interrupted' : determinate ? `${Math.floor(percent)}%` : formatBytes(item.received)}{active.length > 1 ? ` +${active.length - 1}` : ''}</span></span>
      <span className="relative h-0.5 overflow-hidden rounded-full bg-foreground/10" role="progressbar" aria-label={`Download ${item.name}`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={determinate ? Math.floor(percent) : undefined} aria-valuetext={downloadStatus(item)}><span className={cn('absolute inset-y-0 start-0 rounded-full bg-primary', !determinate && isDownloading(item) && '[animation:ath-indeterminate_1.1s_var(--ease-snap)_infinite] motion-reduce:animate-none')} style={{ width: determinate ? `${percent}%` : isDownloading(item) ? '35%' : '0%' }} /></span>
    </span>
  </Button><NavButton label={isDownloading(item) ? `Pause ${item.name}` : `Resume ${item.name}`} disabled={pending || !isDownloading(item) && !item.canResume} onClick={() => {
    setPending(true)
    void api.controlDownload(item.id, isDownloading(item) ? 'pause' : 'resume').catch((error) => toast.error('Could not change download', { description: String(error), action: { label: 'Downloads', onClick: onOpen } })).finally(() => setPending(false))
  }}>{isDownloading(item) ? <Pause aria-hidden="true" /> : <Play aria-hidden="true" />}</NavButton></div>
}

export function MobileBar({ snapshot, activeTab, openBar, openSwitcher, openMenu, openPage }: { snapshot: Snapshot; activeTab: Tab | null; openBar: () => void; openSwitcher: () => void; openMenu: () => void; openPage: (page: Page) => void }) {
  return <div className="flex h-[var(--ath-mobile-top-height)] shrink-0 items-center gap-1.5 px-3" data-part="toolbar">
    <UrlPill snapshot={snapshot} activeTab={activeTab} onOpen={openBar} onSettings={() => openPage('settings')} className="flex-1" />
    <Button variant="ghost" size="touch" className="px-0" aria-label="Open tabs" data-part="nav-button" onClick={openSwitcher}><PanelsTopLeft aria-hidden="true" /></Button>
    <Button variant="ghost" size="touch" className="px-0" aria-label="Menu" data-part="nav-button" onClick={openMenu}><Command aria-hidden="true" /></Button>
  </div>
}
