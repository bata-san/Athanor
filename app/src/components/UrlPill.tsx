import { useEffect, useMemo, useState } from 'react'
import { Globe, Lock, Search, Settings, ShieldAlert, ShieldCheck } from 'lucide-react'
import type { Snapshot, Tab } from '@/lib/types'
import { api } from '@/lib/api'
import { useOverlay } from '@/lib/overlay'
import { cn } from '@/lib/utils'
import { Button } from './ui/button'
import { Popover, PopoverAnchor, PopoverContent } from './ui/popover'
import { Switch } from './ui/switch'
import { Tip } from './ui/tooltip'

/** Host of the page, or '' for Athanor's own pages. */
export function hostOf(url: string | undefined): string {
  try { const parsed = new URL(url ?? ''); return parsed.protocol === 'athanor:' ? '' : parsed.host } catch { return '' }
}

/**
 * The address "pill": shows where you are (lock, host, blocked count) and opens the command bar when clicked.
 * It never edits text itself; typing happens in the command bar so there is exactly one place to search.
 */
export function UrlPill({ snapshot, activeTab, onOpen, onSettings, compact = false, className }: { snapshot: Snapshot; activeTab: Tab | null; onOpen: () => void; onSettings: () => void; compact?: boolean; className?: string }) {
  const host = useMemo(() => hostOf(activeTab?.url), [activeTab?.url])
  const runtime = activeTab ? snapshot.runtime[activeTab.id] : undefined
  const blocked = runtime?.blocked ?? 0
  const [shieldOpen, setShieldOpen] = useState(false)
  const [shieldEnabled, setShieldEnabled] = useState(true)
  useOverlay(shieldOpen, 'shield')
  useEffect(() => { if (shieldOpen && host) void api.getSiteShield(host).then(setShieldEnabled) }, [shieldOpen, host])
  const Lead = !host ? Search : runtime?.secure ? Lock : Globe

  return <Popover open={shieldOpen} onOpenChange={setShieldOpen}>
    <PopoverAnchor asChild>
      <div className={cn('group/pill flex h-9 min-w-0 items-center rounded-xl bg-foreground/[0.055] text-[13px] transition-colors hover:bg-foreground/[0.085] max-md:h-11', className)} data-part="omnibox">
        <Tip label="Search or enter address" shortcut="Ctrl+L" side="right" disabled={!compact}>
          <button type="button" className={cn('flex h-full min-w-0 flex-1 items-center gap-2 rounded-xl ps-2.5 pe-2 text-start outline-none focus-visible:ring-2 focus-visible:ring-ring/40', compact && 'justify-center px-0')} data-part="omnibox-input" aria-label="Address and search" onClick={onOpen}>
            <Lead className="size-4 shrink-0 text-muted-foreground" />
            <span className={cn('sb-label min-w-0 flex-1 truncate', host ? 'font-medium text-foreground' : 'text-muted-foreground')}>{host || 'Search or enter address'}</span>
          </button>
        </Tip>
        {host && !compact && <Tip label={`${blocked} blocked on this page`}>
          <button type="button" className={cn('me-1 flex h-7 shrink-0 items-center gap-1 rounded-lg px-1.5 text-muted-foreground outline-none transition-colors hover:bg-foreground/10 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/40 [&_svg]:size-4', !shieldEnabled && 'opacity-60')} data-part="shield-badge" aria-label={`${blocked} requests blocked`} onClick={() => setShieldOpen((open) => !open)}>
            {shieldEnabled ? <ShieldCheck /> : <ShieldAlert />}{blocked > 0 && <span className="text-xs font-medium tabular-nums">{blocked}</span>}
          </button>
        </Tip>}
      </div>
    </PopoverAnchor>
    {host && <PopoverContent align="start" className="w-80" role="dialog" aria-label={`Protection for ${host}`} onOpenAutoFocus={(event) => event.preventDefault()}>
      <div className="flex items-center gap-3">
        <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-secondary [&_svg]:size-[18px]">{shieldEnabled ? <ShieldCheck /> : <ShieldAlert />}</span>
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
