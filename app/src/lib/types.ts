export type Id = string
export interface Tab { id: Id; url: string; title: string; favicon: string | null; space: Id; folder: Id | null; pinned: boolean; parent: Id | null; created: number; lastActive: number; archived: boolean; muted: boolean; autoFiled: boolean }
export interface Folder { id: Id; name: string; space: Id; collapsed: boolean; color: string | null; auto: boolean }
export interface Space { id: Id; name: string; icon: string; color: string; theme: string | null }
export type SplitNode = { kind: 'leaf'; tab: Id } | { kind: 'split'; dir: 'row' | 'column'; ratio: number; a: SplitNode; b: SplitNode }
export interface SplitState { root: SplitNode; focused: Id }
export interface Workspace { spaces: Space[]; folders: Folder[]; tabs: Tab[]; activeSpace: Id; activeTab: Id | null; split: SplitState | null }
export interface TabRuntime { loading: boolean; canGoBack: boolean; canGoForward: boolean; blocked: number; audible: boolean; secure: boolean }
export interface Settings { searchEngine: string; archiveAfterHours: number; httpsUpgrade: boolean; stripTracking: boolean; autoFile: boolean; restoreSession: boolean; sidebarSide: 'left' | 'right'; sidebarCompact: boolean; sidebarWidth: number; theme: string; adblockEnabled: boolean; homepage: string; youtubeAdSkip: boolean; blockDrm: boolean; onboarded: boolean; webFont: boolean; autoUpdate: boolean; siteZoom: Record<string, number>; sitePermissions: Record<string, boolean> }
export interface ScriptDialogEvent { type: 'scriptDialog'; tab: Id; kind: 'alert' | 'confirm' | 'prompt' | 'beforeunload'; message: string; defaultText: string; origin: string }
export interface PermissionPrompt { tab: Id; id: number; origin: string; kind: string; host: string }
export interface DownloadEvent { type: 'download'; tab: Id; id: number; name: string; path: string; state: 'started' | 'progress' | 'done' | 'failed' | 'cancelled'; received: number; total: number }
export interface StatusTextEvent { type: 'statusText'; tab: Id; text: string }
export interface UpdateInfo { version: string; current: string; notes: string | null; downloaded: boolean }
export interface FilingRule { id: string; folder: string; host: string | null; pathPrefix: string | null; titleContains: string | null; enabled: boolean }
export type Platform = 'windows' | 'macos' | 'linux' | 'android' | 'ios'
export interface Snapshot { workspace: Workspace; runtime: Record<Id, TabRuntime>; settings: Settings; filingRules: FilingRule[]; platform: Platform; version: string; blockedTotal: number }
export interface Rect { x: number; y: number; w: number; h: number }
export interface SplitRects { panes: { tab: Id; rect: Rect }[]; dividers: { path: boolean[]; dir: 'row' | 'column'; rect: Rect; ratio: number }[] }
export interface Suggestion { kind: 'tab' | 'history' | 'search' | 'url' | 'command'; title: string; subtitle: string; url?: string; tab?: Id; icon?: string; command?: string }
export interface DevServer { port: number; url: string; title: string | null }
export type DevTool = 'json-pretty' | 'json-minify' | 'base64-encode' | 'base64-decode' | 'url-encode' | 'url-decode' | 'jwt' | 'timestamp' | 'uuid' | 'sha256' | 'color'
export interface AdblockList { id: string; name: string; enabled: boolean; updatedAt: number | null; ruleCount: number; error: string | null }
export interface AdblockStatus { enabled: boolean; lists: AdblockList[]; blockedTotal: number; updating: boolean }
export interface LineIssue { line: number; message: string }   // line = 1-based; 0 = whole text (e.g. too large)
export interface ThemeInfo { id: string; name: string; dark: boolean; source: 'builtin' | 'extension' | 'user' }
export interface ExtensionInfo { id: string; name: string; version: string; description: string; enabled: boolean; source: 'builtin' | 'user'; permissions: string[] }
export interface PanelInfo { ext: string; id: string; title: string; icon: string; url: string }
export interface CommandInfo { ext: string; id: string; title: string; keybinding: string | null }
export interface BoardSummary { id: Id; name: string; itemCount: number; updatedAt: number }
export type ItemKind = { kind: 'image'; asset: string; mime: string; sourceUrl?: string | null } | { kind: 'text'; text: string; size: number; color: string }
export type BoardItem = { id: Id; x: number; y: number; w: number; h: number; rotation: number; opacity: number; flipX: boolean; grayscale: boolean; locked: boolean; z: number } & ItemKind
export interface Board { id: Id; name: string; items: BoardItem[]; view: { x: number; y: number; zoom: number }; background: string; alwaysOnTop: boolean }

export interface SplitArgs { tab: Id; dir: 'row' | 'column'; newFirst?: boolean }
export interface CommandArgs {
  get_snapshot: Record<string, never>; get_shell_css: Record<string, never>; list_themes: Record<string, never>; set_theme: { id: string }; set_space_theme: { space: Id; theme: string | null };
  get_panels: Record<string, never>; get_commands: Record<string, never>; run_extension_command: { ext: string; id: string }; extension_rpc: { ext: string; method: string; params: unknown };
  open_tab: { url?: string; parent?: Id; folder?: Id; space?: Id; background?: boolean; pinned?: boolean }; navigate: { tab: Id; input: string }; activate_tab: { tab: Id }; close_tab: { tab: Id }; duplicate_tab: { tab: Id }; reload: { tab: Id }; stop: { tab: Id }; go_back: { tab: Id }; go_forward: { tab: Id }; set_pinned: { tab: Id; pinned: boolean }; set_muted: { tab: Id; muted: boolean }; move_tab: { tab: Id; space?: Id; folder?: Id | null; before?: Id | null; pinned?: boolean }; close_other_tabs: { tab: Id }; close_tabs_below: { tab: Id }; restore_tab: { tab: Id }; copy_url: { tab: Id };
  create_folder: { space: Id; name: string }; rename_folder: { id: Id; name: string }; toggle_folder: { id: Id }; delete_folder: { id: Id; closeTabs: boolean }; set_folder_color: { id: Id; color: string | null };
  add_space: { name: string; icon: string; color: string }; rename_space: { id: Id; name: string }; remove_space: { id: Id }; switch_space: { id: Id }; update_space: { id: Id; icon?: string; color?: string };
  auto_file_all: Record<string, never>; set_filing_rules: { rules: FilingRule[] }; archive_inactive_now: Record<string, never>;
  split_with: SplitArgs; unsplit: Record<string, never>; set_split_ratio: { path: boolean[]; ratio: number }; focus_pane: { tab: Id }; get_split_rects: Record<string, never>;
  set_content_bounds: Rect; set_overlay_open: { open: boolean }; capture_frame: { tab: Id }; import_detect: Record<string, never>; import_run: { request: ImportRequest }; import_pick_file: Record<string, never>; set_page_radius: { radius: number }; resolve_context_menu: { tab: Id; command: number | null }; context_action: { action: string; data: string }; set_viewport_emulation: { tab: Id; preset: 'mobile' | 'tablet' | 'laptop' | null };
  omnibox_suggest: { query: string }; open_devtools: { tab: Id }; run_dev_tool: { tool: DevTool; input: string }; list_dev_servers: Record<string, never>;
  list_boards: Record<string, never>; get_board: { id: Id }; create_board: { name: string }; save_board: { board: Board }; delete_board: { id: Id }; board_put_asset: { dataBase64: string; mime: string }; board_add_from_url: { id: Id; url: string; cx: number; cy: number }; open_board_window: { id: Id }; set_board_always_on_top: { id: Id; on: boolean }; send_page_image_to_board: { tab: Id; boardId: Id };
  get_adblock_status: Record<string, never>; set_adblock_enabled: { enabled: boolean }; set_adblock_list_enabled: { id: string; enabled: boolean }; update_adblock_lists: Record<string, never>; get_site_shield: { host: string }; set_site_shield: { host: string; enabled: boolean };
  get_user_filters: Record<string, never>; set_user_filters: { text: string };
  resolve_script_dialog: { tab: Id; accept: boolean; text: string }; resolve_permission: { tab: Id; id: number; allow: boolean; remember?: boolean; origin?: string; kind?: string }; reset_site_permissions: Record<string, never>; reveal_download: { path: string }; zoom_page: { tab: Id; dir: number }; find_in_page: { tab: Id; action: 'start' | 'next' | 'prev' | 'clear'; query: string; matchCase: boolean }; hard_reload: { tab: Id }; print_page: { tab: Id }; toggle_fullscreen: Record<string, never>; focus_shell: Record<string, never>; focus_page: { tab: Id }; run_shortcut: { combo: string }; check_update: Record<string, never>; download_update: Record<string, never>; install_update: Record<string, never>; get_settings: Record<string, never>; set_settings: { patch: Partial<Settings> }; list_extensions: Record<string, never>; set_extension_enabled: { id: string; enabled: boolean }; install_extension: { path: string }; remove_extension: { id: string }; pick_directory: Record<string, never>;
  window_minimize: Record<string, never>; window_toggle_maximize: Record<string, never>; window_close: Record<string, never>; window_start_drag: Record<string, never>; window_is_maximized: Record<string, never>;
}
export interface CommandResult { check_update: UpdateInfo | null; import_detect: DetectedBrowser[]; import_run: ImportReport; import_pick_file: string | null; capture_frame: string; get_snapshot: Snapshot; get_shell_css: string; list_themes: ThemeInfo[]; get_panels: PanelInfo[]; get_commands: CommandInfo[]; open_tab: Id; duplicate_tab: Id | null; add_space: Id; create_folder: Id; split_with: boolean; get_split_rects: SplitRects | null; omnibox_suggest: Suggestion[]; run_dev_tool: string; list_dev_servers: DevServer[]; list_boards: BoardSummary[]; get_board: Board; create_board: Board; board_put_asset: string; get_adblock_status: AdblockStatus; get_site_shield: boolean; get_user_filters: string; set_user_filters: LineIssue[]; get_settings: Settings; list_extensions: ExtensionInfo[]; pick_directory: string | null; window_is_maximized: boolean }
export type EventPayloads = { 'athanor://context-menu': PageContextMenu; 'athanor://snapshot': Snapshot; 'athanor://shortcut': { combo: string }; 'athanor://find': { tab: Id; count: number; index: number }; 'athanor://script-dialog': ScriptDialogEvent; 'athanor://permission': PermissionPrompt; 'athanor://download': DownloadEvent; 'athanor://status-text': StatusTextEvent; 'athanor://toast': { level: 'info' | 'success' | 'error'; message: string }; 'athanor://adblock': AdblockStatus; 'athanor://split-rects': SplitRects; 'athanor://board-changed': { id: Id }; 'athanor://shell-css': string; 'athanor://extension-event': { ext: string; type: string; data: unknown } }
export interface ContextTarget { kind: 'page' | 'image' | 'selection' | 'audio' | 'video'; pageUrl: string; linkUrl: string | null; linkText: string | null; sourceUrl: string | null; selectionText: string | null; editable: boolean }
export interface ContextItem { id: number; name: string; label: string; kind: 'command' | 'checkbox' | 'radio' | 'separator' | 'submenu'; enabled: boolean; checked: boolean; shortcut: string | null; children: ContextItem[] }
/** Engine "page context menu" request: `x`/`y` are logical pixels from the top-left of the tab's view. */
export interface PageContextMenu { type: 'pageContextMenu'; tab: Id; x: number; y: number; target: ContextTarget; items: ContextItem[] }
export interface ImportProfile { id: string; name: string; hasBookmarks: boolean; hasHistory: boolean }
export interface DetectedBrowser { id: string; name: string; engine: 'chromium' | 'firefox'; profiles: ImportProfile[] }
export type ImportSource = { kind: 'browser'; browser: string; profile: string } | { kind: 'file'; path: string }
export interface ImportRequest { source: ImportSource; bookmarks: boolean; history: boolean }
export interface ImportReport { bookmarks: number; folders: number; history: number; skipped: number; space: Id | null; warnings: string[] }
