import { useState } from 'react'
import type { DevTool, Snapshot } from '@/lib/types'
import { api } from '@/lib/api'
import { useAppStore } from '@/lib/store'
import { AppIcon } from '@/components/Icons'
import { Callout } from '@/components/page'
import { Button } from '@/components/ui/button'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import { Tip } from '@/components/ui/tooltip'

const tools: { id: DevTool; label: string; icon: string }[] = [
  { id: 'json-pretty', label: 'Format JSON', icon: 'FileCode2' }, { id: 'json-minify', label: 'Minify JSON', icon: 'FileCode2' }, { id: 'base64-encode', label: 'Base64 encode', icon: 'LockKeyhole' }, { id: 'base64-decode', label: 'Base64 decode', icon: 'LockKeyhole' }, { id: 'url-encode', label: 'URL encode', icon: 'Globe2' }, { id: 'url-decode', label: 'URL decode', icon: 'Globe2' }, { id: 'jwt', label: 'Decode JWT', icon: 'Shield' }, { id: 'timestamp', label: 'Timestamp', icon: 'History' }, { id: 'uuid', label: 'UUID', icon: 'Zap' }, { id: 'sha256', label: 'SHA-256', icon: 'LockKeyhole' }, { id: 'color', label: 'Inspect color', icon: 'Sun' },
]
const sections = ['Tools', 'Servers', 'Responsive', 'Page'] as const
type Section = (typeof sections)[number]

export default function DevPanel({ onClose, snapshot }: { onClose: () => void; snapshot: Snapshot }) {
  const servers = useAppStore((state) => state.servers)
  const [section, setSection] = useState<Section>('Tools')
  const [tool, setTool] = useState<DevTool>('json-pretty')
  const [input, setInput] = useState(`{
  "browser": "Athanor",
  "fast": true
}`)
  const [output, setOutput] = useState('')
  const [preset, setPreset] = useState<'mobile' | 'tablet' | 'laptop' | null>(null)
  const [copied, setCopied] = useState(false)
  const active = snapshot.workspace.tabs.find((tab) => tab.id === snapshot.workspace.activeTab)
  const run = async () => { if (tool === 'uuid') { setOutput(await api.runDevTool(tool, input)); return }; if (tool === 'sha256') { try { const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input)); setOutput([...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')) } catch { setOutput('SHA-256 is available in the native developer panel.') }; return }; setOutput(await api.runDevTool(tool, input)) }
  const openServer = (url: string) => void api.openTab({ url })
  const refreshServers = () => void api.listDevServers().then((found) => useAppStore.getState().setServers(found))
  const copyOutput = () => { void navigator.clipboard.writeText(output); setCopied(true); window.setTimeout(() => setCopied(false), 1200) }
  const selectPreset = (value: 'mobile' | 'tablet' | 'laptop') => { setPreset(value); if (active) void api.setViewportEmulation(active.id, value) }
  const resetPreset = () => { setPreset(null); if (active) void api.setViewportEmulation(active.id, null) }

  return <aside data-part="dev-panel" role="region" aria-label="Developer panel" className="absolute inset-x-0 bottom-0 z-[8] flex max-h-[58%] flex-col border-t border-border bg-background shadow-[0_-8px_30px_-12px_oklch(0_0_0/0.25)]">
    <div className="flex h-11 shrink-0 items-center gap-2 border-b border-border px-3">
      <AppIcon name="Terminal" className="size-4 shrink-0 text-muted-foreground" />
      <span className="shrink-0 text-sm font-semibold tracking-tight max-md:hidden">Developer tools</span>
      <Tabs value={section} onValueChange={(value) => setSection(value as Section)} className="min-w-0 overflow-x-auto">
        <TabsList>
          {sections.map((item) => <TabsTrigger key={item} value={item} data-active={String(section === item)}>{item}</TabsTrigger>)}
        </TabsList>
      </Tabs>
      <Tip label="Close developer panel"><Button variant="ghost" size="icon-sm" aria-label="Close developer panel" onClick={onClose} className="ms-auto shrink-0"><AppIcon name="X" /></Button></Tip>
    </div>

    {section === 'Tools' && <div className="grid min-h-0 flex-1 grid-cols-[14rem_minmax(0,1fr)] max-md:grid-cols-[7.5rem_minmax(0,1fr)]">
      <div className="flex min-h-0 flex-col gap-0.5 overflow-y-auto border-e border-border p-2">
        {tools.map((item) => <button key={item.id} data-active={String(tool === item.id)} onClick={() => { setTool(item.id); setOutput('') }} className="flex h-8 min-w-0 items-center gap-2 rounded-lg px-2 text-start text-[13px] text-muted-foreground transition-colors outline-none hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/40 data-[active=true]:bg-accent data-[active=true]:text-foreground max-md:min-h-11"><AppIcon name={item.icon} className="size-4 shrink-0" /><span className="truncate">{item.label}</span></button>)}
      </div>
      <div className="flex min-h-0 flex-col gap-2 overflow-y-auto p-3">
        <label htmlFor="dev-input" className="text-xs font-medium text-muted-foreground">Input</label>
        <Textarea id="dev-input" value={input} onChange={(event) => setInput(event.target.value)} className="min-h-24 resize-y font-mono text-[13px]" />
        <div className="flex items-center gap-2">
          <Button size="sm" onClick={() => void run()}>Run tool</Button>
          <Button variant="ghost" size="sm" onClick={() => setInput('')}>Clear</Button>
        </div>
        <div className="mt-1 flex items-center justify-between gap-3">
          <span className="text-xs font-medium text-muted-foreground">Output</span>
          <Button variant="outline" size="sm" disabled={!output} onClick={copyOutput}><AppIcon name={copied ? 'Check' : 'Copy'} />{copied ? 'Copied' : 'Copy output'}</Button>
        </div>
        <pre className="min-h-24 flex-1 overflow-auto rounded-lg border border-border bg-muted/40 p-3 font-mono text-[13px] whitespace-pre-wrap">{output || 'Your result will appear here.'}</pre>
      </div>
    </div>}

    {section === 'Servers' && <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-4">
      {servers.length ? servers.map((server) => <div key={server.url} className="flex items-center justify-between gap-4 rounded-xl border border-border p-3">
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="truncate text-sm font-medium">{server.title ?? `localhost:${server.port}`}</span>
          <span className="truncate text-[13px] text-muted-foreground">{server.url}</span>
        </div>
        <Button size="sm" className="shrink-0" onClick={() => openServer(server.url)}>Open</Button>
      </div>) : <Callout><AppIcon name="Globe2" className="size-4 shrink-0" />No local development servers detected.</Callout>}
      <div><Button variant="outline" size="sm" onClick={refreshServers}><AppIcon name="RotateCw" />Refresh</Button></div>
    </div>}

    {section === 'Responsive' && <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4">
      <div>
        <h3 className="m-0 text-sm font-semibold">Viewport emulation</h3>
        <p className="m-0 mt-0.5 text-[13px] text-muted-foreground">Resize the active native page inside its slot.</p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <div className="inline-flex items-center gap-1 rounded-lg border border-border p-1">
          {(['mobile', 'tablet', 'laptop'] as const).map((item) => <Button key={item} size="sm" variant={preset === item ? 'secondary' : 'ghost'} aria-pressed={preset === item} onClick={() => selectPreset(item)}><AppIcon name={item === 'mobile' ? 'AppWindow' : item === 'tablet' ? 'PanelsTopLeft' : 'Monitor'} />{item}</Button>)}
        </div>
        <Button size="sm" variant={preset ? 'secondary' : 'ghost'} onClick={resetPreset}>Reset</Button>
      </div>
    </div>}

    {section === 'Page' && <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4">
      <div>
        <h3 className="m-0 text-sm font-semibold">Page developer tools</h3>
        <p className="m-0 mt-0.5 text-[13px] text-muted-foreground">Open the native inspector for the current page.</p>
      </div>
      <div><Button onClick={() => active && api.openDevtools(active.id)} disabled={!active}><AppIcon name="Bug" />Open developer tools</Button></div>
    </div>}
  </aside>
}
