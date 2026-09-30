<p align="center"><img src="assets/athanor.svg" width="96" alt="Athanor"></p>

# Athanor

**A very light Chromium-based browser for Windows and Android.** Rust + Tauri core, shadcn/ui shell, Brave-grade blocking built in.

軽量な Chromium ベースのブラウザ(Windows / Android)。垂直タブ、スペース、自動タブファイリング、分割表示、開発者向けツール、PureRef 風リファレンスボード、Brave の `adblock-rust` による標準広告ブロックを搭載。コア層と拡張層を厳密に分離し、拡張機能とテーマで UI の深部まで変更できます。

## Highlights

- **Vertical tabs, Arc-style**: spaces, pinned tabs, folders, archive of idle tabs.
- **Auto tab filing**: tabs are sorted into folders by built-in categories and your own rules (host / path / title).
- **Split view**: any number of panes, drag the dividers, powered by a pure layout tree.
- **Adblock, on by default**: network + cosmetic + scriptlet filtering via Brave's `adblock-rust`, HTTPS upgrade, tracking-parameter stripping, per-site shields.
- **Developer friendly**: JSON/JWT/Base64/URL/timestamp/color/hash tools in the palette, localhost dev-server detection, responsive viewport presets, native DevTools.
- **Boards**: a PureRef-like reference canvas (paste / drop images, arrange, always-on-top window).
- **Deeply customisable**: themes are JSON; every UI part exposes `data-part` hooks; extensions add themes, shell CSS, userscripts, panels, commands, filter lists and filing rules.
- **Light**: no bundled Chromium. Uses the system engine (WebView2 / Android System WebView), so it stays small and always current.

## Architecture in one picture

```
Shell UI (React/shadcn) ─ Extensions ─ Core (pure Rust) ─ Platform adapters ─ System Chromium
```

The core and extension crates never depend on Tauri or on any webview, so Chromium changes only ever touch the adapters.
See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Build

Requirements: Rust (stable), Node 20+, and on Windows the MSVC Build Tools + WebView2 runtime.

```bash
cd app
npm install
npm run tauri dev      # desktop dev
npm run tauri build    # installer
```

Android: see [docs/ANDROID.md](docs/ANDROID.md) (Android SDK + NDK, `npm run tauri android build`).

Tests:

```bash
cargo test --workspace
cd app && npm test && npm run typecheck
```

## Docs

[Architecture](docs/ARCHITECTURE.md) · [IPC contract](docs/IPC.md) · [Extensions](docs/EXTENSIONS.md) · [Theming](docs/THEMING.md) · [UI](docs/UI.md) · [Android](docs/ANDROID.md)

## License

MIT for Athanor's own code. Third-party components keep their licenses; notably `adblock` (Brave's adblock-rust) is MPL-2.0.
