import { useEffect, useState } from 'react'
import type { ExtensionInfo } from '@/lib/types'
import { api } from '@/lib/api'
import { AppIcon } from '@/components/Icons'
import { Button } from '@/components/ui/button'

export default function ExtensionsPage() {
  const [extensions, setExtensions] = useState<ExtensionInfo[]>([])
  useEffect(() => { void api.listExtensions().then(setExtensions) }, [])
  const refresh = () => void api.listExtensions().then(setExtensions)
  const install = async () => { const path = await api.pickDirectory(); if (path) { await api.installExtension(path); refresh() } }
  return <div className="page-scroll" data-part="extension-settings"><header className="page-header"><div><h1>Extensions</h1><p className="muted-copy">Small tools that extend your browser, with clear permissions.</p></div><Button onClick={() => void install()}><AppIcon name="Plus" />Install from directory</Button></header>{extensions.map((extension) => <section key={extension.id} className="page-section"><div className="switch-row"><div><strong>{extension.name}</strong><p>{extension.description}</p><span className="muted-copy">Permissions: {extension.permissions.join(', ') || 'None'} · {extension.version}</span></div><div className="extension-actions"><button className="switch" role="switch" aria-label={`${extension.enabled ? 'Disable' : 'Enable'} ${extension.name}`} aria-checked={extension.enabled} data-checked={String(extension.enabled)} onClick={() => void api.setExtensionEnabled(extension.id, !extension.enabled).then(refresh)} />{extension.source === 'user' && <Button variant="ghost" size="icon" aria-label={`Remove ${extension.name}`} onClick={() => void api.removeExtension(extension.id).then(refresh)}><AppIcon name="Trash2" /></Button>}</div></div></section>)}{extensions.length === 0 && <section className="page-section"><p className="muted-copy">No extensions installed yet.</p></section>}</div>
}
