# Athanor shell UI

The React shell lives under `app/src/`. `components/` contains the sidebar with desktop browser controls, mobile bars and tab switcher, and shadcn-style primitives; `pages/` holds the lazy Settings, Boards, Developer Tools, and Extensions screens; `lib/` contains the IPC wrapper, event listener, mock backend, Zustand store, and tested UI math.

## State flow

`bootStore()` loads the snapshot and auxiliary lists through `lib/api.ts`. The Tauri implementation calls the commands in `docs/IPC.md`; a plain browser selects `lib/mock/backend.ts`. Snapshot events replace the Zustand snapshot wholesale. Screens send user actions through the same typed API, and the mock emits the same event names back into the store.

## Add a command or screen

Add a command's argument and result types in `lib/types.ts`, expose it through `lib/api.ts`, and implement it in `lib/mock/backend.ts` so browser demos stay functional. For a page, add a component under `pages/`, lazy-load it from `App.tsx`, and route it through an `athanor://` internal tab when the backend should hide native page webviews. Use CSS variables and `data-part` hooks so backend theme CSS can restyle the shell.

## My filters editor

`Settings > Privacy` carries a monospace editor for the user's own filter rules (`data-part="my-filters"`). It loads through `getUserFilters()` when the section opens, saves with `setUserFilters()` or `Ctrl+S` inside the editor, reverts to the last saved text, and keeps a live line counter; after a save it lists the returned `LineIssue` lines and clicking one selects that line in the textarea. The pure helpers in `lib/userFilters.ts` map a line number to a selection range, count lines, and validate text so the mock backend can report the same issues.

## Mock backend

Mock mode starts automatically when `window.__TAURI_INTERNALS__` is absent. It includes example spaces, tabs, folders, filter lists, developer servers, extension panels, and reference boards; it also implements tab actions, filing, archive, split view, settings, boards, and developer utilities. `?platform=android` forces the mobile shell only in mock mode.
