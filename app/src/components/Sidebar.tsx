import { useMemo, useRef, useState } from 'react'
import type * as React from 'react'
import { useDndContext, useDraggable, useDroppable } from '@dnd-kit/core'
import { CSS } from '@dnd-kit/utilities'
import { AnimatePresence, m } from 'motion/react'
import {
  Archive, ArrowDownToLine, AudioLines, ChevronDown, ChevronRight, Columns2, Copy, Folder as FolderIcon, FolderInput, FolderPlus, Globe, History, LayoutPanelTop, Link2, Loader2, Lock, PanelLeft, PanelLeftClose, Palette, Pencil, Pin, PinOff, Plus, RotateCcw, Settings, Smile, Trash2, Volume2, VolumeX, WandSparkles, X, XCircle,
} from 'lucide-react'
import type { PanelInfo, Snapshot, Tab } from '@/lib/types'
import { groupSidebarTabs } from '@/lib/sidebarModel'
import { api } from '@/lib/api'
import { cn, cssToken } from '@/lib/utils'
import { enter, fold, snap } from '@/lib/motion'
import { AthanorMark } from './AthanorMark'
import { AppIcon } from './Icons'
import { Button } from './ui/button'
import { Kbd } from './ui/kbd'
import { Tip } from './ui/tooltip'
import { ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuShortcut, ContextMenuSub, ContextMenuSubContent, ContextMenuSubTrigger, ContextMenuTrigger } from './ui/context-menu'
import { OverlayContextMenu, ownContextMenu } from './overlay-menus'
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
const rowBase = `flex h-[var(--ath-tab-height)] w-full items-center gap-2.5 rounded-lg px-2 text-start text-[13px] outline-none focus-visible:ring-2 focus-visible:ring-ring/40 rail:h-10 rail:justify-center rail:gap-0 rail:px-0 [&_svg]:size-4 [&_svg]:shrink-0`

export function Sidebar({ snapshot, panels, openPage, openPanel, windowControls }: Props) {
  const [archiveOpen, setArchiveOpen] = useState(false)
  const [panelOpen, setPanelOpen] = useState(true)
  const [pinOpen, setPinOpen] = useState(true)
  const [folderOpen, setFolderOpen] = useState(true)
  const dragging = useDndContext().active !== null
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
    const move = (moveEvent: PointerEvent) => { const width = Math.max(208, Math.min(400, settings.sidebarSide === 'left' ? moveEvent.clientX : window.innerWidth - moveEvent.clientX)); void api.setSettings({ sidebarWidth: width }) }
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up) }
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up)
  }
  const rowProps = (tab: Tab) => ({ tab, compact, active: tab.id === activeId, runtime: snapshot.runtime[tab.id], snapshot, activeTab, spaceFolders })

  return <aside className="group/sidebar relative flex w-[var(--ath-sidebar-width)] min-w-[var(--ath-sidebar-min)] max-w-[var(--ath-sidebar-max)] shrink-0 flex-col overflow-hidden bg-sidebar text-sidebar-foreground data-[collapsed=true]:w-[var(--ath-rail-width)] data-[collapsed=true]:min-w-[var(--ath-rail-width)] data-[collapsed=true]:max-w-[var(--ath-rail-width)]"
    data-part="sidebar" data-collapsed={String(compact)} data-side={settings.sidebarSide} style={{ '--ath-sidebar-width': `${settings.sidebarWidth}px` } as React.CSSProperties}>
    <div className={`flex h-12 shrink-0 items-center justify-between gap-2 ps-2.5 pe-1.5 rail:h-auto rail:flex-col rail:justify-center rail:gap-2 rail:px-0 rail:py-3`} data-part="sidebar-header" onPointerDown={dragWindow} onDoubleClick={toggleWindow}>
      <div className="flex w-full items-center justify-between rail:w-auto rail:flex-col rail:gap-2" data-no-drag>
        <Tip label={compact ? 'Expand sidebar' : 'Collapse sidebar'} shortcut="Ctrl+B" side="right"><Button variant="ghost" size="icon-sm" aria-label={compact ? 'Expand sidebar' : 'Collapse sidebar'} onClick={() => void api.setSettings({ sidebarCompact: !compact })}>{compact ? <PanelLeft /> : <PanelLeftClose />}</Button></Tip>
        {windowControls}
      </div>
    </div>

    <div className={`px-2.5 pb-2 rail:flex rail:justify-center`}>
      <Tip label="New tab" shortcut="Ctrl+T" side="right" disabled={!compact}><Button variant="outline" className={`h-9 w-full justify-start gap-2.5 rounded-lg border-border/80 bg-background px-2.5 text-[13px] font-medium text-foreground shadow-xs hover:bg-background hover:shadow-sm rail:size-10 rail:justify-center rail:gap-0 rail:rounded-xl rail:border-transparent rail:bg-transparent rail:px-0 rail:shadow-none rail:hover:bg-tab-hover`} data-part="new-tab-button" aria-label="New tab" onClick={() => void api.openTab()}><Plus /><span className="sb-label">New tab</span><Kbd className="sb-label ms-auto border-0 bg-transparent rail:ms-0">Ctrl T</Kbd></Button></Tip>
    </div>

    <OverlayContextMenu>
      <ContextMenuTrigger asChild>
        <div className="relative min-h-0 flex-1 overflow-y-auto overflow-x-hidden overscroll-contain px-2.5 pb-3 [scrollbar-width:thin] [scrollbar-color:var(--border)_transparent]" data-part="tab-list">
          <div key={String(compact)} className="contents">
          <AnimatePresence mode="popLayout" initial={false} custom={slide.current}>
            <m.div key={workspace.activeSpace} custom={slide.current}
              variants={{ enter: (d: number) => ({ x: d * 36, opacity: 0 }), center: { x: 0, opacity: 1 }, exit: (d: number) => ({ x: d * -36, opacity: 0 }) }}
              initial="enter" animate="center" exit="exit" transition={enter}>
              <Section label="Pinned" open={pinOpen} onToggle={() => setPinOpen((v) => !v)} hidden={groups.pinned.length === 0 && !dragging} action={<IconAction label="New pinned tab" onClick={() => void api.openTab({ pinned: true })}><Plus /></IconAction>}>
                <PinnedDrop><div className={`grid grid-cols-4 gap-1.5 px-0.5 pt-0.5 rail:grid-cols-1`} data-part="pinned-grid"><AnimatePresence initial={false} mode="popLayout">{groups.pinned.map((tab) => <Item key={tab.id}><PinnedTile {...rowProps(tab)} /></Item>)}</AnimatePresence></div></PinnedDrop>
              </Section>

              <Section label="Folders" open={folderOpen} onToggle={() => setFolderOpen((v) => !v)} hidden={groups.folders.length === 0 && !dragging} action={<IconAction label="New folder" onClick={() => void createFolder()}><FolderPlus /></IconAction>}>
                {groups.folders.map(({ folder, tabs }) => <FolderGroup key={folder.id} folder={folder} count={tabs.length} compact={compact}>
                  <Collapse open={!folder.collapsed}><div className="ms-3.5 flex flex-col gap-px border-s border-border ps-1.5 rail:ms-0 rail:border-s-0 rail:ps-0"><AnimatePresence initial={false} mode="popLayout">{tabs.map((tab) => <Item key={tab.id}><TabRow {...rowProps(tab)} /></Item>)}</AnimatePresence></div></Collapse>
                </FolderGroup>)}
              </Section>

              <Section label="Tabs" action={<><DropTarget id="root-drop" label="Drop here to unfile" /><IconAction label="New folder" onClick={() => void createFolder()}><FolderPlus /></IconAction></>}>
                <div className="relative flex flex-col gap-px"><AnimatePresence initial={false} mode="popLayout">{groups.root.map((tab) => <Item key={tab.id}><TabRow {...rowProps(tab)} /></Item>)}</AnimatePresence></div>
              </Section>

              <Section label="Archive" open={archiveOpen} onToggle={() => setArchiveOpen((v) => !v)} count={groups.archived.length} hidden={groups.archived.length === 0 && compact} action={<IconAction label="Archive inactive tabs now" onClick={() => void api.archiveInactiveNow()}><History /></IconAction>}>
                <AnimatePresence initial={false} mode="popLayout">{groups.archived.map((tab) => <Item key={tab.id}><ArchivedRow tab={tab} compact={compact} snapshot={snapshot} activeTab={activeTab} spaceFolders={spaceFolders} /></Item>)}</AnimatePresence>
              </Section>

              {panels.some((item) => item.ext) && <Section label="Panels" open={panelOpen} onToggle={() => setPanelOpen((v) => !v)}>
                {panels.filter((item) => item.ext).map((item) => <NavRow key={`${item.ext}/${item.id}`} icon={<AppIcon name={item.icon} />} label={item.title} compact={compact} onClick={() => openPanel(item)} />)}
              </Section>}

              <Section label="Collections">
                <NavRow icon={<LayoutPanelTop />} label="Reference boards" compact={compact} data-part="board" onClick={() => openPage('boards')} />
              </Section>
            </m.div>
          </AnimatePresence>
          </div>
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent className="w-56">
        <ContextMenuItem onSelect={() => void api.openTab()}><Plus />New tab<ContextMenuShortcut>Ctrl+T</ContextMenuShortcut></ContextMenuItem>
        <ContextMenuItem onSelect={() => void createFolder()}><FolderPlus />New folder</ContextMenuItem>
        <ContextMenuItem onSelect={() => void createSpace()}><Plus />New space</ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem onSelect={() => void api.autoFileAll()}><FolderInput />File tabs into folders</ContextMenuItem>
        <ContextMenuItem onSelect={() => void api.archiveInactiveNow()}><Archive />Archive inactive tabs</ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem onSelect={() => void api.setSettings({ sidebarCompact: !compact })}>{compact ? <PanelLeft /> : <PanelLeftClose />}{compact ? 'Expand sidebar' : 'Collapse sidebar'}<ContextMenuShortcut>Ctrl+B</ContextMenuShortcut></ContextMenuItem>
        <ContextMenuItem onSelect={() => void api.setSettings({ sidebarSide: settings.sidebarSide === 'left' ? 'right' : 'left' })}><Columns2 />Move sidebar to the {settings.sidebarSide === 'left' ? 'right' : 'left'}</ContextMenuItem>
      </ContextMenuContent>
    </OverlayContextMenu>

    <footer className={`flex shrink-0 items-center gap-1 border-t border-sidebar-border p-2.5 rail:flex-col rail:gap-2 rail:py-3`} data-part="space-switcher">
      <div className={`flex min-w-0 flex-1 items-center gap-1 rail:flex-none rail:flex-col rail:gap-1.5`}>
        {workspace.spaces.map((space) => <SpaceChip key={space.id} space={space} active={space.id === workspace.activeSpace} snapshot={snapshot} />)}
        <Tip label="New space" side="top"><Button variant="ghost" size="icon-sm" className="border border-dashed border-border" aria-label="Add space" onClick={() => void createSpace()}><Plus /></Button></Tip>
      </div>
      <Tip label="Settings" side="top"><Button variant="ghost" size="icon-sm" aria-label="Settings" onClick={() => openPage('settings')}><Settings /></Button></Tip>
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

function IconAction({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return <Tip label={label} side="right"><button type="button" aria-label={label} className="grid size-6 place-items-center rounded-md text-muted-foreground outline-none hover:bg-foreground/8 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/40 [&_svg]:size-3.5" onClick={onClick}>{children}</button></Tip>
}

function Section({ label, open = true, onToggle, hidden, count, action, children }: { label: string; open?: boolean; onToggle?: () => void; hidden?: boolean; count?: number; action?: React.ReactNode; children?: React.ReactNode }) {
  if (hidden) return null
  return <section className="mt-3 first:mt-0 rail:mt-2 rail:border-t rail:border-border rail:pt-2" data-part="section" data-section={label.toLowerCase()}>
    <div className={`group/heading flex h-7 items-center justify-between ps-1 pe-0.5 text-[11px] font-medium uppercase tracking-wider text-muted-foreground/90 rail:hidden`}>
      {onToggle ? <button type="button" className="flex items-center gap-1 rounded-md px-1 py-0.5 outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/40" aria-expanded={open} onClick={onToggle}><ChevronDown className={cn('size-3 transition-transform duration-200', !open && '-rotate-90')} />{label}{count !== undefined && count > 0 && <span className="ms-0.5 tabular-nums">{count}</span>}</button> : <span className="px-1 py-0.5">{label}</span>}
      <div className="flex items-center opacity-0 transition-opacity group-hover/heading:opacity-100 focus-within:opacity-100">{action}</div>
    </div>
    <Collapse open={open || false}>{children}</Collapse>
  </section>
}

function NavRow({ icon, label, compact, onClick, ...rest }: { icon: React.ReactNode; label: string; compact: boolean; onClick: () => void } & React.HTMLAttributes<HTMLButtonElement>) {
  return <Tip label={label} side="right" disabled={!compact}><button type="button" className={cn(rowBase, 'hover:bg-tab-hover [&_svg]:text-muted-foreground')} onClick={onClick} aria-label={label} {...rest}>{icon}<span className="sb-label min-w-0 flex-1">{label}</span></button></Tip>
}

function PinnedDrop({ children }: { children: React.ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({ id: 'pinned-drop' })
  return <div ref={setNodeRef} className="rounded-lg transition-colors data-[over=true]:bg-accent/60" data-over={String(isOver)}>{children}</div>
}

function DropTarget({ id, label }: { id: string; label: string }) {
  const { setNodeRef, isOver } = useDroppable({ id })
  return <Tip label={label} side="right"><span ref={setNodeRef} className="inline-grid size-6 place-items-center rounded-md border border-dashed border-transparent text-muted-foreground transition-colors data-[over=true]:border-ring data-[over=true]:bg-accent" data-over={String(isOver)} aria-label={label}><ArrowDownToLine className="size-3.5" /></span></Tip>
}

type TabMenuCtx = { tab: Tab; snapshot: Snapshot; activeTab: Tab | undefined; spaceFolders: Snapshot['workspace']['folders'] }

/** The menu shared by tab rows, pinned tiles and archived rows. */
function TabMenu({ tab, snapshot, activeTab, spaceFolders }: TabMenuCtx) {
  const spaces = snapshot.workspace.spaces
  const canSplit = activeTab && activeTab.id !== tab.id && !tab.archived
  return <ContextMenuContent className="w-60">
    <ContextMenuItem onSelect={() => void api.setPinned(tab.id, !tab.pinned)}>{tab.pinned ? <PinOff /> : <Pin />}{tab.pinned ? 'Unpin tab' : 'Pin tab'}</ContextMenuItem>
    <ContextMenuItem onSelect={() => void api.setMuted(tab.id, !tab.muted)}>{tab.muted ? <Volume2 /> : <VolumeX />}{tab.muted ? 'Unmute tab' : 'Mute tab'}</ContextMenuItem>
    <ContextMenuItem onSelect={() => void api.duplicateTab(tab.id)}><Copy />Duplicate</ContextMenuItem>
    <ContextMenuItem disabled={!canSplit} onSelect={() => void api.splitWith({ tab: tab.id, dir: 'row' })}><Columns2 />Split with current tab</ContextMenuItem>
    <ContextMenuSeparator />
    <ContextMenuSub>
      <ContextMenuSubTrigger><FolderInput />Move to</ContextMenuSubTrigger>
      <ContextMenuSubContent className="w-52">
        {spaces.map((space) => <ContextMenuItem key={space.id} disabled={space.id === tab.space} onSelect={() => void api.moveTab({ tab: tab.id, space: space.id, folder: null })}><AppIcon name={space.icon} />{space.name}</ContextMenuItem>)}
        {spaceFolders.length > 0 && <ContextMenuSeparator />}
        {spaceFolders.map((folder) => <ContextMenuItem key={folder.id} disabled={tab.folder === folder.id} onSelect={() => void api.moveTab({ tab: tab.id, folder: folder.id })}><FolderIcon style={folder.color ? { color: folder.color } : undefined} />{folder.name}</ContextMenuItem>)}
        {tab.folder && <><ContextMenuSeparator /><ContextMenuItem onSelect={() => void api.moveTab({ tab: tab.id, folder: null })}><XCircle />Remove from folder</ContextMenuItem></>}
      </ContextMenuSubContent>
    </ContextMenuSub>
    <ContextMenuItem onSelect={() => void api.copyUrl(tab.id)}><Link2 />Copy address</ContextMenuItem>
    <ContextMenuSeparator />
    <ContextMenuItem onSelect={() => void api.closeTab(tab.id)}><X />Close tab<ContextMenuShortcut>Ctrl+W</ContextMenuShortcut></ContextMenuItem>
    <ContextMenuItem onSelect={() => void api.closeOtherTabs(tab.id)}><XCircle />Close other tabs</ContextMenuItem>
    <ContextMenuItem onSelect={() => void api.closeTabsBelow(tab.id)}><ArrowDownToLine />Close tabs below</ContextMenuItem>
  </ContextMenuContent>
}

type RowProps = TabMenuCtx & { compact: boolean; active: boolean; runtime: Snapshot['runtime'][string] | undefined }

function Favicon({ tab, runtime, className }: { tab: Tab; runtime?: Snapshot['runtime'][string]; className?: string }) {
  return <span className={cn('grid size-4 shrink-0 place-items-center text-muted-foreground [&_svg]:size-4', className)} data-part="tab-favicon" data-loading={String(runtime?.loading ?? false)}>
    {runtime?.loading ? <Loader2 className="animate-spin text-foreground" /> : tab.favicon ? <img src={tab.favicon} alt="" className="size-4 rounded-[3px] object-contain" /> : tab.url.startsWith('athanor://') ? <AthanorMark className="size-3.5" /> : runtime?.secure ? <Lock className="!size-3.5" /> : <Globe />}
  </span>
}

const tabAction = `grid size-6 place-items-center rounded-md text-muted-foreground hover:bg-foreground/10 hover:text-foreground rail:hidden [&_svg]:size-3.5`

function TabRow(props: RowProps) {
  const { tab, active, runtime, compact } = props
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: `tab:${tab.id}` })
  const { setNodeRef: setDropRef, isOver } = useDroppable({ id: `tab-target:${tab.id}` })
  const close = () => void api.closeTab(tab.id)
  const row = <div ref={(element) => { setNodeRef(element); setDropRef(element) }} role="group" aria-label={`${tab.title} tab`} onContextMenu={ownContextMenu}
    className={`group/tab relative isolate flex h-[var(--ath-tab-height)] cursor-grab items-center gap-2 rounded-lg ps-2 pe-1 text-[13px] transition-colors hover:bg-tab-hover active:cursor-grabbing data-[active=true]:bg-transparent data-[active=true]:font-medium data-[archived=true]:opacity-60 data-[over=true]:ring-2 data-[over=true]:ring-ring/50 rail:h-10 rail:justify-center rail:gap-0 rail:px-0`}
    data-part="tab" data-active={String(active)} data-pinned={String(tab.pinned)} data-loading={String(runtime?.loading ?? false)} data-audible={String(runtime?.audible ?? false)} data-archived={String(tab.archived)} data-over={String(isOver)}
    style={{ transform: CSS.Transform.toString(transform), opacity: isDragging ? 0.45 : undefined }}>
    {active && <ActivePill />}
    <button type="button" {...attributes} {...listeners} className={`flex h-full min-w-0 flex-1 items-center gap-2 rounded-md text-start outline-none focus-visible:ring-2 focus-visible:ring-ring/40 rail:justify-center rail:gap-0`} onClick={() => void api.activateTab(tab.id)} onAuxClick={(event) => { if (event.button === 1) { event.preventDefault(); close() } }} title={compact ? undefined : tab.url}>
      <Favicon tab={tab} runtime={runtime} className={`rail:size-5`} />
      <span className="sb-label min-w-0 flex-1 truncate" data-part="tab-title">{tab.title}</span>
    </button>
    {runtime?.audible && !tab.muted && <button type="button" className={tabAction} aria-label="Mute audible tab" title="Mute tab" onPointerDown={(event) => event.stopPropagation()} onClick={() => void api.setMuted(tab.id, true)}><AudioLines /></button>}
    {tab.muted && <button type="button" className={tabAction} aria-label="Unmute tab" title="Tab muted" onPointerDown={(event) => event.stopPropagation()} onClick={() => void api.setMuted(tab.id, false)}><VolumeX /></button>}
    <button type="button" className={`${tabAction} opacity-0 focus-visible:opacity-100 group-hover/tab:opacity-100 group-data-[active=true]/tab:opacity-100`} data-part="tab-close" aria-label={`Close ${tab.title}`} onPointerDown={(event) => event.stopPropagation()} onClick={close}><X /></button>
  </div>
  return <OverlayContextMenu><ContextMenuTrigger asChild><div><Tip label={tab.title} side="right" disabled={!compact}>{row}</Tip></div></ContextMenuTrigger><TabMenu {...props} /></OverlayContextMenu>
}

function PinnedTile(props: RowProps) {
  const { tab, active, runtime } = props
  const { attributes, listeners, setNodeRef, transform } = useDraggable({ id: `tab:${tab.id}` })
  const tile = <button ref={setNodeRef} type="button" {...attributes} {...listeners} onContextMenu={ownContextMenu} onClick={() => void api.activateTab(tab.id)}
    className="relative isolate grid aspect-square w-full min-w-0 place-items-center rounded-xl bg-sidebar-accent/70 text-muted-foreground outline-none transition-colors hover:bg-sidebar-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/40 data-[active=true]:bg-transparent data-[active=true]:text-foreground"
    data-part="pinned-tab" data-pinned="true" data-active={String(active)} style={{ transform: CSS.Transform.toString(transform) }} aria-label={tab.title}>
    {active && <ActivePill />}
    <Favicon tab={tab} runtime={runtime} className="size-5" />
  </button>
  return <OverlayContextMenu><ContextMenuTrigger asChild><div><Tip label={tab.title} side="right">{tile}</Tip></div></ContextMenuTrigger><TabMenu {...props} /></OverlayContextMenu>
}

function ArchivedRow({ tab, compact, snapshot, activeTab, spaceFolders }: TabMenuCtx & { compact: boolean }) {
  const button = <button type="button" className={cn(rowBase, 'group/arch text-muted-foreground hover:bg-tab-hover hover:text-foreground')} data-archived="true" onContextMenu={ownContextMenu} onClick={() => void api.restoreTab(tab.id)} title={compact ? undefined : 'Restore tab'}><Archive /><span className="sb-label min-w-0 flex-1 truncate">{tab.title}</span><RotateCcw className={`opacity-0 group-hover/arch:opacity-100 rail:hidden`} /></button>
  return <OverlayContextMenu><ContextMenuTrigger asChild><div><Tip label={tab.title} side="right" disabled={!compact}>{button}</Tip></div></ContextMenuTrigger><TabMenu tab={tab} snapshot={snapshot} activeTab={activeTab} spaceFolders={spaceFolders} /></OverlayContextMenu>
}

function FolderGroup({ folder, count, compact, children }: { folder: Snapshot['workspace']['folders'][number]; count: number; compact: boolean; children?: React.ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({ id: `folder:${folder.id}` })
  const rename = async () => { const name = await askText({ title: 'Rename folder', label: 'Name', initial: folder.name }); if (name) void api.renameFolder(folder.id, name) }
  const remove = async (closeTabs: boolean) => {
    const ok = await askConfirm({ title: closeTabs ? `Delete “${folder.name}” and close its tabs?` : `Delete “${folder.name}”?`, description: closeTabs ? 'Every tab in this folder will be closed.' : 'Its tabs stay open and move out of the folder.', confirm: 'Delete', destructive: true })
    if (ok) void api.deleteFolder(folder.id, closeTabs)
  }
  const header = <button type="button" onContextMenu={ownContextMenu} onClick={() => void api.toggleFolder(folder.id)}
    className={cn(rowBase, 'font-medium hover:bg-tab-hover data-[collapsed=true]:text-muted-foreground')}
    data-part="folder-header" data-collapsed={String(folder.collapsed)} aria-label={folder.name}>
    <ChevronRight className={cn('size-3.5 text-muted-foreground transition-transform duration-200', 'rail:hidden', !folder.collapsed && 'rotate-90')} />
    <FolderIcon className="text-muted-foreground" style={folder.color ? { color: folder.color } : undefined} />
    <span className="sb-label min-w-0 flex-1 truncate">{folder.name}</span>
    {folder.auto && <Tip label="Filed automatically" side="top"><WandSparkles className={`!size-3 text-muted-foreground/70 rail:hidden`} /></Tip>}
    <span className={`text-xs font-normal tabular-nums text-muted-foreground rail:hidden`}>{count}</span>
  </button>
  return <div ref={setNodeRef} className="rounded-lg transition-colors data-[over=true]:bg-accent/60 data-[over=true]:ring-2 data-[over=true]:ring-ring/40" data-part="folder" data-over={String(isOver)}>
    <OverlayContextMenu>
      <ContextMenuTrigger asChild><div><Tip label={folder.name} side="right" disabled={!compact}>{header}</Tip></div></ContextMenuTrigger>
      <ContextMenuContent className="w-56">
        <ContextMenuItem onSelect={() => void rename()}><Pencil />Rename</ContextMenuItem>
        <ContextMenuSub>
          <ContextMenuSubTrigger><Palette />Color</ContextMenuSubTrigger>
          <ContextMenuSubContent className="w-44">{SWATCHES.map((swatch) => <ContextMenuItem key={swatch.name} onSelect={() => void api.setFolderColor(folder.id, swatch.value)}><span className="grid size-4 place-items-center"><span className="size-3 rounded-full border border-border" style={{ background: swatch.value ?? 'transparent' }} /></span>{swatch.name}</ContextMenuItem>)}</ContextMenuSubContent>
        </ContextMenuSub>
        <ContextMenuSeparator />
        <ContextMenuItem onSelect={() => void remove(false)}><Trash2 />Delete folder</ContextMenuItem>
        <ContextMenuItem destructive onSelect={() => void remove(true)}><XCircle />Delete folder and close tabs</ContextMenuItem>
      </ContextMenuContent>
    </OverlayContextMenu>
    {children}
  </div>
}

function SpaceChip({ space, active, snapshot }: { space: Snapshot['workspace']['spaces'][number]; active: boolean; snapshot: Snapshot }) {
  const { setNodeRef, isOver } = useDroppable({ id: `space:${space.id}` })
  const rename = async () => { const name = await askText({ title: 'Rename space', label: 'Name', initial: space.name }); if (name) void api.renameSpace(space.id, name) }
  const remove = async () => { if (await askConfirm({ title: `Delete “${space.name}”?`, description: 'The space and the tabs inside it will be closed.', confirm: 'Delete', destructive: true })) void api.removeSpace(space.id) }
  const chip = <button ref={setNodeRef} type="button" aria-label={`Switch to ${space.name}`} onContextMenu={ownContextMenu} onClick={() => void api.switchSpace(space.id)}
    className="relative isolate grid size-8 place-items-center rounded-lg text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/40 data-[active=true]:text-foreground data-[over=true]:ring-2 data-[over=true]:ring-ring/50 [&_svg]:size-4"
    data-part="space" data-active={String(active)} data-over={String(isOver)} style={{ '--space-color': space.color, color: active ? space.color : undefined } as React.CSSProperties}>
    {active && <m.span layoutId="active-space" transition={snap} aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10 rounded-[inherit] border border-border/70 bg-tab-active shadow-[0_1px_2px_oklch(0_0_0/0.07)]" />}
    <AppIcon name={space.icon} />
  </button>
  return <OverlayContextMenu>
    <ContextMenuTrigger asChild><div><Tip label={space.name} side="top">{chip}</Tip></div></ContextMenuTrigger>
    <ContextMenuContent className="w-52">
      <ContextMenuItem onSelect={() => void rename()}><Pencil />Rename space</ContextMenuItem>
      <ContextMenuSub>
        <ContextMenuSubTrigger><Smile />Icon</ContextMenuSubTrigger>
        <ContextMenuSubContent className="grid w-auto grid-cols-4 gap-0.5 p-1.5">{SPACE_ICONS.map((icon) => <ContextMenuItem key={icon} className="size-9 justify-center p-0" aria-label={icon} data-checked={String(icon === space.icon)} onSelect={() => void api.updateSpace(space.id, { icon })}><AppIcon name={icon} /></ContextMenuItem>)}</ContextMenuSubContent>
      </ContextMenuSub>
      <ContextMenuSub>
        <ContextMenuSubTrigger><Palette />Color</ContextMenuSubTrigger>
        <ContextMenuSubContent className="w-44">{SWATCHES.map((swatch) => <ContextMenuItem key={swatch.name} onSelect={() => void api.updateSpace(space.id, { color: swatch.value ?? cssToken('--ath-space-default-color') })}><span className="grid size-4 place-items-center"><span className="size-3 rounded-full border border-border" style={{ background: swatch.value ?? cssToken('--ath-space-default-color') }} /></span>{swatch.name}</ContextMenuItem>)}</ContextMenuSubContent>
      </ContextMenuSub>
      <ContextMenuSeparator />
      <ContextMenuItem destructive disabled={snapshot.workspace.spaces.length <= 1} onSelect={() => void remove()}><Trash2 />Delete space</ContextMenuItem>
    </ContextMenuContent>
  </OverlayContextMenu>
}
