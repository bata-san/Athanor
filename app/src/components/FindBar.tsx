import { useEffect, useRef, useState } from 'react'
import { ChevronDown, ChevronUp, CaseSensitive, Search, X } from 'lucide-react'
import { m } from 'motion/react'
import type { Id } from '@/lib/types'
import { api } from '@/lib/api'
import { listen } from '@/lib/events'
import { cn } from '@/lib/utils'
import { snap } from '@/lib/motion'
import { Tip } from './ui/tooltip'

/**
 * Find in page. Lives in a strip between the toolbar and the page (not over it), so the page stays live and its
 * highlights stay visible while you type. Enter / Ctrl+G go to the next match, Shift+Enter / Ctrl+Shift+G to the
 * previous one, Esc closes.
 */
export function FindBar({ tab, url, seed, onClose, commandRef }: { tab: Id; url: string; seed: number; onClose: () => void; commandRef: React.MutableRefObject<((action: 'next' | 'prev') => void) | null> }) {
  const [query, setQuery] = useState('')
  const [matchCase, setMatchCase] = useState(false)
  const [result, setResult] = useState<{ count: number; index: number } | null>(null)
  const input = useRef<HTMLInputElement>(null)
  const state = useRef({ query, matchCase, tab })
  state.current = { query, matchCase, tab }

  // Results come back asynchronously from the page.
  useEffect(() => {
    const off = listen('athanor://find', (payload) => { if (payload.tab === state.current.tab) setResult({ count: payload.count, index: payload.index }) })
    return () => { void off.then((fn) => fn()) }
  }, [])

  // Take the keyboard (the page may have it) every time Ctrl+F is pressed, and search for the selection-less query.
  useEffect(() => { void api.focusShell().then(() => { input.current?.focus(); input.current?.select() }) }, [seed])

  // Search as you type.
  useEffect(() => {
    const timer = window.setTimeout(() => { void api.findInPage(tab, 'start', query, matchCase); if (!query) setResult(null) }, query ? 70 : 0)
    return () => window.clearTimeout(timer)
  }, [query, matchCase, tab])

  // A different page: the old highlights are gone, so is the bar.
  const first = useRef(url)
  useEffect(() => { if (first.current !== url) onClose() }, [url, onClose])
  useEffect(() => () => { void api.findInPage(state.current.tab, 'clear', '', false) }, [])

  const step = (action: 'next' | 'prev') => { if (state.current.query) void api.findInPage(state.current.tab, action, state.current.query, state.current.matchCase) }
  useEffect(() => { commandRef.current = step; return () => { commandRef.current = null } })

  const none = query !== '' && result !== null && result.count === 0
  return <m.div initial={{ height: 0, opacity: 0 }} animate={{ height: 40, opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={snap} className="shrink-0 overflow-hidden" data-part="find-bar">
    <div className="flex h-10 items-center justify-center px-2" role="search" aria-label="Find in page">
      <div className={cn('flex h-8 w-[min(34rem,100%)] items-center gap-1 rounded-lg bg-foreground/[0.055] ps-2.5 pe-1 text-[13px] shadow-[inset_0_0_0_1px_oklch(0_0_0/0.04)] transition-shadow focus-within:shadow-[inset_0_0_0_1.5px_var(--ring)] dark:shadow-[inset_0_0_0_1px_oklch(1_0_0/0.05)]', none && 'shadow-[inset_0_0_0_1.5px_var(--destructive)]')}>
        <Search className="size-[15px] shrink-0 text-muted-foreground" />
        <input ref={input} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Find in page" aria-label="Find in page" spellCheck={false} autoComplete="off"
          className="h-full min-w-0 flex-1 bg-transparent outline-none placeholder:text-muted-foreground"
          onKeyDown={(event) => {
            if (event.key === 'Escape') { event.preventDefault(); onClose() }
            else if (event.key === 'Enter') { event.preventDefault(); step(event.shiftKey ? 'prev' : 'next') }
          }} />
        <span className={cn('shrink-0 px-1 font-instr text-[11px] tabular-nums text-muted-foreground', none && 'text-destructive')} aria-live="polite">
          {query === '' ? '' : result === null ? '' : none ? 'Not found' : `${result.index} of ${result.count}`}
        </span>
        <Tip label="Match case" side="bottom"><button type="button" aria-pressed={matchCase} aria-label="Match case" onClick={() => setMatchCase((value) => !value)} className={cn('grid size-6 place-items-center rounded-md text-muted-foreground outline-none transition-colors hover:bg-foreground/10 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/40', matchCase && 'bg-foreground/[0.12] text-foreground')}><CaseSensitive className="size-4" /></button></Tip>
        <Tip label="Previous match" shortcut="Shift+Enter" side="bottom"><button type="button" aria-label="Previous match" disabled={!result?.count} onClick={() => step('prev')} className="grid size-6 place-items-center rounded-md text-muted-foreground outline-none transition-colors hover:bg-foreground/10 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/40 disabled:opacity-40"><ChevronUp className="size-4" /></button></Tip>
        <Tip label="Next match" shortcut="Enter" side="bottom"><button type="button" aria-label="Next match" disabled={!result?.count} onClick={() => step('next')} className="grid size-6 place-items-center rounded-md text-muted-foreground outline-none transition-colors hover:bg-foreground/10 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/40 disabled:opacity-40"><ChevronDown className="size-4" /></button></Tip>
        <Tip label="Close" shortcut="Esc" side="bottom"><button type="button" aria-label="Close find" onClick={onClose} className="grid size-6 place-items-center rounded-md text-muted-foreground outline-none transition-colors hover:bg-foreground/10 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/40"><X className="size-4" /></button></Tip>
      </div>
    </div>
  </m.div>
}
