import { useEffect, useState } from 'react'
import { KeyRound, Search, Trash2 } from 'lucide-react'
import type { PasswordInfo, Tab } from '@/lib/types'
import { api } from '@/lib/api'
import { useOverlay } from '@/lib/overlay'
import { Button } from './ui/button'
import { Input } from './ui/input'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from './ui/dialog'
import { askConfirm } from './dialogs'

export function Passwords({ open, onOpenChange, activeTab, platform }: { open: boolean; onOpenChange: (open: boolean) => void; activeTab: Tab | null; platform: string }) {
  const [items, setItems] = useState<PasswordInfo[]>([])
  const [query, setQuery] = useState('')
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState('')
  const [error, setError] = useState('')
  useOverlay(open, 'passwords')
  useEffect(() => { if (!open) return; let alive = true; setError(''); setStatus(''); void api.passwordList().then((items) => { if (alive) setItems(items) }).catch((error) => { if (alive) setError(String(error)) }); return () => { alive = false } }, [open])
  const perform = async (action: () => Promise<void>) => { setBusy(true); setError(''); setStatus(''); try { await action() } catch (error) { setError(String(error)) } finally { setBusy(false) } }
  const importPasswords = () => perform(async () => { const report = await api.passwordImport(); if (!report) return; setItems(await api.passwordList()); setStatus(`Imported ${report.imported} passwords · Updated ${report.updated} · Skipped ${report.skipped}`) })
  const site = (() => { try { return activeTab ? new URL(activeTab.url).origin : '' } catch { return '' } })()
  const shown = items.filter((item) => `${item.origin} ${item.username}`.toLocaleLowerCase().includes(query.toLocaleLowerCase())).sort((a, b) => Number(b.origin === site) - Number(a.origin === site) || a.origin.localeCompare(b.origin))
  return <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent data-part="passwords" aria-describedby="password-description">
      <DialogHeader><DialogTitle className="text-base font-semibold">Passwords</DialogTitle><DialogDescription id="password-description">Import a password CSV from Chrome, Edge or Firefox. Saved passwords are encrypted for your Windows account.</DialogDescription></DialogHeader>
      {platform !== 'windows' ? <p className="px-5 text-sm text-muted-foreground">Password import is currently available on Windows.</p> : <>
        <div className="px-5 pt-4"><div className="relative"><Search className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" /><Input className="ps-9" value={query} onChange={(event) => setQuery(event.target.value)} aria-label="Search saved passwords" placeholder="Search sites or usernames" /></div>
          <p className="mb-0 text-xs text-muted-foreground">Chrome / Edge: Password Manager → Settings → Export passwords. Firefox: Passwords → menu → Export passwords. After import, delete the exported CSV because it contains readable passwords.</p>
        </div>
        <div className="mt-3 min-h-0 overflow-y-auto px-5">
          {!shown.length && <div className="flex flex-col items-center gap-2 py-8 text-sm text-muted-foreground"><KeyRound className="size-6" /><span>{query ? 'No matching passwords' : 'No saved passwords yet'}</span></div>}
          {shown.map((item) => <div key={item.id} className="flex items-center gap-3 border-b border-border py-3 last:border-0" data-part="password-item">
            <div className="min-w-0 flex-1"><p className="m-0 break-all text-sm font-medium">{item.origin}</p><p className="m-0 mt-1 break-all text-xs text-muted-foreground">{item.username || 'No username'}</p></div>
            <Button variant="outline" size="sm" disabled={busy} className="max-md:min-h-11" onClick={() => void perform(async () => { if (item.origin !== site) { await api.openTab({ url: item.origin }); onOpenChange(false); return }; if (activeTab) { await api.passwordFill(item.id, activeTab.id); onOpenChange(false) } })}>{item.origin === site ? 'Fill login' : 'Open site'}</Button>
            <Button variant="ghost" size="icon-sm" disabled={busy} aria-label={`Delete password for ${item.username} at ${item.origin}`} className="max-md:size-11" onClick={() => void perform(async () => { if (await askConfirm({ title: 'Delete saved password?', description: `${item.username || 'This account'} at ${item.origin}. You can import it again from your original browser.`, confirm: 'Delete' })) { await api.passwordRemove(item.id); setItems(await api.passwordList()) } })}><Trash2 className="size-4" /></Button>
          </div>)}
        </div>
      </>}
      {(status || error) && <p className={`m-0 px-5 pt-3 text-sm ${error ? 'text-destructive' : 'text-muted-foreground'}`} role={error ? 'alert' : 'status'}>{error || status}</p>}
      <DialogFooter className="pt-4"><Button variant="outline" disabled={busy} onClick={() => onOpenChange(false)}>Done</Button>{platform === 'windows' && <Button disabled={busy} onClick={() => void importPasswords()}>{busy ? 'Processing…' : 'Import passwords…'}</Button>}</DialogFooter>
    </DialogContent>
  </Dialog>
}
