import { useCallback, useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import type * as React from 'react'
import * as DialogPrimitive from '@radix-ui/react-dialog'
import { Globe, Loader2, Volume2, VolumeX, X, ZapOff } from 'lucide-react'
import type { Snapshot, Tab, TabRuntime } from '@/lib/types'
import { api } from '@/lib/api'
import { cn } from '@/lib/utils'
import { useOverlay } from '@/lib/overlay'
import { useThumbs } from '@/lib/thumbs'
import { groupSidebarTabs } from '@/lib/sidebarModel'
import { nextIndex } from '@/lib/gridNav'
import { Dialog, DialogDescription, DialogTitle } from './ui/dialog'
import { AthanorMark } from './AthanorMark'

const NAV_KEYS = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End']
/** The cards are born at the middle of the window and settle where they belong; the same curve runs backwards on the way out. */
const EASE_OUT = 'cubic-bezier(0.16, 1, 0.3, 1)'
const EASE_IN = 'cubic-bezier(0.4, 0, 1, 1)'

const reducedMotion = () => document.documentElement.dataset.reduceMotion === 'true' || window.matchMedia('(prefers-reduced-motion: reduce)').matches

function hostOf(url: string) {
  if (url.startsWith('athanor://')) return url.replace('athanor://', '')
  try { return new URL(url).host || url } catch { return url }
}

/** The tabs of the current space in the order the sidebar shows them: pinned, then each folder, then the loose tabs. */
function orderedTabs(snapshot: Snapshot): Tab[] {
  const groups = groupSidebarTabs(snapshot.workspace.tabs, snapshot.workspace.folders, snapshot.workspace.activeSpace)
  return [...groups.pinned, ...groups.folders.flatMap(({ tabs }) => tabs), ...groups.root]
}

/**
 * The tab overview (Ctrl+Space). Nothing but the tabs: each one a picture of its page with its name written on it, laid
 * out over the blurred page. The cards come out of the middle of the window and go back into it. No window, no panel,
 * no controls: click a card to go there, Esc or a click on the empty space to leave, Delete to close the focused tab.
 */
export function TabOverview({ open, onClose, snapshot }: { open: boolean; onClose: () => void; snapshot: Snapshot }) {
  const root = useRef<HTMLDivElement>(null)
  const columns = useRef(1)
  const leaving = useRef(false)
  const images = useThumbs((state) => state.images)
  // Native page views draw above the shell, so they are hidden while the overview is up.
  useOverlay(open, 'tab-overview')
  const tabs = useMemo(() => orderedTabs(snapshot), [snapshot])

  const cards = useCallback(() => Array.from(root.current?.querySelectorAll<HTMLElement>('[data-part="tab-card"]') ?? []), [])
  const centre = () => ({ x: window.innerWidth / 2, y: window.innerHeight / 2 })

  // Arrival: every card starts at the middle of the window, small and clear, and travels to its place. Cards nearest the
  // middle leave first, so the grid unfolds outward from the centre.
  useLayoutEffect(() => {
    if (!open) return
    leaving.current = false
    if (reducedMotion()) return
    const middle = centre()
    const nodes = cards()
    const far = Math.max(1, ...nodes.map((node) => { const box = node.getBoundingClientRect(); return Math.hypot(box.left + box.width / 2 - middle.x, box.top + box.height / 2 - middle.y) }))
    nodes.forEach((node) => {
      const box = node.getBoundingClientRect()
      const dx = middle.x - (box.left + box.width / 2)
      const dy = middle.y - (box.top + box.height / 2)
      const distance = Math.hypot(dx, dy) / far
      node.animate(
        [{ transform: `translate(${dx}px, ${dy}px) scale(0.22)`, opacity: 0 }, { transform: 'translate(0, 0) scale(1)', opacity: 1 }],
        { duration: 520, delay: distance * 90, easing: EASE_OUT, fill: 'backwards' },
      )
    })
    // Only the cards that exist when it opens are staged; later ones (a closed tab sliding away) just appear in place.
  }, [open, cards])

  // Leaving: the cards run back into the middle, quicker than they came, and only then is the overview really closed.
  const leave = useCallback((then?: () => void) => {
    if (leaving.current) return
    leaving.current = true
    const done = () => { onClose(); then?.() }
    if (reducedMotion()) { done(); return }
    const middle = centre()
    const nodes = cards()
    if (!nodes.length) { done(); return }
    let remaining = nodes.length
    nodes.forEach((node) => {
      const box = node.getBoundingClientRect()
      const run = node.animate(
        [{ transform: 'translate(0, 0) scale(1)', opacity: 1 }, { transform: `translate(${middle.x - (box.left + box.width / 2)}px, ${middle.y - (box.top + box.height / 2)}px) scale(0.22)`, opacity: 0 }],
        { duration: 140, easing: EASE_IN, fill: 'forwards' },
      )
      run.onfinish = () => { remaining -= 1; if (remaining === 0) done() }
    })
  }, [cards, onClose])

  // A row is however many cards `auto-fill` decided fit: ask the DOM rather than guess from the window width.
  const measureColumns = useCallback(() => {
    const lefts = new Set(cards().map((node) => Math.round(node.offsetLeft)))
    columns.current = Math.max(1, lefts.size)
  }, [cards])
  useEffect(() => {
    if (!open) return
    const frame = window.requestAnimationFrame(measureColumns)
    window.addEventListener('resize', measureColumns)
    return () => { window.cancelAnimationFrame(frame); window.removeEventListener('resize', measureColumns) }
  }, [open, measureColumns, tabs.length])

  const go = useCallback((tab: Tab) => { void api.activateTab(tab.id); leave() }, [leave])
  const close = useCallback((tab: Tab) => {
    // The card that takes the closed one's place gets the focus, so the walk carries on where it was.
    const at = tabs.findIndex((entry) => entry.id === tab.id)
    const next = tabs[at + 1] ?? tabs[at - 1]
    void api.closeTab(tab.id)
    if (!next) { leave(); return }
    window.setTimeout(() => cards().find((node) => node.dataset.tab === next.id)?.focus(), 30)
  }, [tabs, cards, leave])

  // Focus starts on the current tab.
  const onOpenAutoFocus = (event: Event) => {
    event.preventDefault()
    const nodes = cards()
    const current = nodes.find((node) => node.dataset.active === 'true') ?? nodes[0]
    current?.focus()
  }

  const onKeyDown = (event: React.KeyboardEvent) => {
    const nodes = cards()
    const at = nodes.findIndex((node) => node === document.activeElement)
    if (NAV_KEYS.includes(event.key) && nodes.length) {
      event.preventDefault()
      nodes[nextIndex(at < 0 ? 0 : at, nodes.length, columns.current, event.key)]?.focus()
    } else if ((event.key === 'Delete' || event.key === 'Backspace') && at >= 0) {
      event.preventDefault()
      const tab = tabs.find((entry) => entry.id === nodes[at]!.dataset.tab)
      if (tab) close(tab)
    }
  }

  return <Dialog open={open} onOpenChange={(next) => { if (!next) leave() }}>
    {open && <DialogPrimitive.Portal>
      {/* Only a blur: no tint, no surface. It deepens as the cards arrive. */}
      <DialogPrimitive.Overlay className="fixed inset-0 z-50 animate-[ath-blur-in_420ms_var(--ease-snap)_both]" />
      <DialogPrimitive.Content
        data-part="tab-overview"
        onOpenAutoFocus={onOpenAutoFocus}
        onEscapeKeyDown={(event) => { event.preventDefault(); leave() }}
        aria-describedby={undefined}
        className="fixed inset-0 z-50 text-foreground outline-none"
      >
        <DialogTitle className="sr-only">All Tabs</DialogTitle>
        <DialogDescription className="sr-only">Every open tab as a picture. Arrow keys move, Enter opens, Delete closes, Escape leaves.</DialogDescription>
        <div ref={root} onKeyDown={onKeyDown} onPointerDown={(event) => { if (event.target === event.currentTarget || (event.target as HTMLElement).dataset.part === 'tab-overview-grid') leave() }} className="absolute inset-0 overflow-y-auto overflow-x-hidden">
          <div className="mx-auto flex min-h-full w-full max-w-[76rem] items-center p-8">
            <div data-part="tab-overview-grid" className="grid w-full grid-cols-[repeat(auto-fill,minmax(15rem,1fr))] gap-6">
              {tabs.map((tab) => <TabCard key={tab.id} tab={tab} image={images[tab.id]} runtime={snapshot.runtime[tab.id]} active={tab.id === snapshot.workspace.activeTab} onGo={go} onClose={close} />)}
            </div>
          </div>
        </div>
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>}
  </Dialog>
}

function Favicon({ tab }: { tab: Tab }) {
  if (tab.favicon) return <img src={tab.favicon} alt="" className="size-[1.1rem] shrink-0 rounded-[0.2rem] object-contain" />
  if (tab.url.startsWith('athanor://')) return <AthanorMark className="size-[1.1rem] shrink-0" />
  return <Globe aria-hidden="true" className="size-[1.1rem] shrink-0" />
}

/** A tab: the picture of its page, with its name and address written on the picture itself. */
function TabCard({ tab, image, runtime, active, onGo, onClose }: { tab: Tab; image: string | undefined; runtime: TabRuntime | undefined; active: boolean; onGo: (tab: Tab) => void; onClose: (tab: Tab) => void }) {
  const host = hostOf(tab.url)
  const title = tab.title || host
  const state = [runtime?.loading && 'loading', runtime?.audible && !tab.muted && 'playing audio', tab.muted && 'muted', tab.softwareRendering && 'hardware acceleration off', active && 'current tab'].filter(Boolean).join(', ')
  return <div className="group relative min-w-0">
    <button
      type="button"
      data-part="tab-card"
      data-tab={tab.id}
      data-active={String(active)}
      aria-label={`${title}, ${host}${state ? `, ${state}` : ''}`}
      aria-current={active ? 'page' : undefined}
      onClick={() => onGo(tab)}
      onAuxClick={undefined}
      onPointerDown={(event) => { if (event.button === 1) { event.preventDefault(); event.stopPropagation(); onClose(tab) } else event.stopPropagation() }}
      className={cn('relative block aspect-[16/10] w-full overflow-hidden rounded-2xl bg-card text-start shadow-[0_10px_30px_-10px_oklch(0_0_0/0.45)] outline-none transition-[transform,box-shadow] duration-200 [transition-timing-function:var(--ease-snap)] hover:scale-[1.025] focus-visible:scale-[1.025] focus-visible:ring-2 focus-visible:ring-foreground', active && 'ring-2 ring-foreground/80')}
    >
      {image
        ? <img src={image} alt="" draggable={false} className="absolute inset-0 size-full object-cover object-top" />
        : <span className="absolute inset-0 grid place-items-center bg-gradient-to-br from-muted to-card text-muted-foreground"><span className="[&_svg]:size-10"><Favicon tab={tab} /></span></span>}
      {/* The words are part of the picture: set over it on a soft shade, so they read on any page. */}
      <span className="absolute inset-x-0 bottom-0 flex items-center gap-2 bg-gradient-to-t from-black/75 via-black/45 to-transparent px-3.5 pb-3 pt-10 text-white">
        <Favicon tab={tab} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[0.9333rem] font-semibold leading-tight [text-shadow:0_1px_2px_oklch(0_0_0/0.5)]">{title}</span>
          <span className="block truncate font-mono text-[0.7333rem] leading-tight text-white/75">{host}</span>
        </span>
        {runtime?.loading && <Loader2 aria-hidden="true" className="size-4 shrink-0 animate-spin" />}
        {runtime?.audible && !tab.muted && <Volume2 aria-hidden="true" className="size-4 shrink-0" />}
        {tab.muted && <VolumeX aria-hidden="true" className="size-4 shrink-0" />}
        {tab.softwareRendering && <ZapOff aria-hidden="true" className="size-4 shrink-0" />}
      </span>
    </button>
    <button
      type="button"
      data-part="tab-card-close"
      aria-label={`Close ${title}`}
      onPointerDown={(event) => event.stopPropagation()}
      onClick={() => onClose(tab)}
      className="absolute end-2.5 top-2.5 grid size-7 place-items-center rounded-full bg-black/55 text-white opacity-0 outline-none backdrop-blur transition-opacity group-hover:opacity-100 focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-white"
    ><X aria-hidden="true" className="size-4" /></button>
  </div>
}
