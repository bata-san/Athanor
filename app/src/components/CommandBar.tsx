import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowDown, ArrowUp, CornerDownLeft, Globe, Search } from 'lucide-react'
import type { CommandInfo, DevServer, DevTool, Snapshot, Suggestion } from '@/lib/types'
import { api } from '@/lib/api'
import { cn } from '@/lib/utils'
import { AppIcon } from './Icons'
import { Button } from './ui/button'
import { Command, CommandEmpty, CommandGroup, CommandItem, CommandList } from './ui/command'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from './ui/dialog'
import { Kbd } from './ui/kbd'
import { Textarea } from './ui/textarea'
import { Command as CommandPrimitive } from 'cmdk'

/** `navigate` loads into the current tab; `new-tab` opens a fresh one. */
export type BarMode = 'navigate' | 'new-tab'

const COMMANDS = [
  { id: 'newtab', label: 'New tab', shortcut: 'Ctrl+T', icon: 'Plus' },
  { id: 'settings', label: 'Open settings', icon: 'Settings' },
  { id: 'boards', label: 'Open reference boards', icon: 'PanelsTopLeft' },
  { id: 'extensions', label: 'Manage extensions', icon: 'Zap' },
  { id: 'devtools', label: 'Toggle developer panel', shortcut: 'Ctrl+Shift+D', icon: 'SquareCode' },
  { id: 'split', label: 'Split with next tab', shortcut: 'Ctrl+\\', icon: 'Split' },
  { id: 'autofile', label: 'File tabs into folders', shortcut: 'Ctrl+Shift+F', icon: 'FolderInput' },
  { id: 'welcome', label: 'Welcome tour and import', icon: 'Sparkles' },
]
const DEV_TOOLS: DevTool[] = ['json-pretty', 'json-minify', 'base64-encode', 'base64-decode', 'url-encode', 'url-decode', 'jwt', 'timestamp', 'uuid', 'sha256', 'color']
/** How each tool reads; the same names the developer panel puts on its tabs. */
const TOOL_LABELS: Record<DevTool, string> = {
  'json-pretty': 'Format JSON', 'json-minify': 'Minify JSON', 'base64-encode': 'Base64 Encode', 'base64-decode': 'Base64 Decode',
  'url-encode': 'URL Encode', 'url-decode': 'URL Decode', jwt: 'Decode JWT', timestamp: 'Timestamp', uuid: 'UUID', sha256: 'SHA-256', color: 'Inspect Color',
}

function fuzzy(query: string, candidate: string) {
  const text = candidate.toLocaleLowerCase()
  return query.trim().toLocaleLowerCase().split(/\s+/).every((part) => {
    let cursor = 0
    for (const character of part) { cursor = text.indexOf(character, cursor); if (cursor < 0) return false; cursor += 1 }
    return true
  })
}
const looksLikeAddress = (text: string) => /^(https?:\/\/|athanor:\/\/|localhost\b|\d{1,3}(\.\d{1,3}){3}\b)/i.test(text) || /^[\w-]+(\.[\w-]+)+(:\d+)?(\/\S*)?$/.test(text)

function Tile({ icon, children }: { icon: React.ReactNode; children?: React.ReactNode }) {
  return <span className="grid size-6 shrink-0 place-items-center rounded-md bg-secondary text-muted-foreground [&_svg]:size-[0.9333rem]">{icon}{children}</span>
}

/**
 * One place for everything typed: addresses, searches, tabs, commands and developer tools. Opening it from the
 * address pill (or Ctrl+L) pre-fills the current address; Ctrl+T / Ctrl+K start empty. The list is ordered the way
 * it is read: what you typed first, then the tabs you could switch to, then places you visited, then commands.
 */
export function CommandBar({ open, onOpenChange, mode, seed, snapshot, servers, extensionCommands, run }: { open: boolean; onOpenChange: (open: boolean) => void; mode: BarMode; seed: string; snapshot: Snapshot; servers: DevServer[]; extensionCommands: CommandInfo[]; run: (value: string) => void }) {
  const [query, setQuery] = useState('')
  const [suggestions, setSuggestions] = useState<Suggestion[]>([])
  const [activeTool, setActiveTool] = useState<DevTool | null>(null)
  const [toolInput, setToolInput] = useState('')
  const [toolOutput, setToolOutput] = useState('')
  const input = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!open) return
    setQuery(seed); setActiveTool(null); setToolOutput('')
    // A page's own view may hold the keyboard (that is where Ctrl+T was pressed): give it back to the shell first,
    // then focus again once the dialog has mounted, so typing starts in the field at once.
    let cancelled = false
    const focus = () => { if (!cancelled) { input.current?.focus(); input.current?.select() } }
    const id = window.setTimeout(focus, 30)
    void api.focusShell().then(() => { window.setTimeout(focus, 0) }).catch(() => undefined)
    return () => { cancelled = true; window.clearTimeout(id) }
  }, [open, seed])
  const fresh = query === seed
  const q = fresh ? '' : query
  useEffect(() => {
    if (!open) return
    const timeout = window.setTimeout(() => { void api.omniboxSuggest(q).then(setSuggestions).catch(() => setSuggestions([])) }, 50)
    return () => window.clearTimeout(timeout)
  }, [q, open])

  const tabs = useMemo(() => snapshot.workspace.tabs.filter((tab) => tab.space === snapshot.workspace.activeSpace && !tab.archived), [snapshot.workspace])
  const activeId = snapshot.workspace.activeTab
  const text = query.trim()

  const go = async (value: string, newTab = false) => {
    const target = value.trim(); if (!target) return
    onOpenChange(false)
    const active = snapshot.workspace.tabs.find((tab) => tab.id === activeId)
    // A new tab is opened straight at the address: navigating a tab that is still being created gets lost.
    if (mode === 'new-tab' || newTab || !active) void api.openTab({ url: target })
    else void api.navigate(active.id, target)
  }
  const select = (value: string) => {
    if (value === 'go') { void go(text); return }
    if (value.startsWith('goto:')) { void go(value.slice(5)); return }
    if (value.startsWith('devtool:')) { setActiveTool(value.slice(8) as DevTool); setToolOutput(''); return }
    if (value.startsWith('suggest-command:')) { onOpenChange(false); run(value.slice(16)); return }
    if (value.startsWith('suggest:')) { void go(value.slice(8)); return }
    onOpenChange(false); run(value)
  }

  // Places you have been, then the commands the omnibox suggests: the tabs and the palette's own commands come
  // from the snapshot, so the groups stay one kind of thing each, and a group with nothing in it is not drawn.
  const visited = useMemo(() => suggestions.filter((item) => (item.kind === 'history' || item.kind === 'url') && item.url).slice(0, q ? 8 : 5), [suggestions, q])
  const suggestedCommands = useMemo(() => suggestions.filter((item) => item.kind === 'command' && item.command), [suggestions])
  const openTabs = useMemo(() => tabs.filter((tab) => !q || fuzzy(q, `${tab.title} ${tab.url}`)).slice(0, q ? 8 : 6), [tabs, q])
  const paletteCommands = useMemo(() => COMMANDS.filter((item) => !q || fuzzy(q, item.label)), [q])
  const extensionRows = useMemo(() => extensionCommands.filter((item) => !q || fuzzy(q, item.title)), [extensionCommands, q])
  const tools = useMemo(() => (q ? DEV_TOOLS.filter((item) => fuzzy(q, item.replaceAll('-', ' '))) : []), [q])
  const devServers = useMemo(() => servers.filter((server) => !q || fuzzy(q, `${server.title ?? ''} ${server.url}`)), [servers, q])
  const address = looksLikeAddress(text)
  const hint = mode === 'new-tab' ? 'New tab' : 'This tab'

  return <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent aria-describedby={undefined} data-part="palette" className="top-[12vh] w-[min(44rem,calc(100vw-1rem))] rounded-xl border-border/70 bg-popover/95 backdrop-blur-xl max-md:top-[6vh]">
      <DialogTitle className="sr-only">Command bar</DialogTitle>
      <DialogDescription className="sr-only">Search, open an address, switch tabs or run a command.</DialogDescription>
      <Command shouldFilter={false} loop label="Search or enter address">
        <div className="flex items-center gap-3 border-b border-border px-4">
          <Search aria-hidden="true" className="size-[1.2rem] shrink-0 text-muted-foreground" />
          <CommandPrimitive.Input ref={input} value={query} onValueChange={setQuery} placeholder={mode === 'new-tab' ? 'Search or enter address for a new tab…' : 'Search or enter address…'} className="h-12 w-full bg-transparent text-[0.9333rem] outline-none placeholder:text-muted-foreground" aria-label="Search or enter address"
            // Ctrl+Enter always opens a fresh tab, so a search never costs you the page you are on.
            onKeyDown={(event) => { if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) { event.preventDefault(); void go(text, true) } }} />
        </div>
        <CommandList className="max-h-[min(28rem,56dvh)]">
          <CommandEmpty>Nothing here yet. Type an address or a search to get started.</CommandEmpty>
          {text && <CommandGroup>
            <CommandItem data-part="palette-item" value="go" onSelect={() => select('go')}><Tile icon={address ? <Globe /> : <Search />} /><span className="min-w-0 flex-1 truncate" title={text}>{address ? 'Go to ' : 'Search the web for '}<strong className="font-medium">{text}</strong></span><span className="shrink-0 text-xs text-muted-foreground">{hint}</span></CommandItem>
          </CommandGroup>}
          {openTabs.length > 0 && <CommandGroup heading="Open tabs">{openTabs.map((tab) => <CommandItem data-part="palette-item" key={tab.id} value={tab.id} onSelect={select}><Tile icon={tab.favicon ? <img src={tab.favicon} alt="" className="size-4 rounded-[0.2rem]" /> : <AppIcon name={tab.pinned ? 'Layers3' : 'Globe2'} />} /><span className="min-w-0 flex-1 truncate">{tab.title}</span><span className="max-w-[45%] truncate font-mono text-[0.7333rem] text-muted-foreground">{tab.url}</span>{tab.id === activeId && <span className="shrink-0 text-xs text-muted-foreground">Current</span>}</CommandItem>)}</CommandGroup>}
          {visited.length > 0 && <CommandGroup heading={q ? 'History' : 'Recent'}>{visited.map((item, index) => <CommandItem data-part="palette-item" key={`${item.kind}-${index}`} value={`suggest:${item.url}`} onSelect={select}><Tile icon={<AppIcon name="History" />} /><span className="min-w-0 flex-1 truncate">{item.title}</span><span className="max-w-[45%] truncate font-mono text-[0.7333rem] text-muted-foreground">{item.subtitle}</span></CommandItem>)}</CommandGroup>}
          {paletteCommands.length + suggestedCommands.length + extensionRows.length > 0 && <CommandGroup heading="Commands">{paletteCommands.map((item) => <CommandItem data-part="palette-item" key={item.id} value={`cmd:${item.id}`} onSelect={select}><Tile icon={<AppIcon name={item.icon} />} /><span className="min-w-0 flex-1 truncate">{item.label}</span>{item.shortcut && <Kbd className="shrink-0 border-0 bg-transparent">{item.shortcut}</Kbd>}</CommandItem>)}{suggestedCommands.map((item, index) => <CommandItem data-part="palette-item" key={`suggested-${index}`} value={`suggest-command:${item.command}`} onSelect={select}><Tile icon={<AppIcon name="Zap" />} /><span className="min-w-0 flex-1 truncate">{item.title}</span></CommandItem>)}{extensionRows.map((item) => <CommandItem data-part="palette-item" key={`${item.ext}/${item.id}`} value={`ext:${item.ext}/${item.id}`} onSelect={select}><Tile icon={<AppIcon name="Zap" />} /><span className="min-w-0 flex-1 truncate">{item.title}</span>{item.keybinding && <Kbd className="shrink-0 border-0 bg-transparent">{item.keybinding}</Kbd>}</CommandItem>)}</CommandGroup>}
          {tools.length > 0 && <CommandGroup heading="Developer tools">{tools.map((item) => <CommandItem data-part="palette-item" key={item} value={`devtool:${item}`} onSelect={select}><Tile icon={<AppIcon name="SquareCode" />} /><span className="truncate">{TOOL_LABELS[item]}</span></CommandItem>)}</CommandGroup>}
          {devServers.length > 0 && <CommandGroup heading="Dev servers">{devServers.map((server) => <CommandItem data-part="palette-item" key={server.url} value={`goto:${server.url}`} onSelect={select}><Tile icon={<AppIcon name="Terminal" />} /><div className="flex min-w-0 flex-1 flex-col"><span className="truncate">{server.title ?? `localhost:${server.port}`}</span><span className="truncate text-xs text-muted-foreground">{server.url}</span></div></CommandItem>)}</CommandGroup>}
        </CommandList>
        {activeTool ? <div className="flex flex-col gap-2 border-t border-border p-3">
          <div className="flex items-center justify-between"><strong className="text-sm">{TOOL_LABELS[activeTool]}</strong><Button variant="ghost" size="sm" onClick={() => setActiveTool(null)}>Back</Button></div>
          <Textarea className="font-mono text-[0.8667rem]" aria-label="Developer tool input" value={toolInput} onChange={(event) => setToolInput(event.target.value)} placeholder="Input" />
          <div className="flex items-center gap-2"><Button size="sm" onClick={() => void api.runDevTool(activeTool, toolInput).then(setToolOutput)}>Run</Button><Button variant="outline" size="sm" disabled={!toolOutput} onClick={() => void navigator.clipboard.writeText(toolOutput)}>Copy</Button></div>
          <pre className="m-0 max-h-24 overflow-auto whitespace-pre-wrap rounded-lg border border-border bg-muted/40 p-3 font-mono text-[0.8667rem]">{toolOutput || 'Your result will appear here.'}</pre>
        </div> : <div className={cn('flex items-center gap-4 border-t border-border px-4 py-2 text-xs text-muted-foreground max-md:hidden')}>
          <span className="flex items-center gap-1.5"><Kbd className="size-5 min-w-5 px-0"><CornerDownLeft aria-hidden="true" className="size-3" /></Kbd>open</span>
          <span className="flex items-center gap-1.5"><Kbd>Ctrl</Kbd><Kbd className="size-5 min-w-5 px-0"><CornerDownLeft aria-hidden="true" className="size-3" /></Kbd>new tab</span>
          <span className="flex items-center gap-1.5"><Kbd className="size-5 min-w-5 px-0"><ArrowUp aria-hidden="true" className="size-3" /></Kbd><Kbd className="size-5 min-w-5 px-0"><ArrowDown aria-hidden="true" className="size-3" /></Kbd>move</span>
          <span className="flex items-center gap-1.5"><Kbd>Esc</Kbd>close</span>
        </div>}
      </Command>
    </DialogContent>
  </Dialog>
}
