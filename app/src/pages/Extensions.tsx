import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import type { ExtensionInfo } from '@/lib/types'
import { api } from '@/lib/api'
import { AppIcon } from '@/components/Icons'
import { Page, IconTile, Callout } from '@/components/page'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Switch } from '@/components/ui/switch'
import { Tip } from '@/components/ui/tooltip'

/** The wording, buttons and empty state are the ones Settings -> Extensions uses, so the two read the same. */
export default function ExtensionsPage() {
  const [extensions, setExtensions] = useState<ExtensionInfo[]>([])
  useEffect(() => { void refreshExtensions(setExtensions) }, [])
  const refresh = () => refreshExtensions(setExtensions)
  const install = async () => {
    const before = new Set(extensions.map((extension) => extension.id))
    try {
      const path = await api.pickDirectory()
      if (!path) return
      await api.installExtension(path)
      const next = await refresh()
      if (!next) return
      const added = next.find((extension) => !before.has(extension.id))
      if (added) toast.success(`Installed ${added.name}`)
      else toast.error('That folder is not an extension Athanor can install')
    } catch (error) { toast.error(why(error)) }
  }

  return <Page data-part="extension-settings" title="Extensions" description="Manage the tools installed in your browser." actions={<Button className="max-md:min-h-11" onClick={() => void install()}><AppIcon name="Plus" />Install from Folder…</Button>}>
    {extensions.length === 0 ? <Callout><AppIcon name="Zap" className="size-4 shrink-0" />No extensions installed.</Callout> : extensions.map((extension) => <Card key={extension.id} className="flex min-h-24 items-center gap-4 p-4 max-sm:flex-wrap">
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
        <TouchSwitch label={`${extension.enabled ? 'Disable' : 'Enable'} ${extension.name}`} checked={extension.enabled} onCheckedChange={(enabled) => void api.setExtensionEnabled(extension.id, enabled).then(refresh).catch((error) => toast.error(why(error)))} />
        {extension.source === 'user' && <Tip label={`Remove ${extension.name}`}><Button className="max-md:size-11" variant="ghost" size="icon" aria-label={`Remove ${extension.name}`} onClick={() => { void api.removeExtension(extension.id).then(() => { void refresh(); toast.success(`Removed ${extension.name}`) }).catch((error) => toast.error(why(error))) }}><AppIcon name="Trash2" className="text-destructive" /></Button></Tip>}
      </div>
    </Card>)}
  </Page>
}

/** Re-reads the list, and says so when it cannot: an empty list and a failed list must not look the same. `null` when the read failed. */
async function refreshExtensions(set: (next: ExtensionInfo[]) => void) {
  try { const list = await api.listExtensions(); set(list); return list }
  catch (error) { toast.error(why(error)); return null }
}

/** The reason the backend gave, in the words Settings shows. */
function why(error: unknown) { return error instanceof Error ? error.message : String(error) }

/** A switch sized for touch; the name lives on the switch itself, so the wrapper only pads the target. */
function TouchSwitch({ label, checked, onCheckedChange }: { label: string; checked: boolean; onCheckedChange: (checked: boolean) => void }) {
  return <div className="grid place-items-center max-md:size-11"><Switch aria-label={label} checked={checked} onCheckedChange={onCheckedChange} /></div>
}
