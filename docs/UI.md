# Athanor shell UI

The React shell lives under `app/src/`. `components/` contains the sidebar with desktop browser controls, mobile bars and tab switcher, and shadcn/ui primitives (`components/ui/`, Radix + Tailwind v4, one look for every menu in `menu-styles.ts`) and page building blocks (`components/page.tsx`); `pages/` holds the lazy Settings, Boards, Developer Tools, and Extensions screens; `lib/` contains the IPC wrapper, event listener, mock backend, Zustand store, and tested UI math.

## State flow

`bootStore()` loads the snapshot and auxiliary lists through `lib/api.ts`. The Tauri implementation calls the commands in `docs/IPC.md`; a plain browser selects `lib/mock/backend.ts`. Snapshot events replace the Zustand snapshot wholesale. Screens send user actions through the same typed API, and the mock emits the same event names back into the store.

## Add a command or screen

Add a command's argument and result types in `lib/types.ts`, expose it through `lib/api.ts`, and implement it in `lib/mock/backend.ts` so browser demos stay functional. For a page, add a component under `pages/`, lazy-load it from `App.tsx`, and route it through an `athanor://` internal tab when the backend should hide native page webviews. Use CSS variables and `data-part` hooks so backend theme CSS can restyle the shell.

## My filters editor

`Settings > Privacy` carries a monospace editor for the user's own filter rules (`data-part="my-filters"`). It loads through `getUserFilters()` when the section opens, saves with `setUserFilters()` or `Ctrl+S` inside the editor, reverts to the last saved text, and keeps a live line counter; after a save it lists the returned `LineIssue` lines and clicking one selects that line in the textarea. The pure helpers in `lib/userFilters.ts` map a line number to a selection range, count lines, and validate text so the mock backend can report the same issues.

## Mock backend

Mock mode starts automatically when `window.__TAURI_INTERNALS__` is absent. It includes example spaces, tabs, folders, filter lists, developer servers, extension panels, and reference boards; it also implements tab actions, filing, archive, split view, settings, boards, and developer utilities. `?platform=android` forces the mobile shell only in mock mode.

## Filing on request

Tabs stay loose when opened or navigated. The File button in the desktop toolbar, `Ctrl+Shift+F`, the command bar entry, Settings > Filing, and the sidebar context menu all call the same filing action. It applies enabled rules to open, unfiled, unpinned web tabs across spaces, reports the number of tabs and destination folders, and offers Undo for seven seconds. Undo only moves tabs that are still in the folder chosen by that action, so a later manual move is respected. Newly created empty folders are removed. Legacy `autoFile` settings are accepted but ignored and saved as `false`.

The sidebar's close control stays in the keyboard order even while visually quiet. The start page explains the empty recent-tab area. Shared page headers wrap at narrow widths, and less-used toolbar actions remain in More when space is tight. Shell destructive controls use neutral light and dark tones.

## Right-click menus

Every menu is a shadcn `ContextMenu` / `DropdownMenu`. Sidebar rows (tabs, pinned tiles, folders, spaces, the empty area) own their menus in `components/Sidebar.tsx`. The *page's* menu is different: WebView2 raises `ContextMenuRequested`, the adapter keeps it open and emits `athanor://context-menu`; `components/PageContextMenu.tsx` freezes the page (`capture_frame`), draws the engine's entries (icons by command name, noisy Edge-only entries hidden) plus Athanor's own at the click position, and answers with `resolve_context_menu` (a command id, or `null` on dismissal). `e2e/ui/context-menu.cjs` drives all of this on the real WebView2.

## Popups over the native page

Native tab views draw above the shell, so any popup that can reach the page area registers with `useOverlay()` (`lib/overlay.ts`). While one is open the app captures the visible page(s), shows the still under the popup, and hides the native view; closing reverses it. Menus built on `OverlayContextMenu` / `OverlayDropdownMenu` do this automatically.

## Motion

Springs and easings live in `lib/motion.ts` and `styles/tokens.css`. Rows ease in and out, the active-tab highlight is one shared element (`layoutId`) that glides between rows, spaces slide in the direction you switch, and the sidebar collapses by animating width while labels fold (CSS `rail:` variant, no JS reflow). Keep new motion on these tokens so the shell stays uniformly quick.

## Layout (v2)

The window is one continuous chrome surface (`.ath-chrome`, derived from `--sidebar`) with the page floating on it as a rounded card (`data-part="content"`, `--ath-stage-radius`). The `StageBar` above the card holds back / forward / reload, the address pill (`UrlPill`: lock, host, blocked count, protection popover), the split / developer / command-bar buttons and the window buttons. The **sidebar** header shows where you are (`space / folder / title`) next to the collapse button, and the rest of the sidebar is the tabs. Clicking the pill, `Ctrl+L`, `Ctrl+K` or `Ctrl+T` opens the single **command bar** (`CommandBar`): addresses, searches, open tabs, commands, developer tools and dev servers in one list (`Ctrl+L` pre-fills the current address, `Ctrl+T` opens the result in a new tab).

The native page view is clipped to the card's rounded corners: the shell reports the radius (`set_page_radius`, physical px) and the Windows adapter applies a rounded `SetWindowRgn` to each view's container window, re-applying it on every resize. The clip also removes the corners from hit-testing.

## Density and type

The shell is deliberately compact: the root font size is 15px, rows are 27px tall (`--ath-tab-height`), controls 28-32px, radii 8px (`--radius`) with a 12px stage. Body text is IBM Plex Sans JP; anything that is data (hosts, paths, counts, idle time, shortcuts, the status line) is IBM Plex Mono with tabular numbers, which is what gives the chrome its instrument-panel character. Dense by design: tabs show the time since last use once idle for 10 minutes, the address pill splits host and path, the sidebar header shows `space / folder / title`, the sidebar ends in a one-line status (`space · tabs · blocked`), and a loading page draws a hairline progress bar along the pill.

## First-run welcome and importing from other browsers

`components/welcome/Welcome.tsx` is a full-window overlay shown until `settings.onboarded` is set (also reachable as "Welcome tour and import" in the command bar). Five steps - Welcome, Import, Look, Privacy, Ready - with the step list on the left (inverted panel) and the step on the right. Everything chosen is applied live, so skipping is always safe.

The Import step lists the browsers found on this machine (`import_detect`) and copies their bookmarks and history (`import_run`): Chrome, Edge, Brave, Vivaldi, Opera, Chromium and Firefox, or a Netscape-format HTML bookmarks file. The readers are the pure crate `crates/athanor-import` (they work on copies of the other browser's files; passwords, cookies and cards are never read). Athanor has no separate bookmark store: bookmarks become **archived tabs** in a dedicated space ("From Chrome"), one folder per bookmark folder (`Workspace::import_bookmarks`, capped at 5,000), and history is merged into the omnibox history (`History::import`, capped at 20,000). Windows only; other platforms report an empty list.

## Everyday browser behaviour

* **One list of shortcuts** (`app/src/lib/shortcuts.ts`, `SHORTCUTS`): it drives the key handlers, the cheat sheet (`Ctrl+/`, `ShortcutSheet`) and Settings -> Shortcuts. Each combo has an owner: `shell` (handled in React) or `backend` (handled in `Browser::shortcut`; when the shell has focus it forwards them with the `run_shortcut` command). When a page has focus, WebView2's accelerator hook in `win.rs` (`combo()`) catches the same keys first and sends the combo to the backend, which handles it or forwards shell-owned ones as `athanor://shortcut`. Alternative spellings fold onto one action (`Ctrl+R` = `F5`, `F3` = `Ctrl+G`, `Ctrl+PageDown` = `Ctrl+Tab`, `Ctrl+Shift+]` = next tab). Add a shortcut in the list, in `combo()` if pages should not see it, and in the matching handler.
* **Find in page** (`Ctrl+F`, `Ctrl+G` / `Ctrl+Shift+G`, `FindBar`): a strip between the toolbar and the page, so the page stays live. The page-side script (`app/src-tauri/assets/find.js`) counts matches and paints them with the CSS Custom Highlight API (no DOM changes; all matches yellow, the current one orange); `find_in_page` returns the result through `athanor://find`. It closes when the page changes.
* **Zoom** (`Ctrl+=`, `Ctrl+-`, `Ctrl+0`, Ctrl+wheel, pinch): remembered per site (`Settings.siteZoom`, keyed by host without `www.`), restored after every navigation, shown as a badge in the address pill (click to reset). The shell itself never zooms.
* **Ctrl+1..9 follow the sidebar**: pinned tabs are 1, 2, ..., then the sidebar from the top (each folder's tabs, then the loose tabs); `Ctrl+9` is always the last tab. Tabs inside a *closed* folder are not counted, so the numbers match the rows you can see. Hold `Ctrl` and every row shows its number (`NumberBadge`). `Ctrl+Tab` walks the same order, closed folders included. The order lives in `Workspace::sidebar_order` / `numbered_tabs` (Rust) and `tabNumbers` (`lib/sidebarModel.ts`); keep them in step. A closed folder keeps its name, shows up to three page icons, and is marked when it holds the current tab.
* `Ctrl+D` pins or unpins the tab (Athanor has no separate bookmark list), `Ctrl+Shift+R` reloads without the cache, `Ctrl+P` prints, `F11` toggles full screen, `Ctrl+,` opens Settings.

## No Edge look-alikes

WebView2 is Microsoft Edge's engine, and left alone it shows Edge in several places. Athanor turns those off and draws its own (`app/src-tauri/src/win_ui.rs`, `brand.rs`, `errorpage.rs`; shell side `components/NativeUi.tsx`):

* **Identity**: the user agent loses its `Edg/` token and the client-hint brands become Chromium + Athanor (`Emulation.setUserAgentOverride`).
* **Error page**: `IsBuiltInErrorPageEnabled` is off; a failed load shows Athanor's page (light/dark, "Try again", retries when the network is back). The tab keeps the address that failed, so Reload retries it. Certificate errors are refused with the same page (no "continue anyway").
* **JavaScript dialogs** (`alert`, `confirm`, `prompt`, leave-page): shadcn dialogs; the page waits until the user answers (`resolve_script_dialog`). The shell's own `window.prompt`/`confirm` calls use `askText` / `askConfirm`.
* **Permission prompts** (camera, microphone, location, notifications, clipboard, sensors, ...): a dialog with "Remember for this site"; answers live in `Settings.sitePermissions` (Settings -> Privacy -> Reset), not in the WebView2 profile.
* **Downloads**: no Edge bubble; progress and "Show in folder" are toasts (`athanor://download`). A typed address that turns out to be a file leaves the tab where it was.
* **Link under the pointer**: the status bubble is off; the address pill shows the link while the pointer is on it.
* **Autofill / password popups** are off in tabs and in the shell; the shell also has no browser accelerator keys of its own.

Still the engine's own: the PDF viewer, the F12 inspector window, and the process names (`msedgewebview2.exe`) and profile folder (`EBWebView`) on disk.

The design rules behind motion, menus, feedback and accessibility (with what each one became in code) are in [HIG.md](HIG.md).

## Tab overview (Ctrl+Space)

`Ctrl+Space` (or `Ctrl+Shift+\`, or the grid button in the toolbar) blurs the page and lays every open tab over it as a picture of its page with the name written on the picture, in sidebar order. Nothing else: no window, no panel, no search field. The cards come out of the middle of the window with an eased glide (about 0.5 s, nearest cards first) and are simply gone when you leave (a chosen tab is current at once); only the blur lets go, in 130 ms. Click or Enter goes to the tab; the X, middle-click or Delete closes it (with the usual Undo); arrows move in two dimensions; Esc, `Ctrl+Space` or a click on the empty space leaves. Reduce Motion replaces the flight with an instant change. Code: `components/TabOverview.tsx`, grid maths `lib/gridNav.ts`. The pictures come from `lib/thumbs.ts`: the page in front is captured after it loads and every 20 s, downscaled, kept in memory only, and dropped when the tab closes or moves to an Athanor page. `e2e/ui/tab-overview.cjs` drives it.

## Sign-in popups

A page that opens a sized window (`window.open(url, name, 'width=...')`: Google, Apple and Microsoft sign-in, payment pages) gets a real popup window that keeps its opener, so the sign-in can report back (`engine_desktop.rs`, `on_new_window`). Plain links and size-less `window.open` calls still become tabs (`win.rs`). `e2e/ui/popup.cjs` checks both.

## Back / Forward history

Press and hold Back or Forward (or right-click, or ArrowDown on the focused button) to list up to 14 pages behind or ahead, nearest first. Choosing one jumps straight there (`nav_history` asks the page via CDP `Page.getNavigationHistory`, answered by the `athanor://nav-history` event; `nav_history_go` runs `Page.navigateToHistoryEntry`). A plain click still goes one step. Checked by `e2e/ui/pureref-history.cjs`.

## PureRef import

Boards can import PureRef 2.x scenes (`.pur`): the "Import from PureRef" button, or drop a `.pur` file on the Boards page. The `athanor-pur` crate reads the file; each image keeps its place, size, rotation, flip, opacity and grey filter, and notes become text. The result is a new board named after the file (`board_pick_pureref`, `board_import_pureref`; Windows only).

## CAPTCHA and sign-in frames

Frames of reCAPTCHA, hCaptcha, Turnstile, Arkose and accounts.google.com are never cancelled and replayed for ad-block scripting (`is_challenge_frame` in `win.rs`); doing so left an empty box. `e2e/ui/captcha.cjs` loads Google's reCAPTCHA demo and checks the checkbox frame renders.

## Translate page

Right-click a page and choose Translate page, or press T while the menu is open (Show original brings it back). The page script `translate.js` lists the page's text blocks and replaces only the text of existing text nodes (plus `title`, `placeholder`, `alt`, `aria-label` and the tab title), so the tree, listeners and scripts are untouched; `code`, `pre`, inputs, editable areas, `translate="no"` and `.notranslate` are skipped. A sentence split by inline elements is sent whole with `<n>` markers and put back into its own nodes. `translate.rs` sends the text in batches to Google's public translate endpoint (page text leaves the device when you use this) into the shell's language. Checked by `e2e/ui/translate.cjs`.

## Ctrl+T

The command bar gives the keyboard back to the shell before focusing its field, so typing starts at once even when the page had focus (`e2e/ui/newtab-focus.cjs`).

## Bot-check pages

A Cloudflare challenge answers with HTTP 403 and replays navigations; Athanor shows the page the site sent instead of its own error page, ignores the late failure of a navigation that was replaced, and never cancels and replays challenge navigations (`__cf_chl`, `/cdn-cgi/`). `e2e/ui/cloudflare.cjs` loads one.

## Overlays and controlled menus

`OverlayDropdownMenu` follows the menu's real open state when its owner controls it (the Back/Forward buttons open only on a long press). Counting the primitive's refused "open" requests as an overlay froze and hid the page after every plain click on Back, so pages opened afterwards never showed. App also settles a frozen page 700 ms after nothing is open any more, as a safety net. `e2e/ui/note-back.cjs` clicks an article on note.com, clicks Back, then opens other pages.

## Aborted navigations

A navigation that turns into a download, or is replaced by another one, ends "aborted" without any response. Athanor shows no error page for that (the page stays as it was), like other browsers; before, every download from a site such as GitHub releases ended in "The connection was interrupted", and Try again downloaded the file once more. Real failures (reset, timeout, offline, certificate) still get the page. `e2e/ui/ghdownload.cjs` (needs `DL_URL`) and `e2e/ui/sites.cjs` check this against live sites.

## Auto-archive and playing tabs

Tabs left idle for `archiveAfterHours` (12 by default) are archived and their page is discarded. A tab that is playing sound is in use: it is never archived and counts as used right now, so a YouTube tab left playing in the background is not stopped, and one that falls silent is not archived on the next pass (`Workspace::archive_inactive`'s `busy` list, filled from the engine's audible state).
