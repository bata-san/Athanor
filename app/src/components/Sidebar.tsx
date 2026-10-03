import { useMemo, useRef, useState } from 'react'
import type * as React from 'react'
import { useDraggable, useDroppable } from '@dnd-kit/core'
import { dropId, useDragState } from '@/lib/tabDnd'
import { AnimatePresence, m } from 'motion/react'
import {
  Archive, ArrowDownToLine, AudioLines, ChevronRight, Columns2, Copy, Folder as FolderIcon, FolderInput, FolderPlus, Globe, LayoutPanelTop, Link2, Loader2, Lock, PanelLeft, PanelLeftClose, Palette, Pencil, Pin, PinOff, Plus, Puzzle, RotateCcw, Settings, Smile, Trash2, Volume2, VolumeX, WandSparkles, X, XCircle, ZapOff
} from 'lucide-react'
import type { PanelInfo, Snapshot, Tab } from '@/lib/types'
import { groupSidebarTabs, tabNumbers } from '@/lib/sidebarModel'
import { useCtrlHeld } from '@/lib/modifiers'
import { api } from '@/lib/api'
import { fileTabs } from '@/lib/filing'
import { cn, cssToken } from '@/lib/utils'
import { enter, fold, snap } from '@/lib/motion'
import { AthanorMark } from './AthanorMark'
import { AppIcon } from './Icons'
import { Button } from './ui/button'
import { Tip } from './ui/tooltip'
import { ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuSub, ContextMenuSubContent, ContextMenuSubTrigger, ContextMenuTrigger } from './ui/context-menu'
import { OverlayContextMenu, OverlayDropdownMenu, ownContextMenu } from './overlay-menus'
import { DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from './ui/dropdown-menu'
import { TabRuler } from './Instrument'
import { askConfirm, askText } from './dialogs'
import { dragWindow, toggleWindow } from './WindowControls'

type Page = 'settings' | 'boards' | 'extensions'
type Props = { snapshot: Snapshot; panels: PanelInfo[]; openPage: (page: Page) => void; openPanel: (panel: PanelInfo) => void; windowControls?: React.ReactNode }

const SWATCHES: { name: string; value: string | null }[] = [
  { name: 'Default', value: null }, { name: 'Gray', value: '#71717a' }, { name: 'Red', value: '#ef4444' }, { name: 'Orange', value: '#f97316' }, { name: 'Amber', value: '#eab308' },
  { name: 'Green', value: '#22c55e' }, { name: 'Blue', value: '#3b82f6' }, { name: 'Violet', value: '#8b5cf6' }, { name: 'Pink', value: '#ec4899' },
]
const SPACE_ICONS = ['Briefcase', 'Sparkles', 'BookOpen', 'Home', 'Terminal', 'Zap', 'Globe2', 'Gauge', 'NotebookPen', 'Layers3', 'Shield', 'Bug']

/* `rail:` styles apply while the sidebar is collapsed to its icon rail (custom variant in tokens.css; CSS-driven so the collapse can animate). */
const rowBase = `flex h-[var(--ath-tab-height)] w-full items-center gap-2 rounded-md px-1.5 text-start text-[0.8333rem] outline-none focus-visible:ring-2 focus-visible:ring-ring/40 rail:h-9 rail:justify-center rail:gap-0 rail:px-0 [&_svg]:size-[1rem] [&_svg]:shrink-0`

/** Where you are: space / folder / page. Sits in the sidebar header; the address itself lives above the page. */
function Location({ snapshot, activeTab, className }: { snapshot: Snapshot; activeTab: Tab | null; className?: string }) {
  const space = snapshot.workspace.spaces.find((entry) => entry.id === snapshot.workspace.activeSpace)
  const folder = snapshot.workspace.folders.find((entry) => entry.id === activeTab?.folder)
  return <nav className={cn('ms-1 flex min-w-0 flex-1 items-center gap-1.5 text-[0.8rem] text-muted-foreground', className)} data-part="page-title" aria-label="Location">
    <span className="shrink-0">{space?.name}</span>
    {folder && <><span className="opacity-50">/</span><span className="shrink-0">{folder.name}</span></>}
    <span className="opacity-50">/</span>
    <span className="min-w-0 truncate font-medium text-foreground/80">{activeTab?.title ?? ''}</span>
  </nav>
}

export function Sidebar({ snapshot, panels, openPage, openPanel, windowControls }: Props) {
  const [archiveOpen, setArchiveOpen] = useState(false)
  const dragging = useDragState((state) => state.dragging !== null)
  const { setNodeRef: setListRef } = useDroppable({ id: dropId.unfile })
  const unfileHint = useDragState((state) => state.hint?.kind === 'unfile')
  const settings = snapshot.settings
  const compact = settings.sidebarCompact
  const { workspace } = snapshot
  const groups = useMemo(() => groupSidebarTabs(workspace.tabs, workspace.folders, workspace.activeSpace), [workspace.tabs, workspace.folders, workspace.activeSpace])
  const activeId = workspace.activeTab
  const activeTab = workspace.tabs.find((tab) => tab.id === activeId)
  const spaceFolders = workspace.folders.filter((folder) => folder.space === workspace.activeSpace)
  // Spaces slide in the direction you move through them (Arc's space swipe).
  const spaceIndex = workspace.spaces.findIndex((space) => space.id === workspace.activeSpace)
  const lastIndex = useRef(spaceIndex)
  const direction = spaceIndex === lastIndex.current ? 0 : spaceIndex > lastIndex.current ? 1 : -1
  const slide = useRef(1)
  if (direction !== 0) slide.current = direction
  lastIndex.current = spaceIndex

  const createFolder = async () => { const name = await askText({ title: 'New folder', label: 'Name', placeholder: 'Reading list', confirm: 'Create' }); if (name) void api.createFolder(workspace.activeSpace, name) }
  const createSpace = async () => { const name = await askText({ title: 'New space', label: 'Name', placeholder: 'Research', confirm: 'Create' }); if (name) void api.addSpace(name, 'Sparkles', cssToken('--ath-space-default-color')) }
  const resizeStart = (event: React.PointerEvent) => {
    event.currentTarget.setPointerCapture(event.pointerId)
    const move = (moveEvent: PointerEvent) => { const scale = settings.uiScale / 100; const width = Math.round(Math.max(208, Math.min(400, (settings.sidebarSide === 'left' ? moveEvent.clientX : window.innerWidth - moveEvent.clientX) / scale))); void api.setSettings({ sidebarWidth: width }) }
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up) }
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up)
  }
  const numbers = useMemo(() => tabNumbers(groups), [groups])
  const ctrlHeld = useCtrlHeld((state) => state.held)
  const rowProps = (tab: Tab) => ({ tab, compact, active: tab.id === activeId, runtime: snapshot.runtime[tab.id], snapshot, activeTab, spaceFolders, number: ctrlHeld ? numbers.get(tab.id) : undefined, shortcutNumber: numbers.get(tab.id) })

  return <aside className="group/sidebar relative flex w-[var(--ath-sidebar-width)] min-w-[var(--ath-sidebar-min)] max-w-[var(--ath-sidebar-max)] shrink-0 flex-col overflow-hidden bg-sidebar text-sidebar-foreground data-[collapsed=true]:w-[var(--ath-rail-width)] data-[collapsed=true]:min-w-[var(--ath-rail-width)] data-[collapsed=true]:max-w-[var(--ath-rail-width)]"
    data-part="sidebar" data-collapsed={String(compact)} data-side={settings.sidebarSide} style={{ '--ath-sidebar-width': `calc(${settings.sidebarWidth}px * var(--ath-ui-scale, 1))` } as React.CSSProperties}>
    <div className="flex shrink-0 items-center gap-1 px-2 pt-2 pb-1.5 rail:flex-col rail:px-0 rail:pt-2" data-part="sidebar-header" onPointerDown={dragWindow} onDoubleClick={toggleWindow}>
      <div className="flex items-center gap-1 rail:flex-col rail:gap-1.5" data-no-drag>
        <Tip label={compact ? 'Expand sidebar' : 'Collapse sidebar'} shortcut="Ctrl+B" side="right"><Button variant="ghost" size="icon" className="size-7 shrink-0 rounded-md text-muted-foreground" aria-label={compact ? 'Expand sidebar' : 'Collapse sidebar'} onClick={() => void api.setSettings({ sidebarCompact: !compact })}>{compact ? <PanelLeft /> : <PanelLeftClose />}</Button></Tip>
        {windowControls}
      </div>
      <Location snapshot={snapshot} activeTab={activeTab ?? null} className="rail:hidden" />
    </div>

    <div className="relative flex min-h-0 flex-1 flex-col">
    <OverlayContextMenu>
      <ContextMenuTrigger asChild>
        <div ref={setListRef} className={cn("relative min-h-0 flex-1 overflow-y-auto overflow-x-hidden overscroll-contain px-2 pb-2 rail:ps-1.5 rail:pe-3.5 [scrollbar-width:thin] [scrollbar-color:var(--border)_transparent] transition-shadow", unfileHint && "shadow-[inset_0_0_0_2px_var(--ring)]")} data-part="tab-list">
          <div key={String(compact)} className="contents">
          <AnimatePresence mode="popLayout" initial={false} custom={slide.current}>
            <m.div key={workspace.activeSpace} custom={slide.current}
              variants={{ enter: (d: number) => ({ x: d * 36, opacity: 0 }), center: { x: 0, opacity: 1 }, exit: (d: number) => ({ x: d * -36, opacity: 0 }) }}
              initial="enter" animate="center" exit="exit" transition={enter}>
              <Block hidden={groups.pinned.length === 0 && !dragging}>
                <PinnedDrop><div className="grid grid-cols-5 gap-1 pt-0.5 rail:grid-cols-1" data-part="pinned-grid"><AnimatePresence initial={false} mode="popLayout">{groups.pinned.map((tab) => <Item key={tab.id}><PinnedTile {...rowProps(tab)} /></Item>)}</AnimatePresence></div></PinnedDrop>
              </Block>

              <Block data-part="tab-flow">
                {groups.folders.map(({ folder, tabs }) => <FolderGroup key={folder.id} folder={folder} tabs={tabs} activeId={activeId} compact={compact}>
                  <Collapse open={!folder.collapsed}><div className="ms-3 flex flex-col border-s border-border ps-1 rail:ms-0 rail:border-s-0 rail:ps-0"><AnimatePresence initial={false} mode="popLayout">{tabs.map((tab) => <Item key={tab.id}><TabRow {...rowProps(tab)} /></Item>)}</AnimatePresence></div></Collapse>
                </FolderGroup>)}
                <div className="relative flex flex-col"><AnimatePresence initial={false} mode="popLayout">{groups.root.map((tab) => <Item key={tab.id}><TabRow {...rowProps(tab)} /></Item>)}</AnimatePresence>
                  <NavRow icon={<Plus />} label="New tab" compact={compact} data-part="new-tab-button" className="text-muted-foreground hover:text-foreground" onClick={() => void api.openTab()} />
                </div>
              </Block>

              {groups.archived.length > 0 && <Block>
                <button type="button" className={cn(rowBase, 'text-muted-foreground hover:bg-tab-hover hover:text-foreground')} aria-expanded={archiveOpen} onClick={() => setArchiveOpen((v) => !v)}><Archive /><span className="sb-label min-w-0 flex-1">Archive</span><span className="text-xs tabular-nums rail:hidden">{groups.archived.length}</span></button>
                <Collapse open={archiveOpen}><AnimatePresence initial={false} mode="popLayout">{groups.archived.map((tab) => <Item key={tab.id}><ArchivedRow tab={tab} compact={compact} snapshot={snapshot} activeTab={activeTab} spaceFolders={spaceFolders} /></Item>)}</AnimatePresence></Collapse>
              </Block>}
            </m.div>
          </AnimatePresence>
          </div>
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent className="w-56">
        <ContextMenuItem onSelect={() => void api.openTab()}><Plus />New Tab</ContextMenuItem>
        <ContextMenuItem onSelect={() => void createFolder()}><FolderPlus />New Folder…</ContextMenuItem>
        <ContextMenuItem onSelect={() => void createSpace()}><Plus />New Space…</ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem onSelect={() => void fileTabs()}><FolderInput />File Tabs into Folders</ContextMenuItem>
        {groups.root.length + groups.folders.reduce((n, g) => n + g.tabs.length, 0) > 0 && <ContextMenuItem onSelect={() => void api.archiveInactiveNow()}><Archive />Archive Inactive Tabs</ContextMenuItem>}
        <ContextMenuSeparator />
        <ContextMenuItem onSelect={() => void api.setSettings({ sidebarCompact: !compact })}>{compact ? <PanelLeft /> : <PanelLeftClose />}{compact ? 'Show Sidebar' : 'Hide Sidebar'}</ContextMenuItem>
        <ContextMenuItem onSelect={() => void api.setSettings({ sidebarSide: settings.sidebarSide === 'left' ? 'right' : 'left' })}><Columns2 />Move Sidebar to {settings.sidebarSide === 'left' ? 'Right' : 'Left'}</ContextMenuItem>
      </ContextMenuContent>
    </OverlayContextMenu>
    <TabRuler snapshot={snapshot} orientation="vertical" className="absolute inset-y-2 end-1 hidden rail:flex" />
    </div>

    <div className="shrink-0 border-t border-sidebar-border pt-2 rail:hidden"><TabRuler snapshot={snapshot} /></div>
    <div className="shrink-0 truncate px-3 pt-1.5 font-instr text-[0.7333rem] uppercase tracking-[0.08em] tabular-nums text-muted-foreground" data-part="status">
      {workspace.spaces.find((space) => space.id === workspace.activeSpace)?.name} · {workspace.tabs.filter((tab) => tab.space === workspace.activeSpace && !tab.archived).length} tabs · {snapshot.blockedTotal.toLocaleString()} blk
    </div>
    <footer className="flex shrink-0 items-center gap-1 px-2 pt-1 pb-2 rail:flex-col rail:gap-1.5 rail:border-t rail:border-sidebar-border rail:py-2" data-part="space-switcher">
      <div className="flex min-w-0 flex-1 items-center gap-0.5 rail:flex-none rail:flex-col rail:gap-1">
        {workspace.spaces.map((space) => <SpaceChip key={space.id} space={space} active={space.id === workspace.activeSpace} snapshot={snapshot} />)}
        <Tip label="New space" side="top"><Button variant="ghost" size="icon-sm" className="size-7 rounded-md text-muted-foreground rail:hidden" aria-label="Add space" onClick={() => void createSpace()}><Plus /></Button></Tip>
      </div>
      <div className="flex items-center gap-0.5 rail:flex-col rail:gap-1">
        <Tip label="Reference boards" side="top"><Button variant="ghost" size="icon-sm" className="size-7 rounded-md text-muted-foreground rail:hidden" aria-label="Reference boards" data-part="board" onClick={() => openPage('boards')}><LayoutPanelTop /></Button></Tip>
        {panels.some((item) => item.ext) && <OverlayDropdownMenu>
          <Tip label="Extension panels" side="top"><DropdownMenuTrigger asChild><Button variant="ghost" size="icon-sm" className="size-7 rounded-md text-muted-foreground rail:hidden" aria-label="Extension panels"><Puzzle /></Button></DropdownMenuTrigger></Tip>
          <DropdownMenuContent side="top" align="end" className="w-56">{panels.filter((item) => item.ext).map((item) => <DropdownMenuItem key={`${item.ext}/${item.id}`} onSelect={() => openPanel(item)}><AppIcon name={item.icon} />{item.title}</DropdownMenuItem>)}</DropdownMenuContent>
        </OverlayDropdownMenu>}
        <Tip label="Settings" side="top"><Button variant="ghost" size="icon-sm" className="size-7 rounded-md text-muted-foreground" aria-label="Settings" onClick={() => openPage('settings')}><Settings /></Button></Tip>
      </div>
    </footer>
    <div className="absolute inset-y-0 z-10 w-1 cursor-ew-resize transition-colors hover:bg-foreground/10 group-data-[side=left]/sidebar:-end-0.5 group-data-[side=right]/sidebar:-start-0.5" role="separator" aria-label="Resize sidebar" onPointerDown={resizeStart} />
  </aside>
}

/* ------------------------------------------------------------------ pieces */

/** List entrance/exit: new rows ease in, closed rows pop out of flow while the rest glide up. */
function Item({ children }: { children: React.ReactNode }) {
  return <m.div layout="position" initial={{ opacity: 0, scale: 0.94 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.94 }} transition={{ layout: snap, opacity: { duration: 0.12 }, scale: enter }} style={{ transformOrigin: 'left center' }}>{children}</m.div>
}

/** Height-animated disclosure; clips only while moving so dragged rows are never cut off. */
function Collapse({ open, children }: { open: boolean; children: React.ReactNode }) {
  const [moving, setMoving] = useState(false)
  return <AnimatePresence initial={false}>{open && <m.div key="body" initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={fold}
    style={{ overflow: moving ? 'hidden' : 'visible' }} onAnimationStart={() => setMoving(true)} onAnimationComplete={() => setMoving(false)}>{children}</m.div>}</AnimatePresence>
}

/** The highlight behind the active row: one shared element that glides from row to row. */
function ActivePill() {
  return <m.span layoutId="active-pill" transition={snap} aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10 rounded-[inherit] border border-border/70 bg-tab-active shadow-[0_1px_2px_oklch(0_0_0/0.07)]" />
}

/** One group in the sidebar flow. In the icon rail groups are told apart by a hairline instead of whitespace. */
function Block({ hidden, children, ...rest }: { hidden?: boolean; children?: React.ReactNode } & React.HTMLAttributes<HTMLElement>) {
  if (hidden) return null
  return <section className="mt-1.5 first:mt-0 rail:mt-1.5 rail:border-t rail:border-border rail:pt-2" data-part="section" {...rest}>{children}</section>
}

function NavRow({ icon, label, compact, onClick, className, ...rest }: { icon: React.ReactNode; label: string; compact: boolean; onClick: () => void } & React.HTMLAttributes<HTMLButtonElement>) {
  return <Tip label={label} side="right" disabled={!compact}><button type="button" className={cn(rowBase, 'hover:bg-tab-hover [&_svg]:text-muted-foreground', className)} onClick={onClick} aria-label={label} {...rest}>{icon}<span className="sb-label min-w-0 flex-1">{label}</span></button></Tip>
}

function PinnedDrop({ children }: { children: React.ReactNode }) {
  const { setNodeRef } = useDroppable({ id: dropId.pin })
  const over = useDragState((state) => state.hint?.kind === 'pin')
  const dragging = useDragState((state) => state.dragging !== null)
  return <div ref={setNodeRef} className={cn('min-h-9 rounded-lg transition-colors', dragging && 'bg-foreground/[0.04] ring-1 ring-dashed ring-border', over && 'bg-accent/70 ring-2 ring-ring/60')}>{children}</div>
}

/** The line that shows where the dragged tab will land (horizontal in lists, vertical between pinned tiles). */
function DropLine({ tab, vertical = false }: { tab: Tab; vertical?: boolean }) {
  const edge = useDragState((state) => state.hint && (state.hint.kind === 'before' || state.hint.kind === 'after') && state.hint.target === tab.id ? state.hint.kind : null)
  if (!edge) return null
  return <span aria-hidden="true" className={cn('pointer-events-none absolute z-20 rounded-full bg-foreground shadow-[0_0_0_2px_var(--sidebar)]', vertical ? 'inset-y-1 w-0.5' : 'inset-x-1.5 h-0.5', vertical ? (edge === 'before' ? '-start-0.5' : '-end-0.5') : (edge === 'before' ? '-top-px' : '-bottom-px'))} />
}

/** The picture that follows the pointer while dragging. */
export function DragGhost({ tab }: { tab: Tab }) {
  return <div className="pointer-events-none flex h-[var(--ath-tab-height)] w-56 cursor-grabbing items-center gap-2 rounded-md border border-border bg-popover px-2 text-[0.8333rem] font-medium text-popover-foreground shadow-menu">
    {tab.favicon ? <img src={tab.favicon} alt="" className="size-[1rem] rounded-[0.2rem] object-contain" /> : <Globe className="size-[1rem] text-muted-foreground" />}
    <span className="min-w-0 flex-1 truncate">{tab.title}</span>
  </div>
}

type TabMenuCtx = { tab: Tab; snapshot: Snapshot; activeTab: Tab | undefined; spaceFolders: Snapshot['workspace']['folders'] }

/**
 * The menu shared by tab rows, pinned tiles and archived rows. Per Apple's menu guidance: few items, grouped, unavailable
 * items hidden (not dimmed), no keyboard shortcuts (they live in the main menus and the shortcut sheet), one level of
 * submenu, an ellipsis when more input is needed, and the commands that end a tab last.
 */
function TabMenu({ tab, snapshot, activeTab, spaceFolders }: TabMenuCtx) {
  const spaces = snapshot.workspace.spaces
  const visible = snapshot.workspace.tabs.filter((item) => item.space === tab.space && !item.archived)
  const canSplit = Boolean(activeTab && activeTab.id !== tab.id && !tab.archived)
  const hasBelow = visible.findIndex((item) => item.id === tab.id) < visible.length - 1 && !tab.archived
  const hasOthers = visible.some((item) => item.id !== tab.id)
  const moveSpaces = spaces.filter((space) => space.id !== tab.space)
  const moveFolders = spaceFolders.filter((folder) => folder.id !== tab.folder)
  return <ContextMenuContent className="w-64">
    <ContextMenuItem onSelect={() => void api.setPinned(tab.id, !tab.pinned)}>{tab.pinned ? <PinOff /> : <Pin />}{tab.pinned ? 'Unpin Tab' : 'Pin Tab'}</ContextMenuItem>
    <ContextMenuItem onSelect={() => void api.setMuted(tab.id, !tab.muted)}>{tab.muted ? <Volume2 /> : <VolumeX />}{tab.muted ? 'Unmute Tab' : 'Mute Tab'}</ContextMenuItem>
    <ContextMenuItem onSelect={() => void api.duplicateTab(tab.id)}><Copy />Duplicate Tab</ContextMenuItem>
    {canSplit && <ContextMenuItem onSelect={() => void api.splitWith({ tab: tab.id, dir: 'row' })}><Columns2 />Split with Current Tab</ContextMenuItem>}
    <ContextMenuSeparator />
    {(moveSpaces.length > 0 || moveFolders.length > 0 || tab.folder) && <ContextMenuSub>
      <ContextMenuSubTrigger><FolderInput />Move to…</ContextMenuSubTrigger>
      <ContextMenuSubContent className="w-52">
        {moveSpaces.map((space) => <ContextMenuItem key={space.id} onSelect={() => void api.moveTab({ tab: tab.id, space: space.id, folder: null })}><AppIcon name={space.icon} />{space.name}</ContextMenuItem>)}
        {moveSpaces.length > 0 && moveFolders.length > 0 && <ContextMenuSeparator />}
        {moveFolders.map((folder) => <ContextMenuItem key={folder.id} onSelect={() => void api.moveTab({ tab: tab.id, folder: folder.id })}><FolderIcon style={folder.color ? { color: folder.color } : undefined} />{folder.name}</ContextMenuItem>)}
        {tab.folder && <><ContextMenuSeparator /><ContextMenuItem onSelect={() => void api.moveTab({ tab: tab.id, folder: null })}><XCircle />Remove from Folder</ContextMenuItem></>}
      </ContextMenuSubContent>
    </ContextMenuSub>}
    <ContextMenuItem onSelect={() => void api.copyUrl(tab.id)}><Link2 />Copy Address</ContextMenuItem>
    {!tab.archived && !tab.url.startsWith('athanor://') && <ContextMenuItem onSelect={() => void api.setSoftwareRendering(tab.id, !tab.softwareRendering)}><ZapOff />{tab.softwareRendering ? 'Turn On Hardware Acceleration' : 'Turn Off Hardware Acceleration'}</ContextMenuItem>}
    <ContextMenuSeparator />
    <ContextMenuItem onSelect={() => void api.closeTab(tab.id)}><X />Close Tab</ContextMenuItem>
    {hasOthers && <ContextMenuItem onSelect={() => void api.closeOtherTabs(tab.id)}><XCircle />Close Other Tabs</ContextMenuItem>}
    {hasBelow && <ContextMenuItem onSelect={() => void api.closeTabsBelow(tab.id)}><ArrowDownToLine />Close Tabs Below</ContextMenuItem>}
  </ContextMenuContent>
}

type RowProps = TabMenuCtx & { compact: boolean; active: boolean; runtime: Snapshot['runtime'][string] | undefined; /** The Ctrl+number this tab answers to, shown while Ctrl is held. */ number?: number; /** Always set: exposed to assistive technology as the row's keyboard shortcut. */ shortcutNumber?: number }

/** The little numeral that appears on a tab while Ctrl is held: it is the key that opens it. */
function NumberBadge({ value, className }: { value: number; className?: string }) {
  return <span className={cn('grid h-[1.1rem] min-w-[1.1rem] place-items-center rounded-[0.3rem] bg-foreground px-1 font-instr text-[0.7333rem] font-medium tabular-nums text-background', className)} data-part="tab-number" aria-hidden="true">{value}</span>
}

function Favicon({ tab, runtime, className }: { tab: Tab; runtime?: Snapshot['runtime'][string]; className?: string }) {
  return <span className={cn('grid size-[1rem] shrink-0 place-items-center text-muted-foreground [&_svg]:size-[1rem]', className)} data-part="tab-favicon" data-loading={String(runtime?.loading ?? false)}>
    {runtime?.loading ? <Loader2 className="animate-spin text-foreground" /> : tab.favicon ? <img src={tab.favicon} alt="" className="size-[1rem] rounded-[0.2rem] object-contain" /> : tab.url.startsWith('athanor://') ? <AthanorMark className="size-3.5" /> : runtime?.secure ? <Lock className="!size-3.5" /> : <Globe />}
  </span>
}

/** Compact "time since last used", shown only once a tab has been idle for a while. */
function idleLabel(lastActive: number) {
  const minutes = Math.floor((Date.now() - lastActive) / 60000)
  if (!lastActive || minutes < 10) return ''
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  return hours < 48 ? `${hours}h` : `${Math.floor(hours / 24)}d`
}

const tabAction = `grid size-6 place-items-center rounded-md text-muted-foreground hover:bg-foreground/10 hover:text-foreground rail:hidden [&_svg]:size-3.5`

function TabRow(props: RowProps) {
  const { tab, active, runtime, compact, number, shortcutNumber } = props
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: `tab:${tab.id}` })
  const { setNodeRef: setDropRef } = useDroppable({ id: dropId.tab(tab.id), disabled: isDragging })
  const close = () => void api.closeTab(tab.id)
  const idle = active || tab.pinned ? '' : idleLabel(tab.lastActive)
  const row = <div ref={(element) => { setNodeRef(element); setDropRef(element) }} role="group" aria-label={`${tab.title} tab`}
    className={`group/tab relative isolate flex h-[var(--ath-tab-height)] cursor-grab items-center gap-1.5 rounded-md ps-1.5 pe-0.5 text-[0.8333rem] transition-colors hover:bg-tab-hover active:cursor-grabbing data-[active=true]:bg-transparent data-[active=true]:font-medium data-[archived=true]:opacity-60 rail:h-9 rail:justify-center rail:gap-0 rail:px-0`}
    data-part="tab" data-active={String(active)} data-pinned={String(tab.pinned)} data-loading={String(runtime?.loading ?? false)} data-audible={String(runtime?.audible ?? false)} data-archived={String(tab.archived)}
    style={{ opacity: isDragging ? 0.35 : undefined }}>
    {active && <ActivePill />}
    <DropLine tab={tab} />
    <button type="button" {...attributes} {...listeners} className={`flex h-full min-w-0 flex-1 items-center gap-1.5 rounded text-start outline-none focus-visible:ring-2 focus-visible:ring-ring/40 rail:justify-center rail:gap-0`} aria-current={active ? 'page' : undefined} aria-keyshortcuts={shortcutNumber ? `Control+${shortcutNumber}` : undefined} onClick={() => void api.activateTab(tab.id)} onAuxClick={(event) => { if (event.button === 1) { event.preventDefault(); close() } }} title={compact ? undefined : tab.url}>
      <Favicon tab={tab} runtime={runtime} className={`rail:size-[1.2rem]`} />
      <span className="sb-label min-w-0 flex-1 truncate" data-part="tab-title">{tab.title}</span>
    </button>
    {tab.softwareRendering && <Tip label="Hardware acceleration is off" side="right"><span className="grid size-[1.4667rem] place-items-center text-muted-foreground rail:hidden" role="img" aria-label="Hardware acceleration is off"><ZapOff className="size-3" /></span></Tip>}
    {runtime?.audible && !tab.muted && <button type="button" className={tabAction} aria-label="Mute audible tab" title="Mute tab" onPointerDown={(event) => event.stopPropagation()} onClick={() => void api.setMuted(tab.id, true)}><AudioLines /></button>}
    {tab.muted && <button type="button" className={tabAction} aria-label="Unmute tab" title="Tab muted" onPointerDown={(event) => event.stopPropagation()} onClick={() => void api.setMuted(tab.id, false)}><VolumeX /></button>}
    {number !== undefined && <NumberBadge value={number} className="me-1 rail:absolute rail:end-0.5 rail:top-0.5" />}
    {number === undefined && idle && <span className="me-1 font-instr text-[0.7333rem] uppercase tabular-nums text-muted-foreground/80 group-hover/tab:hidden rail:hidden" title={`Last used ${idle} ago`}>{idle}</span>}
    <button type="button" className={`${tabAction} opacity-0 pointer-events-none ${number === undefined ? 'group-hover/tab:opacity-100 group-hover/tab:pointer-events-auto group-data-[active=true]/tab:opacity-100 group-data-[active=true]/tab:pointer-events-auto' : ''} focus-visible:opacity-100 focus-visible:pointer-events-auto`} data-part="tab-close" aria-label={`Close ${tab.title}`} onPointerDown={(event) => event.stopPropagation()} onClick={close}><X /></button>
  </div>
  return <OverlayContextMenu><ContextMenuTrigger asChild><div onContextMenu={ownContextMenu}><Tip label={tab.title} side="right" disabled={!compact}>{row}</Tip></div></ContextMenuTrigger><TabMenu {...props} /></OverlayContextMenu>
}

function PinnedTile(props: RowProps) {
  const { tab, active, runtime, number, shortcutNumber } = props
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: `tab:${tab.id}` })
  const { setNodeRef: setDropRef } = useDroppable({ id: dropId.tab(tab.id), disabled: isDragging })
  const tile = <button ref={(element) => { setNodeRef(element); setDropRef(element) }} type="button" {...attributes} {...listeners} onClick={() => void api.activateTab(tab.id)}
    className="relative isolate grid aspect-square w-full min-w-0 place-items-center rounded-lg bg-sidebar-accent/70 text-muted-foreground outline-none transition-colors hover:bg-sidebar-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/40 data-[active=true]:bg-transparent data-[active=true]:text-foreground"
    data-part="pinned-tab" data-pinned="true" data-active={String(active)} aria-keyshortcuts={shortcutNumber ? `Control+${shortcutNumber}` : undefined} style={{ opacity: isDragging ? 0.35 : undefined }} aria-label={tab.title}>
    {active && <ActivePill />}
    <DropLine tab={tab} vertical />
    <Favicon tab={tab} runtime={runtime} className="size-[1.2rem]" />
    {number !== undefined && <NumberBadge value={number} className="absolute -end-1 -top-1" />}
  </button>
  return <OverlayContextMenu><ContextMenuTrigger asChild><div onContextMenu={ownContextMenu}><Tip label={tab.title} side="right">{tile}</Tip></div></ContextMenuTrigger><TabMenu {...props} /></OverlayContextMenu>
}

function ArchivedRow({ tab, compact, snapshot, activeTab, spaceFolders }: TabMenuCtx & { compact: boolean }) {
  const button = <button type="button" className={cn(rowBase, 'group/arch text-muted-foreground hover:bg-tab-hover hover:text-foreground')} data-archived="true" onClick={() => void api.restoreTab(tab.id)} title={compact ? undefined : 'Restore tab'}><Archive /><span className="sb-label min-w-0 flex-1 truncate">{tab.title}</span><RotateCcw className={`opacity-0 group-hover/arch:opacity-100 rail:hidden`} /></button>
  return <OverlayContextMenu><ContextMenuTrigger asChild><div onContextMenu={ownContextMenu}><Tip label={tab.title} side="right" disabled={!compact}>{button}</Tip></div></ContextMenuTrigger><TabMenu tab={tab} snapshot={snapshot} activeTab={activeTab} spaceFolders={spaceFolders} /></OverlayContextMenu>
}

function FolderGroup({ folder, tabs, activeId, compact, children }: { folder: Snapshot['workspace']['folders'][number]; tabs: Tab[]; activeId: string | null; compact: boolean; children?: React.ReactNode }) {
  const count = tabs.length
  const holdsActive = folder.collapsed && tabs.some((tab) => tab.id === activeId)
  const { setNodeRef } = useDroppable({ id: dropId.folder(folder.id) })
  const over = useDragState((state) => state.hint?.kind === 'folder' && state.hint.folder === folder.id)
  const rename = async () => { const name = await askText({ title: 'Rename folder', label: 'Name', initial: folder.name }); if (name) void api.renameFolder(folder.id, name) }
  const remove = async (closeTabs: boolean) => {
    const ok = await askConfirm({ title: closeTabs ? `Delete “${folder.name}” and close its tabs?` : `Delete “${folder.name}”?`, description: closeTabs ? 'Every tab in this folder will be closed.' : 'Its tabs stay open and move out of the folder.', confirm: 'Delete', destructive: true })
    if (ok) void api.deleteFolder(folder.id, closeTabs)
  }
  const header = <button type="button" onClick={() => void api.toggleFolder(folder.id)}
    className={cn(rowBase, 'font-medium hover:bg-tab-hover data-[folded=true]:text-muted-foreground')}
    data-part="folder-header" data-folded={String(folder.collapsed)} aria-label={folder.name} aria-expanded={!folder.collapsed}>
    <ChevronRight className={cn('size-3 text-muted-foreground transition-transform duration-200', 'rail:hidden', !folder.collapsed && 'rotate-90')} />
    <FolderIcon className="text-muted-foreground" style={folder.color ? { color: folder.color } : undefined} />
    <span className={cn('sb-label min-w-0 flex-1 truncate', holdsActive && 'font-semibold')}>{folder.name}</span>
    {folder.collapsed && count > 0 && <span className="flex shrink-0 items-center -space-x-0.5 rail:hidden" aria-hidden="true" data-part="folder-preview">{tabs.slice(0, 3).map((tab) => tab.favicon ? <img key={tab.id} src={tab.favicon} alt="" className="size-[0.9rem] rounded-[0.2rem] bg-sidebar object-contain ring-1 ring-sidebar" /> : <span key={tab.id} className="grid size-[0.9rem] place-items-center rounded-[0.2rem] bg-sidebar-accent ring-1 ring-sidebar"><Globe className="!size-2.5 text-muted-foreground" /></span>)}</span>}
    {holdsActive && <span className="size-1.5 shrink-0 rounded-full bg-foreground rail:hidden" role="img" aria-label="Contains the current tab" />}
    {folder.auto && <Tip label="Filed automatically" side="top"><WandSparkles className={`!size-3 text-muted-foreground/70 rail:hidden`} /></Tip>}
    <span className={`font-mono text-[0.7333rem] font-normal tabular-nums text-muted-foreground rail:hidden`}>{count}</span>
  </button>
  return <div ref={setNodeRef} className="rounded-lg transition-colors data-[over=true]:bg-accent/70 data-[over=true]:ring-2 data-[over=true]:ring-ring/60" data-part="folder" data-over={String(over)}>
    <OverlayContextMenu>
      <ContextMenuTrigger asChild><div onContextMenu={ownContextMenu}><Tip label={folder.name} side="right" disabled={!compact}>{header}</Tip></div></ContextMenuTrigger>
      <ContextMenuContent className="w-56">
        <ContextMenuItem onSelect={() => void rename()}><Pencil />Rename…</ContextMenuItem>
        <ContextMenuSub>
          <ContextMenuSubTrigger><Palette />Color</ContextMenuSubTrigger>
          <ContextMenuSubContent className="w-44">{SWATCHES.map((swatch) => <ContextMenuItem key={swatch.name} onSelect={() => void api.setFolderColor(folder.id, swatch.value)}><span className="grid size-4 place-items-center"><span className="size-3 rounded-full border border-border" style={{ background: swatch.value ?? 'transparent' }} /></span>{swatch.name}</ContextMenuItem>)}</ContextMenuSubContent>
        </ContextMenuSub>
        <ContextMenuSeparator />
        <ContextMenuItem onSelect={() => void remove(false)}><Trash2 />Delete Folder…</ContextMenuItem>
        <ContextMenuItem destructive onSelect={() => void remove(true)}><XCircle />Delete Folder and Close Tabs…</ContextMenuItem>
      </ContextMenuContent>
    </OverlayContextMenu>
    {children}
  </div>
}

function SpaceChip({ space, active, snapshot }: { space: Snapshot['workspace']['spaces'][number]; active: boolean; snapshot: Snapshot }) {
  const { setNodeRef } = useDroppable({ id: dropId.space(space.id) })
  const isOver = useDragState((state) => state.hint?.kind === 'space' && state.hint.space === space.id)
  const rename = async () => { const name = await askText({ title: 'Rename space', label: 'Name', initial: space.name }); if (name) void api.renameSpace(space.id, name) }
  const remove = async () => { if (await askConfirm({ title: `Delete “${space.name}”?`, description: 'The space and the tabs inside it will be closed.', confirm: 'Delete', destructive: true })) void api.removeSpace(space.id) }
  const chip = <button ref={setNodeRef} type="button" aria-label={`Switch to ${space.name}`} onClick={() => void api.switchSpace(space.id)}
    className="relative isolate grid size-7 place-items-center rounded-md text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/40 data-[active=true]:text-foreground data-[over=true]:ring-2 data-[over=true]:ring-ring/50 [&_svg]:size-4"
    data-part="space" data-active={String(active)} data-over={String(isOver)} style={{ '--space-color': space.color, color: active ? space.color : undefined } as React.CSSProperties}>
    {active && <m.span layoutId="active-space" transition={snap} aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10 rounded-[inherit] border border-border/70 bg-tab-active shadow-[0_1px_2px_oklch(0_0_0/0.07)]" />}
    <AppIcon name={space.icon} />
  </button>
  return <OverlayContextMenu>
    <ContextMenuTrigger asChild><div onContextMenu={ownContextMenu}><Tip label={space.name} side="top">{chip}</Tip></div></ContextMenuTrigger>
    <ContextMenuContent className="w-52">
      <ContextMenuItem onSelect={() => void rename()}><Pencil />Rename Space…</ContextMenuItem>
      <ContextMenuSub>
        <ContextMenuSubTrigger><Smile />Icon</ContextMenuSubTrigger>
        <ContextMenuSubContent className="grid w-auto grid-cols-4 gap-0.5 p-1.5">{SPACE_ICONS.map((icon) => <ContextMenuItem key={icon} className="size-9 justify-center p-0" aria-label={icon} data-checked={String(icon === space.icon)} onSelect={() => void api.updateSpace(space.id, { icon })}><AppIcon name={icon} /></ContextMenuItem>)}</ContextMenuSubContent>
      </ContextMenuSub>
      <ContextMenuSub>
        <ContextMenuSubTrigger><Palette />Color</ContextMenuSubTrigger>
        <ContextMenuSubContent className="w-44">{SWATCHES.map((swatch) => <ContextMenuItem key={swatch.name} onSelect={() => void api.updateSpace(space.id, { color: swatch.value ?? cssToken('--ath-space-default-color') })}><span className="grid size-4 place-items-center"><span className="size-3 rounded-full border border-border" style={{ background: swatch.value ?? cssToken('--ath-space-default-color') }} /></span>{swatch.name}</ContextMenuItem>)}</ContextMenuSubContent>
      </ContextMenuSub>
      <ContextMenuSeparator />
      {snapshot.workspace.spaces.length > 1 && <ContextMenuItem destructive onSelect={() => void remove()}><Trash2 />Delete Space…</ContextMenuItem>}
    </ContextMenuContent>
  </OverlayContextMenu>
}
