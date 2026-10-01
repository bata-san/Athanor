// Real-app check of sign-in style popups: window.open with a size must give a real window that keeps its opener
// (Google / Apple / Microsoft sign-in report "blocked" and never finish otherwise); a plain link target still becomes a tab.
//
//   set ATHANOR_DATA_DIR=<empty temp dir>
//   set WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9222
//   athanor.exe
//   node e2e/ui/popup.cjs
const { chromium } = require('playwright-core');
const http = require('node:http');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  if (!process.env.ATHANOR_DATA_DIR) { console.log('Refusing to run without ATHANOR_DATA_DIR.'); process.exit(2); }
  const server = http.createServer((req, res) => {
    res.setHeader('content-type', 'text/html; charset=utf-8');
    if (req.url.startsWith('/popup')) { res.end('<!doctype html><title>Popup</title><body>signing in...<script>setTimeout(() => { window.opener.postMessage("signed-in", "*"); window.close(); }, 300)</script>'); return; }
    res.end('<!doctype html><title>Opener</title><body><button id="pop" onclick="window.__w = window.open(\'/popup\', \'auth\', \'popup,width=420,height=520\'); window.__opened = !!window.__w">Sign in</button> <a id="tab" target="_blank" href="/plain">link</a><script>window.__msg = null; addEventListener("message", (e) => { window.__msg = e.data })</script>');
  });
  await new Promise((r) => server.listen(8774, '127.0.0.1', r));
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
  const all = () => browser.contexts().flatMap((c) => c.pages());
  let shell;
  for (let i = 0; i < 40 && !shell; i++) { shell = all().find((p) => /^https?:\/\/(tauri\.localhost|localhost:1420)/.test(p.url())); if (!shell) await sleep(250); }
  if (!shell) { console.log('RESULT: shell not found'); process.exit(2); }
  const invoke = (cmd, args = {}) => shell.evaluate(([c, a]) => window.__TAURI_INTERNALS__.invoke(c, a), [cmd, args]);
  let failed = 0;
  const check = (name, ok, detail) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' - ' + detail : ''}`); if (!ok) failed++; };

  await invoke('set_settings', { patch: { onboarded: true, autoFile: false } });
  const tab = (await invoke('get_snapshot')).workspace.activeTab;
  await invoke('navigate', { tab, input: 'http://127.0.0.1:8774/' });
  let page = null;
  for (let i = 0; i < 80 && !page; i++) { page = all().find((p) => p.url() === 'http://127.0.0.1:8774/'); if (!page) await sleep(250); }
  if (!page) { check('opener page loaded', false); process.exit(1); }
  await sleep(800);
  const tabsBefore = (await invoke('get_snapshot')).workspace.tabs.length;
  await page.click('#pop');
  await sleep(1800);
  check('window.open with a size returns a window (not null)', await page.evaluate(() => window.__opened === true));
  check('the popup talks back to its opener', (await page.evaluate(() => window.__msg)) === 'signed-in');
  check('the popup did not become a tab', (await invoke('get_snapshot')).workspace.tabs.length === tabsBefore);
  await page.click('#tab');
  await sleep(1500);
  check('a plain target=_blank link still opens a tab', (await invoke('get_snapshot')).workspace.tabs.length === tabsBefore + 1);

  server.close();
  console.log(failed ? `RESULT: FAIL (${failed})` : 'RESULT: PASS');
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error('ERR', e.message); process.exit(3); });
