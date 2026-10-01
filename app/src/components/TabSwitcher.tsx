import { useCallback, useRef, useState } from 'react'
import type * as React from 'react'
import * as DialogPrimitive from '@radix-ui/react-dialog'
import type { Snapshot, Tab } from '@/lib/types'
import { groupSidebarTabs } from '@/lib/sidebarModel'
import { api } from '@/lib/api'
import { cssToken } from '@/lib/utils'
import { AppIcon } from './Icons'
import { Button } from './ui/button'
import { Tip } from './ui/tooltip'

function tabHost(url: string) {
  try { return new URL(url).host || new URL(url).protocol.replace(':', '') } catch { return url }
}

export function TabSwitcher({ open, onClose, snapshot }: { open: boolean; onClose: () => void; snapshot: Snapshot }) {
  const [spaceId, setSpaceId] = useState(snapshot.workspace.activeSpace)
  const [contextTab, setContextTab] = useState<Tab | null>(null)
  const touchStart = useRef<{ id: string; x: number; y: number } | null>(null)
  const contextTimer = useRef<number | null>(null)
  const longPressTriggered = useRef(false)
  const sheetRef = useRef<HTMLDivElement | null>(null)
  const setSheetRef = useCallback((node: HTMLDivElement | null) => { if (node && sheetRef.current !== node && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) node.animate([{ transform: 'translateY(100%)' }, { transform: 'translateY(0)' }], { duration: 220, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' }); sheetRef.current = node }, [])
  const groups = groupSidebarTabs(snapshot.workspace.tabs, snapshot.workspace.folders, spaceId)
  if (!open) return null
  const activate = (tab: Tab) => { void api.activateTab(tab.id); onClose() }
  const swipeClose = (event: React.TouchEvent, tab: Tab) => { const start = touchStart.current; touchStart.current = null; if (start?.id === tab.id && (Math.abs(event.changedTouches[0]!.clientX - start.x) > 70 || Math.abs(event.changedTouches[0]!.clientY - start.y) > 70)) void api.closeTab(tab.id) }
  const openContext = (tab: Tab, fromLongPress = false) => { if (fromLongPress) longPressTriggered.current = true; setContextTab(tab) }
  const runContextAction = (action: 'pin' | 'mute' | 'duplicate' | 'split' | 'close') => {
    if (!contextTab) return
    if (action === 'pin') void api.setPinned(contextTab.id, !contextTab.pinned)
    if (action === 'mute') void api.setMuted(contextTab.id, !contextTab.muted)
    if (action === 'duplicate') void api.duplicateTab(contextTab.id)
    if (action === 'split' && snapshot.workspace.activeTab && snapshot.workspace.activeTab !== contextTab.id) void api.splitWith({ tab: contextTab.id, dir: 'row' })
    if (action === 'close') void api.closeTab(contextTab.id)
    setContextTab(null)
  }
  const card = (tab: Tab) => <article key={tab.id} className={`relative min-w-0 rounded-2xl border bg-card p-4 text-left ${tab.id === snapshot.workspace.activeTab ? 'border-primary ring-1 ring-primary' : 'border-border'}`} data-part="tab" data-active={String(tab.id === snapshot.workspace.activeTab)} data-pinned={String(tab.pinned)} data-archived={String(tab.archived)} onTouchStart={(event) => { const touch = event.touches[0]!; touchStart.current = { id: tab.id, x: touch.clientX, y: touch.clientY }; longPressTriggered.current = false; if (contextTimer.current !== null) window.clearTimeout(contextTimer.current); contextTimer.current = window.setTimeout(() => openContext(tab, true), 520) }} onTouchMove={(event) => { const start = touchStart.current, touch = event.touches[0]; if (start && touch && (Math.abs(touch.clientX - start.x) > 14 || Math.abs(touch.clientY - start.y) > 14) && contextTimer.current !== null) { window.clearTimeout(contextTimer.current); contextTimer.current = null } }} onTouchEnd={(event) => { if (contextTimer.current !== null) window.clearTimeout(contextTimer.current); contextTimer.current = null; if (longPressTriggered.current) { touchStart.current = null; return }; swipeClose(event, tab) }} onContextMenu={(event) => { event.preventDefault(); openContext(tab) }}>
    <Tip label={`Close ${tab.title}`}><Button variant="ghost" size="touch" className="absolute right-1 top-1 size-11 p-0" aria-label={`Close ${tab.title}`} onClick={(event) => { if (longPressTriggered.current) { event.preventDefault(); event.stopPropagation(); longPressTriggered.current = false; return }; void api.closeTab(tab.id) }}><AppIcon name="X" /></Button></Tip>
    <button type="button" className="flex w-full min-w-0 flex-col items-start text-left focus-visible:rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40" onClick={(event) => { if (longPressTriggered.current) { event.preventDefault(); longPressTriggered.current = false; return }; activate(tab) }}>
      <span className="mb-4 flex size-10 items-center justify-center rounded-xl bg-muted text-foreground"><AppIcon name={tab.pinned ? 'Layers3' : 'Globe2'} className="size-5" /></span>
      <strong className="line-clamp-2 min-h-10 w-full pr-8 text-sm font-semibold leading-5">{tab.title}</strong>
      <span className="mt-1 w-full truncate text-xs text-muted-foreground">{tabHost(tab.url)}</span>
    </button>
  </article>
  const heading = (title: string) => <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</h3>

  return <section className="fixed inset-0 z-40 flex flex-col bg-background pt-[calc(env(safe-area-inset-top)+1rem)] text-foreground" role="dialog" aria-modal="true" aria-label="Open tabs" data-part="tab-switcher">
    <header className="flex shrink-0 items-center justify-between gap-3 px-4 pb-4"><div className="flex items-center gap-2"><h2 className="text-lg font-semibold">Tabs</h2><span className="rounded-full border border-border px-2 py-0.5 text-xs font-medium text-muted-foreground">{snapshot.workspace.tabs.filter((tab) => !tab.archived).length}</span></div><Tip label="Close tab switcher"><Button variant="ghost" size="touch" className="size-11 p-0" aria-label="Close tab switcher" onClick={onClose}><AppIcon name="X" /></Button></Tip></header>
    <div className="flex shrink-0 gap-2 overflow-x-auto px-4 pb-4">{snapshot.workspace.spaces.map((space) => <Button key={space.id} variant={spaceId === space.id ? 'default' : 'outline'} size="touch" className="h-11 rounded-full px-4" data-active={String(spaceId === space.id)} onClick={() => { setSpaceId(space.id); void api.switchSpace(space.id) }}><AppIcon name={space.icon} />{space.name}</Button>)}<Button variant="outline" size="touch" className="h-11 rounded-full px-4" onClick={() => { const name = window.prompt('New space name'); if (name?.trim()) void api.addSpace(name.trim(), 'Sparkles', cssToken('--ath-space-default-color')).then(setSpaceId) }}><AppIcon name="Plus" />New space</Button></div>
    <div className="min-h-0 flex-1 space-y-6 overflow-y-auto px-4 pb-6">
      {groups.pinned.length > 0 && <section>{heading('Pinned')}<div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4">{groups.pinned.map(card)}</div></section>}
      {groups.folders.filter((entry) => entry.tabs.length).map(({ folder, tabs }) => <section key={folder.id}><h3 className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{folder.name}{folder.auto && <span className="rounded-full border border-border px-1.5 py-0.5 text-[10px] font-normal normal-case">auto</span>}</h3><div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4">{tabs.map(card)}</div></section>)}
      {groups.root.length > 0 && <section>{heading('Open tabs')}<div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4">{groups.root.map(card)}</div></section>}
      {groups.archived.length > 0 && <section>{heading('Archive')}<div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4">{groups.archived.map((tab) => <article key={tab.id} className="min-w-0 rounded-2xl border border-border bg-card p-4" data-part="tab" data-archived="true"><button type="button" className="flex min-h-20 w-full min-w-0 flex-col items-start justify-center text-left" onClick={() => { void api.restoreTab(tab.id); void api.activateTab(tab.id); onClose() }}><strong className="line-clamp-2 text-sm font-semibold">{tab.title}</strong><span className="mt-2 text-xs text-muted-foreground">Restore from archive</span></button></article>)}</div></section>}
    </div>
    <div className="shrink-0 border-t border-border bg-background px-4 pb-[calc(env(safe-area-inset-bottom)+1rem)] pt-3"><Button size="touch" className="w-full" onClick={() => { void api.openTab(); onClose() }}><AppIcon name="Plus" />New tab</Button></div>

    <DialogPrimitive.Root open={contextTab !== null} onOpenChange={(isOpen) => { if (!isOpen) setContextTab(null) }}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/40" />
        <DialogPrimitive.Content ref={setSheetRef} className="fixed inset-x-0 bottom-0 z-50 rounded-t-2xl border-t border-border bg-popover pb-[calc(env(safe-area-inset-bottom)+1rem)] text-popover-foreground shadow-menu outline-none">
          <DialogPrimitive.Title className="sr-only">Tab actions</DialogPrimitive.Title>
          <div className="mx-auto my-3 h-1 w-10 rounded-full bg-muted-foreground/30" aria-hidden="true" />
          {contextTab && <div className="px-4 pb-1" role="menu" aria-label={`Actions for ${contextTab.title}`}>
            <button className="flex h-12 w-full items-center gap-3 rounded-lg px-3 text-left text-base hover:bg-accent" role="menuitem" onClick={() => runContextAction('pin')}><AppIcon name="Layers3" className="size-5" />{contextTab.pinned ? 'Unpin tab' : 'Pin tab'}</button>
            <button className="flex h-12 w-full items-center gap-3 rounded-lg px-3 text-left text-base hover:bg-accent" role="menuitem" onClick={() => runContextAction('mute')}><AppIcon name={contextTab.muted ? 'Volume2' : 'VolumeX'} className="size-5" />{contextTab.muted ? 'Unmute tab' : 'Mute tab'}</button>
            <button className="flex h-12 w-full items-center gap-3 rounded-lg px-3 text-left text-base hover:bg-accent" role="menuitem" onClick={() => runContextAction('duplicate')}><AppIcon name="Copy" className="size-5" />Duplicate tab</button>
            <button className="flex h-12 w-full items-center gap-3 rounded-lg px-3 text-left text-base hover:bg-accent" role="menuitem" onClick={() => runContextAction('split')}><AppIcon name="Split" className="size-5" />Split with active</button>
            <button className="flex h-12 w-full items-center gap-3 rounded-lg px-3 text-left text-base text-destructive hover:bg-accent" role="menuitem" onClick={() => runContextAction('close')}><AppIcon name="X" className="size-5" />Close tab</button>
            <DialogPrimitive.Close className="mt-1 flex h-12 w-full items-center justify-center rounded-lg text-sm text-muted-foreground hover:bg-accent">Cancel</DialogPrimitive.Close>
          </div>}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  </section>
}
