import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type * as React from 'react'
import * as DialogPrimitive from '@radix-ui/react-dialog'
import { Globe, Loader2, Plus, Search, Volume2, VolumeX, X, ZapOff } from 'lucide-react'
import { AnimatePresence, m } from 'motion/react'
import type { Snapshot, Tab, TabRuntime } from '@/lib/types'
import { api } from '@/lib/api'
import { cn } from '@/lib/utils'
import { enter } from '@/lib/motion'
import { useOverlay } from '@/lib/overlay'
import { useThumbs } from '@/lib/thumbs'
import { groupSidebarTabs } from '@/lib/sidebarModel'
import { nextIndex } from '@/lib/gridNav'
import { Dialog, DialogDescription, DialogTitle } from './ui/dialog'
import { Button } from './ui/button'
import { Input } from './ui/input'
import { Tip } from './ui/tooltip'
import { AthanorMark } from './AthanorMark'

/** Cards arrive one after another, but only for the first handful: past that they all come in together. */
const STAGGERED = 8
const entrance = (position: number) => ({ ...enter, delay: Math.min(position, STAGGERED) * 0.02 })

const NAV_KEYS = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End']

function hostOf(url: string) {
  if (url.startsWith('athanor://')) return url.replace('athanor://', '')
  try { return new URL(url).host || url } catch { return url }
}

type Item = { kind: 'header'; key: string; label: string } | { kind: 'card'; key: string; tab: Tab }

/**
 * Everything the grid shows, in sidebar order: pinned, then each folder under its name, then the loose tabs.
 * Group headers that would say nothing (an empty folder, "Pinned" while every space is on screen) are left out.
 */
function overviewItems(snapshot: Snapshot, scope: 'space' | 'all', visible: (tab: Tab) => boolean): Item[] {
  const spaces = scope === 'all' ? snapshot.workspace.spaces : snapshot.workspace.spaces.filter((space) => space.id === snapshot.workspace.activeSpace)
  const items: Item[] = []
  for (const space of spaces) {
    const groups = groupSidebarTabs(snapshot.workspace.tabs, snapshot.workspace.folders, space.id)
    const rows = [
      { key: 'pinned', label: 'Pinned', tabs: groups.pinned.filter(visible) },
      ...groups.folders.map(({ folder, tabs }) => ({ key: `folder-${folder.id}`, label: folder.name, tabs: tabs.filter(visible) })),
      { key: 'loose', label: 'Open Tabs', tabs: groups.root.filter(visible) },
    ]
    const filled = rows.filter((row) => row.tabs.length)
    if (!filled.length) continue
    if (scope === 'all') items.push({ kind: 'header', key: `space-${space.id}`, label: space.name })
    for (const row of filled) {
      if (scope === 'all' && row.key === 'pinned') { for (const tab of row.tabs) items.push({ kind: 'card', key: tab.id, tab }); continue }
      items.push({ kind: 'header', key: `${space.id}-${row.key}`, label: row.label })
      for (const tab of row.tabs) items.push({ kind: 'card', key: tab.id, tab })
    }
  }
  return items
}

/**
 * The tab overview (Ctrl+Space): every open tab as a picture, in the order the sidebar shows them.
 * Modal, keyboard-first, and it moves nothing while you are only looking at it.
 */
export function TabOverview({ open, onClose, snapshot }: { open: boolean; onClose: () => void; snapshot: Snapshot }) {
  const [scope, setScope] = useState<'space' | 'all'>('space')
  const [query, setQuery] = useState('')
  const [panel, setPanel] = useState<{ left: number; top: number; width: number; height: number } | null>(null)
  const root = useRef<HTMLDivElement>(null)
  const field = useRef<HTMLInputElement>(null)
  const columns = useRef(1)
  const carry = useRef<string | null>(null)
  const images = useThumbs((state) => state.images)
  // Native page views draw above the shell, so they are hidden while the overview is up.
  useOverlay(open, 'tab-overview')
  // Each time in is a fresh look: the search and the scope start where they always start.
  useEffect(() => { if (!open) { setQuery(''); setScope('space') } }, [open])

  const words = useMemo(() => query.trim().toLowerCase().split(/\s+/).filter(Boolean), [query])
  const items = useMemo(() => overviewItems(snapshot, scope, (tab) => {
    if (!words.length) return true
    // Case-insensitive, and every word has to be somewhere in the title or the address.
    const haystack = `${tab.title} ${tab.url}`.toLowerCase()
    return words.every((word) => haystack.includes(word))
  }), [snapshot, scope, words])
  const tabs = useMemo(() => items.filter((item): item is Extract<Item, { kind: 'card' }> => item.kind === 'card').map((item) => item.tab), [items])
  const total = scope === 'all'
    ? snapshot.workspace.tabs.filter((tab) => !tab.archived).length
    : snapshot.workspace.tabs.filter((tab) => tab.space === snapshot.workspace.activeSpace && !tab.archived).length

  // The grid sits exactly over the page card: the overview reads as the page, not as a popup on top of it.
  useLayoutEffect(() => {
    if (!open) { setPanel(null); return }
    const content = document.querySelector<HTMLElement>('[data-part="content"]')
    if (!content) return
    const measure = () => {
      const box = content.getBoundingClientRect()
      // A card that floats over the page, not a second page: inset from the page edges, never wider than ~76rem.
      const rem = parseFloat(getComputedStyle(document.documentElement).fontSize) || 15
      const pad = 1.5 * rem
      const width = Math.min(box.width - 2 * pad, 76 * rem)
      setPanel({ left: box.left + (box.width - width) / 2, top: box.top + pad, width, height: box.height - 2 * pad })
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(content)
    window.addEventListener('resize', measure)
    return () => { observer.disconnect(); window.removeEventListener('resize', measure) }
  }, [open])

  // A row is however many cards `auto-fill` decided fit: ask the DOM rather than guess from the window width.
  const measureColumns = useCallback(() => {
    const grid = root.current?.querySelector('[data-part="tab-overview-grid"]')
    if (!grid) return
    const base = grid.getBoundingClientRect().left
    const lefts = new Set([...grid.querySelectorAll<HTMLElement>('[data-part="tab-card"]')].map((node) => Math.round(node.getBoundingClientRect().left - base)))
    columns.current = Math.max(1, lefts.size)
  }, [])
  useEffect(() => {
    if (!open) return
    const frame = window.requestAnimationFrame(measureColumns)
    const observer = new ResizeObserver(measureColumns)
    if (root.current) observer.observe(root.current)
    return () => { window.cancelAnimationFrame(frame); observer.disconnect() }
  }, [open, measureColumns, tabs.length])

  // Where the cards are in the walk, in the order they are on screen (the New Tab card is the last one).
  const nodes = useCallback(() => Array.from(root.current?.querySelectorAll<HTMLElement>('[data-part="tab-card"],[data-part="tab-card-new"]') ?? []), [])
  const position = useCallback(() => {
    const active = document.activeElement
    return nodes().findIndex((node) => node === active || node.contains(active))
  }, [nodes])

  const activate = useCallback((tab: Tab) => { void api.activateTab(tab.id); onClose() }, [onClose])
  const newTab = useCallback(() => { void api.openTab(); onClose() }, [onClose])
  const closeTab = useCallback((tab: Tab) => {
    // The card that takes the closed one's place gets the focus, so the walk carries on where it was.
    const at = tabs.findIndex((entry) => entry.id === tab.id)
    carry.current = at < 0 ? null : (tabs[at + 1]?.id ?? (at > 0 ? tabs[at - 1]!.id : 'new'))
    void api.closeTab(tab.id)
  }, [tabs])
  useEffect(() => {
    // By tab, not by place: the closing card is still in the DOM while it fades out.
    const id = carry.current
    if (id === null) return
    carry.current = null
    const selector = id === 'new' ? '[data-part="tab-card-new"]' : `[data-part="tab-card"][data-tab="${CSS.escape(id)}"]`
    root.current?.querySelector<HTMLElement>(selector)?.focus()
  }, [tabs.length])

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.defaultPrevented || event.target === field.current) return
    const here = position()
    if ((event.key === 'Delete' || event.key === 'Backspace') && here >= 0 && here < tabs.length) {
      event.preventDefault()
      closeTab(tabs[here]!)
      return
    }
    if (NAV_KEYS.includes(event.key)) {
      if (here < 0) return
      const all = nodes()
      const next = nextIndex(here, all.length, columns.current, event.key)
      if (next < 0 || next === here) return
      event.preventDefault()
      all[next]?.focus()
      return
    }
    // Any printable key starts a search instead of doing nothing.
    if (event.key.length === 1 && !event.ctrlKey && !event.altKey && !event.metaKey) {
      event.preventDefault()
      setQuery((value) => value + event.key)
      field.current?.focus()
    }
  }

  // Opening focuses the tab you are looking at; the dialog hands focus back when it closes.
  const onOpenAutoFocus = (event: Event) => {
    event.preventDefault()
    const all = nodes()
    const wanted = all.find((node) => node.dataset.tab === snapshot.workspace.activeTab)
    const target = wanted ?? all[0]
    target?.focus()
    target?.scrollIntoView({ block: 'nearest' })
  }

  return <Dialog open={open} onOpenChange={(next) => { if (!next) onClose() }}>
    {open && <DialogPrimitive.Portal>
      <m.div aria-hidden="true" className="fixed inset-0 z-50 backdrop-blur-2xl" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.22, ease: [0.2, 0.9, 0.25, 1] }} />
      <DialogPrimitive.Content
        data-part="tab-overview"
        style={panel ?? { inset: '0.5rem' }}
        onOpenAutoFocus={onOpenAutoFocus}
        className="fixed z-50 flex animate-[ath-float_260ms_var(--ease-snap)_both] flex-col text-foreground outline-none"
      >
        <DialogTitle className="sr-only">All Tabs</DialogTitle>
        <DialogDescription className="sr-only">Every open tab as a picture. Type to search, use the arrow keys to move, Enter to open, Delete to close.</DialogDescription>

        <header className="flex shrink-0 flex-wrap items-center gap-2 px-6 pb-3 pt-1">
          <div className="relative min-w-[11rem] flex-1">
            <Search aria-hidden="true" className="pointer-events-none absolute start-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input ref={field} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search Tabs" aria-label="Search tabs" spellCheck={false} autoComplete="off" className="bg-popover/85 ps-8 shadow-sm backdrop-blur-xl" />
          </div>
          <span aria-live="polite" className="shrink-0 rounded-full bg-popover/85 px-2.5 py-1 font-instr text-[0.7333rem] tabular-nums text-muted-foreground shadow-sm backdrop-blur-xl">{tabs.length === total ? `${total}` : `${tabs.length} of ${total}`}</span>
          {snapshot.workspace.spaces.length > 1 && <div role="radiogroup" aria-label="Tab scope" className="flex shrink-0 gap-0.5 rounded-lg bg-popover/85 p-0.5 shadow-sm backdrop-blur-xl">
            {([['space', 'This Space'], ['all', 'All Spaces']] as const).map(([value, label]) => <button key={value} type="button" role="radio" aria-checked={scope === value}
              className={cn('h-7 rounded-md px-2.5 text-[0.8667rem] font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring/40', scope === value ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground')}
              onClick={() => setScope(value)}>{label}</button>)}
          </div>}
          <Tip label="Close" shortcut="Esc"><Button variant="ghost" size="icon-sm" aria-label="Close tab overview" className="shrink-0 rounded-full bg-popover/85 shadow-sm backdrop-blur-xl" onClick={onClose}><X /></Button></Tip>
        </header>

        <div ref={root} onKeyDown={onKeyDown} className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden outline-none [mask-image:linear-gradient(to_bottom,transparent,black_1rem,black_calc(100%_-_1.5rem),transparent)]">
          <div className="mx-auto flex w-full max-w-[80rem] flex-col gap-3 p-6">
            {!tabs.length && <p className="m-0 mx-auto rounded-full bg-popover/85 px-4 py-2 text-center text-[0.8667rem] text-muted-foreground shadow-sm backdrop-blur-xl">{words.length ? `No tabs match “${query.trim()}”.` : scope === 'all' ? 'No open tabs.' : 'No open tabs in this space.'}</p>}
            <div data-part="tab-overview-grid" className="relative grid grid-cols-[repeat(auto-fill,minmax(14rem,1fr))] gap-4">
              <AnimatePresence mode="popLayout">
                {items.map((item) => item.kind === 'header'
                  ? <m.h3 key={item.key} layout transition={enter} className="col-span-full m-0 w-fit rounded-full bg-popover/85 px-2.5 py-1 text-[0.7333rem] font-semibold uppercase tracking-wide text-muted-foreground shadow-sm backdrop-blur-xl">{item.label}</m.h3>
                  : <m.div
                    key={item.key}
                    layout
                    transition={enter}
                    initial={{ opacity: 0, scale: 0.97, transition: entrance(tabs.indexOf(item.tab)) }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.97, transition: { duration: 0.12 } }}
                    className="group relative min-w-0"
                  >
                    <TabCard
                      tab={item.tab}
                      image={images[item.tab.id]}
                      runtime={snapshot.runtime[item.tab.id]}
                      active={item.tab.id === snapshot.workspace.activeTab}
                      onActivate={activate}
                      onClose={closeTab}
                    />
                  </m.div>)}
              </AnimatePresence>
              <m.div layout transition={enter} initial={{ opacity: 0, scale: 0.97 }} animate={{ opacity: 1, scale: 1 }} className="min-w-0">
                <button
                  type="button"
                  data-part="tab-card-new"
                  onClick={newTab}
                  className="flex aspect-[16/10] w-full min-w-0 flex-col items-center justify-center gap-1 rounded-xl border border-dashed border-foreground/30 bg-popover/60 text-muted-foreground shadow-sm outline-none backdrop-blur-xl transition-colors hover:border-foreground/50 hover:bg-accent/40 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/40"
                >
                  <Plus aria-hidden="true" className="size-6" />
                  <span className="text-[0.8667rem] font-medium">New Tab</span>
                </button>
              </m.div>
            </div>
          </div>
        </div>
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>}
  </Dialog>
}

function Favicon({ tab, size }: { tab: Tab; size: 'sm' | 'lg' }) {
  if (tab.favicon) return <img src={tab.favicon} alt="" className={cn('rounded-[0.2rem] object-contain', size === 'lg' ? 'size-8' : 'size-[1rem]')} />
  if (tab.url.startsWith('athanor://')) return <AthanorMark className={size === 'lg' ? 'size-8' : 'size-[1rem]'} />
  return <Globe aria-hidden="true" className={cn('text-muted-foreground', size === 'lg' ? 'size-9' : 'size-[1rem]')} />
}

/** A tab as a picture of its page, its name and where it lives, plus what the tab is doing right now. */
function TabCard({ tab, image, runtime, active, onActivate, onClose }: {
  tab: Tab; image: string | undefined; runtime: TabRuntime | undefined; active: boolean
  onActivate: (tab: Tab) => void; onClose: (tab: Tab) => void
}) {
  const host = hostOf(tab.url)
  // The badges are pictures, so what they mean goes in the card's name: a screen reader hears "Muted" too.
  const badges = [
    runtime?.loading ? 'Loading' : null,
    tab.muted ? 'Muted' : runtime?.audible ? 'Playing audio' : null,
    tab.softwareRendering ? 'Hardware acceleration is off' : null,
  ].filter(Boolean)
  return <>
    <button
      type="button"
      data-part="tab-card"
      data-tab={tab.id}
      data-active={String(active)}
      aria-current={active ? 'page' : undefined}
      aria-label={`${tab.title || host} — ${host}${badges.length ? ` (${badges.join(', ')})` : ''}`}
      onClick={() => onActivate(tab)}
      // A middle click closes the tab, the same as the X. WebView2 fires no `auxclick` on a plain button,
      // so watch the pointer instead.
      onPointerDown={(event) => { if (event.button === 1) { event.preventDefault(); onClose(tab) } }}
      className={cn(
        'flex w-full min-w-0 flex-col overflow-hidden rounded-xl border bg-card text-start shadow-md outline-none transition-[border-color,box-shadow] focus-visible:ring-2 focus-visible:ring-ring/40',
        active ? 'border-primary shadow-[inset_0_0_0_1px_var(--primary)]' : 'border-border hover:border-foreground/25',
      )}
    >
      <span className="relative block aspect-[16/10] w-full overflow-hidden bg-muted">
        {image ? <img src={image} alt="" draggable={false} className="size-full object-cover object-top" />
          : <span className="grid size-full place-items-center"><Favicon tab={tab} size="lg" /></span>}
        {active && <span data-part="tab-card-active" aria-hidden="true" className="absolute end-2 top-2 size-2.5 rounded-full bg-primary ring-2 ring-popover" />}
      </span>
      <span className="flex min-w-0 items-center gap-2 p-2">
        <Favicon tab={tab} size="sm" />
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-[0.8667rem] font-medium leading-4">{tab.title || host}</span>
          <span className="truncate font-instr text-[0.7333rem] leading-4 text-muted-foreground">{host}</span>
        </span>
        <span aria-hidden="true" className="flex shrink-0 items-center gap-1 text-muted-foreground">
          {runtime?.loading && <Loader2 data-part="tab-card-loading" className="size-3.5 animate-spin" />}
          {tab.muted ? <VolumeX data-part="tab-card-muted" className="size-3.5" /> : runtime?.audible ? <Volume2 data-part="tab-card-audible" className="size-3.5" /> : null}
          {tab.softwareRendering && <ZapOff data-part="tab-card-software" className="size-3.5" />}
        </span>
      </span>
    </button>
    <button
      type="button"
      data-part="tab-card-close"
      aria-label={`Close ${tab.title}`}
      onClick={() => onClose(tab)}
      className="absolute start-2 top-2 grid size-6 place-items-center rounded-md bg-popover/85 text-foreground opacity-0 shadow-sm outline-none backdrop-blur transition-opacity focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring/40 group-hover:opacity-100 group-focus-within:opacity-100"
    ><X aria-hidden="true" className="size-3.5" /></button>
  </>
}