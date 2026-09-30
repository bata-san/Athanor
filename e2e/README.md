# End-to-end checks against the real app

These drive the real Athanor window (WebView2) over the Chrome DevTools Protocol.

## Shield (ad blocking)

`e2e/shield/check.cjs` navigates the active tab to a local test site (`server.cjs`) and asserts that

* generic cosmetic rules hide ad-like elements, including ones added after load,
* ordinary elements stay visible,
* third-party ad/analytics scripts are blocked while first-party scripts load,
* the tab's blocked counter increments.

```bash
# 1. build the app with the real frontend embedded
(cd app && npm ci && npm run build)
cargo build -p athanor --features tauri/custom-protocol

# 2. start the test site and the app (CDP on 9222; map a public-suffix host name to loopback,
#    because ad-block rules intentionally do not apply to bare `localhost`)
node e2e/shield/server.cjs &
WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS='--remote-debugging-port=9222 --host-resolver-rules="MAP shield-test.example.com 127.0.0.1"' \
  target/debug/athanor.exe &

# 3. assert (needs `playwright-core`, e.g. NODE_PATH=app/node_modules)
NODE_PATH=app/node_modules node e2e/shield/check.cjs
```

Note: WebView2 only delivers **string** messages from pages to the host; the cosmetic bridge therefore
sends `JSON.stringify(...)` payloads (see `docs/ADBLOCK.md`).
