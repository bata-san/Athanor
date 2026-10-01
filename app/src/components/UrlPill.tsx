import { useEffect, useMemo, useState } from 'react'
import { Globe, Lock, Search, Settings, ShieldAlert, ShieldCheck } from 'lucide-react'
import type { Snapshot, Tab } from '@/lib/types'
import { api } from '@/lib/api'
import { useOverlay } from '@/lib/overlay'
import { useHover } from '@/lib/hover'
import { cn } from '@/lib/utils'
import { Button } from './ui/button'
import { Popover, PopoverAnchor, PopoverContent } from './ui/popover'
import { Switch } from './ui/switch'
import { Tip } from './ui/tooltip'

/** Host of the page, or '' for Athanor's own pages. */
export function pathOf(url: string | undefined): string {
  try { const parsed = new URL(url ?? ''); if (parsed.protocol === 'athanor:') return ''; const path = `${parsed.pathname === '/' ? '' : parsed.pathname}${parsed.search}`; return path } catch { return '' }
}

export function hostOf(url: string | undefined): string {
  try { const parsed = new URL(url ?? ''); return parsed.protocol === 'athanor:' ? '' : parsed.host } catch { return '' }
}

/**
 * The address "pill": shows where you are (lock, host, blocked count) and opens the command bar when clicked.
 * It never edits text itself; typing happens in the command bar so there is exactly one place to search.
 */
export function UrlPill({ snapshot, activeTab, onOpen, onSettings, compact = false, className }: { snapshot: Snapshot; activeTab: Tab | null; onOpen: () => void; onSettings: () => void; compact?: boolean; className?: string }) {
  const host = useMemo(() => hostOf(activeTab?.url), [activeTab?.url])
  const path = useMemo(() => pathOf(activeTab?.url), [activeTab?.url])
  const runtime = activeTab ? snapshot.runtime[activeTab.id] : undefined
  const blocked = runtime?.blocked ?? 0
  const [shieldOpen, setShieldOpen] = useState(false)
  const [shieldEnabled, setShieldEnabled] = useState(true)
  useOverlay(shieldOpen, 'shield')
  useEffect(() => { if (shieldOpen && host) void api.getSiteShield(host).then(setShieldEnabled) }, [shieldOpen, host])
  const Lead = !host ? Search : runtime?.secure ? Lock : Globe
  const hovered = useHover((state) => (activeTab ? state.links[activeTab.id] : undefined))
  const zoom = host ? snapshot.settings.siteZoom?.[host.replace(/^www\./, '').replace(/:\d+$/, '').toLowerCase()] : undefined

  return <Popover open={shieldOpen} onOpenChange={setShieldOpen}>
    <PopoverAnchor asChild>
      <div className={cn('group/pill relative flex h-8 min-w-0 items-center overflow-hidden rounded-lg bg-foreground/[0.055] text-[0.8333rem] shadow-[inset_0_0_0_1px_oklch(0_0_0/0.04)] transition-colors hover:bg-foreground/[0.085] max-md:h-11 dark:shadow-[inset_0_0_0_1px_oklch(1_0_0/0.05)]', className)} data-part="omnibox">
        <Tip label="Search or enter address" shortcut="Ctrl+L" side="right" disabled={!compact}>
          <button type="button" className={cn('relative flex h-full min-w-0 flex-1 items-center justify-center gap-1.5 rounded-lg px-7 outline-none focus-visible:ring-2 focus-visible:ring-ring/40', compact && 'px-0')} data-part="omnibox-input" aria-label="Address and search" onClick={onOpen}>
            <Lead className="absolute start-2 size-[0.9333rem] shrink-0 text-muted-foreground" />
            <span className={cn('sb-label min-w-0 truncate text-center', !host && 'text-muted-foreground')}>{hovered ? <span className="font-mono text-[0.7667rem] text-muted-foreground" data-part="hover-link" title={hovered}>{hovered}</span> : host ? <><span className="font-medium text-foreground">{host}</span><span className="font-mono text-[0.7333rem] text-muted-foreground">{path}</span></> : 'Search or enter address'}</span>
          </button>
        </Tip>
        {zoom && !compact && <Tip label="Reset zoom" shortcut="Ctrl+0"><button type="button" className="me-0.5 h-6 shrink-0 rounded-md px-1.5 font-instr text-[0.7333rem] font-medium tabular-nums text-muted-foreground outline-none transition-colors hover:bg-foreground/10 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/40" data-part="zoom-badge" aria-label={`Zoom ${Math.round(zoom * 100)} percent. Reset`} onClick={() => activeTab && void api.zoomPage(activeTab.id, 0)}>{Math.round(zoom * 100)}%</button></Tip>}
        {host && !compact && <Tip label={`${blocked} blocked on this page`}>
          <button type="button" className={cn('me-0.5 flex h-6 shrink-0 items-center gap-1 rounded-md px-1 text-muted-foreground outline-none transition-colors hover:bg-foreground/10 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/40 [&_svg]:size-[1rem]', !shieldEnabled && 'opacity-60')} data-part="shield-badge" aria-label={`${blocked} requests blocked`} onClick={() => setShieldOpen((open) => !open)}>
            {shieldEnabled ? <ShieldCheck /> : <ShieldAlert />}{blocked > 0 && <span className="font-mono text-[0.7333rem] font-medium tabular-nums">{blocked}</span>}
          </button>
        </Tip>}
        {runtime?.loading && <span className="pointer-events-none absolute inset-x-2 bottom-0 h-[2px] overflow-hidden rounded-full" aria-hidden="true"><span className="block h-full w-2/5 rounded-full bg-foreground/70 [animation:ath-indeterminate_1.1s_var(--ease-snap)_infinite]" /></span>}
      </div>
    </PopoverAnchor>
    {host && <PopoverContent align="start" className="w-80" role="dialog" aria-label={`Protection for ${host}`} onOpenAutoFocus={(event) => event.preventDefault()}>
      <div className="flex items-center gap-3">
        <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-secondary [&_svg]:size-[1.2rem]">{shieldEnabled ? <ShieldCheck /> : <ShieldAlert />}</span>
        <div className="min-w-0 flex-1"><h3 className="m-0 truncate text-sm font-semibold">{host}</h3><span className="text-xs text-muted-foreground">{runtime?.secure ? 'Secure connection' : 'Not secure'}</span></div>
        <Switch checked={shieldEnabled} aria-label="Block ads and trackers" onCheckedChange={(enabled) => { setShieldEnabled(enabled); void api.setSiteShield(host, enabled) }} />
      </div>
      <div className="mt-4 grid grid-cols-2 gap-2">
        <div className="rounded-lg border border-border p-3"><strong className="block text-xl font-semibold tabular-nums">{blocked}</strong><span className="text-xs text-muted-foreground">This page</span></div>
        <div className="rounded-lg border border-border p-3"><strong className="block text-xl font-semibold tabular-nums">{snapshot.blockedTotal}</strong><span className="text-xs text-muted-foreground">All time</span></div>
      </div>
      <Button variant="ghost" size="sm" className="mt-3 w-full justify-start text-foreground" onClick={() => { setShieldOpen(false); onSettings() }}><Settings />Protection settings</Button>
    </PopoverContent>}
  </Popover>
}
