import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowLeft, ArrowRight, Bug, ClipboardPaste, Copy, Download, ExternalLink, FileCode2, ImagePlus, Image as ImageIcon, Languages, Link2, Printer, Redo2, RotateCw, Scissors, Search, SpellCheck, TextSelect, Undo2,
  type LucideIcon,
} from 'lucide-react'
import type { ContextItem, PageContextMenu } from '@/lib/types'
import { api } from '@/lib/api'
import { useOverlay } from '@/lib/overlay'
import { cn } from '@/lib/utils'
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuShortcut, ContextMenuSub, ContextMenuSubContent, ContextMenuSubTrigger, ContextMenuTrigger } from './ui/context-menu'

/** The engine's own entries we never show: they lead to services Athanor does not ship. */
const HIDDEN = /moretools|share|webcapture|screenshot|collections|copilot|readaloud|emoji|cast|immersive|translate|reading|bing|sidebar|feedback|lookup|webselect/i

/** Keys are the engine's own command names (what WebView2 reports for the Edge/Chromium menu, spaces removed). */
const ICONS: Record<string, LucideIcon> = {
  back: ArrowLeft, forward: ArrowRight, reload: RotateCw,
  saveas: Download, saveimageas: Download, savelinkas: Download, savevideoas: Download, saveaudioas: Download,
  print: Printer, cut: Scissors, copy: Copy, paste: ClipboardPaste, pasteasplaintext: ClipboardPaste, selectall: TextSelect, undo: Undo2, redo: Redo2,
  copyimage: ImageIcon, copyimagelocation: Link2, copylinklocation: Link2, copyvideolocation: Link2, copyaudiolocation: Link2, copylinktohighlight: Link2,
  openimageinnewtab: ExternalLink, openlinkinnewwindow: ExternalLink,
  inspectelement: Bug, viewpagesource: FileCode2, spellcheck: SpellCheck, languages: Languages,
}

type Entry =
  | { type: 'item'; key: string; name?: string; label: string; icon?: LucideIcon; shortcut?: string | null; enabled: boolean; checked?: boolean; destructive?: boolean; run: () => void }
  | { type: 'separator'; key: string }
  | { type: 'sub'; key: string; name: string; label: string; icon?: LucideIcon; children: Entry[] }
  | { type: 'nav'; key: string; items: Extract<Entry, { type: 'item' }>[] }

const clean = (label: string) => label.replace(/&(?!&)/g, '').replace('&&', '&')
const clip = (text: string, max = 28) => { const flat = text.replace(/\s+/g, ' ').trim(); return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat }

/** Shell-side description of the engine menu: engine entries (filtered, icons added) plus Athanor's own. */
export function buildPageMenu(request: PageContextMenu, searchEngine: string, answer: (command: number | null) => void): Entry[] {
  const { target, tab } = request
  const mine: Entry[] = []
  const custom = (key: string, label: string, icon: LucideIcon, run: () => void): Entry => ({ type: 'item', key, label, icon, enabled: true, run: () => { answer(null); run() } })
  if (target.linkUrl) {
    const url = target.linkUrl
    mine.push(custom('athanor-open-link', 'Open link in new tab', ExternalLink, () => void api.openTab({ url, parent: tab })))
  }
  if (target.kind === 'image' && target.sourceUrl && /^https?:\/\//.test(target.sourceUrl)) {
    const src = target.sourceUrl
    mine.push(custom('athanor-image-board', 'Send image to board', ImagePlus, () => void api.contextAction('send-image-to-board', src)))
  }
  if (target.selectionText) {
    const query = target.selectionText.trim().slice(0, 300)
    const url = searchEngine.replace('{q}', encodeURIComponent(query))
    mine.push(custom('athanor-search', `Search “${clip(query, 24)}”`, Search, () => void api.openTab({ url, parent: tab })))
  }

  const build = (items: ContextItem[], depth = 0): Entry[] => {
    const out: Entry[] = []
    for (const item of items) {
      if (item.kind === 'separator') { out.push({ type: 'separator', key: `sep-${item.id}-${out.length}` }); continue }
      const probe = `${item.name} ${item.label}`
      if (HIDDEN.test(probe)) continue
      if (/^openlinkinnew(window|tab)/.test(item.name) && target.linkUrl) continue // replaced by our own
      if (/^search/.test(item.name) && target.selectionText) continue
      if (item.kind === 'submenu' && !item.name) continue // the engine's anonymous "More tools" bucket
      const label = clean(item.label)
      if (item.kind === 'submenu') {
        const children = depth < 2 ? build(item.children, depth + 1) : []
        if (children.some((c) => c.type !== 'separator')) out.push({ type: 'sub', key: `sub-${item.id}`, name: item.name, label, icon: ICONS[item.name], children })
        continue
      }
      out.push({ type: 'item', key: `cmd-${item.id}`, name: item.name, label, icon: ICONS[item.name], shortcut: item.shortcut, enabled: item.enabled, checked: item.kind === 'checkbox' || item.kind === 'radio' ? item.checked : undefined, run: () => answer(item.id) })
    }
    return out
  }
  let entries = build(request.items)
  // Back / Forward / Reload become one compact icon row.
  const navNames = ['back', 'forward', 'reload']
  const navItems = request.items.filter((item) => item.kind === 'command' && navNames.includes(item.name))
  if (navItems.length) {
    const row: Extract<Entry, { type: 'item' }>[] = navNames.flatMap((name) => { const item = navItems.find((candidate) => candidate.name === name); return item ? [{ type: 'item' as const, key: `cmd-${item.id}`, name, label: clean(item.label), icon: ICONS[name], shortcut: item.shortcut, enabled: item.enabled, run: () => answer(item.id) }] : [] })
    entries = [{ type: 'nav', key: 'nav', items: row }, ...entries.filter((entry) => !(entry.type === 'item' && navItems.some((nav) => `cmd-${nav.id}` === entry.key)))]
  }
  entries = [...mine, ...(mine.length ? [{ type: 'separator', key: 'sep-mine' } as Entry] : []), ...entries]
  // Tidy separators: no leading / trailing / doubled ones.
  const tidy: Entry[] = []
  for (const entry of entries) {
    if (entry.type === 'separator' && (tidy.length === 0 || tidy[tidy.length - 1]!.type === 'separator')) continue
    tidy.push(entry)
  }
  while (tidy.length && tidy[tidy.length - 1]!.type === 'separator') tidy.pop()
  return tidy
}

function Entries({ entries }: { entries: Entry[] }) {
  return <>{entries.map((entry) => {
    if (entry.type === 'separator') return <ContextMenuSeparator key={entry.key} />
    if (entry.type === 'nav') return <div key={entry.key} className="mb-1 grid grid-cols-3 gap-1">{entry.items.map((item) => { const Icon = item.icon; return <ContextMenuItem key={item.key} data-command={item.name} disabled={!item.enabled} title={`${item.label}${item.shortcut ? ` (${item.shortcut})` : ''}`} aria-label={item.label} className="h-9 justify-center px-0" onSelect={item.run}>{Icon && <Icon />}</ContextMenuItem> })}</div>
    if (entry.type === 'sub') { const Icon = entry.icon; return <ContextMenuSub key={entry.key}><ContextMenuSubTrigger data-command={entry.name || entry.key}>{Icon ? <Icon /> : <span className="size-4" />}{entry.label}</ContextMenuSubTrigger><ContextMenuSubContent><Entries entries={entry.children} /></ContextMenuSubContent></ContextMenuSub> }
    const Icon = entry.icon
    return <ContextMenuItem key={entry.key} data-command={entry.name ?? entry.key} disabled={!entry.enabled} destructive={entry.destructive} onSelect={entry.run}>{Icon ? <Icon /> : <span className="size-4" />}<span className={cn('truncate', entry.checked && 'font-medium')}>{entry.label}</span>{entry.shortcut && <ContextMenuShortcut>{entry.shortcut}</ContextMenuShortcut>}</ContextMenuItem>
  })}</>
}

/**
 * Draws the engine's right-click menu with shadcn. The engine keeps the request open (WebView2 deferral);
 * every way of closing this menu answers it exactly once: with the chosen command id, or `null` to dismiss.
 * `anchor` is the shell-space position of the click.
 */
export function PageContextMenuView({ request, anchor, searchEngine, onClose }: { request: PageContextMenu | null; anchor: { x: number; y: number } | null; searchEngine: string; onClose: () => void }) {
  const catcher = useRef<HTMLDivElement>(null)
  const answered = useRef(false)
  const opened = useRef(false)
  const [open, setOpen] = useState(false)
  useOverlay(open, 'page-menu')

  const answer = useCallback((command: number | null) => {
    if (answered.current || !request) return
    answered.current = true
    void api.resolveContextMenu(request.tab, command)
  }, [request])
  const entries = useMemo(() => request ? buildPageMenu(request, searchEngine, answer) : [], [request, searchEngine, answer])

  // Open at the click position by replaying a contextmenu event on the (invisible) trigger. If the menu does
  // not come up (it always should), answer the engine anyway so the page is never left waiting.
  useEffect(() => {
    if (!request || !anchor) return
    answered.current = false
    opened.current = false
    catcher.current?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: anchor.x, clientY: anchor.y, button: 2 }))
    const watchdog = window.setTimeout(() => { if (!opened.current) { answer(null); onClose() } }, 600)
    return () => window.clearTimeout(watchdog)
  }, [request, anchor, answer, onClose])

  // Anything that closes the menu without a choice dismisses the engine's request.
  const onOpenChange = (next: boolean) => {
    setOpen(next)
    if (next) opened.current = true
    else { answer(null); onClose() }
  }
  // Nothing to show (every entry was filtered): answer right away so the page is not left waiting.
  useEffect(() => { if (request && entries.length === 0) { answer(null); onClose()} }, [request, entries.length, answer, onClose])

  return <ContextMenu onOpenChange={onOpenChange}>
    <ContextMenuTrigger asChild><div ref={catcher} aria-hidden="true" className="pointer-events-none fixed inset-0 -z-10" data-part="page-context-anchor" /></ContextMenuTrigger>
    <ContextMenuContent className="min-w-56" data-part="page-context-menu" onCloseAutoFocus={(event) => event.preventDefault()}>
      <Entries entries={entries} />
    </ContextMenuContent>
  </ContextMenu>
}
