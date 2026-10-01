// Real-app check: pages without their own font use IBM Plex Sans JP, and the app UI shows the address pill above the page.
//
//   set ATHANOR_DATA_DIR=<empty temp dir>
//   set WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9222
//   athanor.exe
//   node e2e/ui/web-font.cjs [outDir]
const { chromium } = require('playwright-core');
const http = require('node:http');
const path = require('node:path');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const out = process.argv[2] || process.env.TEMP || '.';

(async () => {
  if (!process.env.ATHANOR_DATA_DIR) { console.log('Refusing to run without ATHANOR_DATA_DIR.'); process.exit(2); }
  // A page with no stylesheet at all: whatever font it gets is the browser default.
  const server = http.createServer((_, res) => { res.setHeader('content-type', 'text/html; charset=utf-8'); res.end('<!doctype html><html lang="ja"><title>plain</title><body><p id="jp">日本語のテキスト Hello</p><p id="sans" style="font-family:sans-serif">Sans 日本語</p></body></html>'); });
  await new Promise((r) => server.listen(8765, '127.0.0.1', r));
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
  const all = () => browser.contexts().flatMap((c) => c.pages());
  let shell;
  for (let i = 0; i < 40 && !shell; i++) { shell = all().find((p) => /^https?:\/\/(tauri\.localhost|localhost:1420)/.test(p.url())); if (!shell) await sleep(250); }
  if (!shell) { console.log('RESULT: shell not found'); process.exit(2); }
  const invoke = (cmd, args = {}) => shell.evaluate(([c, a]) => window.__TAURI_INTERNALS__.invoke(c, a), [cmd, args]);
  let failed = 0;
  const check = (name, ok, detail) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' - ' + detail : ''}`); if (!ok) failed++; };

  await invoke('set_settings', { patch: { onboarded: true } });
  const snap = await invoke('get_snapshot');
  check('settings default: webFont and autoUpdate on', snap.settings.webFont === true && snap.settings.autoUpdate === true);
  await invoke('navigate', { tab: snap.workspace.activeTab, input: 'http://127.0.0.1:8765/' });
  let page = null;
  for (let i = 0; i < 80 && !page; i++) { page = all().find((p) => p.url().startsWith('http://127.0.0.1:8765')); if (!page) await sleep(250); }
  if (!page) { check('test page opened', false); process.exit(1); }
  await sleep(1200);
  const session = await page.context().newCDPSession(page);
  await session.send('DOM.enable'); await session.send('CSS.enable');
  const { root } = await session.send('DOM.getDocument');
  for (const id of ['jp', 'sans']) {
    const { nodeId } = await session.send('DOM.querySelector', { nodeId: root.nodeId, selector: '#' + id });
    const { fonts } = await session.send('CSS.getPlatformFontsForNode', { nodeId });
    const names = fonts.map((f) => f.familyName);
    console.log(id, 'fonts:', JSON.stringify(fonts.map((f) => [f.familyName, f.glyphCount])));
    check(`#${id} is set in IBM Plex Sans JP`, names.some((n) => /IBM Plex Sans JP/i.test(n)));
  }

  // Layout: the address pill sits in the bar above the page, not in the sidebar.
  const geometry = await shell.evaluate(() => {
    const rect = (sel) => { const el = document.querySelector(sel); if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; };
    return { pill: rect('[data-part="omnibox"]'), content: rect('[data-part="content"]'), sidebar: rect('[data-part="sidebar"]'), crumb: document.querySelector('[data-part="sidebar-header"] [data-part="page-title"]')?.textContent ?? null };
  });
  console.log('layout:', JSON.stringify(geometry));
  check('address pill is above the page', geometry.pill && geometry.content && geometry.pill.y + geometry.pill.h <= geometry.content.y + 1);
  check('address pill is outside the sidebar', geometry.pill && geometry.sidebar && geometry.pill.x >= geometry.sidebar.x + geometry.sidebar.w - 1);
  check('sidebar header shows the location', Boolean(geometry.crumb));
  await shell.screenshot({ path: path.join(out, 'layout.png') });

  server.close();
  console.log(failed ? `RESULT: FAIL (${failed})` : 'RESULT: PASS');
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error('ERR', e.message); process.exit(3); });
