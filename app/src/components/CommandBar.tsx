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
  { id: 'autofile', label: 'File tabs into folders', icon: 'Folder' },
]
const DEV_TOOLS: DevTool[] = ['json-pretty', 'json-minify', 'base64-encode', 'base64-decode', 'url-encode', 'url-decode', 'jwt', 'timestamp', 'uuid', 'sha256', 'color']

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
  return <span className="grid size-7 shrink-0 place-items-center rounded-lg bg-secondary text-muted-foreground [&_svg]:size-4">{icon}{children}</span>
}

/**
 * One place for everything typed: addresses, searches, tabs, commands and developer tools. Opening it from the
 * address pill (or Ctrl+L) pre-fills the current address; Ctrl+T / Ctrl+K start empty.
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
    const id = window.setTimeout(() => { input.current?.focus(); input.current?.select() }, 30)
    return () => window.clearTimeout(id)
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

  const go = async (value: string) => {
    const target = value.trim(); if (!target) return
    onOpenChange(false)
    const active = snapshot.workspace.tabs.find((tab) => tab.id === activeId)
    if (mode === 'new-tab' || !active || active.url === 'athanor://newtab') {
      if (active && active.url === 'athanor://newtab' && mode !== 'new-tab') void api.navigate(active.id, target)
      else { const id = await api.openTab({}); void api.navigate(id, target) }
    } else void api.navigate(active.id, target)
  }
  const select = (value: string) => {
    if (value === 'go') { void go(text); return }
    if (value.startsWith('goto:')) { void go(value.slice(5)); return }
    if (value.startsWith('devtool:')) { setActiveTool(value.slice(8) as DevTool); setToolOutput(''); return }
    if (value.startsWith('suggest-command:')) { onOpenChange(false); run(value.slice(16)); return }
    if (value.startsWith('suggest:')) { void go(value.slice(8)); return }
    onOpenChange(false); run(value)
  }

  const visibleSuggestions = suggestions.filter((item) => item.kind !== 'search' && item.kind !== 'tab' && (item.url || item.command))
  return <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent aria-describedby={undefined} data-part="palette" className="top-[14vh] w-[min(42rem,calc(100vw-1rem))] rounded-2xl border-border/70 bg-popover/95 backdrop-blur-xl max-md:top-[6vh]">
      <DialogTitle className="sr-only">Command bar</DialogTitle>
      <DialogDescription className="sr-only">Search, open an address, switch tabs or run a command.</DialogDescription>
      <Command shouldFilter={false} loop>
        <div className="flex items-center gap-3 border-b border-border px-4">
          <Search className="size-[18px] shrink-0 text-muted-foreground" />
          <CommandPrimitive.Input ref={input} value={query} onValueChange={setQuery} placeholder={mode === 'new-tab' ? 'Search or enter address for a new tab…' : 'Search or enter address…'} className="h-14 w-full bg-transparent text-[15px] outline-none placeholder:text-muted-foreground" aria-label="Search or enter address" />
        </div>
        <CommandList className="max-h-[min(26rem,52dvh)]">
          <CommandEmpty>Nothing here yet. Press Enter to search the web.</CommandEmpty>
          {!fresh && text && <CommandGroup>
            <CommandItem data-part="palette-item" value="go" onSelect={select}><Tile icon={looksLikeAddress(text) ? <Globe /> : <Search />} /><span className="min-w-0 flex-1 truncate">{looksLikeAddress(text) ? 'Go to ' : 'Search for '}<strong className="font-medium">{text}</strong></span><span className="text-xs text-muted-foreground">{mode === 'new-tab' ? 'New tab' : 'This tab'}</span></CommandItem>
          </CommandGroup>}
          {visibleSuggestions.length > 0 && <CommandGroup heading={q ? 'Suggestions' : 'Recent'}>{visibleSuggestions.map((item, index) => <CommandItem data-part="palette-item" key={`${item.kind}-${index}`} value={item.command ? `suggest-command:${item.command}` : item.tab ? item.tab : `suggest:${item.url ?? ''}`} onSelect={select}><Tile icon={<AppIcon name={item.kind === 'tab' ? 'PanelsTopLeft' : 'Globe2'} />} /><div className="flex min-w-0 flex-1 flex-col"><span className="truncate">{item.title}</span><span className="truncate text-xs text-muted-foreground">{item.subtitle}</span></div></CommandItem>)}</CommandGroup>}
          <CommandGroup heading="Open tabs">{tabs.filter((tab) => !q || fuzzy(q, `${tab.title} ${tab.url}`)).slice(0, q ? 8 : 6).map((tab) => <CommandItem data-part="palette-item" key={tab.id} value={tab.id} onSelect={select}><Tile icon={tab.favicon ? <img src={tab.favicon} alt="" className="size-4 rounded-[3px]" /> : <AppIcon name={tab.pinned ? 'Layers3' : 'Globe2'} />} /><div className="flex min-w-0 flex-1 flex-col"><span className="truncate">{tab.title}</span><span className="truncate text-xs text-muted-foreground">{tab.url}</span></div>{tab.id === activeId && <span className="text-xs text-muted-foreground">Current</span>}</CommandItem>)}</CommandGroup>
          <CommandGroup heading="Commands">{COMMANDS.filter((item) => !q || fuzzy(q, item.label)).map((item) => <CommandItem data-part="palette-item" key={item.id} value={`cmd:${item.id}`} onSelect={select}><Tile icon={<AppIcon name={item.icon} />} /><span className="flex-1">{item.label}</span>{item.shortcut && <Kbd className="border-0 bg-transparent">{item.shortcut}</Kbd>}</CommandItem>)}{extensionCommands.filter((item) => !q || fuzzy(q, item.title)).map((item) => <CommandItem data-part="palette-item" key={`${item.ext}/${item.id}`} value={`ext:${item.ext}/${item.id}`} onSelect={select}><Tile icon={<AppIcon name="Zap" />} /><span className="flex-1">{item.title}</span>{item.keybinding && <Kbd className="border-0 bg-transparent">{item.keybinding}</Kbd>}</CommandItem>)}</CommandGroup>
          {q && <CommandGroup heading="Developer tools">{DEV_TOOLS.filter((item) => fuzzy(q, item.replaceAll('-', ' '))).map((item) => <CommandItem data-part="palette-item" key={item} value={`devtool:${item}`} onSelect={select}><Tile icon={<AppIcon name="SquareCode" />} /><span className="capitalize">{item.replaceAll('-', ' ')}</span></CommandItem>)}</CommandGroup>}
          {servers.length > 0 && <CommandGroup heading="Dev servers">{servers.filter((server) => !q || fuzzy(q, `${server.title ?? ''} ${server.url}`)).map((server) => <CommandItem data-part="palette-item" key={server.url} value={`goto:${server.url}`} onSelect={select}><Tile icon={<AppIcon name="Terminal" />} /><div className="flex min-w-0 flex-1 flex-col"><span className="truncate">{server.title ?? `localhost:${server.port}`}</span><span className="truncate text-xs text-muted-foreground">{server.url}</span></div></CommandItem>)}</CommandGroup>}
        </CommandList>
        {activeTool ? <div className="flex flex-col gap-2 border-t border-border p-3">
          <div className="flex items-center justify-between"><strong className="text-sm capitalize">{activeTool.replaceAll('-', ' ')}</strong><Button variant="ghost" size="sm" onClick={() => setActiveTool(null)}>Back</Button></div>
          <Textarea className="font-mono text-[13px]" aria-label="Developer tool input" value={toolInput} onChange={(event) => setToolInput(event.target.value)} placeholder="Input" />
          <div className="flex items-center gap-2"><Button size="sm" onClick={() => void api.runDevTool(activeTool, toolInput).then(setToolOutput)}>Run</Button><Button variant="outline" size="sm" disabled={!toolOutput} onClick={() => void navigator.clipboard.writeText(toolOutput)}>Copy</Button></div>
          <pre className="m-0 max-h-24 overflow-auto whitespace-pre-wrap rounded-lg border border-border bg-muted/40 p-3 font-mono text-[13px]">{toolOutput || 'Your result will appear here.'}</pre>
        </div> : <div className={cn('flex items-center gap-4 border-t border-border px-4 py-2 text-xs text-muted-foreground max-md:hidden')}>
          <span className="flex items-center gap-1.5"><Kbd className="size-5 min-w-5 px-0"><CornerDownLeft className="size-3" /></Kbd>open</span>
          <span className="flex items-center gap-1.5"><Kbd className="size-5 min-w-5 px-0"><ArrowUp className="size-3" /></Kbd><Kbd className="size-5 min-w-5 px-0"><ArrowDown className="size-3" /></Kbd>move</span>
          <span className="flex items-center gap-1.5"><Kbd>Esc</Kbd>close</span>
        </div>}
      </Command>
    </DialogContent>
  </Dialog>
}
