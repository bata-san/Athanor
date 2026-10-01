import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import type { ExtensionInfo, FilingRule, LineIssue, Settings as SettingsShape, ThemeInfo } from '@/lib/types'
import { api } from '@/lib/api'
import { countFilterLines, ignoredLineSummary, lineCountLabel, lineSelectionRange } from '@/lib/userFilters'
import { useAppStore } from '@/lib/store'
import { cn } from '@/lib/utils'
import { AppIcon } from '@/components/Icons'
import { AthanorMark } from '@/components/AthanorMark'
import { UpdateRow } from '@/components/UpdateRow'
import { Page, Section, Row, IconTile, Stat, Callout } from '@/components/page'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Switch } from '@/components/ui/switch'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Slider } from '@/components/ui/slider'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Card } from '@/components/ui/card'
import { Kbd, KeyCap } from '@/components/ui/kbd'
import { SHORTCUTS, comboKeys, type ShortcutGroup } from '@/lib/shortcuts'
import { Tip } from '@/components/ui/tooltip'

type SettingsSection = 'General' | 'Privacy' | 'Filing' | 'Appearance' | 'Extensions' | 'Shortcuts' | 'About'
const sections: { id: SettingsSection; icon: string }[] = [
  { id: 'General', icon: 'Settings' },
  { id: 'Privacy', icon: 'Shield' },
  { id: 'Filing', icon: 'Folder' },
  { id: 'Appearance', icon: 'Sun' },
  { id: 'Extensions', icon: 'Zap' },
  { id: 'Shortcuts', icon: 'Command' },
  { id: 'About', icon: 'CircleHelp' },
]
const searchEngines = [
  ['https://www.google.com/search?q={q}', 'Google'],
  ['https://duckduckgo.com/?q={q}', 'DuckDuckGo'],
  ['https://www.bing.com/search?q={q}', 'Bing'],
] as const
const sectionDescriptions: Record<SettingsSection, string> = {
  General: 'Control how Athanor starts and how your sidebar behaves.',
  Privacy: 'Choose how Athanor handles trackers and your browsing data.',
  Filing: 'Organize tabs into folders with rules that match their content.',
  Appearance: 'Choose a theme and set the density of your workspace.',
  Extensions: 'Manage the tools installed in your browser.',
  Shortcuts: 'Keyboard shortcuts for common browser actions.',
  About: 'A little information about Athanor and this workspace.',
}
/** The most used first, so the sheet reads top down like the menus do. */
const shortcutGroups: readonly ShortcutGroup[] = ['Tabs', 'Navigation', 'Page', 'Window']

export default function SettingsPage() {
  const snapshot = useAppStore((state) => state.snapshot)
  const adblock = useAppStore((state) => state.adblock)
  const [section, setSection] = useState<SettingsSection>('General')
  const [themes, setThemes] = useState<ThemeInfo[]>([])
  const [extensions, setExtensions] = useState<ExtensionInfo[]>([])
  const [rules, setRules] = useState<FilingRule[]>(snapshot?.filingRules ?? [])
  const [customSearch, setCustomSearch] = useState('')
  const [customStatus, setCustomStatus] = useState('')
  const [listStatus, setListStatus] = useState('')
  const [filing, setFiling] = useState(false)
  const [newRule, setNewRule] = useState('')
  const folderFields = useRef(new Map<string, HTMLInputElement>())
  const updatingLists = useRef(false)
  const [density, setDensityState] = useState<'comfortable' | 'compact'>(() => localStorage.getItem('athanor-density') === 'compact' ? 'compact' : 'comfortable')
  const settings = snapshot?.settings
  const remembered = Object.keys(settings?.sitePermissions ?? {}).length
  // One wording for each slider, read by the thumb (aria-valuetext) and shown beside it, so the two never drift apart.
  const archiveLabel = (settings?.archiveAfterHours ?? 0) === 0 ? 'Never' : `${settings?.archiveAfterHours} hours`
  const sidebarLabel = `${settings?.sidebarWidth}px`
  const scaleLabel = `${settings?.uiScale}%`

  useEffect(() => {
    void api.listThemes().then(setThemes)
    void api.listExtensions().then(setExtensions)
    void api.getAdblockStatus().then(useAppStore.getState().setAdblock)
  }, [])
  useEffect(() => { if (snapshot) setRules(snapshot.filingRules) }, [snapshot?.filingRules])
  // The lists are refreshed in the background, so the result is read off the status the backend sends back.
  useEffect(() => {
    if (updatingLists.current && !adblock?.updating) setListStatus('Filter lists updated')
    updatingLists.current = Boolean(adblock?.updating)
  }, [adblock?.updating, adblock?.lists])
  // A rule that was just added takes the caret, so reading and typing carry on where the button left off.
  useEffect(() => { if (newRule) folderFields.current.get(newRule)?.focus() }, [newRule, rules])

  const patch = (values: Partial<SettingsShape>) => void api.setSettings(values)
  const persistRules = (next: FilingRule[]) => { setRules(next); void api.setFilingRules(next) }
  const addRule = () => {
    const rule: FilingRule = { id: crypto.randomUUID(), folder: '', host: '', pathPrefix: null, titleContains: null, enabled: true }
    persistRules([...rules, rule])
    setNewRule(rule.id)
  }
  const deleteRule = (rule: FilingRule) => {
    persistRules(rules.filter((item) => item.id !== rule.id))
    toast('Filing rule removed', { action: { label: 'Undo', onClick: () => persistRules([...rules, rule]) } })
  }
  const install = async () => {
    const path = await api.pickDirectory()
    if (!path) return
    const before = new Set(extensions.map((extension) => extension.id))
    try {
      await api.installExtension(path)
      const next = await api.listExtensions()
      setExtensions(next)
      const added = next.find((extension) => !before.has(extension.id))
      if (added) toast.success(`Installed ${added.name}`)
      else toast.error('That folder is not an extension Athanor can install')
    } catch (error) { toast.error(error instanceof Error ? error.message : String(error)) }
  }
  const runFiling = async () => {
    if (filing) return
    setFiling(true)
    try { await api.autoFileAll(); toast.success('Automatic filing finished') }
    catch (error) { toast.error(error instanceof Error ? error.message : String(error)) }
    finally { setFiling(false) }
  }
  const updateDensity = (value: string) => {
    if (value !== 'compact' && value !== 'comfortable') return
    setDensityState(value)
    setDensity(value)
  }

  return <div className="flex h-full min-h-0 w-full" data-part="settings">
    <nav aria-label="Settings sections" className="flex w-56 shrink-0 flex-col gap-1 overflow-y-auto border-e border-border bg-sidebar p-3 max-[700px]:w-14 max-[700px]:px-1.5">
      {sections.map((item) => <button
        type="button"
        key={item.id}
        aria-label={item.id}
        aria-current={section === item.id ? 'page' : undefined}
        title={item.id}
        className="flex h-8 min-w-0 items-center gap-2.5 rounded-lg px-2.5 text-start text-sm text-foreground transition-colors hover:bg-tab-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 data-[active=true]:bg-sidebar-accent data-[active=true]:font-medium max-md:min-h-11 max-[700px]:justify-center max-[700px]:px-0"
        data-active={String(section === item.id)}
        onClick={() => setSection(item.id)}
      ><AppIcon name={item.icon} className="size-4 shrink-0" /><span className="max-[700px]:sr-only">{item.id}</span></button>)}
    </nav>

    <Page title={section} description={sectionDescriptions[section]}>
      {!settings ? <Callout><AppIcon name="CircleHelp" className="size-4 shrink-0" />Settings are not available yet.</Callout> : <>
        {section === 'General' && <>
          <Section title="Search and startup">
            <Row title="New tab opens" description="The page a new tab starts on." htmlFor="homepage">
              <Select value={settings.homepage === 'athanor://newtab' ? 'athanor' : settings.homepage === 'https://www.google.com/' ? 'google' : 'custom'} onValueChange={(value) => { if (value === 'google') patch({ homepage: 'https://www.google.com/' }); else if (value === 'athanor') patch({ homepage: 'athanor://newtab' }) }}>
                <SelectTrigger id="homepage" aria-label="New tab opens" className="w-56 max-sm:w-full max-md:h-11"><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="google">Google</SelectItem><SelectItem value="athanor">Athanor start page</SelectItem>{settings.homepage !== 'athanor://newtab' && settings.homepage !== 'https://www.google.com/' && <SelectItem value="custom">{settings.homepage}</SelectItem>}</SelectContent>
              </Select>
            </Row>
            <Row title="Search engine" description="Choose where searches from the address bar go." htmlFor="search-engine">
              <Select value={searchEngines.some(([value]) => value === settings.searchEngine) ? settings.searchEngine : 'custom'} onValueChange={(value) => {
                if (value !== 'custom') patch({ searchEngine: value })
                else if (customSearch) patch({ searchEngine: customSearch })
              }}>
                <SelectTrigger id="search-engine" aria-label="Search engine" className="w-56 max-sm:w-full max-md:h-11"><SelectValue /></SelectTrigger>
                <SelectContent>{searchEngines.map(([value, name]) => <SelectItem key={value} value={value}>{name}</SelectItem>)}<SelectItem value="custom">Custom template</SelectItem></SelectContent>
              </Select>
            </Row>
            <Row title="Custom URL template" description={<>Use <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs">{'{q}'}</code> for your query.</>} htmlFor="custom-search">
              <div className="flex w-72 max-sm:w-full flex-col gap-1">
                <Input id="custom-search" className="max-md:h-11" value={customSearch || (!searchEngines.some(([value]) => value === settings.searchEngine) ? settings.searchEngine : '')} placeholder="https://example.com/search?q={q}" onChange={(event) => { setCustomSearch(event.target.value); setCustomStatus('') }} onBlur={() => { if (customSearch.includes('{q}')) { patch({ searchEngine: customSearch }); setCustomStatus('Search engine updated') } }} />
                <span aria-live="polite" className="text-[0.7333rem] text-muted-foreground">{customStatus}</span>
              </div>
            </Row>
            <Row title="Restore previous session" description="Bring back your open tabs when Athanor starts.">
              <TouchSwitch label="Restore previous session" checked={settings.restoreSession} onCheckedChange={(restoreSession) => patch({ restoreSession })} />
            </Row>
            <Row title="Archive inactive tabs after" description="Set to Never to keep all inactive tabs in view.">
              <div className="flex w-64 items-center gap-4 max-sm:w-full"><Slider className="max-md:h-11" aria-label="Archive inactive tabs after" aria-valuetext={archiveLabel} min={0} max={168} step={1} value={[settings.archiveAfterHours]} onValueChange={([archiveAfterHours]) => patch({ archiveAfterHours })} /><span className="w-20 shrink-0 text-right text-[0.8667rem] tabular-nums text-muted-foreground">{archiveLabel}</span></div>
            </Row>
          </Section>
          <Section title="Sidebar">
            <Row title="Position" description="Choose which side of the window holds the sidebar.">
              <Tabs value={settings.sidebarSide} onValueChange={(value) => { if (value === 'left' || value === 'right') patch({ sidebarSide: value }) }}>
                <TabsList aria-label="Sidebar side"><TabsTrigger className="max-md:min-h-11" value="left"><AppIcon name="PanelLeft" />Left</TabsTrigger><TabsTrigger className="max-md:min-h-11" value="right"><AppIcon name="PanelLeft" className="scale-x-[-1]" />Right</TabsTrigger></TabsList>
              </Tabs>
            </Row>
            <Row title="Compact sidebar" description="Show a smaller icon rail.">
              <TouchSwitch label="Compact sidebar" checked={settings.sidebarCompact} onCheckedChange={(sidebarCompact) => patch({ sidebarCompact })} />
            </Row>
            <Row title="Sidebar width" description="Adjust the width of the expanded sidebar.">
              <div className="flex w-64 items-center gap-4 max-sm:w-full"><Slider className="max-md:h-11" aria-label="Sidebar width" aria-valuetext={`${settings.sidebarWidth} px`} min={208} max={400} step={1} value={[settings.sidebarWidth]} onValueChange={([sidebarWidth]) => patch({ sidebarWidth })} /><span className="w-14 shrink-0 text-right text-[0.8667rem] tabular-nums text-muted-foreground">{sidebarLabel}</span></div>
            </Row>
          </Section>
        </>}

        {section === 'Privacy' && <>
          <div className="grid grid-cols-2 gap-3 max-sm:grid-cols-1">
            <Stat label="Blocked this session" value={(snapshot?.blockedTotal ?? adblock?.blockedTotal ?? 0).toLocaleString()} />
            <Stat label="Enabled filter lists" value={(adblock?.lists.filter((list) => list.enabled).length ?? 0).toLocaleString()} />
          </div>
          <Section title="Ad and tracker blocking" actions={<div className="flex flex-col items-end gap-1"><Button className="max-md:min-h-11" size="sm" variant="outline" disabled={adblock?.updating} onClick={() => void api.updateAdblockLists().catch(() => setListStatus('Filter lists could not be updated'))}><AppIcon name="RotateCw" className={adblock?.updating ? 'animate-spin' : ''} />{adblock?.updating ? 'Updating…' : 'Update Filter Lists'}</Button><span aria-live="polite" className="text-[0.7333rem] text-muted-foreground">{listStatus}</span></div>}>
            <Row title="Block ads and trackers" description="Block requests with the filter lists, and hide cosmetic ads.">
              <TouchSwitch label="Block ads and trackers" checked={adblock?.enabled ?? settings.adblockEnabled} onCheckedChange={(enabled) => void api.setAdblockEnabled(enabled)} />
            </Row>
            <div className="py-2">
              <h3 className="mb-2 text-[0.8667rem] font-medium text-muted-foreground">Filter lists</h3>
              <div className="divide-y divide-border">
                {(adblock?.lists ?? []).map((list) => <div className="flex min-h-11 items-center justify-between gap-4 py-2 max-sm:items-start" key={list.id}>
                  <div className="min-w-0"><p className="m-0 text-sm font-medium">{list.name}</p><p className="m-0 mt-0.5 text-[0.8667rem] text-muted-foreground">{list.ruleCount.toLocaleString()} rules · {list.updatedAt ? `Updated ${new Date(list.updatedAt).toLocaleDateString()}` : 'Not updated'}{list.error ? ` · ${list.error}` : ''}</p></div>
                  <TouchSwitch label={`${list.name} filter list`} checked={list.enabled} onCheckedChange={(enabled) => void api.setAdblockListEnabled(list.id, enabled)} />
                </div>)}
                {adblock?.lists.length === 0 && <p className="m-0 py-2 text-[0.8667rem] text-muted-foreground">No filter lists are available.</p>}
              </div>
            </div>
          </Section>
          <Section title="My filters" description="Add custom network and cosmetic filtering rules.">
            <MyFiltersEditor />
          </Section>
          <Section title="Protection preferences">
            <Row title="Skip YouTube ads" description="Removes ad data, hides ad slots and fast-forwards any ad that still plays. Applies to pages you open next.">
              <TouchSwitch label="Skip YouTube ads" checked={settings.youtubeAdSkip} onCheckedChange={(youtubeAdSkip) => patch({ youtubeAdSkip })} />
            </Row>
            <Row title="Turn off DRM" description="Tells sites that encrypted media (Widevine) is unavailable, so protected video will not play. Applies to pages you open next.">
              <TouchSwitch label="Turn off DRM" checked={settings.blockDrm} onCheckedChange={(blockDrm) => patch({ blockDrm })} />
            </Row>
            <Row title="Upgrade to HTTPS" description="Prefer encrypted connections when available.">
              <TouchSwitch label="Upgrade to HTTPS" checked={settings.httpsUpgrade} onCheckedChange={(httpsUpgrade) => patch({ httpsUpgrade })} />
            </Row>
            <Row title="Strip tracking parameters" description="Remove common tracking keys from addresses.">
              <TouchSwitch label="Strip tracking parameters" checked={settings.stripTracking} onCheckedChange={(stripTracking) => patch({ stripTracking })} />
            </Row>
            {/* Destructive, so it comes last in the section. */}
            <Row title="Site permissions" description={`Camera, microphone, location and similar answers Athanor remembers. ${remembered === 0 ? 'None yet.' : `${remembered} will be asked again.`}`}>
              <Button variant="destructive" size="sm" disabled={remembered === 0} onClick={() => { void api.resetSitePermissions(); toast.success('Site permissions reset') }}>Reset Site Permissions</Button>
            </Row>
          </Section>
        </>}

        {section === 'Filing' && <>
          <Section title="Automatic filing" description="Group tabs into folders using a matching site, URL path, or title." actions={<Button className="max-md:min-h-11" variant="outline" disabled={filing} onClick={() => void runFiling()}><AppIcon name="WandSparkles" />{filing ? 'Filing…' : 'File Open Tabs Now'}</Button>}>
            <Row title="File new tabs automatically" description="Use these rules when a tab opens.">
              <TouchSwitch label="File new tabs automatically" checked={settings.autoFile} onCheckedChange={(autoFile) => patch({ autoFile })} />
            </Row>
          </Section>
          <Section title="Filing rules" description="Built-in destinations include Development, Reading list, Shopping, Social, and Design. Rules create a folder the first time a match appears." actions={<Button className="max-md:min-h-11" size="sm" onClick={addRule}><AppIcon name="Plus" />Add Rule</Button>}>
            <div className="py-2">
              <div className="mb-2 hidden grid-cols-[2.5rem_repeat(4,minmax(0,1fr))_2.5rem] gap-2 px-1 text-xs text-muted-foreground md:grid" aria-hidden="true"><span /><span>Folder</span><span>Host contains</span><span>Path prefix</span><span>Title contains</span><span /></div>
              <div className="divide-y divide-border">
                {rules.map((rule) => <div key={rule.id} className="grid grid-cols-1 items-center gap-2 py-2 md:grid-cols-[2.5rem_repeat(4,minmax(0,1fr))_2.5rem]">
                  <TouchSwitch label="Enable rule" checked={rule.enabled} onCheckedChange={(enabled) => persistRules(rules.map((item) => item.id === rule.id ? { ...item, enabled } : item))} />
                  <Input ref={(node) => { if (node) folderFields.current.set(rule.id, node); else folderFields.current.delete(rule.id) }} className="max-md:h-11" aria-label="Folder name" placeholder="Folder name" value={rule.folder} onChange={(event) => persistRules(rules.map((item) => item.id === rule.id ? { ...item, folder: event.target.value } : item))} />
                  <Input className="max-md:h-11" aria-label="Host contains" placeholder="Host, e.g. github.com" value={rule.host ?? ''} onChange={(event) => persistRules(rules.map((item) => item.id === rule.id ? { ...item, host: event.target.value || null } : item))} />
                  <Input className="max-md:h-11" aria-label="Path prefix" placeholder="Path prefix (optional)" value={rule.pathPrefix ?? ''} onChange={(event) => persistRules(rules.map((item) => item.id === rule.id ? { ...item, pathPrefix: event.target.value || null } : item))} />
                  <Input className="max-md:h-11" aria-label="Title contains" placeholder="Title contains (optional)" value={rule.titleContains ?? ''} onChange={(event) => persistRules(rules.map((item) => item.id === rule.id ? { ...item, titleContains: event.target.value || null } : item))} />
                  <Tip label="Delete rule"><Button className="max-md:size-11" type="button" size="icon" variant="ghost" aria-label="Delete rule" onClick={() => deleteRule(rule)}><AppIcon name="Trash2" className="text-destructive" /></Button></Tip>
                </div>)}
                {rules.length === 0 && <p className="m-0 py-4 text-[0.8667rem] text-muted-foreground">No filing rules yet. Add a rule to start organizing tabs automatically.</p>}
              </div>
            </div>
          </Section>
        </>}

        {section === 'Appearance' && <>
          <Section title="Accessibility" description="Make Athanor easier to see and to use. The system settings for Reduce Motion and Increase Contrast are always followed.">
            <Row title="Interface size" description="Scales text, controls and menus together. Web pages keep their own zoom (Ctrl + / Ctrl -).">
              <div className="flex w-64 items-center gap-4 max-sm:w-full"><Slider className="max-md:h-11" aria-label="Interface size" aria-valuetext={scaleLabel} min={100} max={200} step={5} value={[settings.uiScale]} onValueChange={([uiScale]) => patch({ uiScale })} /><span className="w-12 text-end text-[0.8667rem] tabular-nums text-muted-foreground">{scaleLabel}</span></div>
            </Row>
            <Row title="Reduce motion" description="Replaces sliding and scaling with simple fades.">
              <TouchSwitch label="Reduce motion" checked={settings.reduceMotion} onCheckedChange={(reduceMotion) => patch({ reduceMotion })} />
            </Row>
            <Row title="Increase contrast" description="Darker text and clearer edges for controls.">
              <TouchSwitch label="Increase contrast" checked={settings.highContrast} onCheckedChange={(highContrast) => patch({ highContrast })} />
            </Row>
          </Section>
          <Section title="Web pages" description="Pages that name their own font are not changed.">
            <Row title="IBM Plex Sans JP as the default font" description="Used by pages that do not pick a font themselves. Applies the next time Athanor starts.">
              <TouchSwitch label="IBM Plex Sans JP as the default font" checked={settings.webFont} onCheckedChange={(webFont) => patch({ webFont })} />
            </Row>
          </Section>
          <Section title="Theme" description="Choose the colors used across Athanor.">
            <div className="grid grid-cols-2 gap-3 py-2 max-sm:grid-cols-1">
              {themes.map((theme) => <button type="button" key={theme.id} data-selected={String(settings.theme === theme.id)} aria-pressed={settings.theme === theme.id} aria-label={`Use ${theme.name} theme`} className="rounded-xl border border-border bg-card p-3 text-left outline-none transition-colors hover:bg-accent/40 focus-visible:ring-2 focus-visible:ring-ring/40 data-[selected=true]:border-primary data-[selected=true]:ring-1 data-[selected=true]:ring-primary max-md:min-h-11" onClick={() => { document.documentElement.dataset.themeDark = String(theme.dark); patch({ theme: theme.id }); void api.setTheme(theme.id) }}>
                <div data-part="theme-preview" className="mb-3 flex h-20 overflow-hidden rounded-lg border border-border bg-background p-2">
                  <div className="w-1/4 rounded-md bg-sidebar p-1"><div className="mb-1 h-1.5 rounded bg-muted" /><div className="h-1.5 w-2/3 rounded bg-muted" /></div>
                  <div className="flex flex-1 flex-col gap-2 p-2"><div className="h-2 w-1/2 rounded bg-card" /><div className="h-5 rounded bg-muted" /><div className="h-2 w-2/3 rounded bg-card" /></div>
                </div>
                {/* The tick is what marks the chosen theme, so the state is not colour alone; it keeps its space either way. */}
                <span className="flex items-center gap-1.5 text-sm font-medium"><AppIcon name="Check" className={cn('size-3.5 shrink-0', settings.theme !== theme.id && 'invisible')} />{theme.name}</span><span className="mt-0.5 block text-[0.8667rem] text-muted-foreground">{theme.dark ? 'Dark' : 'Light'} · {theme.source}</span>
              </button>)}
              {themes.length === 0 && <p className="m-0 text-[0.8667rem] text-muted-foreground">No themes are available.</p>}
            </div>
          </Section>
          <Section title="Density" description="Choose the amount of space between tab rows and controls.">
            <Row title="Workspace density"><Tabs value={density} onValueChange={updateDensity}><TabsList aria-label="Workspace density"><TabsTrigger className="max-md:min-h-11" value="comfortable">Comfortable</TabsTrigger><TabsTrigger className="max-md:min-h-11" value="compact">Compact</TabsTrigger></TabsList></Tabs></Row>
          </Section>
        </>}

        {section === 'Extensions' && <Section title="Installed extensions" description="Panels and commands run in a restricted extension frame." actions={<Button className="max-md:min-h-11" onClick={() => void install()}><AppIcon name="Plus" />Install from Folder…</Button>}>
          <div className="divide-y divide-border">
            {extensions.map((extension) => <SettingsExtensionRow key={extension.id} extension={extension} onRefresh={() => void api.listExtensions().then(setExtensions)} />)}
            {extensions.length === 0 && <Callout className="my-3"><AppIcon name="Zap" className="size-4 shrink-0" />No extensions installed.</Callout>}
          </div>
        </Section>}

        {section === 'Shortcuts' && <Section title="Keyboard shortcuts" description="Use these keys to move around Athanor more quickly.">
          <div className="grid grid-cols-2 gap-x-8 max-sm:grid-cols-1">
            {shortcutGroups.map((group) => <div key={group} className="py-2">
              <h3 className="m-0 mb-1 text-[0.7333rem] font-medium uppercase tracking-wider text-muted-foreground">{group}</h3>
              <div className="divide-y divide-border">
                {SHORTCUTS.filter((item) => item.group === group).map((item) => <div key={item.combo} className="flex min-h-11 items-center justify-between gap-4 py-1.5">
                  <span className="text-sm">{item.label}</span><span className="flex shrink-0 items-center gap-1">{comboKeys(item.combo).map((key, index) => <KeyCap key={`${key}-${index}`} k={key} />)}</span>
                </div>)}
              </div>
            </div>)}
          </div>
        </Section>}

        {section === 'About' && <Card className="mx-auto w-full max-w-lg p-8 text-center">
          <div className="mx-auto mb-4 grid size-16 place-items-center rounded-2xl bg-primary text-primary-foreground"><AthanorMark className="size-8" /></div>
          <h2 className="m-0 text-lg font-semibold">Athanor</h2>
          <p className="mb-1 mt-1 text-[0.8667rem] text-muted-foreground">Version {snapshot?.version ?? '—'}</p>
          <UpdateRow autoUpdate={settings.autoUpdate} onAuto={(autoUpdate) => patch({ autoUpdate })} />
          <p className="mx-auto mb-6 mt-2 max-w-sm text-[0.8667rem] text-muted-foreground">A quiet, fast browser, made for focus, research, and developer work.</p>
          <div className="grid grid-cols-3 gap-3 text-left max-sm:grid-cols-1">
            <Stat label="Platform" value={snapshot?.platform ?? '—'} className="p-3" />
            <Stat label="Spaces" value={snapshot?.workspace.spaces.length ?? '—'} className="p-3" />
            <Stat label="Open tabs" value={snapshot?.workspace.tabs.length ?? '—'} className="p-3" />
          </div>
        </Card>}
      </>}
    </Page>
  </div>
}

function MyFiltersEditor() {
  const [text, setText] = useState('')
  const [saved, setSaved] = useState('')
  const [issues, setIssues] = useState<LineIssue[]>([])
  const [saving, setSaving] = useState(false)
  const area = useRef<HTMLTextAreaElement>(null)
  useEffect(() => {
    let alive = true
    void api.getUserFilters().then((value) => { if (alive) { setText(value); setSaved(value) } }).catch(() => toast.error('Filters could not be loaded.'))
    return () => { alive = false }
  }, [])
  const dirty = text !== saved
  const save = async () => {
    if (!dirty || saving) return
    setSaving(true)
    try {
      const found = await api.setUserFilters(text)
      setSaved(text)
      setIssues(found)
      toast.success(found.length ? `Filters saved · ${ignoredLineSummary(found.length)}` : 'Filters saved')
    } catch (error) { toast.error(error instanceof Error ? error.message : String(error)) }
    finally { setSaving(false) }
  }
  const jump = (line: number) => {
    const node = area.current
    if (!node) return
    const range = lineSelectionRange(text, line)
    node.focus()
    node.setSelectionRange(range.start, range.end)
  }
  const lines = countFilterLines(text)

  return <div className="space-y-3 py-2">
    <p id="my-filters-help" className="m-0 text-[0.8667rem] text-muted-foreground">One rule per line, for example <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs">||ads.example.com^</code>, <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs">example.com##.banner</code>, <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs">@@||example.com^$document</code>.</p>
    <Textarea ref={area} id="my-filters" data-part="my-filters" className="min-h-60 resize-y font-mono text-[0.8667rem] leading-5" aria-label="My filters" aria-describedby="my-filters-help" rows={12} wrap="off" spellCheck={false} value={text} placeholder="||ads.example.com^" onChange={(event) => setText(event.target.value)} onKeyDown={(event) => { if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') { event.preventDefault(); void save() } }} />
    <div className="flex flex-wrap items-center gap-2">
      <Button className="max-md:min-h-11" onClick={() => void save()} disabled={!dirty || saving}><AppIcon name="Check" />{saving ? 'Saving…' : 'Save'}</Button>
      <Button className="max-md:min-h-11" variant="outline" onClick={() => setText(saved)} disabled={!dirty || saving}><AppIcon name="RotateCcw" />Revert</Button>
      <span className="ms-auto flex items-center gap-3 text-[0.8667rem] text-muted-foreground"><span data-part="filter-count">{lineCountLabel(lines)}</span><span className="flex items-center gap-1" aria-label="Save shortcut"><Kbd>Ctrl</Kbd><Kbd>S</Kbd></span></span>
    </div>
    {issues.length > 0 && <div>
      <p className="mb-2 mt-1 text-[0.8667rem] text-muted-foreground">The engine ignored {lineCountLabel(issues.length)}:</p>
      <ul className="m-0 list-none space-y-2 p-0" data-part="filter-issues" aria-label="Ignored lines">
        {issues.map((issue) => <li key={`${issue.line}-${issue.message}`}>
          <button type="button" className="flex w-full items-start gap-2 rounded-lg border border-border bg-background px-3 py-2 text-left text-[0.8667rem] hover:bg-accent/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40" data-part="filter-issue" aria-label={issue.line ? `Select line ${issue.line}` : 'Select all filters'} onClick={() => jump(issue.line)}>
            <AppIcon name="XCircle" className="mt-0.5 size-4 shrink-0 text-destructive" /><span><strong>{issue.line ? `Line ${issue.line}:` : 'All lines:'}</strong> <span className="text-muted-foreground">{issue.message}</span></span>
          </button>
        </li>)}
      </ul>
    </div>}
  </div>
}

/** A switch sized for touch; the name lives on the switch itself, so the wrapper only pads the target. */
function TouchSwitch({ label, checked, onCheckedChange }: { label: string; checked: boolean; onCheckedChange: (checked: boolean) => void }) {
  return <div className="grid place-items-center max-md:size-11"><Switch aria-label={label} checked={checked} onCheckedChange={onCheckedChange} /></div>
}

function SettingsExtensionRow({ extension, onRefresh }: { extension: ExtensionInfo; onRefresh: () => void }) {
  return <div className="flex min-h-20 items-center gap-3 py-2 max-sm:flex-wrap">
    <IconTile icon="Zap" />
    <div className="min-w-0 flex-1"><p className="m-0 text-sm font-medium">{extension.name}</p><p className="m-0 mt-0.5 text-[0.8667rem] text-muted-foreground">{extension.description}</p><p className="m-0 mt-1 text-xs text-muted-foreground">Permissions: {extension.permissions.join(', ') || 'None'} · {extension.version}</p></div>
    <div className="flex shrink-0 items-center gap-1"><TouchSwitch label={`${extension.enabled ? 'Disable' : 'Enable'} ${extension.name}`} checked={extension.enabled} onCheckedChange={(enabled) => void api.setExtensionEnabled(extension.id, enabled).then(onRefresh)} />{extension.source === 'user' && <Tip label={`Remove ${extension.name}`}><Button className="max-md:size-11" variant="ghost" size="icon" aria-label={`Remove ${extension.name}`} onClick={() => { void api.removeExtension(extension.id).then(() => { onRefresh(); toast.success(`Removed ${extension.name}`) }).catch((error) => toast.error(error instanceof Error ? error.message : String(error))) }}><AppIcon name="Trash2" className="text-destructive" /></Button></Tip>}</div>
  </div>
}

function setDensity(value: 'compact' | 'comfortable') {
  localStorage.setItem('athanor-density', value)
  window.dispatchEvent(new CustomEvent('athanor-density', { detail: value }))
}
