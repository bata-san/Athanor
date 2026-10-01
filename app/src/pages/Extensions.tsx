import { useEffect, useState } from 'react'
import type { ExtensionInfo } from '@/lib/types'
import { api } from '@/lib/api'
import { AppIcon } from '@/components/Icons'
import { Page, IconTile, Callout } from '@/components/page'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Switch } from '@/components/ui/switch'
import { Tip } from '@/components/ui/tooltip'

export default function ExtensionsPage() {
  const [extensions, setExtensions] = useState<ExtensionInfo[]>([])
  useEffect(() => { void api.listExtensions().then(setExtensions) }, [])
  const refresh = () => void api.listExtensions().then(setExtensions)
  const install = async () => {
    const path = await api.pickDirectory()
    if (path) { await api.installExtension(path); refresh() }
  }

  return <Page data-part="extension-settings" title="Extensions" description="Small tools that extend your browser, with clear permissions." actions={<Button className="max-md:min-h-11" onClick={() => void install()}><AppIcon name="Plus" />Install from directory</Button>}>
    {extensions.length === 0 ? <Callout><AppIcon name="Zap" className="size-4 shrink-0" />No extensions installed yet.</Callout> : extensions.map((extension) => <Card key={extension.id} className="flex min-h-24 items-center gap-4 p-4 max-sm:flex-wrap">
      <IconTile icon="Zap" className="size-10 rounded-xl" />
      <div className="min-w-0 flex-1">
        <h2 className="m-0 text-sm font-semibold">{extension.name}</h2>
        <p className="m-0 mt-0.5 text-[0.8667rem] text-muted-foreground">{extension.description}</p>
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <span className="me-1 text-xs text-muted-foreground">Permissions:</span>
          {extension.permissions.length ? extension.permissions.map((permission) => <Badge key={permission} variant="outline">{permission}</Badge>) : <Badge variant="outline">None</Badge>}
          <span className="ms-1 text-xs text-muted-foreground">· {extension.version}</span>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <TouchSwitch label={`${extension.enabled ? 'Disable' : 'Enable'} ${extension.name}`} checked={extension.enabled} onCheckedChange={(enabled) => void api.setExtensionEnabled(extension.id, enabled).then(refresh)} />
        {extension.source === 'user' && <Tip label={`Remove ${extension.name}`}><Button className="max-md:size-11" variant="ghost" size="icon" aria-label={`Remove ${extension.name}`} onClick={() => void api.removeExtension(extension.id).then(refresh)}><AppIcon name="Trash2" /></Button></Tip>}
      </div>
    </Card>)}
  </Page>
}

function TouchSwitch({ label, checked, onCheckedChange }: { label: string; checked: boolean; onCheckedChange: (checked: boolean) => void }) {
  return <label className="grid place-items-center max-md:size-11"><Switch aria-label={label} checked={checked} onCheckedChange={onCheckedChange} /></label>
}
