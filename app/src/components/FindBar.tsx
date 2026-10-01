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
 * previous one, Esc closes and gives the keyboard back to the page. The buttons give the keyboard straight back to
 * the field, so clicking one never ends your typing.
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
  const noneYet = !result?.count
  const nothing = query === '' ? 'Type what you are looking for' : 'Nothing to go to yet'
  const keepTyping = () => input.current?.focus()
  return <m.div initial={{ height: 0, opacity: 0 }} animate={{ height: 40, opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={snap} className="shrink-0 overflow-hidden" data-part="find-bar">
    <div className="flex h-10 items-center justify-center px-2" role="search" aria-label="Find in page">
      <div className={cn('flex h-8 w-[min(34rem,100%)] items-center gap-1 rounded-lg bg-foreground/[0.055] ps-2.5 pe-1 text-[0.8667rem] shadow-[inset_0_0_0_1px_oklch(0_0_0/0.04)] transition-shadow focus-within:shadow-[inset_0_0_0_1.5px_var(--ring)] dark:shadow-[inset_0_0_0_1px_oklch(1_0_0/0.05)]', none && 'shadow-[inset_0_0_0_1.5px_var(--destructive)]')}>
        <Search aria-hidden="true" className="size-[1rem] shrink-0 text-muted-foreground" />
        <input ref={input} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Find in page" aria-label="Find in page" spellCheck={false} autoComplete="off"
          className="h-full min-w-0 flex-1 bg-transparent outline-none placeholder:text-muted-foreground"
          onKeyDown={(event) => {
            if (event.key === 'Escape') { event.preventDefault(); onClose() }
            else if (event.key === 'Enter') { event.preventDefault(); step(event.shiftKey ? 'prev' : 'next') }
          }} />
        <span className={cn('shrink-0 px-1 font-instr text-[0.7333rem] tabular-nums text-muted-foreground', none && 'text-destructive')} aria-live="polite" aria-atomic="true">
          {query === '' ? '' : result === null ? '' : none ? 'Not found' : `${result.index} of ${result.count}`}
        </span>
        <Tip label={matchCase ? 'Ignore case' : 'Match case'} side="bottom"><button type="button" aria-pressed={matchCase} aria-label="Match case" onClick={() => { setMatchCase((value) => !value); keepTyping() }} className={cn('grid size-6 place-items-center rounded-md text-muted-foreground outline-none transition-colors hover:bg-foreground/10 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/40', matchCase && 'bg-foreground/[0.12] text-foreground')}><CaseSensitive aria-hidden="true" className="size-4" /></button></Tip>
        {/* The step buttons go disabled with nothing to step to; the span keeps their explanation reachable. */}
        <Tip label={noneYet ? nothing : 'Previous match'} shortcut={noneYet ? undefined : 'Shift+Enter'} side="bottom"><span className="inline-flex"><button type="button" aria-label="Previous match" aria-keyshortcuts="Shift+Enter" disabled={noneYet} onClick={() => { step('prev'); keepTyping() }} className="grid size-6 place-items-center rounded-md text-muted-foreground outline-none transition-colors hover:bg-foreground/10 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/40 disabled:opacity-40"><ChevronUp aria-hidden="true" className="size-4" /></button></span></Tip>
        <Tip label={noneYet ? nothing : 'Next match'} shortcut={noneYet ? undefined : 'Enter'} side="bottom"><span className="inline-flex"><button type="button" aria-label="Next match" aria-keyshortcuts="Enter" disabled={noneYet} onClick={() => { step('next'); keepTyping() }} className="grid size-6 place-items-center rounded-md text-muted-foreground outline-none transition-colors hover:bg-foreground/10 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/40 disabled:opacity-40"><ChevronDown aria-hidden="true" className="size-4" /></button></span></Tip>
        <Tip label="Close" shortcut="Esc" side="bottom"><button type="button" aria-label="Close find" aria-keyshortcuts="Escape" onClick={onClose} className="grid size-6 place-items-center rounded-md text-muted-foreground outline-none transition-colors hover:bg-foreground/10 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/40"><X aria-hidden="true" className="size-4" /></button></Tip>
      </div>
    </div>
  </m.div>
}
