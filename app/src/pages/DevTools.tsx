import { useState } from 'react'
import type { DevTool, Snapshot } from '@/lib/types'
import { api } from '@/lib/api'
import { useAppStore } from '@/lib/store'
import { AppIcon } from '@/components/Icons'
import { Button } from '@/components/ui/button'

const tools: { id: DevTool; label: string; icon: string }[] = [
  { id: 'json-pretty', label: 'Format JSON', icon: 'FileCode2' }, { id: 'json-minify', label: 'Minify JSON', icon: 'FileCode2' }, { id: 'base64-encode', label: 'Base64 encode', icon: 'LockKeyhole' }, { id: 'base64-decode', label: 'Base64 decode', icon: 'LockKeyhole' }, { id: 'url-encode', label: 'URL encode', icon: 'Globe2' }, { id: 'url-decode', label: 'URL decode', icon: 'Globe2' }, { id: 'jwt', label: 'Decode JWT', icon: 'Shield' }, { id: 'timestamp', label: 'Timestamp', icon: 'History' }, { id: 'uuid', label: 'UUID', icon: 'Zap' }, { id: 'sha256', label: 'SHA-256', icon: 'LockKeyhole' }, { id: 'color', label: 'Inspect color', icon: 'Sun' },
]
type Section = 'Tools' | 'Servers' | 'Responsive' | 'Page'
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
  return <aside className="dev-panel" data-part="dev-panel" role="region" aria-label="Developer panel">
    <div className="dev-panel-header"><AppIcon name="Terminal" /><strong>Developer tools</strong><div className="dev-tabs">{(['Tools', 'Servers', 'Responsive', 'Page'] as Section[]).map((item) => <button key={item} className="dev-tab" data-active={String(section === item)} onClick={() => setSection(item)}>{item}</button>)}</div><button className="icon-button" aria-label="Close developer panel" onClick={onClose}><AppIcon name="X" /></button></div>
    {section === 'Tools' && <div className="dev-panel-body"><div className="dev-tool-list">{tools.map((item) => <button key={item.id} className="menu-item" data-active={String(tool === item.id)} onClick={() => { setTool(item.id); setOutput('') }}><AppIcon name={item.icon} />{item.label}</button>)}</div><div className="dev-output"><label htmlFor="dev-input">Input</label><textarea id="dev-input" className="textarea" value={input} onChange={(event) => setInput(event.target.value)} /><div className="dev-actions"><Button onClick={() => void run()}>Run tool</Button><Button variant="ghost" size="sm" onClick={() => setInput('')}>Clear</Button></div><label>Output</label><pre>{output || 'Your result will appear here.'}</pre><Button variant="outline" size="sm" disabled={!output} onClick={() => { void navigator.clipboard.writeText(output); setCopied(true); window.setTimeout(() => setCopied(false), 1200) }}><AppIcon name={copied ? 'Check' : 'Copy'} />{copied ? 'Copied' : 'Copy output'}</Button></div></div>}
    {section === 'Servers' && <div className="dev-panel-body dev-server-list">{servers.length ? servers.map((server) => <div className="server-card" key={server.url}><div><strong>{server.title ?? `localhost:${server.port}`}</strong><span className="muted-copy">{server.url}</span></div><Button size="sm" onClick={() => openServer(server.url)}>Open</Button></div>) : <p className="muted-copy">No local development servers detected.</p>}<Button variant="outline" size="sm" onClick={() => void api.listDevServers().then((found) => useAppStore.getState().setServers(found))}><AppIcon name="RotateCw" />Refresh</Button></div>}
    {section === 'Responsive' && <div className="dev-panel-body responsive-presets"><div><h3>Viewport emulation</h3><p className="muted-copy">Resize the active native page inside its slot.</p></div>{(['mobile', 'tablet', 'laptop'] as const).map((item) => <Button key={item} variant={preset === item ? 'default' : 'outline'} onClick={() => { setPreset(item); if (active) void api.setViewportEmulation(active.id, item) }}><AppIcon name={item === 'mobile' ? 'AppWindow' : item === 'tablet' ? 'PanelsTopLeft' : 'Monitor'} />{item}</Button>)}<Button variant={preset ? 'secondary' : 'ghost'} onClick={() => { setPreset(null); if (active) void api.setViewportEmulation(active.id, null) }}>Reset</Button></div>}
    {section === 'Page' && <div className="dev-panel-body dev-server-list"><div><h3>Page developer tools</h3><p className="muted-copy">Open the native inspector for the current page.</p></div><Button onClick={() => active && api.openDevtools(active.id)} disabled={!active}><AppIcon name="Bug" />Open developer tools</Button></div>}
  </aside>
}
