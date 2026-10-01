# Athanor IPC contract (shell UI ⇄ Rust backend)

The backend (Tauri, `app/src-tauri`) is the single source of truth. The React shell is a thin view:
it calls **commands** and re-renders whenever the backend emits a fresh **snapshot**. The same contract is
used on desktop and Android — on Android the tab webviews are native Android `WebView`s managed by a Kotlin
plugin, but the shell cannot tell the difference.

* JSON is **camelCase** everywhere. Command arguments are passed as one object: `invoke('open_tab', { url, parent })`.
* Errors reject with a plain string message.
* `Id` = opaque string.

## Layout model (important)

Tab pages are **not** DOM inside the shell. They are separate native webviews that sit on top of the shell webview.
The shell owns a *content area* `<div data-part="content">`; it reports that rectangle to the backend and the backend
places the native webviews there (split view = several rectangles).

1. Shell measures `content` with `getBoundingClientRect()` (CSS px, relative to the shell viewport) and calls
   `set_content_bounds({ x, y, w, h })` on mount, on every `ResizeObserver` change, and when the sidebar collapses.
2. Native webviews always render **above** any shell DOM. Whenever the shell shows something that must cover the
   page (command palette, modal dialogs, dropdown menus that overlap the content area, the Android tab switcher…),
   it calls `set_overlay_open({ open: true })`, and `false` when closed (backend ref-counts nothing: send the current boolean).
   The backend hides the tab webviews while `open` is true. Shell may render a dimmed backdrop itself.
3. Tabs whose `url` is `athanor://newtab` (or `athanor://settings`, `athanor://boards`) have **no native webview**.
   The shell renders the matching React page inside `content` instead (the backend hides all webviews when the active
   tab is an internal page). Internal pages: `newtab`, `settings`, `boards`, `extensions`.
4. If `workspace.split` is set, the backend computes pane rectangles with `athanor-core::layout` from the content bounds and
   positions each pane's webview; the shell draws divider handles from `get_split_rects` (see below) and sends
   `set_split_ratio` while dragging.

## Types (TypeScript)

```ts
export type Id = string;

export interface Tab {
  id: Id; url: string; title: string; favicon: string | null;
  space: Id; folder: Id | null; pinned: boolean; parent: Id | null;
  created: number; lastActive: number;           // ms since epoch
  archived: boolean; muted: boolean; autoFiled: boolean;
}
export interface Folder { id: Id; name: string; space: Id; collapsed: boolean; color: string | null; auto: boolean }
export interface Space { id: Id; name: string; icon: string; color: string; theme: string | null }   // icon = lucide icon name or emoji

export type SplitNode =
  | { kind: 'leaf'; tab: Id }
  | { kind: 'split'; dir: 'row' | 'column'; ratio: number; a: SplitNode; b: SplitNode };
export interface SplitState { root: SplitNode; focused: Id }

export interface Workspace {
  spaces: Space[]; folders: Folder[]; tabs: Tab[];   // tabs are in display order; group by space → pinned → folder → root
  activeSpace: Id; activeTab: Id | null; split: SplitState | null;
}

export interface TabRuntime {                        // per-tab live state, keyed by tab id in Snapshot.runtime
  loading: boolean; canGoBack: boolean; canGoForward: boolean;
  blocked: number;                                   // requests blocked on this page
  audible: boolean; secure: boolean;
}

export interface Settings {
  searchEngine: string;            // URL template containing {q}
  archiveAfterHours: number;       // 0 = never
  httpsUpgrade: boolean; stripTracking: boolean; autoFile: boolean; restoreSession: boolean;
  sidebarSide: 'left' | 'right'; sidebarCompact: boolean; sidebarWidth: number;
  theme: string;                   // theme id
  adblockEnabled: boolean;
}

export interface FilingRule {
  id: string; folder: string; host: string | null; pathPrefix: string | null; titleContains: string | null; enabled: boolean;
}

export type Platform = 'windows' | 'macos' | 'linux' | 'android' | 'ios';

export interface Snapshot {
  workspace: Workspace;
  runtime: Record<Id, TabRuntime>;
  settings: Settings;
  filingRules: FilingRule[];
  platform: Platform;
  version: string;
  blockedTotal: number;
}

export interface Rect { x: number; y: number; w: number; h: number }
export interface SplitRects { panes: { tab: Id; rect: Rect }[]; dividers: { path: boolean[]; dir: 'row' | 'column'; rect: Rect; ratio: number }[] }

export interface Suggestion { kind: 'tab' | 'history' | 'search' | 'url' | 'command'; title: string; subtitle: string; url?: string; tab?: Id; icon?: string; command?: string }

export interface DevServer { port: number; url: string; title: string | null }
export type DevTool = 'json-pretty' | 'json-minify' | 'base64-encode' | 'base64-decode' | 'url-encode' | 'url-decode' | 'jwt' | 'timestamp' | 'uuid' | 'sha256' | 'color';

export interface AdblockList { id: string; name: string; enabled: boolean; updatedAt: number | null; ruleCount: number; error: string | null }
export interface AdblockStatus { enabled: boolean; lists: AdblockList[]; blockedTotal: number; updating: boolean }
export interface LineIssue { line: number; message: string }   // line = 1-based; 0 = whole text (e.g. too large)

export interface ThemeInfo { id: string; name: string; dark: boolean; source: 'builtin' | 'extension' | 'user' }
export interface ExtensionInfo { id: string; name: string; version: string; description: string; enabled: boolean; source: 'builtin' | 'user'; permissions: string[] }
export interface PanelInfo { ext: string; id: string; title: string; icon: string; url: string }      // url = athanor-ext://<ext>/<entry>
export interface CommandInfo { ext: string; id: string; title: string; keybinding: string | null }

export interface BoardSummary { id: Id; name: string; itemCount: number; updatedAt: number }
// Board / Item / View exactly as serialized by athanor-core::board (see crates/athanor-core/src/board.rs).
export type ItemKind =
  | { kind: 'image'; asset: string; mime: string; sourceUrl?: string | null }
  | { kind: 'text'; text: string; size: number; color: string };
export type BoardItem = { id: Id; x: number; y: number; w: number; h: number; rotation: number; opacity: number; flipX: boolean; grayscale: boolean; locked: boolean; z: number } & ItemKind;
export interface Board { id: Id; name: string; items: BoardItem[]; view: { x: number; y: number; zoom: number }; background: string; alwaysOnTop: boolean }
```

## Events (backend → shell), `listen()` names

| event | payload | meaning |
|---|---|---|
| `athanor://snapshot` | `Snapshot` | Any state change. Replace the store wholesale. Emitted at most ~60 Hz. |
| `athanor://shortcut` | `{ combo: string }` | A shortcut intercepted natively (the page had focus). Combos are normalised: `Ctrl+T`, `Ctrl+Shift+T`, `Ctrl+L`, `Ctrl+K`, `Ctrl+W`, `Ctrl+Tab`, `Ctrl+Shift+Tab`, `Alt+Left`, `Alt+Right`, `F5`, `Ctrl+R`, `F12`, `Ctrl+\\`, `Ctrl+B`, `Ctrl+1..9`. Shell handles ones that are UI-only (focus omnibox, palette, toggle sidebar); the backend already performed the rest. |
| `athanor://context-menu` | `{ type: 'pageContextMenu', tab, x, y, target: ContextTarget, items: ContextItem[] }` | The page asked for a right-click menu. The engine holds the request open (WebView2 deferral) until the shell answers with `resolve_context_menu`. `x`/`y` are physical pixels from the top-left of the tab's view. `items` are the engine's own entries (`name` is its unlocalised command name, e.g. `copy`, `saveas`); the shell draws them with shadcn and adds Athanor's own (open link in a tab, send image to board, search selection). Windows only for now. |
| `athanor://toast` | `{ level: 'info' \| 'success' \| 'error'; message: string }` | Show a toast. |
| `athanor://adblock` | `AdblockStatus` | Adblock list state / counters changed. |
| `athanor://split-rects` | `SplitRects` | Pane rectangles changed (only while split is active). |
| `athanor://board-changed` | `{ id: Id }` | A board was modified from another window. |
| `athanor://shell-css` | `string` | Theme/extension CSS changed; replace `<style id="athanor-shell-css">`. |
| `athanor://extension-event` | `{ ext: string; type: string; data: unknown }` | Forwarded to the matching extension panel iframe. |

## Commands (shell → backend)

Names are `snake_case`; args are camelCase properties of the single argument object. All return `Promise<void>` unless noted.

### Bootstrap
* `get_snapshot() → Snapshot`
* `get_shell_css() → string` — CSS for the active theme + enabled extensions. Inject once at startup into `<style id="athanor-shell-css">`, then keep in sync via `athanor://shell-css`.
* `list_themes() → ThemeInfo[]`, `set_theme({ id })`, `set_space_theme({ space, theme: string | null })`
* `get_panels() → PanelInfo[]`, `get_commands() → CommandInfo[]`, `run_extension_command({ ext, id })`
* `extension_rpc({ ext, method, params }) → unknown` — bridge used for panel iframe `postMessage` requests (the shell forwards `{athanor:1,id,method,params}` from a panel iframe, awaits this, and replies to the iframe).

### Tabs
* `open_tab({ url?: string, parent?: Id, folder?: Id, space?: Id, background?: boolean, pinned?: boolean }) → Id` — omit `url` for a new tab page.
* `navigate({ tab, input })` — `input` is raw omnibox text; the backend resolves URL vs search.
* `activate_tab({ tab })`, `close_tab({ tab })`, `duplicate_tab({ tab }) → Id`, `reload({ tab })`, `stop({ tab })`, `go_back({ tab })`, `go_forward({ tab })`
* `set_pinned({ tab, pinned })`, `set_muted({ tab, muted })`
* `move_tab({ tab, space?: Id, folder?: Id | null, before?: Id | null, pinned?: boolean })` — drag & drop. `before` = insert before that tab, absent = end.
* `close_other_tabs({ tab })`, `close_tabs_below({ tab })`
* `restore_tab({ tab })` — un-archive.
* `copy_url({ tab })`

### Folders / spaces
* `create_folder({ space, name }) → Id`, `rename_folder({ id, name })`, `toggle_folder({ id })`, `delete_folder({ id, closeTabs })`, `set_folder_color({ id, color })`
* `add_space({ name, icon, color }) → Id`, `rename_space({ id, name })`, `remove_space({ id })`, `switch_space({ id })`, `update_space({ id, icon?, color? })`

### Auto filing & archive
* `auto_file_all()` — run the filer over unfiled tabs.
* `set_filing_rules({ rules: FilingRule[] })`
* `archive_inactive_now()`

### Split view
* `split_with({ tab, dir: 'row' | 'column', newFirst?: boolean }) → boolean`, `unsplit()`
* `set_split_ratio({ path: boolean[], ratio })` — `path` as in `SplitRects.dividers[i].path`.
* `focus_pane({ tab })`
* `get_split_rects() → SplitRects | null` — current pane/divider rectangles (null when not split); kept fresh by `athanor://split-rects`.

### Layout & overlays
* `set_content_bounds({ x, y, w, h })`, `set_overlay_open({ open })`
* `set_page_radius({ radius })`: corner radius (physical px) for the native page views; Windows clips each view's container window to a rounded rect (0 = square).
* `capture_frame({ tab }) -> string`: JPEG/PNG `data:` URL of the visible page. The shell shows it as a still image while it hides the native view (`set_overlay_open`), so menus and dialogs never make the page vanish.
* `resolve_context_menu({ tab, command: number | null })`: answer an `athanor://context-menu` request exactly once: the chosen `ContextItem.id`, or `null` to dismiss.
* `context_action({ action, data })`: host-side half of Athanor's own context entries (`send-image-to-board` with the image URL).
* `set_viewport_emulation({ tab, preset: 'mobile' | 'tablet' | 'laptop' | null })` — dev responsive mode (resizes that tab's webview inside its slot, centred).

### Omnibox / palette
* `omnibox_suggest({ query }) → Suggestion[]` — open tabs, recent history, search fallback, dev servers, palette commands. Debounce ~60 ms.

### Developer tools
* `open_devtools({ tab })`
* `run_dev_tool({ tool: DevTool, input }) → string`
* `list_dev_servers() → DevServer[]` — probes common localhost ports (fast, ≤300 ms).

### Boards (PureRef-style reference boards)
* `list_boards() → BoardSummary[]`, `get_board({ id }) → Board`, `create_board({ name }) → Board`, `save_board({ board })`, `delete_board({ id })`
* `board_put_asset({ dataBase64, mime }) → string` (hash). Asset URL for `<img>`: `athanor-asset://localhost/<hash>` on Android/Linux/mac, `http://athanor-asset.localhost/<hash>` on Windows — use the helper `assetUrl(hash)` in the frontend that picks by `platform` (Tauri v2 custom-protocol rule).
* `board_add_from_url({ id, url, cx, cy })` — backend downloads the image (used for drag-from-page URLs).
* `open_board_window({ id })` — desktop only: opens the board in its own window; `set_board_always_on_top({ id, on })`.
* `send_page_image_to_board({ tab, boardId })` — captures the visible page area of a tab into a board.

### Adblock
* `get_adblock_status() → AdblockStatus`, `set_adblock_enabled({ enabled })`, `set_adblock_list_enabled({ id, enabled })`, `update_adblock_lists()`
* `get_site_shield({ host }) → boolean` (true = blocking on), `set_site_shield({ host, enabled })`

### Shields

The existing Adblock commands above remain the shell management API. The WebView cosmetic bridge
is a separate page-to-native protocol, not a Tauri invoke command: each frame sends
`{ athanorShield: 1, type: "cosmetic-query", id, classes, ids }` over its native WebView message
channel, and the host replies to that same frame with
`{ athanorShield: 1, type: "cosmetic-response", id, css }`. The host derives the frame URL from
the native message event, validates/rate-limits tokens, and never evaluates content from the page.
See [ADBLOCK.md](ADBLOCK.md#cosmetic-message-protocol-version-1) for limits and Android transport
guidance.

User filters ("My filters") are part of the same shield contract; the text is uBlock / Adblock Plus syntax:

* `get_user_filters() → string` — the stored text (may be empty).
* `set_user_filters({ text }) → LineIssue[]` — stores the text, recompiles, then returns the lines the engine
  cannot parse (`line` is 1-based; `line: 0` means the whole text was rejected). Text is capped at 512 KiB: an
  oversized text is **not** stored and the command rejects with a string message, so the shell must keep the
  editor content. Recompiling emits `athanor://adblock` when the counters change.

Granular per-site controls, element picker/zapper, and dynamic filtering do not yet
have Tauri commands.

### Settings / extensions
* `get_settings() → Settings`, `set_settings({ patch: Partial<Settings> })`
* `list_extensions() → ExtensionInfo[]`, `set_extension_enabled({ id, enabled })`, `install_extension({ path })`, `remove_extension({ id })`
* `pick_directory() → string | null`

### Window (desktop)
* `window_minimize()`, `window_toggle_maximize()`, `window_close()`, `window_start_drag()`, `window_is_maximized() → boolean`
  The desktop window is frameless; the shell draws its own title bar / controls.

## Theming contract for the shell

The shell uses shadcn/ui with the standard CSS variables (`--background`, `--foreground`, `--card`, `--popover`, `--primary`,
`--secondary`, `--muted`, `--accent`, `--destructive`, `--border`, `--input`, `--ring`, `--radius` + their `-foreground`
counterparts, `--sidebar*`) plus Athanor tokens: `--ath-tab-height`, `--ath-sidebar-width`, `--ath-tab-active`, `--ath-tab-hover`,
`--ath-space-accent`, `--ath-blur`, `--font-ui`, `--font-mono`. **Never hardcode colours, radii, fonts or sizes in components — always use these variables** so themes reach everything. Every meaningful element carries
a `data-part="…"` attribute and state attributes (`data-active`, `data-pinned`, `data-loading`, `data-collapsed`, `data-audible`,
`data-archived`); the root element carries `data-side="left|right"` and `data-density="compact|comfortable"`. See `docs/THEMING.md`
for the full list of part names.

## Keyboard

The shell registers document-level shortcuts for when the shell itself has focus; the backend forwards the same combos
via `athanor://shortcut` when a page has focus. Use one shared handler for both.
