# macOS

Athanor supports macOS 14 and later using the system's WKWebView (WebKit). It does not bundle Chromium.
Apple Silicon is the locally checked target. The release workflow also builds an Intel package; Intel
execution and the minimum supported OS still require verification on those machines.

## Build

Install the [Tauri macOS prerequisites](https://v2.tauri.app/start/prerequisites/): Xcode Command Line
Tools (`xcode-select --install`), stable Rust, and Node 20 or later. Use the checked-in dependency locks.

```sh
cd app
npm ci
npm run tauri dev
# A local build without the release updater private key:
npm run tauri build -- --no-sign --bundles app,dmg --config '{"bundle":{"createUpdaterArtifacts":false}}' -- --locked
```

The host architecture is selected automatically. Outputs are `target/release/bundle/macos/Athanor.app`
and `target/release/bundle/dmg/*.dmg`. For a specific architecture, install the Rust target and add
`--target aarch64-apple-darwin` or `--target x86_64-apple-darwin`; the output then lives under
`target/<target>/release/bundle`. The Objective-C adapter is compiled by `xcrun` for the selected
architecture. No package upgrade is needed.

The release profile leaves build-time proc-macro libraries unstripped to avoid
[Rust's Mach-O string-pool alignment issue](https://github.com/rust-lang/rust/issues/157750).
The final executable still uses the existing release optimization and stripping settings.

## Integration

- Standard macOS title bar, close/minimize/zoom buttons, full screen, and app menu. Athanor's shadcn
  shell, theme tokens, fonts and layout remain in use.
- Command-L/T/W/R/F and the other browser commands work through native menu accelerators when a page
  has focus. Control-Tab cycles tabs; Command-Tab and Command-Space remain system shortcuts.
  Command-[ / Command-] navigate history, Control-Command-F toggles full screen, and Option-Command-I
  opens the WebKit inspector. Native Edit menu actions preserve copy/paste, undo and text editing.
- Native back/forward, reload without cache, session-history selection, URL/title/history observation,
  page zoom, PNG captures, find-in-page, translation and page-media queries.
- WebKit popups use Tauri's supplied window configuration to preserve their opener and original
  requests. They currently open in separate native windows, including ordinary `target=_blank` links.
- Downloads use the original WKDownload transfer, retain the final destination for session history,
  and offer Show in Finder after completion. The current Wry API exposes start/completion but no byte
  progress, pause, resume or cancellation. An active transfer therefore stays indeterminate with zero
  reported bytes until completion. Duplicate concurrent downloads from the same URL are declined
  because Wry completion events have no independent transfer identifier.
- Chrome, Edge, Brave, Vivaldi, Chromium and Firefox bookmark/history profiles are detected below
  `~/Library/Application Support`. Exported bookmark HTML files and PureRef 2.x scenes can also be
  imported. Safari bookmarks can be brought in through its HTML export. Browser profile files are read
  using the existing importer; passwords, cookies and cards are not migrated.
- Notifications use the existing Sonner appearance in a separate native child view raised above page
  views without requesting focus. Transparent macOS views require Tauri's `macos-private-api` opt-in;
  this build is intended for direct distribution, not the Mac App Store.

## Shield and feature differences

Brave's adblock-rust converter exports the representable subset of enabled lists to
[`WKContentRuleListStore`](https://developer.apple.com/documentation/webkit/wkcontentruleliststore).
WebKit applies network/cosmetic rules itself; Athanor does not cancel and replay website requests.
Global disable clears native rules, site exceptions are appended after blocking rules, and list updates
replace the compiled rule set. Failed compilation retains the previous set and shows an actionable
message. Compilation is asynchronous; reload an open page after a list or exception change.

This is not complete WebView2 blocking parity. Redirect resources, request-method-specific matching,
`$removeparam`, some procedural/scriptlet filters and generic cosmetic queries cannot all be expressed
as WebKit content rules. Unsupported conversions are omitted. WebKit provides no blocked-request
counter to this adapter, so Settings reports it as unavailable. URL-specific cosmetics and extension
scripts run after page-load completion with a URL guard; document-start timing is unavailable, and scripts from an old
origin are never registered permanently for subsequent sites. Real-site YouTube ad behavior is unverified.

HTTPS upgrade and tracking cleanup apply to explicit address/new-tab navigations. Website forms,
redirects and signed URLs retain their original method and request. Automatic HTTP fallback after an
upgrade failure is currently Windows-only. HTML media can be muted by the user's tab action; this does
not provide WebAudio-level muting. Password CSV storage/fill, the page font override, per-tab GPU
disable and Chromium DevTools Protocol emulation are currently Windows-only.

## Distribution and verification

CI checks macOS compilation/tests and packages an Apple Silicon application. The manual Release
workflow builds Apple Silicon and Intel `.dmg` files plus uniquely named `.app.tar.gz` updater archives,
signs the archives with `TAURI_SIGNING_PRIVATE_KEY`, and merges both Darwin entries into the Windows
update feed. Updater signatures do not replace Apple code signing/notarization. The supplied workflow
currently uses `--no-sign`; public distribution with Gatekeeper acceptance requires a Developer ID and
the [Tauri macOS signing/notarization setup](https://v2.tauri.app/distribute/sign/macos/).
For a fork, configure its updater endpoint and matching public/private updater key before publishing;
the upstream endpoint and trust key are deliberately preserved in this change.

Local verification includes ARM64 compilation, Rust workspace tests, frontend type/build tests and
application packaging. The application process launched with `ATHANOR_DATA_DIR` pointing to a temporary
profile. UI inspection was denied by the computer-use approval review, so rendering, menu interaction,
real browsing, downloads, popup authentication, notifications and captures are **not runtime-verified**.
The existing CDP checks in `e2e/` target Chromium and do not verify WKWebView.
