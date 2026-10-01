import type { ContextItem, ContextTarget, AdblockStatus, Board, BoardItem, BoardSummary, CommandArgs, CommandResult, DevServer, EventPayloads, ExtensionInfo, FilingRule, Folder, Id, PanelInfo, Platform, Settings, Snapshot, Space, SplitNode, SplitRects, Suggestion, Tab, ThemeInfo } from '../types'
import { validateFilterText } from '../userFilters'

const now = Date.now()
const uid = (prefix = 'id') => `${prefix}-${Math.random().toString(36).slice(2, 9)}`
const svgData = (label: string, hue: number) => `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="640" height="420"><defs><linearGradient id="g" x2="1" y2="1"><stop stop-color="hsl(${hue} 48% 35%)"/><stop offset="1" stop-color="hsl(${hue + 30} 38% 13%)"/></linearGradient></defs><rect width="640" height="420" fill="url(#g)"/><circle cx="520" cy="70" r="125" fill="hsl(${hue + 70} 80% 70% / .3)"/><text x="44" y="350" fill="white" font-family="sans-serif" font-size="34">${label}</text></svg>`)}`
const spaces: Space[] = [
  { id: 'space-work', name: 'Work', icon: 'Briefcase', color: '#3f3f46', theme: null },
  { id: 'space-personal', name: 'Personal', icon: 'Sparkles', color: '#71717a', theme: null },
  { id: 'space-research', name: 'Research', icon: 'BookOpen', color: '#a1a1aa', theme: null },
]
const folders: Folder[] = [
  { id: 'folder-dev', name: 'Development', space: 'space-work', collapsed: false, color: null, auto: true },
  { id: 'folder-docs', name: 'Docs', space: 'space-work', collapsed: false, color: null, auto: false },
  { id: 'folder-reading', name: 'Reading list', space: 'space-research', collapsed: false, color: '#a394c2', auto: false },
]
const makeTab = (id: string, title: string, url: string, space: string, folder: string | null, extra: Partial<Tab> = {}): Tab => ({ id, title, url, favicon: null, space, folder, pinned: false, parent: null, created: now - 3600_000, lastActive: now - 2 * 3_600_000, archived: false, muted: false, autoFiled: Boolean(folder), ...extra })
const initialTabs: Tab[] = [
  makeTab('tab-welcome', 'Welcome to Athanor', 'athanor://newtab', 'space-work', null, { lastActive: now }),
  makeTab('tab-github', 'GitHub · Build software', 'https://github.com', 'space-work', 'folder-dev'),
  makeTab('tab-vite', 'Vite | Next Generation Frontend Tooling', 'https://vite.dev', 'space-work', 'folder-dev'),
  makeTab('tab-docs', 'MDN Web Docs', 'https://developer.mozilla.org', 'space-research', 'folder-reading'),
  makeTab('tab-design', 'Athanor visual references', 'https://www.are.na', 'space-research', null),
  makeTab('pin-mail', 'Inbox (12) · Mail', 'https://mail.example.com', 'space-work', null, { pinned: true, lastActive: now - 5 * 60_000 }),
  makeTab('pin-cal', 'Calendar', 'https://calendar.example.com', 'space-work', null, { pinned: true }),
  makeTab('pin-notes', 'Notes', 'https://notes.example.com', 'space-work', null, { pinned: true }),
  makeTab('pin-chat', 'Team chat', 'https://chat.example.com', 'space-work', null, { pinned: true }),
  makeTab('tab-pr', 'Add rounded page clip by bata-san · Pull Request #42', 'https://github.com/bata-san/Athanor/pull/42', 'space-work', 'folder-dev', { lastActive: now - 12 * 60_000 }),
  makeTab('tab-ci', 'Actions · CI · bata-san/Athanor', 'https://github.com/bata-san/Athanor/actions', 'space-work', 'folder-dev', { lastActive: now - 3 * 3_600_000 }),
  makeTab('tab-tauri', 'Tauri 2.0 · Webview API reference', 'https://v2.tauri.app/reference/', 'space-work', 'folder-docs', { lastActive: now - 26 * 60_000 }),
  makeTab('tab-wv2', 'ICoreWebView2ContextMenuRequestedEventArgs interface', 'https://learn.microsoft.com/microsoft-edge/webview2', 'space-work', 'folder-docs', { lastActive: now - 50 * 3_600_000 }),
  makeTab('tab-rust', 'The Rust Programming Language', 'https://doc.rust-lang.org/book/', 'space-work', 'folder-docs'),
  makeTab('tab-news', 'Hacker News', 'https://news.ycombinator.com', 'space-work', null, { lastActive: now - 40 * 60_000 }),
  makeTab('tab-yt', 'Lo-fi beats to code to - YouTube', 'https://youtube.com/watch?v=x', 'space-work', null, { lastActive: now - 8 * 3_600_000 }),
]
const defaultSettings: Settings = { searchEngine: 'https://www.google.com/search?q={q}', archiveAfterHours: 24, httpsUpgrade: true, stripTracking: true, autoFile: true, restoreSession: true, sidebarSide: 'left', sidebarCompact: false, sidebarWidth: 236, theme: 'chalk', adblockEnabled: true, homepage: 'https://www.google.com/', youtubeAdSkip: true, blockDrm: false, webFont: true, autoUpdate: true, siteZoom: {}, sitePermissions: {}, onboarded: !new URLSearchParams(typeof window === 'undefined' ? '' : window.location.search).has('welcome') }
const initialSnapshot = (): Snapshot => ({ workspace: { spaces, folders, tabs: initialTabs, activeSpace: 'space-work', activeTab: 'tab-welcome', split: null }, runtime: Object.fromEntries(initialTabs.map((tab) => [tab.id, { loading: false, canGoBack: tab.url !== 'athanor://newtab', canGoForward: false, blocked: tab.id === 'tab-github' ? 12 : 0, audible: false, secure: tab.url.startsWith('https:') }])), settings: defaultSettings, filingRules: [{ id: 'rule-github', folder: 'Development', host: 'github.com', pathPrefix: null, titleContains: null, enabled: true }, { id: 'rule-docs', folder: 'Reading list', host: 'developer.mozilla.org', pathPrefix: null, titleContains: null, enabled: true }, { id: 'rule-design', folder: 'Design', host: 'figma.com', pathPrefix: null, titleContains: null, enabled: true }, { id: 'rule-shopping', folder: 'Shopping', host: 'amazon.com', pathPrefix: null, titleContains: null, enabled: true }, { id: 'rule-social', folder: 'Social', host: 'reddit.com', pathPrefix: null, titleContains: null, enabled: true }], platform: 'windows', version: '0.1.0 mock', blockedTotal: 128 })
let state = initialSnapshot()
if (mockGetPlatformFromUrl()) state.platform = mockGetPlatformFromUrl()!
let maximized = false
let overlay = false
let bounds = { x: 0, y: 38, w: 1000, h: 700 }
let boards: Board[] = [
  { id: 'board-inspiration', name: 'Interface references', view: { x: 0, y: 0, zoom: 0.72 }, background: '#26231f', alwaysOnTop: false, items: [
    { id: 'item-coast', kind: 'image', asset: 'sample-coast', mime: 'image/svg+xml', x: -350, y: -170, w: 340, h: 225, rotation: -3, opacity: 1, flipX: false, grayscale: false, locked: false, z: 1 },
    { id: 'item-dusk', kind: 'image', asset: 'sample-dusk', mime: 'image/svg+xml', x: 65, y: -95, w: 325, h: 218, rotation: 2, opacity: 1, flipX: false, grayscale: false, locked: false, z: 2 },
    { id: 'item-note', kind: 'text', text: 'Warm light, quiet surfaces\nA little room to think.', size: 26, color: '#e6c393', x: -180, y: 160, w: 340, h: 100, rotation: 0, opacity: 1, flipX: false, grayscale: false, locked: false, z: 3 },
  ] },
]
const assets = new Map<string, string>([['sample-coast', svgData('Morning coast', 25)], ['sample-dusk', svgData('After hours', 215)]])
const rulesDefaults: AdblockStatus = { enabled: true, updating: false, blockedTotal: 128, lists: [{ id: 'easylist', name: 'EasyList', enabled: true, ruleCount: 42861, updatedAt: now - 2_400_000, error: null }, { id: 'easyprivacy', name: 'EasyPrivacy', enabled: true, ruleCount: 17304, updatedAt: now - 2_400_000, error: null }, { id: 'annoyances', name: 'Annoyances', enabled: false, ruleCount: 9088, updatedAt: now - 86_400_000, error: null }] }
let adblock = structuredClone(rulesDefaults)
let panels: PanelInfo[] = [{ ext: 'notes', id: 'quick-notes', title: 'Quick notes', icon: 'NotebookPen', url: 'athanor-ext://notes/panel.html' }]
let extensions: ExtensionInfo[] = [{ id: 'notes', name: 'Quick Notes', version: '1.0.0', description: 'A small scratchpad panel for this space.', enabled: true, source: 'builtin', permissions: ['storage', 'activeTab'] }]
const themes: ThemeInfo[] = [{ id: 'monolith', name: 'Monolith', dark: true, source: 'builtin' }, { id: 'chalk', name: 'Chalk', dark: false, source: 'builtin' }, { id: 'ember', name: 'Ember', dark: true, source: 'builtin' }, { id: 'paper', name: 'Paper', dark: false, source: 'builtin' }, { id: 'midnight', name: 'Midnight', dark: true, source: 'builtin' }, { id: 'terminal', name: 'Terminal', dark: true, source: 'builtin' }, { id: 'mist', name: 'Mist', dark: false, source: 'builtin' }]
const servers: DevServer[] = [{ port: 5173, url: 'http://localhost:5173', title: 'Vite app' }, { port: 3000, url: 'http://localhost:3000', title: 'Next.js' }]
const shields = new Map<string, boolean>()
let userFilters = ['! My filters — one rule per line', '||ads.example.com^', 'example.com##.banner', '@@||example.com^$document', ''].join('\n')
const eventListeners = new Map<string, Set<(payload: unknown) => void>>()
export function isMockMode(): boolean { return typeof window === 'undefined' || !('__TAURI_INTERNALS__' in window) }
export function mockListen<K extends keyof EventPayloads>(event: K, handler: (payload: EventPayloads[K]) => void): () => void {
  const listeners = eventListeners.get(event) ?? new Set<(payload: unknown) => void>()
  listeners.add(handler as (payload: unknown) => void); eventListeners.set(event, listeners)
  return () => { listeners.delete(handler as (payload: unknown) => void) }
}
function emit<K extends keyof EventPayloads>(event: K, payload: EventPayloads[K]) { for (const handler of eventListeners.get(event) ?? []) handler(payload) }
const emitSnapshot = () => emit('athanor://snapshot', structuredClone(state))
function archiveExpiredTabs() {
  const hours = state.settings.archiveAfterHours
  if (hours <= 0) return
  const cutoff = Date.now() - hours * 3_600_000
  let changed = false
  for (const tab of state.workspace.tabs) {
    if (tab.id !== state.workspace.activeTab && !tab.pinned && !tab.archived && tab.lastActive < cutoff) { tab.archived = true; changed = true }
  }
  if (changed) emitSnapshot()
}
if (typeof window !== 'undefined' && isMockMode()) window.setInterval(archiveExpiredTabs, 15_000)
const active = () => state.workspace.tabs.find((tab) => tab.id === state.workspace.activeTab) ?? null
const cleanUrl = (input: string) => /^(https?:|athanor:\/\/)/i.test(input) ? input : input.includes('.') && !input.includes(' ') ? `https://${input}` : state.settings.searchEngine.replace('{q}', encodeURIComponent(input || ''))
function matchesFilingRule(rule: FilingRule, url: string, title: string) {
  if (!rule.enabled || !(rule.host || rule.pathPrefix || rule.titleContains)) return false
  let parsed: URL
  try { parsed = new URL(url) } catch { return false }
  return (!rule.host || parsed.hostname.toLowerCase().includes(rule.host.toLowerCase())) &&
    (!rule.pathPrefix || parsed.pathname.startsWith(rule.pathPrefix)) &&
    (!rule.titleContains || title.toLowerCase().includes(rule.titleContains.toLowerCase()))
}
function openTab(args: CommandArgs['open_tab']): string {
  const id = uid('tab'); const url = cleanUrl(args.url ?? 'athanor://newtab');
  const host = (() => { try { return new URL(url).hostname } catch { return '' } })()
  let folder = args.folder ?? null
  let autoFiled = false
  if (!folder && args.url && state.settings.autoFile && !args.pinned) {
    const matched = state.filingRules.find((rule) => matchesFilingRule(rule, url, host || url))
    if (matched) { let target = state.workspace.folders.find((entry) => entry.name === matched.folder && entry.space === (args.space ?? state.workspace.activeSpace)); if (!target) { target = { id: uid('folder'), name: matched.folder, space: args.space ?? state.workspace.activeSpace, collapsed: false, color: null, auto: true }; state.workspace.folders.push(target) } folder = target.id; autoFiled = true }
  }
  const tab: Tab = makeTab(id, args.url ? host || url : 'New tab', url, args.space ?? state.workspace.activeSpace, folder, { pinned: args.pinned ?? false, parent: args.parent ?? null, autoFiled, lastActive: Date.now() })
  state.workspace.tabs.push(tab); state.runtime[id] = { loading: false, canGoBack: false, canGoForward: false, blocked: 0, audible: false, secure: url.startsWith('https:') }
  if (!args.background) { state.workspace.activeTab = id; if (args.space) state.workspace.activeSpace = args.space }
  return id
}
const tabIndex = (id: Id) => state.workspace.tabs.findIndex((tab) => tab.id === id)
const clearSplitTab = (id: Id) => { if (state.workspace.split && flatten(state.workspace.split.root).includes(id)) state.workspace.split = null }
const flatten = (node: SplitNode): Id[] => node.kind === 'leaf' ? [node.tab] : [...flatten(node.a), ...flatten(node.b)]
function splitRects(): SplitRects | null {
  const split = state.workspace.split; if (!split) return null
  const make = (node: SplitNode, x: number, y: number, w: number, h: number, path: boolean[]): { panes: SplitRects['panes']; dividers: SplitRects['dividers'] } => {
    if (node.kind === 'leaf') return { panes: [{ tab: node.tab, rect: { x, y, w, h } }], dividers: [] }
    if (node.dir === 'row') { const aw = w * node.ratio; const d = 6; const a = make(node.a, x, y, aw - d / 2, h, [...path, false]); const b = make(node.b, x + aw + d / 2, y, w - aw - d / 2, h, [...path, true]); return { panes: [...a.panes, ...b.panes], dividers: [...a.dividers, ...b.dividers, { path, dir: 'row', rect: { x: x + aw - d / 2, y, w: d, h }, ratio: node.ratio }] } }
    const ah = h * node.ratio; const d = 6; const a = make(node.a, x, y, w, ah - d / 2, [...path, false]); const b = make(node.b, x, y + ah + d / 2, w, h - ah - d / 2, [...path, true]); return { panes: [...a.panes, ...b.panes], dividers: [...a.dividers, ...b.dividers, { path, dir: 'column', rect: { x, y: y + ah - d / 2, w, h: d }, ratio: node.ratio }] }
  }
  return make(split.root, 0, 0, bounds.w, bounds.h, [])
}
async function runTool(tool: string, input: string): Promise<string> {
  try {
    if (tool === 'json-pretty') return JSON.stringify(JSON.parse(input), null, 2)
    if (tool === 'json-minify') return JSON.stringify(JSON.parse(input))
    if (tool === 'base64-encode') return btoa(unescape(encodeURIComponent(input)))
    if (tool === 'base64-decode') return decodeURIComponent(escape(atob(input)))
    if (tool === 'url-encode') return encodeURIComponent(input)
    if (tool === 'url-decode') return decodeURIComponent(input)
    if (tool === 'jwt') { const parts = input.split('.'); const decode = (part: string) => JSON.parse(atob(part.replace(/-/g, '+').replace(/_/g, '/'))); return JSON.stringify({ header: decode(parts[0] ?? 'e30'), payload: decode(parts[1] ?? 'e30'), note: 'Signature is not verified in the shell preview.' }, null, 2) }
    if (tool === 'timestamp') { const value = Number(input); const date = new Date(input ? (value < 1e12 ? value * 1000 : value) : Date.now()); return `${date.toISOString()}\nUnix seconds: ${Math.floor(date.getTime() / 1000)}\nUnix milliseconds: ${date.getTime()}` }
    if (tool === 'uuid') return typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : uid('uuid')
    if (tool === 'sha256') { const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input)); return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('') }
    if (tool === 'color') { const hex = input.trim().replace('#', ''); const n = Number.parseInt(hex, 16); return `HEX #${hex}\nRGB ${n >> 16}, ${(n >> 8) & 255}, ${n & 255}` }
    return input
  } catch (error) { return `Error: ${error instanceof Error ? error.message : 'Could not process input.'}` }
}
function summaries(): BoardSummary[] { return boards.map(({ id, name, items }) => ({ id, name, itemCount: items.length, updatedAt: Date.now() - 60000 })) }
function genericError(name: string) { throw new Error(`Mock backend does not implement ${name}`) }

export async function mockInvoke<K extends keyof CommandArgs>(name: K, rawArgs: CommandArgs[K]): Promise<K extends keyof CommandResult ? CommandResult[K] : void> {
  const args = rawArgs as Record<string, any>
  let result: unknown
  switch (name) {
    case 'get_snapshot': result = structuredClone(state); break
    case 'get_shell_css': result = ''; break
    case 'list_themes': result = themes; break
    case 'set_theme': state.settings.theme = args.id; document.documentElement.dataset.themeDark = String(mockThemeDark(args.id)); emit('athanor://shell-css', ''); emitSnapshot(); break
    case 'set_space_theme': { const space = state.workspace.spaces.find((s) => s.id === args.space); if (space) space.theme = args.theme; emitSnapshot(); break }
    case 'get_panels': result = panels; break
    case 'get_commands': result = [{ ext: 'notes', id: 'new-note', title: 'Open quick notes', keybinding: null }]; break
    case 'run_extension_command': emit('athanor://toast', { level: 'info', message: 'Quick notes panel opened.' }); break
    case 'extension_rpc': result = args.method === 'storage.get' ? { value: '' } : { ok: true }; break
    case 'open_tab': result = openTab(args as CommandArgs['open_tab']); emitSnapshot(); break
    case 'navigate': { const tab = state.workspace.tabs.find((t) => t.id === args.tab); if (tab) { tab.url = cleanUrl(args.input); tab.title = (() => { try { return new URL(tab.url).hostname || 'New tab' } catch { return 'Search' } })(); tab.lastActive = Date.now(); state.runtime[tab.id] = { ...state.runtime[tab.id]!, canGoBack: true, canGoForward: false, secure: tab.url.startsWith('https:'), loading: false }; state.workspace.activeTab = tab.id; emitSnapshot() } break }
    case 'activate_tab': { const tab = state.workspace.tabs.find((t) => t.id === args.tab); if (tab) { state.workspace.activeTab = tab.id; state.workspace.activeSpace = tab.space; tab.lastActive = Date.now(); emitSnapshot() } break }
    case 'close_tab': { const i = tabIndex(args.tab); if (i >= 0) { clearSplitTab(args.tab); delete state.runtime[args.tab]; state.workspace.tabs.splice(i, 1); if (state.workspace.activeTab === args.tab) state.workspace.activeTab = state.workspace.tabs[i]?.id ?? state.workspace.tabs[i - 1]?.id ?? null; emitSnapshot() } break }
    case 'duplicate_tab': { const original = state.workspace.tabs.find((t) => t.id === args.tab); if (original) result = openTab({ url: original.url, space: original.space, folder: original.folder ?? undefined, pinned: original.pinned }); emitSnapshot(); break }
    case 'reload': case 'stop': { if (state.runtime[args.tab]) state.runtime[args.tab]!.loading = name === 'reload'; emitSnapshot(); break }
    case 'go_back': case 'go_forward': { if (state.runtime[args.tab]) { state.runtime[args.tab]!.canGoBack = name === 'go_forward'; state.runtime[args.tab]!.canGoForward = name === 'go_back'; emitSnapshot() } break }
    case 'set_pinned': { const tab = state.workspace.tabs.find((t) => t.id === args.tab); if (tab) tab.pinned = args.pinned; emitSnapshot(); break }
    case 'set_muted': { const tab = state.workspace.tabs.find((t) => t.id === args.tab); if (tab) tab.muted = args.muted; emitSnapshot(); break }
    case 'move_tab': { const tab = state.workspace.tabs.find((t) => t.id === args.tab); if (tab) { if (args.space) tab.space = args.space; if ('folder' in args) tab.folder = args.folder; if (args.pinned !== undefined) tab.pinned = args.pinned; const old = tabIndex(tab.id); state.workspace.tabs.splice(old, 1); const before = args.before ? tabIndex(args.before) : -1; state.workspace.tabs.splice(before >= 0 ? before : state.workspace.tabs.length, 0, tab); emitSnapshot() } break }
    case 'close_other_tabs': state.workspace.tabs.filter((t) => t.id !== args.tab && !t.pinned).forEach((t) => delete state.runtime[t.id]); state.workspace.tabs = state.workspace.tabs.filter((t) => t.id === args.tab || t.pinned); emitSnapshot(); break
    case 'close_tabs_below': { const idx = tabIndex(args.tab); const removed = state.workspace.tabs.slice(idx + 1).filter((t) => !t.pinned); removed.forEach((t) => delete state.runtime[t.id]); state.workspace.tabs = state.workspace.tabs.filter((t, i) => i <= idx || t.pinned); emitSnapshot(); break }
    case 'restore_tab': { const tab = state.workspace.tabs.find((t) => t.id === args.tab); if (tab) { tab.archived = false; state.workspace.activeTab = tab.id; emitSnapshot() } break }
    case 'copy_url': { const tab = state.workspace.tabs.find((t) => t.id === args.tab); if (tab) { void navigator.clipboard?.writeText(tab.url); emit('athanor://toast', { level: 'success', message: 'URL copied to clipboard.' }) } break }
    case 'create_folder': { const id = uid('folder'); state.workspace.folders.push({ id, name: args.name, space: args.space, collapsed: false, color: null, auto: false }); result = id; emitSnapshot(); break }
    case 'rename_folder': { const f = state.workspace.folders.find((x) => x.id === args.id); if (f) f.name = args.name; emitSnapshot(); break }
    case 'toggle_folder': { const f = state.workspace.folders.find((x) => x.id === args.id); if (f) f.collapsed = !f.collapsed; emitSnapshot(); break }
    case 'delete_folder': { const f = state.workspace.folders.find((x) => x.id === args.id); if (f) { state.workspace.folders = state.workspace.folders.filter((x) => x.id !== f.id); if (args.closeTabs) state.workspace.tabs = state.workspace.tabs.filter((t) => t.folder !== f.id); else state.workspace.tabs.forEach((t) => { if (t.folder === f.id) t.folder = null }); emitSnapshot() } break }
    case 'set_folder_color': { const f = state.workspace.folders.find((x) => x.id === args.id); if (f) f.color = args.color; emitSnapshot(); break }
    case 'add_space': { const id = uid('space'); state.workspace.spaces.push({ id, name: args.name, icon: args.icon, color: args.color, theme: null }); result = id; state.workspace.activeSpace = id; emitSnapshot(); break }
    case 'rename_space': { const s = state.workspace.spaces.find((x) => x.id === args.id); if (s) s.name = args.name; emitSnapshot(); break }
    case 'remove_space': if (state.workspace.spaces.length > 1) { state.workspace.spaces = state.workspace.spaces.filter((s) => s.id !== args.id); state.workspace.tabs = state.workspace.tabs.filter((t) => t.space !== args.id); state.workspace.activeSpace = state.workspace.spaces[0]!.id; emitSnapshot() } break
    case 'switch_space': state.workspace.activeSpace = args.id; { const candidate = state.workspace.tabs.find((t) => t.space === args.id && !t.archived); if (candidate) state.workspace.activeTab = candidate.id } emitSnapshot(); break
    case 'update_space': { const s = state.workspace.spaces.find((x) => x.id === args.id); if (s) Object.assign(s, args); emitSnapshot(); break }
    case 'auto_file_all': { for (const tab of state.workspace.tabs) { if (tab.folder || tab.pinned) continue; const rule = state.filingRules.find((entry) => matchesFilingRule(entry, tab.url, tab.title)); if (rule) { let f = state.workspace.folders.find((x) => x.name === rule.folder && x.space === tab.space); if (!f) { f = { id: uid('folder'), name: rule.folder, space: tab.space, collapsed: false, color: null, auto: true }; state.workspace.folders.push(f) } tab.folder = f.id; tab.autoFiled = true } } emit('athanor://toast', { level: 'success', message: 'Tabs filed into matching folders.' }); emitSnapshot(); break }
    case 'set_filing_rules': state.filingRules = args.rules; emitSnapshot(); break
    case 'archive_inactive_now': { const hours = state.settings.archiveAfterHours; if (hours > 0) { const cutoff = Date.now() - hours * 3_600_000; for (const tab of state.workspace.tabs) if (tab.id !== state.workspace.activeTab && !tab.pinned && !tab.archived && tab.lastActive < cutoff) tab.archived = true } emitSnapshot(); break }
    case 'split_with': { const other = active(); if (other && other.id !== args.tab) { state.workspace.split = { root: { kind: 'split', dir: args.dir, ratio: 0.5, a: { kind: 'leaf', tab: args.tab }, b: { kind: 'leaf', tab: other.id } }, focused: other.id }; result = true; emit('athanor://split-rects', splitRects()!); emitSnapshot() } else result = false; break }
    case 'unsplit': state.workspace.split = null; emitSnapshot(); break
    case 'set_split_ratio': { let node: SplitNode | null = state.workspace.split?.root ?? null; for (const branch of args.path as boolean[]) { if (node?.kind !== 'split') break; node = branch ? node.b : node.a } if (node?.kind === 'split') node.ratio = Math.min(0.8, Math.max(0.2, args.ratio)); const rects = splitRects(); if (rects) emit('athanor://split-rects', rects); break }
    case 'focus_pane': if (state.workspace.split) state.workspace.split.focused = args.tab; state.workspace.activeTab = args.tab; emitSnapshot(); break
    case 'get_split_rects': result = splitRects(); break
    case 'set_content_bounds': bounds = { x: args.x, y: args.y, w: args.w, h: args.h }; break
    case 'set_overlay_open': overlay = args.open; void overlay; break
    case 'set_page_radius': break
    case 'import_detect': result = [
      { id: 'chrome', name: 'Google Chrome', engine: 'chromium', profiles: [{ id: 'Default', name: 'Person 1', hasBookmarks: true, hasHistory: true }, { id: 'Profile 1', name: 'Work', hasBookmarks: true, hasHistory: true }] },
      { id: 'edge', name: 'Microsoft Edge', engine: 'chromium', profiles: [{ id: 'Default', name: 'Default', hasBookmarks: true, hasHistory: true }] },
      { id: 'firefox', name: 'Firefox', engine: 'firefox', profiles: [{ id: 'abc.default-release', name: 'default-release', hasBookmarks: true, hasHistory: true }] },
    ]; break
    case 'resolve_script_dialog': case 'resolve_permission': case 'reset_site_permissions': case 'reveal_download': break
    case 'zoom_page': case 'find_in_page': case 'hard_reload': case 'print_page': case 'toggle_fullscreen': case 'focus_shell': case 'focus_page': case 'run_shortcut': break
    case 'check_update': result = null; break
    case 'download_update': case 'install_update': break
    case 'import_run': { await new Promise((resolve) => setTimeout(resolve, 1400)); result = { bookmarks: 1204, folders: 38, history: 18332, skipped: 21, space: null, warnings: [] }; break }
    case 'import_pick_file': result = null; break
    case 'capture_frame': result = svgData('Frozen page', 210); break
    case 'resolve_context_menu': mockResolvedMenus.push({ tab: args.tab, command: args.command }); break
    case 'context_action': emit('athanor://toast', { level: 'info', message: `Context action: ${args.action}` }); break
    case 'set_viewport_emulation': emit('athanor://toast', { level: 'info', message: args.preset ? `Viewport preset: ${args.preset}` : 'Viewport emulation cleared.' }); break
    case 'omnibox_suggest': { const query = args.query.trim().toLowerCase(); const matches: Suggestion[] = state.workspace.tabs.filter((t) => !query || t.title.toLowerCase().includes(query) || t.url.toLowerCase().includes(query)).slice(0, 4).map((t) => ({ kind: 'tab', title: t.title, subtitle: t.url, url: t.url, tab: t.id })); if (query) { matches.push({ kind: 'search', title: `Search for “${args.query}”`, subtitle: 'Search the web', url: state.settings.searchEngine.replace('{q}', encodeURIComponent(args.query)) }); if (query.includes('.') && !query.includes(' ')) matches.unshift({ kind: 'url', title: `Open ${args.query}`, subtitle: 'Go to address', url: cleanUrl(args.query) }) } result = matches.slice(0, 7); break }
    case 'open_devtools': emit('athanor://toast', { level: 'info', message: 'Developer tools opened for this page.' }); break
    case 'run_dev_tool': result = await runTool(args.tool, args.input); break
    case 'list_dev_servers': result = servers; break
    case 'list_boards': result = summaries(); break
    case 'get_board': result = structuredClone(boards.find((b) => b.id === args.id) ?? boards[0]); break
    case 'create_board': { const board: Board = { id: uid('board'), name: args.name, items: [], view: { x: 0, y: 0, zoom: 1 }, background: '#26231f', alwaysOnTop: false }; boards.push(board); result = structuredClone(board); emit('athanor://board-changed', { id: board.id }); break }
    case 'save_board': { const index = boards.findIndex((b) => b.id === args.board.id); if (index < 0) boards.push(structuredClone(args.board)); else boards[index] = structuredClone(args.board); emit('athanor://board-changed', { id: args.board.id }); break }
    case 'delete_board': boards = boards.filter((b) => b.id !== args.id); emit('athanor://toast', { level: 'success', message: 'Board deleted.' }); break
    case 'board_put_asset': { const data = `data:${args.mime};base64,${args.dataBase64}`; const hash = `asset-${uid()}`; assets.set(hash, data); result = hash; break }
    case 'board_add_from_url': { const board = boards.find((b) => b.id === args.id); if (board) { const item: BoardItem = { id: uid('item'), kind: 'image', asset: 'sample-dusk', mime: 'image/svg+xml', sourceUrl: args.url, x: args.cx, y: args.cy, w: 320, h: 210, rotation: 0, opacity: 1, flipX: false, grayscale: false, locked: false, z: Date.now() }; board.items.push(item); emit('athanor://board-changed', { id: board.id }) } break }
    case 'open_board_window': emit('athanor://toast', { level: 'info', message: 'Board opened in a new window (mock).' }); break
    case 'set_board_always_on_top': { const b = boards.find((x) => x.id === args.id); if (b) b.alwaysOnTop = args.on; break }
    case 'send_page_image_to_board': { const b = boards.find((x) => x.id === args.boardId); if (b) { b.items.push({ id: uid('item'), kind: 'image', asset: 'sample-coast', mime: 'image/svg+xml', x: 0, y: 0, w: 400, h: 240, rotation: 0, opacity: 1, flipX: false, grayscale: false, locked: false, z: Date.now() }); emit('athanor://board-changed', { id: b.id }) } break }
    case 'get_adblock_status': result = structuredClone(adblock); break
    case 'set_adblock_enabled': adblock.enabled = args.enabled; state.settings.adblockEnabled = args.enabled; emit('athanor://adblock', structuredClone(adblock)); emitSnapshot(); break
    case 'set_adblock_list_enabled': { const list = adblock.lists.find((l) => l.id === args.id); if (list) list.enabled = args.enabled; emit('athanor://adblock', structuredClone(adblock)); break }
    case 'update_adblock_lists': adblock.updating = true; emit('athanor://adblock', structuredClone(adblock)); await new Promise((resolve) => setTimeout(resolve, 550)); adblock.updating = false; adblock.lists.forEach((l) => { l.updatedAt = Date.now() }); emit('athanor://adblock', structuredClone(adblock)); emit('athanor://toast', { level: 'success', message: 'Filter lists are up to date.' }); break
    case 'get_site_shield': result = shields.get(args.host) ?? true; break
    case 'set_site_shield': shields.set(args.host, args.enabled); emit('athanor://toast', { level: 'info', message: `${args.host}: protection ${args.enabled ? 'on' : 'off'}.` }); break
    case 'get_user_filters': result = userFilters; break
    case 'set_user_filters': { const issues = validateFilterText(args.text); const rejected = issues.find((issue) => issue.line === 0); if (rejected) throw new Error(rejected.message); userFilters = args.text; result = issues; break }
    case 'get_settings': result = structuredClone(state.settings); break
    case 'set_settings': Object.assign(state.settings, args.patch); document.documentElement.dataset.themeDark = String(mockThemeDark(state.settings.theme)); emitSnapshot(); break
    case 'list_extensions': result = structuredClone(extensions); break
    case 'set_extension_enabled': { const ext = extensions.find((e) => e.id === args.id); if (ext) ext.enabled = args.enabled; panels = panels.filter((p) => p.ext !== args.id || args.enabled); emitSnapshot(); break }
    case 'install_extension': { const name = String(args.path).split(/[\\/]/).filter(Boolean).at(-1) || 'Sample Extension'; const id = uid('extension'); extensions.push({ id, name, version: '1.0.0', description: 'Installed from a local directory.', enabled: true, source: 'user', permissions: ['activeTab'] }); emit('athanor://toast', { level: 'success', message: `${name} installed.` }); break }
    case 'remove_extension': extensions = extensions.filter((e) => e.id !== args.id); panels = panels.filter((p) => p.ext !== args.id); break
    case 'pick_directory': result = 'C:/Users/Guest/Extensions/sample'; break
    case 'window_minimize': case 'window_close': break
    case 'window_toggle_maximize': maximized = !maximized; break
    case 'window_start_drag': break
    case 'window_is_maximized': result = maximized; break
    default: genericError(String(name))
  }
  return result as K extends keyof CommandResult ? CommandResult[K] : void
}

/** Commands the shell answered for mock context menus (lets browser-only runs and tests inspect them). */
export const mockResolvedMenus: { tab: string; command: number | null }[] = []
const mockItem = (id: number, name: string, label: string, extra: Partial<ContextItem> = {}): ContextItem => ({ id, name, label, kind: 'command', enabled: true, checked: false, shortcut: null, children: [], ...extra })
const mockSeparator = (id: number): ContextItem => mockItem(id, '', '', { kind: 'separator' })
/** Browser-only stand-in for the engine's right-click request (WebView2 sends the real thing). */
export function mockPageContextMenu(tab: string, x: number, y: number, kind: ContextTarget['kind'] = 'page') {
  const pageUrl = state.workspace.tabs.find((t) => t.id === tab)?.url ?? ''
  const target: ContextTarget = { kind, pageUrl, linkUrl: kind === 'page' ? null : kind === 'image' ? 'https://example.com/article' : null, linkText: null, sourceUrl: kind === 'image' ? 'https://example.com/photo.jpg' : null, selectionText: kind === 'selection' ? 'Quiet surfaces, a little room to think' : null, editable: false }
  const nav = [mockItem(1, 'back', 'Back', { shortcut: 'Alt+Left Arrow' }), mockItem(2, 'forward', 'Forward', { enabled: false, shortcut: 'Alt+Right Arrow' }), mockItem(3, 'reload', 'Reload', { shortcut: 'Ctrl+R' })]
  const tail = [mockSeparator(90), mockItem(11, 'saveas', 'Save as...', { shortcut: 'Ctrl+S' }), mockItem(12, 'print', 'Print...', { shortcut: 'Ctrl+P' }), mockItem(13, 'share', 'Share'), mockSeparator(91), mockItem(14, 'viewpagesource', 'View page source', { shortcut: 'Ctrl+U' }), mockItem(15, 'inspectelement', 'Inspect', { shortcut: 'Ctrl+Shift+I' })]
  const items = kind === 'image'
    ? [mockItem(20, 'openimageinnewtab', 'Open image in new tab'), mockItem(21, 'saveimageas', 'Save image as...'), mockItem(22, 'copyimage', 'Copy image'), mockItem(23, 'copyimagelocation', 'Copy image link'), mockSeparator(92), mockItem(24, 'openlinkinnewwindow', 'Open link in new window'), mockItem(25, 'copylinklocation', 'Copy link address'), ...tail]
    : kind === 'selection'
      ? [mockItem(30, 'copy', 'Copy', { shortcut: 'Ctrl+C' }), mockItem(31, 'searchthewebfor', 'Search the web for \u201cQuiet surfaces\u2026\u201d'), mockSeparator(93), mockItem(32, 'selectall', 'Select all', { shortcut: 'Ctrl+A' }), ...tail]
      : [...nav, ...tail]
  emit('athanor://context-menu', { type: 'pageContextMenu', tab, x, y, target, items })
}
export function mockThemeDark(id: string | undefined): boolean { return themes.find((t) => t.id === id)?.dark ?? false }
export function mockAssetUrl(hash: string): string { return assets.get(hash) ?? svgData('Reference image', 28) }
export function mockGetPlatformFromUrl(): Platform | null {
  if (!isMockMode() || typeof window === 'undefined') return null
  return new URLSearchParams(window.location.search).get('platform') === 'android' ? 'android' : null
}
