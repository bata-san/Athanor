import { useCallback, useEffect, useMemo, useState } from 'react'
import type * as React from 'react'
import { AnimatePresence, m } from 'motion/react'
import { ArrowLeft, ArrowRight, Check, Download, FileText, Layers3, LayoutPanelTop, Loader2, PanelLeft, PanelRight, Search, ShieldCheck, Sparkles, SquareTerminal, X } from 'lucide-react'
import type { DetectedBrowser, ImportReport, Snapshot } from '@/lib/types'
import { api } from '@/lib/api'
import { enter, snap } from '@/lib/motion'
import { useOverlay } from '@/lib/overlay'
import { SHORTCUTS } from '@/lib/shortcuts'
import { cn } from '@/lib/utils'
import { AthanorMark } from '../AthanorMark'
import { Button } from '../ui/button'
import { Kbd } from '../ui/kbd'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select'
import { Switch } from '../ui/switch'

const ALL_STEPS = ['Welcome', 'Import', 'Look', 'Privacy', 'Ready'] as const
type StepName = (typeof ALL_STEPS)[number]

/**
 * First-run welcome. A full-window overlay in two panes: the step list (left), and
 * the step itself (right). Everything chosen here is applied live, so "Skip" is always safe.
 */
export function Welcome({ snapshot, onDone }: { snapshot: Snapshot; onDone: () => void }) {
  const [step, setStep] = useState(0)
  const [direction, setDirection] = useState(1)
  const [imported, setImported] = useState<ImportReport[]>([])
  // Importing from other browsers is a Windows feature; elsewhere the step is simply left out.
  const STEPS = useMemo<readonly StepName[]>(() => snapshot.platform === 'windows' ? ALL_STEPS : ALL_STEPS.filter((name) => name !== 'Import'), [snapshot.platform])
  useOverlay(true, 'welcome')
  const go = useCallback((next: number) => { setDirection(next > step ? 1 : -1); setStep(Math.max(0, Math.min(STEPS.length - 1, next))) }, [step, STEPS.length])
  const last = step === STEPS.length - 1

  // Keyboard: Enter / Right = next, Left = back (never while typing or choosing in a control).
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      if (target?.closest('input, textarea, [role="combobox"], [role="listbox"], [role="radio"], [role="switch"], button')) return
      if (event.key === 'ArrowRight' || event.key === 'Enter') { event.preventDefault(); if (last) onDone(); else go(step + 1) }
      if (event.key === 'ArrowLeft') { event.preventDefault(); go(step - 1) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [go, last, onDone, step])
  const name = STEPS[step]!

  return <m.div className="fixed inset-0 z-[90] flex bg-background text-foreground" data-part="welcome" role="dialog" aria-modal="true" aria-label="Welcome to Athanor"
    initial={{ opacity: 0, scale: 1.015 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.985 }} transition={{ duration: 0.28, ease: [0.2, 0.9, 0.25, 1] }}>
    {/* left: where you are */}
    <aside className="relative hidden w-[40%] max-w-[38rem] shrink-0 flex-col justify-between overflow-hidden bg-foreground p-10 text-background md:flex">
      <div className="pointer-events-none absolute -bottom-1/3 -start-1/4 size-[120%] rounded-full opacity-[0.10]" style={{ background: 'radial-gradient(closest-side, currentColor, transparent)' }} aria-hidden="true" />
      <header className="relative flex items-center gap-3 text-[1rem] font-semibold tracking-tight"><span className="grid size-8 place-items-center rounded-lg bg-background text-foreground"><AthanorMark className="size-[1.2rem]" /></span>Athanor</header>
      <nav className="relative" aria-label="Setup progress">
        <ol className="m-0 flex list-none flex-col gap-1 p-0">
          {STEPS.map((label, index) => <li key={label}>
            <button type="button" disabled={index > step} onClick={() => index <= step && go(index)} aria-current={index === step ? 'step' : undefined}
              className={cn('group relative flex w-full items-baseline gap-4 rounded-lg px-3 py-2 text-start outline-none transition-colors focus-visible:ring-2 focus-visible:ring-background/40', index === step ? 'text-background' : index < step ? 'text-background/60 hover:text-background' : 'text-background/30')}>
              {index === step && <m.span layoutId="welcome-rail" transition={snap} className="absolute inset-y-1 start-0 w-0.5 rounded-full bg-background" />}
              <span className="font-instr text-[0.7333rem] tabular-nums opacity-70">{String(index + 1).padStart(2, '0')}</span>
              <span className="text-[1.6rem] font-semibold leading-tight tracking-tight">{label}</span>
              {index < step && <Check aria-hidden="true" className="ms-auto size-4 self-center opacity-70" />}
            </button>
          </li>)}
        </ol>
      </nav>
      <footer className="relative flex items-end justify-between text-xs text-background/50">
        <span>A quiet, fast browser.</span>
        <span className="font-instr tabular-nums">v{snapshot.version}</span>
      </footer>
    </aside>

    {/* right: the step */}
    <section className="relative flex min-w-0 flex-1 flex-col">
      <header className="flex h-14 shrink-0 items-center justify-between gap-4 px-6 md:px-10">
        <div className="min-w-0 flex-1 md:hidden"><StepScale steps={STEPS} step={step} onPick={(index) => index <= step && go(index)} /></div><span className="hidden flex-1 md:block" />
        {!last && <Button variant="ghost" size="sm" className="text-muted-foreground" onClick={onDone}>Skip setup</Button>}
      </header>
      {/* The step swaps in place, so the change is announced for anyone not looking at the rail. */}
      <p className="sr-only" aria-live="polite">{`Step ${step + 1} of ${STEPS.length}: ${name}`}</p>
      <div className="relative min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex min-h-full w-full max-w-[32rem] flex-col justify-center px-6 py-6 md:px-0">
          <AnimatePresence mode="wait" custom={direction} initial={false}>
            <m.div key={step} custom={direction}
              variants={{ enter: (d: number) => ({ opacity: 0, x: d * 28 }), center: { opacity: 1, x: 0 }, exit: (d: number) => ({ opacity: 0, x: d * -28 }) }}
              initial="enter" animate="center" exit="exit" transition={enter}>
              {name === 'Welcome' && <IntroStep />}
              {name === 'Import' && <ImportStep platform={snapshot.platform} imported={imported} onImported={(report) => setImported((current) => [...current, report])} />}
              {name === 'Look' && <LookStep snapshot={snapshot} />}
              {name === 'Privacy' && <PrivacyStep snapshot={snapshot} />}
              {name === 'Ready' && <ReadyStep snapshot={snapshot} imported={imported} />}
            </m.div>
          </AnimatePresence>
        </div>
      </div>
      <footer className="flex h-16 shrink-0 items-center justify-between gap-3 border-t border-border px-6 md:px-10">
        <Button variant="ghost" className={cn('gap-1.5', step === 0 && 'invisible')} onClick={() => go(step - 1)}><ArrowLeft aria-hidden="true" />Back</Button>
        <Button className="min-w-32 gap-1.5 max-md:min-h-11" onClick={() => last ? onDone() : go(step + 1)} autoFocus>{last ? 'Open Athanor' : step === 0 ? 'Get started' : 'Continue'}{!last && <ArrowRight aria-hidden="true" />}</Button>
      </footer>
    </section>
  </m.div>
}

/* ----------------------------------------------------------------------------- shared bits */

/** Five labelled stops on a hairline, the active one marked: for narrow screens. */
function StepScale({ steps, step, onPick }: { steps: readonly StepName[]; step: number; onPick: (index: number) => void }) {
  return <ol className="flex min-w-0 flex-1 items-center gap-1 font-instr text-[0.7333rem] uppercase tracking-[0.16em] text-muted-foreground max-md:gap-0.5" aria-label="Setup progress">
    {steps.map((name, index) => <li key={name} className="flex items-center gap-1 max-md:flex-1">
      <button type="button" disabled={index > step} onClick={() => onPick(index)} aria-current={index === step ? 'step' : undefined}
        className={cn('relative flex items-center gap-1.5 rounded px-1.5 py-1 outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring/40 enabled:hover:text-foreground', index === step && 'text-foreground', index > step && 'opacity-50')}>
        <span className="tabular-nums">{String(index + 1).padStart(2, '0')}</span>
        <span className="max-lg:hidden">{name}</span>
        {index === step && <m.span layoutId="welcome-step" transition={snap} className="absolute inset-x-1.5 -bottom-0.5 h-px bg-foreground" />}
      </button>
      {index < steps.length - 1 && <span className="h-px w-3 bg-border max-md:flex-1" aria-hidden="true" />}
    </li>)}
  </ol>
}

function Title({ index, children, sub, jp }: { index: string; children: React.ReactNode; sub?: React.ReactNode; jp?: string }) {
  return <div className="mb-7">
    <div className="mb-3 font-instr text-[0.7333rem] uppercase tracking-[0.3em] text-muted-foreground">{index}</div>
    <h1 className="m-0 text-[2rem] font-semibold leading-[1.1] tracking-tight">{children}</h1>
    {sub && <p className="m-0 mt-3 text-[0.9rem] leading-relaxed text-muted-foreground">{sub}</p>}
    {jp && <p className="m-0 mt-1 text-[0.8rem] leading-relaxed text-muted-foreground/70">{jp}</p>}
  </div>
}

function Count({ value }: { value: number }) {
  const [shown, setShown] = useState(0)
  useEffect(() => {
    // Counting up is a flourish, so Reduce Motion (ours or the system's) simply shows the number.
    if (document.documentElement.dataset.reduceMotion === 'true') { setShown(value); return }
    const start = performance.now()
    let raf = 0
    const frame = (now: number) => { const t = Math.min(1, (now - start) / 900); setShown(Math.round(value * (1 - Math.pow(1 - t, 3)))); if (t < 1) raf = requestAnimationFrame(frame) }
    raf = requestAnimationFrame(frame)
    return () => cancelAnimationFrame(raf)
  }, [value])
  return <>{shown.toLocaleString()}</>
}

function Chip({ checked, onChange, children, disabled }: { checked: boolean; onChange: (value: boolean) => void; children: React.ReactNode; disabled?: boolean }) {
  return <button type="button" role="switch" aria-checked={checked} disabled={disabled} onClick={() => onChange(!checked)}
    className={cn('inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-[0.8667rem] font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring/40 disabled:opacity-50', checked ? 'border-foreground bg-foreground text-background' : 'border-border text-muted-foreground hover:bg-accent')}>
    <Check aria-hidden="true" className={cn('size-3.5 transition-opacity', checked ? 'opacity-100' : 'opacity-0')} />{children}
  </button>
}

function ToggleRow({ icon, title, description, checked, onChange }: { icon: React.ReactNode; title: string; description: string; checked: boolean; onChange: (value: boolean) => void }) {
  return <div className="flex items-start gap-3 py-2.5">
    <span aria-hidden="true" className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-lg bg-secondary text-foreground [&_svg]:size-4">{icon}</span>
    <div className="min-w-0 flex-1"><div className="text-[0.9rem] font-medium leading-5">{title}</div><div className="text-xs leading-[1.45] text-muted-foreground">{description}</div></div>
    <Switch checked={checked} aria-label={title} onCheckedChange={onChange} className="mt-1" />
  </div>
}

/* ----------------------------------------------------------------------------- 01 welcome */

function IntroStep() {
  const rows: [React.ReactNode, string, string][] = [
    [<PanelLeft key="a" />, 'Spaces, folders, vertical tabs', 'Keep tabs loose until you press File, then organize them in one step.'],
    [<ShieldCheck key="b" />, 'Shield built in', 'Ads, trackers and YouTube ads are handled by the engine, not an extension.'],
    [<LayoutPanelTop key="c" />, 'Boards and developer tools', 'Pin references to a canvas; format JSON, decode JWTs and more from the command bar.'],
  ]
  return <div>
    <Title index="Welcome" sub="A quiet, fast browser for people who keep a lot open." jp="静かで速い、たくさん開く人のためのブラウザ。">Welcome to Athanor.</Title>
    <ul className="m-0 flex list-none flex-col gap-1 p-0">
      {rows.map(([icon, title, text], index) => <m.li key={title} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ ...enter, delay: 0.08 * index }} className="flex items-start gap-3.5 rounded-xl border border-transparent px-1 py-2.5">
        <span className="grid size-9 shrink-0 place-items-center rounded-xl border border-border bg-card [&_svg]:size-[1.2rem]">{icon}</span>
        <span className="min-w-0"><span className="block text-[0.9333rem] font-medium">{title}</span><span className="block text-[0.8333rem] leading-[1.5] text-muted-foreground">{text}</span></span>
      </m.li>)}
    </ul>
  </div>
}

/* ----------------------------------------------------------------------------- 02 import */

type Phase = 'idle' | 'running' | 'done' | 'error'

function ImportStep({ platform, imported, onImported }: { platform: string; imported: ImportReport[]; onImported: (report: ImportReport) => void }) {
  const [browsers, setBrowsers] = useState<DetectedBrowser[] | null>(null)
  const [browserId, setBrowserId] = useState<string | null>(null)
  const [profileId, setProfileId] = useState<string | null>(null)
  const [bookmarks, setBookmarks] = useState(true)
  const [history, setHistory] = useState(true)
  const [phase, setPhase] = useState<Phase>('idle')
  const [report, setReport] = useState<ImportReport | null>(null)
  const [error, setError] = useState('')
  const [status, setStatus] = useState('')
  const [passwordBusy, setPasswordBusy] = useState(false)
  const [passwordStatus, setPasswordStatus] = useState('')

  useEffect(() => { let alive = true; void api.importDetect().then((found) => { if (!alive) return; setBrowsers(found); const first = found[0]; if (first) { setBrowserId(first.id); setProfileId(first.profiles[0]?.id ?? null) } }).catch(() => alive && setBrowsers([])); return () => { alive = false } }, [])

  const current = browsers?.find((browser) => browser.id === browserId) ?? null
  const profile = current?.profiles.find((entry) => entry.id === profileId) ?? null

  const run = async (request: Parameters<typeof api.importRun>[0], label: string) => {
    setPhase('running'); setError('')
    setStatus(`Importing ${[request.bookmarks ? 'bookmarks' : '', request.history ? 'history' : ''].filter(Boolean).join(' and ')} from ${label}…`)
    try {
      const result = await api.importRun(request)
      setReport(result); onImported(result); setPhase('done')
    } catch (failure) { setError(failure instanceof Error ? failure.message : String(failure)); setPhase('error') }
  }
  const importFile = async () => {
    const path = await api.importPickFile()
    if (path) void run({ source: { kind: 'file', path }, bookmarks: true, history: false }, 'the file')
  }

  return <div>
    <Title index="Import" sub="Copy your bookmarks and history from the browser you use today. Nothing is changed in it, and nothing leaves this computer." jp="いま使っているブラウザからブックマークと履歴を取り込みます。">Bring your browsing with you.</Title>

    <AnimatePresence mode="wait" initial={false}>
      {phase === 'running' && <m.div key="running" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="rounded-2xl border border-border bg-card p-6">
        <div className="flex items-center gap-3 text-[0.9rem] font-medium"><Loader2 aria-hidden="true" className="size-4 animate-spin" /><m.span aria-live="polite" key={status} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }}>{status}</m.span></div>
        <div className="mt-5 flex h-4 items-end gap-[0.2rem]" aria-hidden="true">{Array.from({ length: 48 }, (_, i) => <span key={i} className="block w-px flex-1 rounded-full bg-foreground [animation:ath-tick_1.2s_ease-in-out_infinite]" style={{ height: i % 6 === 0 ? 16 : i % 2 === 0 ? 10 : 6, animationDelay: `${i * 22}ms` }} />)}</div>
      </m.div>}

      {phase === 'done' && report && <m.div key="done" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
        <div className="grid grid-cols-3 gap-2">
          {([['Bookmarks', report.bookmarks], ['Folders', report.folders], ['History', report.history]] as const).map(([label, value]) => <div key={label} className="rounded-xl border border-border bg-card p-3.5"><div className="font-instr text-[0.7333rem] uppercase tracking-[0.18em] text-muted-foreground">{label}</div><div className="mt-1 font-instr text-2xl tabular-nums"><Count value={value} /></div></div>)}
        </div>
        <p className="mt-3 text-[0.8333rem] leading-[1.5] text-muted-foreground" role="status">{report.bookmarks > 0 ? 'Bookmarks are waiting in their own space as archived tabs: click one to open it. ' : ''}{report.history > 0 ? 'Your history now powers the address suggestions.' : ''}{report.skipped > 0 ? ` ${report.skipped} duplicates were skipped.` : ''}</p>
        {report.warnings.length > 0 && <p className="mt-2 text-xs text-muted-foreground">{report.warnings.join(' · ')}</p>}
        <div className="mt-4 flex gap-2"><Button variant="outline" size="sm" onClick={() => { setPhase('idle'); setReport(null) }}>Import another</Button></div>
      </m.div>}

      {(phase === 'idle' || phase === 'error') && <m.div key="idle" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
        {browsers === null && <div role="status" className="flex items-center gap-2 py-6 text-[0.8667rem] text-muted-foreground"><Loader2 aria-hidden="true" className="size-4 animate-spin" />Looking for browsers…</div>}
        {browsers !== null && browsers.length === 0 && <div className="rounded-xl border border-dashed border-border px-4 py-5 text-[0.8667rem] text-muted-foreground">No other browsers were found on this computer. You can still import a bookmarks file.</div>}
        {browsers !== null && browsers.length > 0 && <div role="radiogroup" aria-label="Browser to import from" className="flex flex-col gap-1.5">
          {browsers.map((browser) => {
            const selected = browser.id === browserId
            return <button key={browser.id} type="button" role="radio" aria-checked={selected} onClick={() => { setBrowserId(browser.id); setProfileId(browser.profiles[0]?.id ?? null) }}
              className={cn('flex items-center gap-3 rounded-xl border px-3.5 py-2.5 text-start outline-none transition-[border-color,background-color,box-shadow] focus-visible:ring-2 focus-visible:ring-ring/40', selected ? 'border-foreground bg-card shadow-sm' : 'border-border hover:bg-accent/60')}>
              <span aria-hidden="true" className={cn('grid size-8 shrink-0 place-items-center rounded-lg font-instr text-sm uppercase transition-colors', selected ? 'bg-foreground text-background' : 'bg-secondary')}>{browser.name[0]}</span>
              <span className="min-w-0 flex-1"><span className="block text-[0.9rem] font-medium">{browser.name}</span><span className="block text-xs text-muted-foreground">{browser.profiles.length === 1 ? browser.profiles[0]!.name : `${browser.profiles.length} profiles`}</span></span>
              <span aria-hidden="true" className={cn('grid size-4 place-items-center rounded-full border transition-colors', selected ? 'border-foreground bg-foreground text-background' : 'border-border')}>{selected && <Check className="size-3" />}</span>
            </button>
          })}
        </div>}

        {current && current.profiles.length > 1 && <div className="mt-3 flex items-center gap-3"><span className="text-[0.8667rem] text-muted-foreground">Profile</span>
          <Select value={profileId ?? undefined} onValueChange={setProfileId}><SelectTrigger className="w-60" aria-label="Profile"><SelectValue /></SelectTrigger><SelectContent>{current.profiles.map((entry) => <SelectItem key={entry.id} value={entry.id}>{entry.name}</SelectItem>)}</SelectContent></Select>
        </div>}

        {current && <div role="group" aria-labelledby="welcome-bring" className="mt-4 flex flex-wrap items-center gap-2"><span id="welcome-bring" className="text-[0.8667rem] text-muted-foreground">Bring</span>
          <Chip checked={bookmarks && !!profile?.hasBookmarks} disabled={!profile?.hasBookmarks} onChange={setBookmarks}>Bookmarks</Chip>
          <Chip checked={history && !!profile?.hasHistory} disabled={!profile?.hasHistory} onChange={setHistory}>History</Chip>
        </div>}

        {phase === 'error' && <div role="alert" className="mt-4 rounded-xl border border-destructive/40 bg-destructive/5 px-3.5 py-2.5 text-[0.8333rem] leading-[1.5] text-destructive">{error || 'The import failed.'}{current && /lock|use|access/i.test(error) ? ' Close the other browser and try again.' : ''}</div>}

        <div className="mt-5 flex flex-wrap items-center gap-2">
          {current && profile && <Button className="gap-1.5" disabled={!(bookmarks && profile.hasBookmarks) && !(history && profile.hasHistory)} onClick={() => void run({ source: { kind: 'browser', browser: current.id, profile: profile.id }, bookmarks: bookmarks && profile.hasBookmarks, history: history && profile.hasHistory }, current.name)}><Download aria-hidden="true" />Import from {current.name}</Button>}
          <Button variant="outline" className="gap-1.5" onClick={() => void importFile()}><FileText aria-hidden="true" />Bookmarks file…</Button>
          {platform === 'windows' && <Button variant="outline" className="gap-1.5" disabled={passwordBusy} onClick={() => { setPasswordBusy(true); setPasswordStatus(''); void api.passwordImport().then((report) => { if (report) setPasswordStatus(`Imported ${report.imported} passwords · Updated ${report.updated} · Skipped ${report.skipped}`) }).catch((error) => setPasswordStatus(String(error))).finally(() => setPasswordBusy(false)) }}>{passwordBusy ? 'Importing passwords…' : 'Passwords CSV…'}</Button>}
        </div>
        {passwordStatus && <p className="mt-3 text-sm text-muted-foreground" role="status">{passwordStatus}</p>}
        <p className="mt-4 text-[0.7667rem] leading-[1.5] text-muted-foreground/80">On Windows, export a password CSV from Chrome, Edge or Firefox, then import it here. Delete the exported CSV afterwards; it contains readable passwords. Cookies and saved cards are not copied. You can import again later from More → Passwords. {imported.length > 0 && 'Your bookmarks and history have been imported.'}</p>
      </m.div>}
    </AnimatePresence>
  </div>
}

/* ----------------------------------------------------------------------------- 03 look */

/** A small, faithful drawing of the shell in a given theme (fixed colours so both can sit side by side). */
function MiniShell({ dark, side }: { dark: boolean; side: 'left' | 'right' }) {
  const c = dark ? { chrome: '#111113', page: '#09090b', line: '#27272a', bar: '#3f3f46', ink: '#fafafa', pill: '#1c1c1f' } : { chrome: '#f5f5f6', page: '#ffffff', line: '#e4e4e7', bar: '#d4d4d8', ink: '#18181b', pill: '#ebebed' }
  return <div className={cn('flex h-24 w-full gap-1.5 rounded-lg p-1.5', side === 'right' && 'flex-row-reverse')} style={{ background: c.chrome, boxShadow: `inset 0 0 0 1px ${c.line}` }} aria-hidden="true">
    <div className="flex w-[30%] flex-col gap-1 pt-1">
      <div className="h-2.5 rounded" style={{ background: c.pill }} />
      {[70, 55, 80, 45].map((width, i) => <div key={i} className="h-1.5 rounded-full" style={{ width: `${width}%`, background: i === 0 ? c.ink : c.bar, opacity: i === 0 ? 0.85 : 1 }} />)}
    </div>
    <div className="flex-1 rounded-md p-1.5" style={{ background: c.page, boxShadow: `0 0 0 1px ${c.line}` }}>
      <div className="h-1.5 w-1/3 rounded-full" style={{ background: c.bar }} /><div className="mt-2 h-1 w-3/4 rounded-full" style={{ background: c.line }} /><div className="mt-1 h-1 w-2/3 rounded-full" style={{ background: c.line }} />
    </div>
  </div>
}

function Segmented<T extends string>({ value, onChange, options, label }: { value: T; onChange: (value: T) => void; options: { value: T; label: string; icon?: React.ReactNode }[]; label: string }) {
  return <div role="radiogroup" aria-label={label} className="inline-flex gap-0.5 rounded-lg bg-muted p-0.5">
    {options.map((option) => <button key={option.value} type="button" role="radio" aria-checked={value === option.value} onClick={() => onChange(option.value)}
      className={cn('inline-flex h-7 items-center gap-1.5 rounded-md px-3 text-[0.8667rem] font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring/40 [&_svg]:size-3.5', value === option.value ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground')}>{option.icon && <span aria-hidden="true" className="flex items-center">{option.icon}</span>}{option.label}</button>)}
  </div>
}

function LookStep({ snapshot }: { snapshot: Snapshot }) {
  const { settings } = snapshot
  const dark = useMemo(() => ['monolith', 'ember', 'midnight', 'terminal'].includes(settings.theme), [settings.theme])
  const pick = (id: string, isDark: boolean) => { document.documentElement.dataset.themeDark = String(isDark); void api.setTheme(id); void api.setSettings({ theme: id }) }
  const density = localStorage.getItem('athanor-density') === 'compact' ? 'compact' : 'comfortable'
  const setDensity = (value: 'compact' | 'comfortable') => { localStorage.setItem('athanor-density', value); window.dispatchEvent(new CustomEvent('athanor-density', { detail: value })) }
  const [densityValue, setDensityValue] = useState<'compact' | 'comfortable'>(density)
  return <div>
    <Title index="Look" sub="Pick the theme and where the sidebar lives. You can change all of this later in Settings." jp="テーマとサイドバーの位置を選びます。">Make it yours.</Title>
    <div className="grid grid-cols-2 gap-3" role="radiogroup" aria-label="Theme">
      {([['chalk', 'Light', false], ['monolith', 'Dark', true]] as const).map(([id, name, isDark]) => {
        const selected = dark === isDark
        return <button key={id} type="button" role="radio" aria-checked={selected} onClick={() => pick(id, isDark)} className={cn('rounded-xl border p-2 text-start outline-none transition-[border-color,box-shadow] focus-visible:ring-2 focus-visible:ring-ring/40', selected ? 'border-foreground shadow-sm' : 'border-border hover:border-muted-foreground/50')}>
          <MiniShell dark={isDark} side={settings.sidebarSide} />
          <div className="mt-2 flex items-center justify-between px-1 pb-0.5"><span className="text-[0.8667rem] font-medium">{name}</span>{selected && <Check aria-hidden="true" className="size-3.5" />}</div>
        </button>
      })}
    </div>
    <div className="mt-6 flex flex-col gap-3.5">
      <div className="flex items-center justify-between gap-4"><span className="text-[0.9rem] font-medium">Sidebar</span><Segmented label="Sidebar side" value={settings.sidebarSide} onChange={(side) => void api.setSettings({ sidebarSide: side })} options={[{ value: 'left', label: 'Left', icon: <PanelLeft /> }, { value: 'right', label: 'Right', icon: <PanelRight /> }]} /></div>
      <div className="flex items-center justify-between gap-4"><span className="text-[0.9rem] font-medium">Workspace density</span><Segmented label="Workspace density" value={densityValue} onChange={(value) => { setDensityValue(value); setDensity(value) }} options={[{ value: 'comfortable', label: 'Comfortable' }, { value: 'compact', label: 'Compact' }]} /></div>
      <div className="flex items-center justify-between gap-4"><span className="text-[0.9rem] font-medium">Compact sidebar</span><Switch checked={settings.sidebarCompact} aria-label="Compact sidebar" onCheckedChange={(sidebarCompact) => void api.setSettings({ sidebarCompact })} /></div>
    </div>
  </div>
}

/* ----------------------------------------------------------------------------- 04 privacy */

const ENGINES = [['https://www.google.com/search?q={q}', 'Google'], ['https://duckduckgo.com/?q={q}', 'DuckDuckGo'], ['https://www.bing.com/search?q={q}', 'Bing']] as const

function PrivacyStep({ snapshot }: { snapshot: Snapshot }) {
  const { settings } = snapshot
  const patch = (values: Partial<Snapshot['settings']>) => void api.setSettings(values)
  return <div>
    <Title index="Privacy" sub="Shield is on from the first page. Search defaults to Google; change anything below." jp="広告・トラッカーのブロックは最初から有効です。">Quiet by default.</Title>
    <div className="divide-y divide-border">
      <ToggleRow icon={<ShieldCheck />} title="Block ads and trackers" description="Block requests with the filter lists, and hide cosmetic ads." checked={settings.adblockEnabled} onChange={(on) => { void api.setAdblockEnabled(on); patch({ adblockEnabled: on }) }} />
      <ToggleRow icon={<SquareTerminal />} title="Skip YouTube ads" description="Strips ad data, hides ad slots and fast-forwards any ad that still plays." checked={settings.youtubeAdSkip} onChange={(on) => patch({ youtubeAdSkip: on })} />
      <ToggleRow icon={<Layers3 />} title="Upgrade to HTTPS" description="Prefer encrypted connections, falling back if a site can’t." checked={settings.httpsUpgrade} onChange={(on) => patch({ httpsUpgrade: on })} />
      <ToggleRow icon={<Sparkles />} title="Strip tracking parameters" description="Removes utm_*, fbclid, gclid and similar parameters." checked={settings.stripTracking} onChange={(on) => patch({ stripTracking: on })} />
      <ToggleRow icon={<X />} title="Turn off DRM" description="Tells sites encrypted media is unavailable, so protected video won’t play." checked={settings.blockDrm} onChange={(on) => patch({ blockDrm: on })} />
    </div>
    <div className="mt-4 grid grid-cols-2 gap-3 max-sm:grid-cols-1">
      <div className="flex flex-col gap-1.5 text-[0.8333rem] text-muted-foreground"><span className="flex items-center gap-1.5"><Search aria-hidden="true" className="size-3.5" />Search engine</span>
        <Select value={ENGINES.some(([value]) => value === settings.searchEngine) ? settings.searchEngine : 'custom'} onValueChange={(value) => value !== 'custom' && patch({ searchEngine: value })}><SelectTrigger aria-label="Search engine"><SelectValue /></SelectTrigger><SelectContent>{ENGINES.map(([value, name]) => <SelectItem key={value} value={value}>{name}</SelectItem>)}{!ENGINES.some(([value]) => value === settings.searchEngine) && <SelectItem value="custom">Custom</SelectItem>}</SelectContent></Select></div>
      <div className="flex flex-col gap-1.5 text-[0.8333rem] text-muted-foreground"><span className="flex items-center gap-1.5"><AthanorMark className="size-3" />New tab opens</span>
        <Select value={settings.homepage === 'athanor://newtab' ? 'athanor' : 'google'} onValueChange={(value) => patch({ homepage: value === 'athanor' ? 'athanor://newtab' : 'https://www.google.com/' })}><SelectTrigger aria-label="New tab opens"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="google">Google</SelectItem><SelectItem value="athanor">Athanor start page</SelectItem></SelectContent></Select></div>
    </div>
  </div>
}

/* ----------------------------------------------------------------------------- 05 ready */

/** The handful worth remembering on a first run, named exactly as Settings and the cheat sheet name them. */
const REMEMBER = ['Ctrl+K', 'Ctrl+T', 'Ctrl+L', 'Ctrl+B', 'Ctrl+\\', 'Ctrl+Shift+D']
  .map((combo) => SHORTCUTS.find((item) => item.combo === combo))
  .filter((item): item is (typeof SHORTCUTS)[number] => Boolean(item))
const count = (value: number, one: string, many = `${one}s`) => `${value.toLocaleString()} ${value === 1 ? one : many}`

function ReadyStep({ snapshot, imported }: { snapshot: Snapshot; imported: ImportReport[] }) {
  const { settings } = snapshot
  const totals = imported.reduce((sum, report) => ({ bookmarks: sum.bookmarks + report.bookmarks, history: sum.history + report.history }), { bookmarks: 0, history: 0 })
  const lines = [
    totals.bookmarks + totals.history > 0 ? `Imported ${count(totals.bookmarks, 'bookmark')} and ${count(totals.history, 'history entry', 'history entries')}.` : 'Nothing imported. You can do this from the command bar.',
    `${['monolith', 'ember', 'midnight', 'terminal'].includes(settings.theme) ? 'Dark' : 'Light'} theme, sidebar on the ${settings.sidebarSide}.`,
    `Shield ${settings.adblockEnabled ? 'is on' : 'is off'}${settings.youtubeAdSkip ? ', YouTube ads are skipped' : ''}${settings.blockDrm ? ', DRM is off' : ''}.`,
    `${ENGINES.find(([value]) => value === settings.searchEngine)?.[1] ?? 'Custom search'} for search, ${settings.homepage === 'athanor://newtab' ? 'Athanor’s start page' : 'Google'} for new tabs.`,
  ]
  return <div>
    <Title index="Ready" sub="Here is what you chose, and the few shortcuts worth knowing." jp="準備ができました。">You’re all set.</Title>
    <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
      {lines.map((line, index) => <m.li key={line} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ ...enter, delay: 0.06 * index }} className="flex items-start gap-2.5 text-[0.9rem] leading-5"><span aria-hidden="true" className="mt-0.5 grid size-4 shrink-0 place-items-center rounded-full bg-foreground text-background"><Check className="size-3" /></span>{line}</m.li>)}
    </ul>
    <div className="mt-6 grid grid-cols-2 gap-2 max-sm:grid-cols-1">
      {REMEMBER.map((item) => <div key={item.combo} className="flex items-center justify-between rounded-lg border border-border px-3 py-2"><span className="text-[0.8667rem]">{item.label}</span><span className="flex gap-1">{item.combo.split('+').map((key) => <Kbd key={key} className="font-instr">{key}</Kbd>)}</span></div>)}
    </div>
  </div>
}
