import { useEffect, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import { Toaster, toast, useSonner } from 'sonner'
import type { Action, ToastT } from 'sonner'
import { invoke } from '@tauri-apps/api/core'
import { emitTo, listen as nativeListen } from '@tauri-apps/api/event'
import { create } from 'zustand'
import { Bell, Check, CircleAlert, Info } from 'lucide-react'
import type { Snapshot } from '@/lib/types'
import { applyShellCss, isDarkTheme } from '@/lib/theme'
import { useOverlay } from '@/lib/overlay'
import { Button } from './ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from './ui/dialog'

type WireToast = { id: string | number; title: string; description?: string; type: ToastT['type']; duration: number | null; action?: string; cancel?: string }
type Payload = { items: WireToast[]; css: string; dark: boolean; scale: number; reduce: boolean; contrast: boolean; suppressed: boolean }
type Reply = { id: string | number; kind: 'action' | 'cancel' | 'dismiss' | 'autoClose' }
type Notice = ToastT & { created: number }
const consumed = new Set<string | number>()
export const useNotices = create<{ items: Notice[]; displayError: string | null; record: (items: ToastT[]) => void; clear: () => void }>((set) => ({
  items: [],
  displayError: null,
  record: (incoming) => set((state) => {
    const items = [...state.items]
    for (const item of [...incoming].reverse()) {
      const index = items.findIndex((entry) => entry.id === item.id)
      if (index >= 0) { if (items[index]!.title !== item.title) consumed.delete(item.id); items[index] = { ...items[index]!, ...item } }
      else items.unshift({ ...item, created: Date.now() })
    }
    return { items: items.slice(0, 100) }
  }),
  clear: () => set({ items: [] }),
}))

const textOf = (value: unknown) => typeof value === 'string' || typeof value === 'number' ? String(value) : ''
const isAction = (value: unknown): value is Action => Boolean(value && typeof value === 'object' && 'onClick' in value)
const toasterStyle = { '--width': 'calc(356px * var(--ath-ui-scale, 1))', '--normal-bg': 'var(--popover)', '--normal-text': 'var(--popover-foreground)', '--normal-border': 'var(--border)', '--border-radius': 'var(--radius)', fontFamily: 'var(--font-ui)' } as CSSProperties
export function StyledToaster({ mobile = false, dark }: { mobile?: boolean; dark?: boolean }) {
  return <Toaster className="toast-root" position={mobile ? 'top-center' : 'bottom-right'} offset={16} mobileOffset={16} visibleToasts={3} closeButton duration={6000} theme={(dark ?? isDarkTheme()) ? 'dark' : 'light'} style={toasterStyle} />
}

/** Keep Sonner's appearance and callbacks; move only its rendering above the native page layer on Windows. */
export function NotificationHost({ snapshot, native, suppressed, onMobileHeight }: { snapshot: Snapshot; native: boolean; suppressed: boolean; onMobileHeight?: (height: number) => void }) {
  const { toasts } = useSonner()
  const current = useRef(toasts)
  current.current = toasts
  const [fallback, setFallback] = useState(false)
  const [themeRevision, setThemeRevision] = useState(0)
  const failures = useRef(0)
  const serial = useRef(Promise.resolve())
  useEffect(() => { const observer = new MutationObserver(() => setThemeRevision((value) => value + 1)); observer.observe(document.head, { subtree: true, childList: true, characterData: true }); return () => observer.disconnect() }, [])
  useEffect(() => { if (!fallback || failures.current > 3) return; const timer = window.setTimeout(() => setFallback(false), failures.current * 1500); return () => window.clearTimeout(timer) }, [fallback])
  useEffect(() => { useNotices.getState().record(toasts) }, [toasts])
  useEffect(() => {
    if (!native || fallback) return
    const off = nativeListen<Reply>('athanor://notification-action', ({ payload: reply }) => {
      const item = current.current.find((item) => item.id === reply.id)
      if (!item) return
      // Dismiss before calling an action, so a rapid double click cannot perform it twice.
      current.current = current.current.filter((entry) => entry.id !== reply.id)
      toast.dismiss(reply.id)
      if (reply.kind === 'action' || reply.kind === 'cancel') consumed.add(reply.id)
      if (reply.kind === 'action' && isAction(item.action)) item.action.onClick({} as Parameters<Action['onClick']>[0])
      else if (reply.kind === 'cancel' && isAction(item.cancel)) item.cancel.onClick({} as Parameters<Action['onClick']>[0])
      else if (reply.kind === 'autoClose') item.onAutoClose?.(item)
      else if (reply.kind === 'dismiss') item.onDismiss?.(item)
    })
    return () => { void off.then((fn) => fn()) }
  }, [native, fallback])
  useEffect(() => {
    if (!native || fallback) return
    const payload: Payload = {
      items: toasts.map((item) => ({ id: item.id, title: textOf(item.title), description: textOf(item.description) || undefined, type: item.type,
        duration: item.duration === Infinity || item.type === 'loading' ? null : item.duration ?? 6000,
        action: isAction(item.action) ? textOf(item.action.label) : undefined, cancel: isAction(item.cancel) ? textOf(item.cancel.label) : undefined })),
      css: document.getElementById('athanor-shell-css')?.textContent ?? '', dark: isDarkTheme(), scale: snapshot.settings.uiScale,
      reduce: snapshot.settings.reduceMotion, contrast: snapshot.settings.highContrast, suppressed,
    }
    serial.current = serial.current.then(() => invoke('sync_notifications', { payload })).then(() => { failures.current = 0; useNotices.setState({ displayError: null }) }).catch((error) => { console.error('Native notifications unavailable', error); failures.current++; useNotices.setState({ displayError: 'Toast display is temporarily unavailable. Recent messages and actions are available here.' }); setFallback(true) })
  }, [toasts, native, fallback, themeRevision, snapshot.settings.theme, snapshot.workspace.activeSpace, snapshot.settings.uiScale, snapshot.settings.reduceMotion, snapshot.settings.highContrast, suppressed])
  // Android's native page also sits above DOM. Reserve only the live toast's height instead of hiding the whole page.
  useEffect(() => {
    if (!onMobileHeight || native && !fallback) return
    let frame = 0
    const measure = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(() => {
      const visible = [...document.querySelectorAll<HTMLElement>('[data-sonner-toast][data-visible="true"]')].filter((element) => element.dataset.removed !== 'true')
      onMobileHeight(visible.length ? Math.min(260, Math.max(...visible.map((element) => element.getBoundingClientRect().bottom)) + 12) : 0)
    }) }
    const observer = new MutationObserver(measure)
    observer.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['style', 'data-visible', 'data-removed'] })
    measure()
    return () => { observer.disconnect(); cancelAnimationFrame(frame); onMobileHeight(0) }
  }, [native, fallback, onMobileHeight])
  return native && !fallback ? null : <StyledToaster mobile={Boolean(onMobileHeight)} />
}

/** Runs in a small transparent child webview; it never boots the browser shell or gets a tab's focus. */
export function NotificationSurface() {
  const [payload, setPayload] = useState<Payload | null>(null)
  const applied = useRef(new Map<string | number, string>())
  useEffect(() => {
    document.body.style.background = 'transparent'
    document.documentElement.style.background = 'transparent'
    let alive = true
    let received = false
    const off = nativeListen<Payload>('athanor://notifications', ({ payload }) => { received = true; if (alive) setPayload(payload) })
    void off.then(() => invoke<Payload>('get_notification_state')).then((state) => { if (alive && !received && state?.items) setPayload(state) })
    return () => { alive = false; void off.then((fn) => fn()) }
  }, [])
  useEffect(() => {
    if (!payload) return
    applyShellCss(payload.css, payload.dark)
    const root = document.documentElement
    root.style.setProperty('--ath-ui-scale', String(payload.scale / 100))
    root.dataset.reduceMotion = String(payload.reduce)
    if (payload.contrast) root.dataset.contrast = 'high'; else delete root.dataset.contrast
    const reply = (id: string | number, kind: Reply['kind']) => { void emitTo('shell', 'athanor://notification-action', { id, kind }) }
    for (const id of applied.current.keys()) if (!payload.items.some((item) => item.id === id)) { toast.dismiss(id); applied.current.delete(id) }
    // Oldest first, so Sonner's newest item stays nearest the bottom.
    for (const item of [...payload.items].reverse()) {
      const key = JSON.stringify([item, payload.suppressed])
      if (applied.current.get(item.id) === key) continue
      applied.current.set(item.id, key)
      const method = item.type === 'success' || item.type === 'error' || item.type === 'info' || item.type === 'warning' || item.type === 'loading' ? toast[item.type] : toast
      method(item.title, { id: item.id, description: item.description, duration: payload.suppressed || item.duration === null ? Infinity : item.duration,
        action: item.action ? { label: item.action, onClick: () => reply(item.id, 'action') } : undefined,
        cancel: item.cancel ? { label: item.cancel, onClick: () => reply(item.id, 'cancel') } : undefined,
        onDismiss: () => reply(item.id, 'dismiss'), onAutoClose: () => reply(item.id, 'autoClose') })
    }
  }, [payload])
  useEffect(() => {
    let frame = 0
    let last = 0
    const measure = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(() => {
      const visible = [...document.querySelectorAll<HTMLElement>('[data-sonner-toast][data-visible="true"]')].filter((element) => element.dataset.removed !== 'true')
      const height = visible.length ? Math.ceil(window.innerHeight - Math.min(...visible.map((element) => element.getBoundingClientRect().top)) + 8) : 64
      if (Math.abs(height - last) > 2) { last = height; void invoke('notification_height', { height }).catch(console.error) }
    }) }
    // Sonner slides each toast with transforms that do not touch the DOM, so a reading taken once is often too low, and
    // the view then cuts off the top of the stack. Follow the motion frame by frame while it runs, then measure once more.
    let followUntil = 0
    const follow = () => {
      followUntil = Math.max(followUntil, performance.now() + 700)
      if (followFrame) return
      const tick = () => { measure(); followFrame = performance.now() < followUntil ? requestAnimationFrame(tick) : 0 }
      followFrame = requestAnimationFrame(tick)
    }
    let followFrame = 0
    const observer = new MutationObserver(follow)
    observer.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['style', 'data-expanded', 'data-visible', 'data-removed'] })
    document.addEventListener('transitionend', follow, true)
    document.addEventListener('animationend', follow, true)
    window.addEventListener('resize', measure)
    return () => {
      observer.disconnect(); cancelAnimationFrame(frame); cancelAnimationFrame(followFrame)
      document.removeEventListener('transitionend', follow, true); document.removeEventListener('animationend', follow, true)
      window.removeEventListener('resize', measure)
    }
  }, [])
  return <StyledToaster dark={payload?.dark} />
}

export function NotificationCenter({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const items = useNotices((state) => state.items)
  const displayError = useNotices((state) => state.displayError)
  useOverlay(open, 'notification-center')
  return <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent data-part="notification-center" aria-describedby="notification-description">
      <DialogHeader><DialogTitle className="text-base font-semibold">Notifications</DialogTitle><DialogDescription id="notification-description">Recent activity in this session. Dismissing a message keeps it here.</DialogDescription></DialogHeader>
      <div className="mt-4 min-h-0 overflow-y-auto px-5">
        {displayError && <p role="alert" className="text-sm text-muted-foreground">{displayError}</p>}
        {!items.length && <div className="flex flex-col items-center gap-2 py-10 text-sm text-muted-foreground"><Bell className="size-6" /><span>No notifications yet</span></div>}
        {items.map((item) => { const Icon = item.type === 'error' ? CircleAlert : item.type === 'success' ? Check : Info
          return <div key={item.id} className="flex gap-3 border-b border-border py-3 last:border-0" data-part="notification-item">
            <Icon aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
            <div className="min-w-0 flex-1"><p className="m-0 break-words text-sm font-medium">{textOf(item.title)}</p>{item.description && <p className="m-0 mt-1 break-words text-xs text-muted-foreground">{textOf(item.description)}</p>}
              <time className="mt-1 block text-xs text-muted-foreground" dateTime={new Date(item.created).toISOString()}>{new Date(item.created).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</time>
              {isAction(item.action) && <Button variant="outline" size="sm" disabled={consumed.has(item.id)} className="mt-2 max-md:min-h-11" onClick={(event) => { if (consumed.has(item.id)) return; consumed.add(item.id); toast.dismiss(item.id); onOpenChange(false); if (isAction(item.action)) item.action.onClick(event) }}>{consumed.has(item.id) ? 'Action completed' : item.action.label}</Button>}
            </div>
          </div>
        })}
      </div>
      <DialogFooter className="pt-4"><Button variant="ghost" disabled={!items.length} onClick={() => useNotices.getState().clear()}>Clear history</Button><Button variant="outline" onClick={() => onOpenChange(false)}>Done</Button></DialogFooter>
    </DialogContent>
  </Dialog>
}
