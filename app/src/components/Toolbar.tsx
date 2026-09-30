import { useEffect, useMemo, useState } from 'react'
import type * as React from 'react'
import type { RefObject } from 'react'
import type { Snapshot, Suggestion, Tab } from '@/lib/types'
import { api } from '@/lib/api'
import { AppIcon } from './Icons'
import { Input } from './ui/input'

type Page = 'settings' | 'boards' | 'extensions'
type Props = { snapshot: Snapshot; activeTab: Tab | null; omniboxRef: RefObject<HTMLInputElement | null>; openPalette: () => void; openPage: (page: Page) => void; toggleDev: () => void; onOverlay: (open: boolean) => void }
export function Toolbar({ snapshot, activeTab, omniboxRef, openPalette, openPage, toggleDev, onOverlay }: Props) {
  return <div className="toolbar" data-part="toolbar"><div className="toolbar-navigation">
    <IconAction title="Back (Alt+Left)" onClick={() => activeTab && api.goBack(activeTab.id)} disabled={!activeTab || !snapshot.runtime[activeTab.id]?.canGoBack}><AppIcon name="ArrowLeft" /></IconAction>
    <IconAction title="Forward (Alt+Right)" onClick={() => activeTab && api.goForward(activeTab.id)} disabled={!activeTab || !snapshot.runtime[activeTab.id]?.canGoForward}><AppIcon name="ArrowRight" /></IconAction>
    <IconAction title={snapshot.runtime[activeTab?.id ?? '']?.loading ? 'Stop loading' : 'Reload'} onClick={() => activeTab && (snapshot.runtime[activeTab.id]?.loading ? api.stop(activeTab.id) : api.reload(activeTab.id))}><AppIcon name={snapshot.runtime[activeTab?.id ?? '']?.loading ? 'X' : 'RotateCw'} /></IconAction>
  </div><Omnibox snapshot={snapshot} activeTab={activeTab} inputRef={omniboxRef} onOverlay={onOverlay} /><span className="toolbar-spacer" />
    <button className="icon-button" data-part="nav-button" title="Split view" aria-label="Split view" onClick={() => { const next = snapshot.workspace.tabs.find((tab) => tab.id !== activeTab?.id && tab.space === snapshot.workspace.activeSpace && !tab.archived); if (snapshot.workspace.split) void api.unsplit(); else if (next) void api.splitWith({ tab: next.id, dir: 'row' }) }}><AppIcon name="Split" /></button>
    <button className="icon-button" data-part="nav-button" title="Developer panel (Ctrl+Shift+D)" aria-label="Developer panel" onClick={toggleDev}><AppIcon name="Terminal" /></button>
    <button className="icon-button" data-part="nav-button" title="Reference boards" aria-label="Reference boards" onClick={() => openPage('boards')}><AppIcon name="PanelsTopLeft" /></button>
    <button className="icon-button" data-part="nav-button" title="Settings" aria-label="Settings" onClick={() => openPage('settings')}><AppIcon name="Settings" /></button>
    <button className="icon-button" data-part="nav-button" title="Command palette (Ctrl+K)" aria-label="Command palette" onClick={openPalette}><AppIcon name="Command" /></button>
  </div>
}
export function MobileBar({ snapshot, activeTab, omniboxRef, openSwitcher, openPalette, onOverlay }: { snapshot: Snapshot; activeTab: Tab | null; omniboxRef: RefObject<HTMLInputElement | null>; openSwitcher: () => void; openPalette: () => void; onOverlay: (open: boolean) => void }) {
  return <div className="mobile-topbar" data-part="toolbar"><Omnibox snapshot={snapshot} activeTab={activeTab} inputRef={omniboxRef} mobile onOverlay={onOverlay} /><button className="icon-button" data-part="nav-button" aria-label="Open tabs" onClick={openSwitcher}><AppIcon name="PanelsTopLeft" /></button><button className="icon-button" data-part="nav-button" aria-label="Menu" onClick={openPalette}><AppIcon name="Menu" /></button></div>
}
function Omnibox({ snapshot, activeTab, inputRef, mobile = false, onOverlay }: { snapshot: Snapshot; activeTab: Tab | null; inputRef: RefObject<HTMLInputElement | null>; mobile?: boolean; onOverlay: (open: boolean) => void }) {
  const [value, setValue] = useState('')
  const [focused, setFocused] = useState(false)
  const [suggestions, setSuggestions] = useState<Suggestion[]>([])
  const [shieldOpen, setShieldOpen] = useState(false)
  const [shieldEnabled, setShieldEnabled] = useState(true)
  const activeHost = useMemo(() => { try { return new URL(activeTab?.url ?? '').host } catch { return '' } }, [activeTab?.url])
  const runtime = activeTab ? snapshot.runtime[activeTab.id] : undefined
  useEffect(() => { setValue('') }, [activeTab?.id])
  useEffect(() => {
    if (!focused || !value.trim()) { setSuggestions([]); return }
    const timer = window.setTimeout(() => { void api.omniboxSuggest(value).then(setSuggestions) }, 60)
    return () => window.clearTimeout(timer)
  }, [focused, value])
  useEffect(() => { onOverlay(focused && suggestions.length > 0 || shieldOpen) }, [focused, suggestions.length, shieldOpen, onOverlay])
  useEffect(() => { if (shieldOpen && activeHost) void api.getSiteShield(activeHost).then(setShieldEnabled) }, [shieldOpen, activeHost])
  const navigate = (input = value) => {
    if (!input.trim()) return
    if (activeTab) void api.navigate(activeTab.id, input); else void api.openTab({ url: input })
    setFocused(false); setSuggestions([]); setValue('')
  }
  const selectSuggestion = (item: Suggestion) => { if (item.tab) void api.activateTab(item.tab); else if (item.url) navigate(item.url); setFocused(false); setSuggestions([]); setValue('') }
  const blocked = runtime?.blocked ?? 0
  return <div className={`omnibox-wrap ${mobile ? 'omnibox-wrap-mobile' : ''}`} data-part="omnibox">
    <div className="omnibox">
      <button className="omnibox-button" aria-label="Connection security" title={runtime?.secure ? 'Secure connection' : 'Connection'} onClick={() => activeHost && setShieldOpen((open) => !open)}><AppIcon name={runtime?.secure ? 'LockKeyhole' : 'Globe2'} /></button>
      <Input ref={inputRef} className="omnibox-input" data-part="omnibox-input" aria-label="Address and search" value={value} placeholder={activeHost || 'Search or enter address'} onFocus={() => setFocused(true)} onBlur={() => window.setTimeout(() => setFocused(false), 140)} onChange={(event) => setValue(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); navigate() } if (event.key === 'Escape') { setValue(''); setFocused(false); inputRef.current?.blur() } }} />
      {activeHost && <button className="shield-counter" data-part="shield-badge" aria-label={`${blocked} requests blocked`} title={`${blocked} requests blocked`} onClick={() => setShieldOpen((open) => !open)}><AppIcon name="ShieldCheck" />{blocked > 0 && <span>{blocked}</span>}</button>}
    </div>
    {focused && suggestions.length > 0 && <div className="omnibox-suggestions" role="listbox">{suggestions.map((item, index) => <button key={`${item.kind}-${index}`} role="option" aria-selected="false" className="omnibox-suggestion" onMouseDown={(event) => event.preventDefault()} onClick={() => selectSuggestion(item)}><AppIcon name={item.kind === 'tab' ? 'PanelsTopLeft' : item.kind === 'search' ? 'Search' : 'Globe2'} /><span><strong>{item.title}</strong><small>{item.subtitle}</small></span></button>)}</div>}
    {shieldOpen && activeHost && <div className="popover-card shield-popover" role="dialog" aria-label={`Protection for ${activeHost}`}>
      <div className="shield-popover-head"><span className="shield-popover-icon"><AppIcon name={shieldEnabled ? 'ShieldCheck' : 'ShieldAlert'} /></span><div><h3>{activeHost}</h3><span className="muted-copy">Site protection</span></div><button className="icon-button" aria-label="Close protection details" onClick={() => setShieldOpen(false)}><AppIcon name="X" /></button></div>
      <div className="switch-row"><span>Block ads and trackers</span><button className="switch" data-checked={String(shieldEnabled)} role="switch" aria-checked={shieldEnabled} onClick={() => { const enabled = !shieldEnabled; setShieldEnabled(enabled); void api.setSiteShield(activeHost, enabled) }} /></div>
      <div className="shield-stats"><div><strong>{blocked}</strong><span>Blocked on this page</span></div><div><strong>{snapshot.blockedTotal}</strong><span>Blocked all time</span></div></div>
      <button className="menu-item" onClick={() => { setShieldOpen(false); void api.setOverlayOpen(false) }}><AppIcon name="Settings" />Protection settings</button>
    </div>}
  </div>
}
function IconAction({ title, children, onClick, disabled = false }: { title: string; children: React.ReactNode; onClick: () => void; disabled?: boolean }) { return <button className="icon-button" data-part="nav-button" title={title} aria-label={title} disabled={disabled} onClick={onClick}>{children}</button> }
