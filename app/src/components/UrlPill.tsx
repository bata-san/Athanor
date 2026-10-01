import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { Check, Copy, Globe, Lock, Search, Settings, ShieldAlert, ShieldCheck } from 'lucide-react'
import { toast } from 'sonner'
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
 * The address "pill": shows where you are (lock, host, blocked count, zoom) and opens the command bar when clicked.
 * It never edits text itself; typing happens in the command bar so there is exactly one place to search. The button
 * keeps its name short and carries the real address, the connection and the page state as its description, so a
 * screen reader hears where it is going without seeing the pill.
 */
export function UrlPill({ snapshot, activeTab, onOpen, onSettings, className }: { snapshot: Snapshot; activeTab: Tab | null; onOpen: () => void; onSettings: () => void; className?: string }) {
  const host = useMemo(() => hostOf(activeTab?.url), [activeTab?.url])
  const path = useMemo(() => pathOf(activeTab?.url), [activeTab?.url])
  const runtime = activeTab ? snapshot.runtime[activeTab.id] : undefined
  const blocked = runtime?.blocked ?? 0
  const loading = runtime?.loading ?? false
  const [shieldOpen, setShieldOpen] = useState(false)
  const [shieldEnabled, setShieldEnabled] = useState(true)
  const [copied, setCopied] = useState(false)
  const copyTimer = useRef(0)
  const describedBy = useId()
  const protectionId = `${describedBy}-protection`
  useOverlay(shieldOpen, 'shield')
  useEffect(() => { if (shieldOpen && host) void api.getSiteShield(host).then(setShieldEnabled) }, [shieldOpen, host])
  useEffect(() => () => window.clearTimeout(copyTimer.current), [])
  const Lead = !host ? Search : runtime?.secure ? Lock : Globe
  const hovered = useHover((state) => (activeTab ? state.links[activeTab.id] : undefined))
  const zoom = host ? snapshot.settings.siteZoom?.[host.replace(/^www\./, '').replace(/:\d+$/, '').toLowerCase()] : undefined

  const copyAddress = () => {
    const url = activeTab?.url ?? ''
    if (!url) return
    window.clearTimeout(copyTimer.current)
    setCopied(true)
    copyTimer.current = window.setTimeout(() => setCopied(false), 1600)
    const clipboard = navigator.clipboard
    if (clipboard) void clipboard.writeText(url).catch(() => toast('Could not copy the address'))
    else toast('Could not copy the address')
  }
  const blockedLabel = `${blocked} ${blocked === 1 ? 'request' : 'requests'} blocked on this page`
  const shieldLabel = !shieldEnabled ? 'Protection is off for this site' : blocked ? blockedLabel : 'Nothing blocked on this page'
  const description = !host ? 'No page is open'
    : hovered ? `${hovered}, the link under the pointer`
      : `${host}${path}, ${runtime?.secure ? 'secure connection' : 'connection is not secure'}${blocked ? `, ${blockedLabel}` : ''}${loading ? ', loading' : ''}`

  return <Popover open={shieldOpen} onOpenChange={setShieldOpen}>
    <PopoverAnchor asChild>
      <div className={cn('group/pill relative flex h-8 min-w-0 items-center overflow-hidden rounded-lg bg-foreground/[0.055] text-[0.8333rem] shadow-[inset_0_0_0_1px_oklch(0_0_0/0.04)] transition-colors hover:bg-foreground/[0.085] max-md:h-11 dark:shadow-[inset_0_0_0_1px_oklch(1_0_0/0.05)]', className)} data-part="omnibox">
        <Tip label="Search or enter address" shortcut="Ctrl+L" side="right">
          <button type="button" className="relative flex h-full min-w-0 flex-1 items-center justify-center gap-1.5 rounded-lg px-7 outline-none focus-visible:ring-2 focus-visible:ring-ring/40" data-part="omnibox-input" aria-label="Address and search" aria-describedby={describedBy} aria-busy={loading} onClick={onOpen}>
            <Lead aria-hidden="true" className="absolute start-2 size-[0.9333rem] shrink-0 text-muted-foreground" />
            <span className={cn('sb-label flex w-full min-w-0 items-center justify-center', !host && 'text-muted-foreground')}>
              {hovered ? <span className="min-w-0 truncate font-mono text-[0.7667rem] text-muted-foreground" data-part="hover-link" title={hovered}>{hovered}</span>
                : host ? <><span className="max-w-[60%] shrink-0 truncate font-medium text-foreground">{host}</span>{path && <span className="min-w-0 truncate font-mono text-[0.7333rem] text-muted-foreground">{path}</span>}</>
                  : 'Search or enter address'}
              <span id={describedBy} className="sr-only">{description}</span>
            </span>
          </button>
        </Tip>
        {zoom && <Tip label="Reset zoom" shortcut="Ctrl+0"><button type="button" className="me-0.5 h-6 shrink-0 rounded-md px-1.5 font-instr text-[0.7333rem] font-medium tabular-nums text-muted-foreground outline-none transition-colors hover:bg-foreground/10 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/40" data-part="zoom-badge" aria-label={`Page zoom ${Math.round(zoom * 100)} percent. Reset to 100%`} onClick={() => activeTab && void api.zoomPage(activeTab.id, 0)}>{Math.round(zoom * 100)}%</button></Tip>}
        {host && <Tip label={shieldLabel} side="bottom"><button type="button" className={cn('me-0.5 flex h-6 shrink-0 items-center gap-1 rounded-md px-1 text-muted-foreground outline-none transition-colors hover:bg-foreground/10 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/40 [&_svg]:size-[1rem]', !shieldEnabled && 'opacity-60')} data-part="shield-badge" aria-label={`${blockedLabel}. Protection settings`} onClick={() => setShieldOpen((open) => !open)}>{shieldEnabled ? <ShieldCheck aria-hidden="true" /> : <ShieldAlert aria-hidden="true" />}{blocked > 0 && <span className="font-mono text-[0.7333rem] font-medium tabular-nums">{blocked}</span>}</button></Tip>}
        {host && <Tip label={copied ? 'Address copied' : 'Copy page address'} side="bottom"><button type="button" className="me-0.5 grid size-6 shrink-0 place-items-center rounded-md text-muted-foreground outline-none transition-colors hover:bg-foreground/10 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/40 [&_svg]:size-[1rem]" data-part="copy-address" aria-label={copied ? 'Address copied' : 'Copy page address'} onClick={copyAddress}>{copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}</button></Tip>}
        {loading && <span className="pointer-events-none absolute inset-x-2 bottom-0 h-[2px] overflow-hidden rounded-full" aria-hidden="true"><span className="block h-full w-2/5 rounded-full bg-foreground/70 [animation:ath-indeterminate_1.1s_var(--ease-snap)_infinite]" /></span>}
      </div>
    </PopoverAnchor>
    {host && <PopoverContent align="start" className="w-80" role="dialog" aria-label={`Protection for ${host}`} onOpenAutoFocus={(event) => event.preventDefault()}>
      <div className="flex items-center gap-3">
        <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-secondary [&_svg]:size-[1.2rem]">{shieldEnabled ? <ShieldCheck /> : <ShieldAlert />}</span>
        <div className="min-w-0 flex-1">
          <h3 className="m-0 truncate text-sm font-semibold" title={`${host}${path}`}>{host}</h3>
          <span className="block truncate font-mono text-[0.7333rem] text-muted-foreground">{path || '/'}</span>
        </div>
        <Switch checked={shieldEnabled} aria-label="Block ads and trackers" aria-describedby={protectionId} onCheckedChange={(enabled) => { setShieldEnabled(enabled); void api.setSiteShield(host, enabled) }} />
      </div>
      <p id={protectionId} className="m-0 mt-2 text-xs text-muted-foreground">{runtime?.secure ? 'Secure connection' : 'Not secure'} · {shieldEnabled ? 'Protection is on for this site' : 'Protection is off for this site'}</p>
      <div className="mt-4 grid grid-cols-2 gap-2">
        <div className="rounded-lg border border-border p-3"><strong className="block text-xl font-semibold tabular-nums">{blocked}</strong><span className="text-xs text-muted-foreground">on this page</span></div>
        <div className="rounded-lg border border-border p-3"><strong className="block text-xl font-semibold tabular-nums">{snapshot.blockedTotal}</strong><span className="text-xs text-muted-foreground">all time</span></div>
      </div>
      <Button variant="ghost" size="sm" className="mt-3 w-full justify-start text-foreground" onClick={() => { setShieldOpen(false); onSettings() }}><Settings aria-hidden="true" />Protection settings</Button>
    </PopoverContent>}
  </Popover>
}
