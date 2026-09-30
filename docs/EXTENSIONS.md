# Athanor extensions

Extensions are directories loaded by the engine-independent `athanor-ext` registry. The host chooses built-in and user roots, calls `load_dir`, stores `Registry::state()`, restores it on startup, and uses the returned contributions to configure the shell and page adapters. A bad child directory is skipped; `LoadIssue` reports its path and reason. Duplicate IDs retain the first loaded extension. The registry is mutable through `&mut self`; put it behind a caller-owned lock when multiple threads need writes. Read queries take `&self`.

## Manifest

Save `athanor-extension.json` at the root of each extension directory. JSON keys use camelCase. Unknown top-level keys produce load warnings for forward compatibility; unknown nested keys are ignored. IDs use lowercase ASCII letters, digits, dots, underscores, and hyphens, with at least one dot. Versions use SemVer; `athanor` is a SemVer requirement checked against the host version supplied to `Manifest::validate` (the registry uses `HOST_VERSION`). All local file paths must stay inside the extension directory.

```json
{
  "id": "dev.example.hello",
  "name": "Hello",
  "version": "1.0.0",
  "description": "An example extension",
  "author": "Example author",
  "athanor": ">=0.1",
  "permissions": ["shell.panel", "commands", "tabs.read"],
  "contributes": {
    "themes": [{"id":"hello","name":"Hello","file":"themes/hello.json"}],
    "shellCss": ["shell.css"],
    "userScripts": [{"id":"highlight","matches":["https://*.example.com/*"],"excludeMatches":[],"js":["highlight.js"],"css":["highlight.css"],"runAt":"document_idle","allFrames":false}],
    "panels": [{"id":"notes","title":"Notes","icon":"sticky-note","entry":"panel.html","location":"sidebar"}],
    "commands": [{"id":"open-notes","title":"Open Notes","keybinding":"Ctrl+Shift+N"}],
    "filterLists": [{"id":"local","name":"Local rules","file":"filters.txt"}],
    "tabRules": [{"id":"work","folder":"Work","host":"work.example.com","enabled":true}]
  }
}
```

`themes` use the [theme format](THEMING.md). Theme IDs should be globally unique; the host chooses a selected ID. `shellCss` is appended in source order (built-in extensions first, then user extensions, each by ID). Page patterns support `<all_urls>` and `http`, `https`, or `*` schemes; hosts may be exact, `*`, or `*.example.com`; paths use `*` globs. A `*` scheme covers HTTP and HTTPS. `excludeMatches` wins over `matches`. `runAt` is `document_start`, `document_end`, or `document_idle`. `allFrames` defaults to false. Filter lists have exactly one local `file` or HTTPS `url`. `tabRules` are `athanor_core::filing::Rule` values, whose JSON uses camelCase.

## Permissions

| Permission | Capability |
| --- | --- |
| `pages.inject` | Inject declared scripts and CSS into matching pages. |
| `shell.style` | Supply shell CSS. |
| `shell.panel` | Show a sandboxed sidebar panel. |
| `commands` | Declare or register palette commands. |
| `filters` | Supply local or remote filter lists. |
| `tabs.read` | Read tab metadata through `tabs.list`. |
| `tabs.write` | Open tabs through `tabs.open` and supply filing rules. |
| `storage` | Use extension-scoped key/value storage. |
| `clipboard` | Reserved for host clipboard bridge operations. |
| `network` | Allow HTTPS connections from the panel CSP; the host must still enforce network policy. |

The manifest validator requires the permission for each contribution. The host must call `Registry::check(id, permission)` again for every privileged RPC. Disabled extensions fail checks and contribute nothing. The host owns all user consent, storage persistence, and page injection timing.

## Panel lifecycle and RPC

Serve panel files through `Registry::resolve_asset` on `athanor-ext://<extension-id>/<relative-path>`. Reject URL decoding ambiguities before calling it; pass a decoded relative path exactly once. Use an iframe sandbox that permits scripts but excludes top navigation, popups, and same-origin access to the shell. Apply `panel_csp()` or `panel_csp_for(permissions)` to the document: `default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'none'; base-uri 'none'; form-action 'none'`. Network permission changes `connect-src` to `https:`. The shell should identify a panel by its iframe source and extension ID, verify message origin/source, and bound message sizes.

Panel requests use `postMessage` with `{ "athanor": 1, "id": "request-id", "method": "tabs.list", "params": {} }`. The shell responds to that iframe with `{ "athanor": 1, "id": "request-id", "result": ... }` or `{ "athanor": 1, "id": "request-id", "error": "message" }`. IDs are opaque strings scoped to a panel. The shell verifies the method and calls `check` before dispatch:

| Method | Params | Permission |
| --- | --- | --- |
| `tabs.list` | `{}` | `tabs.read` |
| `tabs.open` | `{ "url": "https://…" }` | `tabs.write` |
| `storage.get` | `{ "key": "…" }` | `storage` |
| `storage.set` | `{ "key": "…", "value": … }` | `storage` |
| `commands.register` | `{ "id": "…", "title": "…" }` | `commands` |
| `ui.toast` | `{ "message": "…" }` | `shell.panel` |

The shell should namespace storage and runtime command IDs by extension ID, validate URLs before opening tabs, and limit storage payload size. `ui.toast` is available only to a loaded, enabled panel extension. For commands declared in the manifest, the shell owns invocation behavior and can notify the panel with an application-defined event.

## Security and packaging

Extensions have no direct Tauri, webview, filesystem, process, or native OS API through this crate. They cannot access another extension's files or storage, the shell DOM from a sandboxed panel, privileged `athanor:` pages, or browser internals. Page scripts intentionally run in matched pages and can interact with those pages; only install trusted extension code. `resolve_asset` rejects absolute paths, drive syntax, traversal, percent escapes, backslashes, NULs, and symlink escapes. Installation rejects symlinks, more than 1024 files, or more than 32 MiB. The host should use trusted HTTPS for remote filter-list downloads and apply its own limits.

Package a directory containing the manifest and all referenced files; no build step or archive format is required by this crate. `Registry::install_from_dir` validates and copies it under `<install_root>/<id>`. `remove` removes only extensions loaded as `Source::User` from that root. See `extensions/examples` for three validated packages.
