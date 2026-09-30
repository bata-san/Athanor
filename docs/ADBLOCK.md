# Athanor Shields and content blocking

## Architecture

`athanor-adblock` owns list persistence, compilation, cache serialization, network decisions,
URL rewriting, and cosmetic matching. `app/src-tauri/src/filter.rs` adapts that API for browser
engines. The Windows adapter uses WebView2 request/navigation events and registers the small
cosmetic collector at document creation. Adblock-rust 0.13 supplies the static network and
cosmetic rule engine; the `assets/` scripts are Athanor-owned code and do not evaluate filter text
as JavaScript.

Compiled engines are stored as `engine.dat`, keyed by enabled list contents and a cache format
version. Raw downloaded list bodies remain under `lists/` so list updates and rebuilds work. The
compiled engine is held behind an `Arc`; request checks clone the compiled snapshot and do not hold
the rebuild lock while matching. A site exception is stored by registrable domain in
`adblock-config.json`.

Generic class and ID hide rules are not inserted into every document stylesheet. The initial
document-created bridge observes class and ID tokens, batches them during idle time, and asks the
native host for selectors from the compiled engine's `hidden_class_id_selectors` index. URL-specific
cosmetics, exceptions, scriptlets and procedural filters are selected by the host for that frame's
URL. A matching response is appended to one style element. The bridge has bounded message/token
sizes, and both hosts validate every message and derive their URL from the engine's native message
source, never from page-supplied URL data.

The bridge is transport-agnostic. It prefers `globalThis.chrome.webview` (WebView2) and otherwise
uses the object Android injects as `athanorShield` via
`WebViewCompat.addWebMessageListener("athanorShield", …)`, which offers `postMessage(string)` plus
the DOM `message` event (and `onmessage`). The JSON-string protocol and every bound are identical on
both transports; only the host side differs.

Validation, token limits, selector chunking and response building live in one platform-neutral
function, `Filter::cosmetic_query_reply(source, raw)`. Both the Windows adapter and the Android JNI
export (`Java_dev_athanor_browser_AthanorEngine_cosmeticQuery`) call it, so the two engines cannot
drift. Per-view rate limiting stays in each adapter (`win.rs` keeps its per-view budget; Android has
no separate budget yet and relies on the shared size/token limits).

## Cosmetic message protocol (version 1)

The in-page collector sends this object through the browser's native page-to-host channel:

```json
{
  "athanorShield": 1,
  "type": "cosmetic-query",
  "id": "c1",
  "classes": ["advertisement", "sponsor"],
  "ids": ["ad-slot"]
}
```

The host checks the message version and type, validates the request ID and token count/length,
applies a per-view rate limit, and calls:

```rust
Filter::cosmetic_query(page_url, &classes, &ids, &exceptions)
```

The host gets `page_url` from the native message event's source URI. `exceptions` must come from
the compiled engine's URL-specific cosmetic result; page messages cannot create exceptions. The
reply goes only to the WebView/frame that sent the request:

```json
{
  "athanorShield": 1,
  "type": "cosmetic-response",
  "id": "c1",
  "css": ".advertisement,.sponsor{display:none!important}\n"
}
```

The document accepts only a response whose ID is pending, and caps reply size before inserting it
as text in a style element. Messages are advisory: malformed messages, timeouts, and internal
errors skip cosmetics so the page continues to load. WebView2 top-level messages use
`window.chrome.webview.postMessage` / `WebMessageReceived` / `PostWebMessageAsJson`; child frames
use `ICoreWebView2Frame2` message events and replies. Android installs the same bridge in every
frame with `WebViewCompat.addDocumentStartJavaScript` plus
`WebViewCompat.addWebMessageListener`, validates the same protocol through
`Filter::cosmetic_query_reply`, derives the source URL from the native callback, and replies on the
same frame's `JavaScriptReplyProxy`. `addJavascriptInterface` is not used and no JavaScript
evaluation command is exposed through this channel.

One androidx.webkit detail matters here: `allowedOriginRules` only accepts
`SCHEME://[HOSTNAME_PATTERN[:PORT]]` or the bare `*`. Chromium's origin matcher rejects a wildcard
hostname (`https:` followed by `://` and `*`) with `IllegalArgumentException`, so no rule can
express "every http(s) origin". Both registrations therefore use the bare `*`, and HTTP(S)-only is
enforced natively: the Kotlin callback drops any frame whose `sourceOrigin` is not http(s), and
`Filter::cosmetic_query_reply` drops any non-web page URL. Android also cannot report a subframe's
full URL, so subframe queries use `sourceOrigin` (origin only, no path or query).

The Windows adapter currently caps inbound JSON at 128 KiB, request tokens at 512, each token at
256 UTF-8 bytes, and the response at 768 KiB. The page batches 256 tokens per message and keeps at
most 8,192 distinct tokens per document. Android applies the same 128 KiB inbound cap before
crossing into JNI, and the shared reply builder applies the same 768 KiB response cap.

## Document-start injections

The collector is registered with `AddScriptToExecuteOnDocumentCreated` for all frames. Before a
matching navigation is resumed, the adapter gets that frame's URL-specific script from
`Filter::cosmetic_js`, registers an exact-URL guarded document-created script, then resumes the
navigation. This is intended to run scriptlets and URL-specific cosmetics before parser scripts;
the guard makes repeated registration/navigation idempotent. The existing extension injector still
runs in its established DOMContentLoaded/idle phases.

The registration and frame resume path compiles against the WebView2 bindings but has not yet been
verified with a running WebView2 end-to-end fixture. In particular, iframe cancellation/resume and
the reported scriptlet-before-inline-script property must be confirmed in a real runtime before
calling the timing guarantee proven.

## Current syntax support

| Feature | Status |
|---|---|
| Static network filters, redirect resources, HTTPS upgrade, tracking query stripping | Implemented through adblock-rust and the facade. |
| `$removeparam` | Main-frame navigations are rewritten through `rewrite_navigation`; subresources return a WebView2 307 response with `Location`. WebView2 redirect-following is not yet verified in the app. Android's legacy `verdict` remains source-compatible and maps rewrite to allow; Android should use `verdict_with_rewrite` when it can reissue. |
| `$badfilter`, `$domain`, `$important`, `$1p`/`$3p`, `$popup`, `$ping`, `$websocket`, `redirect-rule` | Covered by engine tests. `$popup` is normalized to a document check for WebView2 `NewWindowRequested`. |
| `$denyallow` | Compatibility normalization is added around adblock-rust 0.13.3, which does not parse this option. Matching destination exceptions are checked in Athanor. An overlapping plain rule is preserved; complex overlaps with multiple distinct rules are not fully equivalent to a native engine implementation. |
| URL-specific CSS and generic class/ID hide rules | Implemented, with generic selectors fetched on demand. `$generichide` and URL-specific exceptions are honored. |
| Procedural cosmetic actions | A bounded, no-`eval` runtime handles `has-text`, `matches-attr`, `matches-css` and pseudo variants, `matches-path`, `min-text-length`, `upward`, `nth-ancestor`, `xpath`, `has`, `not`, `matches-media`, `watch-attr`, `others`, and `remove`, `style`, `remove-attr`, `remove-class`; chained operations are applied in order. Current adblock-rust serialization emits only a subset of these operator types, so some runtime branches cannot yet be reached from list text. Re-evaluation is mutation-batched and stops after a quiet period. Regexes are length-limited and reject known high-risk constructs. |
| `$csp`, `$header`, `$replace`, HTML filters (`##^`) | Unsupported. This adapter does not alter response CSP/headers or rewrite HTML response bodies. WebView2's current request hook can cancel or replace a resource response but Athanor has not implemented the response-body parsing/transformation layer these filters need. |
| Redirect resources / `redirect-rule` | Redirect resources and `redirect-rule` are supported by the engine and neutered data responses. |

Any internal cosmetic/runtime error is caught in page context and skips that action. Invalid
network requests fail open in the engine wrapper.

## Existing configuration and commands

Persisted settings currently cover the global blocker enable flag, per-list enable flags, and
per-registrable-site blocking exceptions. `Filter::set_enabled`, `set_list_enabled`,
`set_site_disabled`, `status`, and list refresh APIs retain their existing behavior. This change
does not add the proposed granular `ShieldsConfig`, third-party cookie controls, GPC/DNT headers,
Tracking Prevention profile setting, fingerprint farbling, user filters, element picker/zapper,
or dynamic filtering matrix. The currently exposed Tauri commands and status event are listed in
the Shields section of `docs/IPC.md`.

The facade adds `DetailedVerdict` / `verdict_with_rewrite` for adapters that can follow rewritten
URLs, `PageContext` / `page_context` / `verdict_with_page_context` to reuse the source host parsed
once per navigation, `cosmetic_query` for generic class/ID matching, `page_script_injections` for
extension-only phases, `enabled` for adapter fast paths, and `set_extra_lists` to accept extension
list pairs and atomically replace the compiled engine. Extra list IDs accept ASCII letters,
digits, `_`, `-`, and `.`, with 8 MiB per list and 32 MiB total limits; the method returns
validation errors. Existing `Verdict` and `verdict` stay source-compatible; legacy `verdict` maps
a rewrite to allow.

## Performance measurements

Run the ignored `live_corpus_benchmark` test with the environment variables below to measure a
compiled load, cache size, raw engine matching, wrapper matching, and up to 101 representative
cosmetic payloads from the supplied corpus:

```powershell
$env:CARGO_TARGET_DIR = "$env:TEMP\athanor-target-shield"
$env:ATHANOR_ADBLOCK_BENCH_DIR = "$env:TEMP\athanor-adblock-live"
$env:ATHANOR_ADBLOCK_CORPUS = "<path-to>/refs/adblock-rust/data/requests.json"
cargo test -p athanor-adblock live_corpus_benchmark -- --ignored --nocapture
```

Set `ATHANOR_ADBLOCK_BENCH_HOLD_SECS=60` to pause immediately after load so Windows process
working-set size can be sampled with `Get-Process`. Record whether the cache was compiled or
rebuilt: a rebuild is not a cold compiled-cache load. On the implementation machine, the first
cache rebuild took 1.78 s; subsequent optimized compiled-cache loads took 64–67 ms. `engine.dat`
was 15,582,948 bytes and the serialized engine payload was 15,571,213 bytes for 13 enabled lists.
The loaded benchmark process used 22.6 MiB working set (17.5 MiB private bytes) before reading the
large request corpus. The optimized engine rebuild measurement inside the benchmark was 128-131 ms.
In the final full-corpus optimized run (242,945 requests, two passes), raw-engine matching measured
5,595 ns/request and the wrapper with navigation-cached source context measured 6,645 ns/request.
Raw and wrapper block totals differ by 24 because the wrapper applies Athanor's `$denyallow`
compatibility exceptions; URL rewrites are excluded from the blocked count. Earlier runs varied
between 5.0-5.7 us raw and 6.6-7.3 us in the wrapper, so the <=5 us target was not consistently met.
The wrapper figure includes destination parsing, per-site config lookup, and the default per-host
counter update on matches. Peak working set during cache deserialization was not captured; the
loaded working set before corpus buffering was 22.6 MiB.
The 101 sampled host-specific cosmetic CSS+JS payloads had a 37,362-byte median, including
procedural runtime/action payloads and URL-specific CSS. This is not the generic on-demand reply
size: the supplied request corpus has no DOM token inventories, so a representative generic reply
size is not measured. Embedded JS assets are 6,379 bytes (`cosmetic-bridge.js`) and 8,203 bytes
(`procedural-runtime.js`), 14,582 bytes total before gzip; no JS minifier is configured, so these
are source-byte sizes rather than minified output. These figures and all timings are specific to
the test machine.

The test-shell application builds with `TAURI_CONFIG={"build":{"frontendDist":"../.testshell"}}`
and `tauri/custom-protocol`. A live WebView2 test was attempted with a local fixture server and
`--remote-debugging-port=9222`, but the app failed during setup while creating WebView2 with
HRESULT `0x800700AA` (the requested resource is in use). No navigation, iframe scriptlet timing,
request-blocking, header, or generic-cosmetic E2E assertions completed.

## Android adapter notes

Keep the existing `Filter` APIs used by `platform_mobile.rs` source-compatible. For the cosmetic
bridge, register `COSMETIC_BRIDGE_JS` before any URL is loaded, including in child frames. The
Kotlin plugin fetches that script once from JNI
(`Java_dev_athanor_browser_AthanorEngine_cosmeticBridgeScript`) and registers it with
`WebViewCompat.addDocumentStartJavaScript`; the transport object comes from
`WebViewCompat.addWebMessageListener` under the name `athanorShield`. Carry the frame URL from the
native callback into `Filter::cosmetic_query_reply` through
`Java_dev_athanor_browser_AthanorEngine_cosmeticQuery`; return the response only to that same frame
(`JavaScriptReplyProxy.postMessage`, only when the call returns non-null). Use `cosmetic_js` for
URL-specific document-start payloads. Prefer `verdict_with_rewrite` for request types where the
Android WebView adapter can cancel and reissue a rewritten request; the old `verdict`
intentionally maps `Rewrite` to `Allow` for compatibility.
