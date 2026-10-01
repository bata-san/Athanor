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

## Right-click menus

Every menu is a shadcn `ContextMenu` / `DropdownMenu`. Sidebar rows (tabs, pinned tiles, folders, spaces, the empty area) own their menus in `components/Sidebar.tsx`. The *page's* menu is different: WebView2 raises `ContextMenuRequested`, the adapter keeps it open and emits `athanor://context-menu`; `components/PageContextMenu.tsx` freezes the page (`capture_frame`), draws the engine's entries (icons by command name, noisy Edge-only entries hidden) plus Athanor's own at the click position, and answers with `resolve_context_menu` (a command id, or `null` on dismissal). `e2e/ui/context-menu.cjs` drives all of this on the real WebView2.

## Popups over the native page

Native tab views draw above the shell, so any popup that can reach the page area registers with `useOverlay()` (`lib/overlay.ts`). While one is open the app captures the visible page(s), shows the still under the popup, and hides the native view; closing reverses it. Menus built on `OverlayContextMenu` / `OverlayDropdownMenu` do this automatically.

## Motion

Springs and easings live in `lib/motion.ts` and `styles/tokens.css`. Rows ease in and out, the active-tab highlight is one shared element (`layoutId`) that glides between rows, spaces slide in the direction you switch, and the sidebar collapses by animating width while labels fold (CSS `rail:` variant, no JS reflow). Keep new motion on these tokens so the shell stays uniformly quick.

## Layout (v2)

The window is one continuous chrome surface (`.ath-chrome`, derived from `--sidebar`) with the page floating on it as a rounded card (`data-part="content"`, `--ath-stage-radius`). There is no top toolbar: the **sidebar** holds back / forward / reload, the address pill (`UrlPill`: lock, host, blocked count, protection popover) and the tabs; a slim `StageBar` above the card carries the page title, split / developer / command-bar buttons and the window buttons. Clicking the pill, `Ctrl+L`, `Ctrl+K` or `Ctrl+T` opens the single **command bar** (`CommandBar`): addresses, searches, open tabs, commands, developer tools and dev servers in one list (`Ctrl+L` pre-fills the current address, `Ctrl+T` opens the result in a new tab).

The native page view is clipped to the card's rounded corners: the shell reports the radius (`set_page_radius`, physical px) and the Windows adapter applies a rounded `SetWindowRgn` to each view's container window, re-applying it on every resize. The clip also removes the corners from hit-testing.

## Density and type

The shell is deliberately compact: the root font size is 15px, rows are 27px tall (`--ath-tab-height`), controls 28-32px, radii 8px (`--radius`) with a 12px stage. Body text is IBM Plex Sans JP; anything that is data (hosts, paths, counts, idle time, shortcuts, the status line) is IBM Plex Mono with tabular numbers, which is what gives the chrome its instrument-panel character. Dense by design: tabs show the time since last use once idle for 10 minutes, the address pill splits host and path, the stage bar shows `space / folder / title`, the sidebar ends in a one-line status (`space · tabs · blocked`), and a loading page draws a hairline progress bar along the pill.
