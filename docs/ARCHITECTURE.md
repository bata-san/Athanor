# Athanor architecture

Athanor is a lightweight Chromium-based browser for Windows and Android. It does **not** ship or fork Chromium.
Rendering is done by the system's Chromium runtime (WebView2 on Windows, Android System WebView on Android), which
the OS updates independently. Everything Athanor adds sits in clearly separated layers so that a big Chromium change
can only ever touch the thin adapter at the bottom.

```
 L4  Shell UI            React + shadcn/ui + Tailwind (app/src)          <- themeable via CSS variables & data-part
 ──────────────────────────────────────────────────────────────────────────────────────────────────────────
 L3  Extension layer     crates/athanor-ext                               <- manifests, themes, userscripts, panels
 ──────────────────────────────────────────────────────────────────────────────────────────────────────────
 L2  Core                crates/athanor-core, crates/athanor-adblock      <- pure Rust, no UI / no webview deps
 ──────────────────────────────────────────────────────────────────────────────────────────────────────────
 L1  Platform adapters   app/src-tauri (engine_desktop.rs, win.rs)        <- WebView2 events, request blocking, shortcuts
                         Android plugin (Kotlin) + engine_mobile.rs       <- native WebView per tab
 ──────────────────────────────────────────────────────────────────────────────────────────────────────────
 L0  Engine              WebView2 (Chromium) / Android System WebView     <- updated by the OS, not by us
```

## The rule that keeps it maintainable

`athanor-core`, `athanor-adblock` and `athanor-ext` may not depend (even transitively) on Tauri, wry/tao, WebView2,
JNI/Android or any UI toolkit. This is enforced by a test (`crates/athanor-core/tests/layering.rs`) that inspects the
`cargo metadata` graph in CI. The engine is reached through exactly one trait, `athanor_core::engine::EngineBackend`,
and reports back through one enum, `EngineEvent`.

When Chromium ships a large change:

| Change | Where it lands |
|---|---|
| WebView2 / Android WebView API added, deprecated or behaving differently | `win.rs` / `engine_desktop.rs` / the Kotlin plugin only |
| New web platform feature | nothing — it is just the newer engine |
| Different engine entirely (e.g. GeckoView, a bundled CEF) | a new `EngineBackend` implementation |
| Tab / workspace / filing / split logic | never affected (unit-tested without any engine) |

## Data flow

```
 shell (React)  ── invoke(commands) ──▶  Browser controller (app/src-tauri/src/browser.rs)
      ▲                                         │  mutate Workspace (athanor-core)
      │                                         ▼
      └──── athanor://snapshot ◀──────  reconcile(): diff desired vs live webviews ──▶ EngineBackend
                                                                                            │
                          EngineEvent (url/title/favicon/blocked/shortcut/…) ◀──────────────┘
```

* The backend is the single source of truth; the shell replaces its store on every snapshot. See [IPC.md](IPC.md).
* Tabs are native webviews stacked above the shell. The shell only reports the content rectangle; the controller
  places one webview per visible pane (split view = several rectangles, computed by `athanor-core::layout`).
* Tabs are created lazily and archived tabs are discarded, so idle memory stays low.

## Content blocking

`athanor-adblock` wraps Brave's `adblock-rust` engine (network rules, cosmetic rules, scriptlets, redirect resources).
Adapters call it through the small `Filter` facade in `app/src-tauri/src/filter.rs`:

* Windows: `WebResourceRequested` (all requests) → `should_block`; cosmetic/scriptlet JS injected on `ContentLoading`.
* Android: `shouldInterceptRequest` → JNI → `should_block`; cosmetic JS injected on page start / commit.
* HTTPS upgrade and tracking-parameter stripping are applied to main-frame navigations.

## Extensibility and theming

* **Themes** are JSON token sets (colors, radius, fonts, layout hints, optional raw CSS) compiled to CSS variables.
* Every meaningful UI element carries a `data-part` attribute and state attributes, so an extension's `shell.css`
  can restyle or rearrange the whole shell without touching React code.
* **Extensions** contribute themes, shell CSS, userscripts/styles (Chrome-style match patterns), sidebar panels
  (sandboxed iframes with a permissioned postMessage RPC), palette commands, filter lists and tab-filing rules,
  all gated by an explicit permission list. See [EXTENSIONS.md](EXTENSIONS.md) and [THEMING.md](THEMING.md).
* On Windows, unpacked Chrome extensions can additionally be loaded by WebView2 itself (experimental).

## Workspace layout

```
Cargo.toml                workspace
crates/athanor-core       tabs, spaces, folders, auto-filing, split layout, boards, history, dev tools, EngineBackend
crates/athanor-adblock    Brave adblock-rust integration, list management, privacy helpers
crates/athanor-ext        extension registry, permissions, themes, match patterns
app/                      Vite + React shell (src/) and the Tauri app (src-tauri/)
app/src-tauri/gen/android generated Android project + Kotlin engine plugin
docs/                     this documentation
extensions/examples/      sample extensions and themes
assets/athanor.svg        the mark
```
