// Real-app check of the everyday browser features: find in page, per-site zoom, shortcuts and the cheat sheet.
//
//   set ATHANOR_DATA_DIR=<empty temp dir>
//   set WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9222
//   athanor.exe
//   node e2e/ui/browser-features.cjs [outDir]
const { chromium } = require('playwright-core');
const http = require('node:http');
const path = require('node:path');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const out = process.argv[2] || process.env.TEMP || '.';

(async () => {
  if (!process.env.ATHANOR_DATA_DIR) { console.log('Refusing to run without ATHANOR_DATA_DIR.'); process.exit(2); }
  const body = Array.from({ length: 40 }, (_, i) => `<p>Line ${i}: the quick brown fox ${i % 7 === 0 ? 'ALPHA' : 'jumps'} over the lazy dog, alpha again?</p>`).join('');
  const server = http.createServer((_, res) => { res.setHeader('content-type', 'text/html; charset=utf-8'); res.end(`<!doctype html><title>Find me</title><body style="font:16px sans-serif">${body}</body>`); });
  await new Promise((r) => server.listen(8765, '127.0.0.1', r));
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
  const all = () => browser.contexts().flatMap((c) => c.pages());
  let shell;
  for (let i = 0; i < 40 && !shell; i++) { shell = all().find((p) => /^https?:\/\/(tauri\.localhost|localhost:1420)/.test(p.url())); if (!shell) await sleep(250); }
  if (!shell) { console.log('RESULT: shell not found'); process.exit(2); }
  const invoke = (cmd, args = {}) => shell.evaluate(([c, a]) => window.__TAURI_INTERNALS__.invoke(c, a), [cmd, args]);
  let failed = 0;
  const check = (name, ok, detail) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' - ' + detail : ''}`); if (!ok) failed++; };
  const pageFor = async (prefix) => { for (let i = 0; i < 80; i++) { const p = all().find((x) => x.url().startsWith(prefix)); if (p) return p; await sleep(250); } return null; };

  await invoke('set_settings', { patch: { onboarded: true } });
  const snap0 = await invoke('get_snapshot');
  const tab = snap0.workspace.activeTab;
  await invoke('navigate', { tab, input: 'http://127.0.0.1:8765/' });
  const page = await pageFor('http://127.0.0.1:8765');
  if (!page) { check('test page opened', false); process.exit(1); }
  await sleep(1200);

  // ---- find in page (through the real shell UI)
  await shell.keyboard.press('Control+f');
  await shell.waitForSelector('[data-part="find-bar"] input', { timeout: 5000 });
  check('Ctrl+F opens the find bar', true);
  await shell.fill('[data-part="find-bar"] input', 'alpha');
  await sleep(600);
  const counter = await shell.$eval('[data-part="find-bar"] [aria-live]', (el) => el.textContent);
  console.log('counter:', counter);
  const matches = await page.evaluate(() => (document.body.innerText.match(/alpha/gi) || []).length);
  check('match count equals the page text', counter === `1 of ${matches}`, `${counter} vs ${matches}`);
  const highlights = await page.evaluate(() => ({ all: CSS.highlights.get('athanor-find')?.size ?? 0, current: CSS.highlights.get('athanor-find-current')?.size ?? 0 }));
  check('every match is highlighted, one is current', highlights.all === matches && highlights.current === 1, JSON.stringify(highlights));
  await shell.keyboard.press('Enter');
  await sleep(300);
  check('Enter moves to the next match', (await shell.$eval('[data-part="find-bar"] [aria-live]', (el) => el.textContent)) === `2 of ${matches}`);
  await shell.keyboard.press('Shift+Enter');
  await sleep(300);
  check('Shift+Enter goes back', (await shell.$eval('[data-part="find-bar"] [aria-live]', (el) => el.textContent)) === `1 of ${matches}`);
  await shell.fill('[data-part="find-bar"] input', 'zzzz-not-there');
  await sleep(500);
  check('no match says so', /Not found/.test(await shell.$eval('[data-part="find-bar"] [aria-live]', (el) => el.textContent)));
  await shell.screenshot({ path: path.join(out, 'find.png') });
  await shell.keyboard.press('Escape');
  await sleep(500);
  check('Esc closes the bar and clears the highlights', (await shell.$('[data-part="find-bar"]')) === null && (await page.evaluate(() => CSS.highlights.size)) === 0);

  // ---- zoom
  const dpr = () => page.evaluate(() => Math.round(window.outerWidth / window.innerWidth * 100) / 100);
  await invoke('zoom_page', { tab, dir: 1 });
  await sleep(500);
  let snap = await invoke('get_snapshot');
  check('zoom in is remembered for the site', snap.settings.siteZoom['127.0.0.1'] === 1.1, JSON.stringify(snap.settings.siteZoom));
  await shell.waitForSelector('[data-part="zoom-badge"]', { timeout: 3000 }).catch(() => {});
  check('the address pill shows the zoom level', (await shell.$eval('[data-part="zoom-badge"]', (el) => el.textContent).catch(() => '')) === '110%');
  check('the page really is zoomed', (await dpr()) === 1.1, String(await dpr()));
  await invoke('navigate', { tab, input: 'http://127.0.0.1:8765/?again' });
  await sleep(1500);
  check('zoom survives navigation on the same site', (await (await pageFor('http://127.0.0.1:8765')).evaluate(() => Math.round(window.outerWidth / window.innerWidth * 100) / 100)) === 1.1);
  await invoke('zoom_page', { tab, dir: 0 });
  await sleep(500);
  snap = await invoke('get_snapshot');
  check('Ctrl+0 resets and forgets', Object.keys(snap.settings.siteZoom).length === 0);

  // ---- cheat sheet and shell shortcuts
  await shell.keyboard.press('Control+/');
  await shell.waitForSelector('[data-part="shortcut-sheet"]', { timeout: 3000 });
  const rows = await shell.$$eval('[data-part="shortcut-sheet"] li', (els) => els.length);
  check('Ctrl+/ shows the shortcut sheet', rows >= 20, `${rows} rows`);
  await shell.screenshot({ path: path.join(out, 'sheet.png') });
  await shell.keyboard.press('Escape');
  await sleep(400);
  const tabsBefore = (await invoke('get_snapshot')).workspace.tabs.length;
  await shell.keyboard.press('Control+d');
  await sleep(400);
  snap = await invoke('get_snapshot');
  check('Ctrl+D pins the tab', snap.workspace.tabs.find((t) => t.id === tab)?.pinned === true);
  await shell.keyboard.press('Control+d');
  await sleep(300);
  check('Ctrl+D again unpins it', (await invoke('get_snapshot')).workspace.tabs.find((t) => t.id === tab)?.pinned === false);
  check('no stray tabs were opened', (await invoke('get_snapshot')).workspace.tabs.length === tabsBefore);

  // ---- keys the backend owns, pressed while the shell has focus (forwarded through run_shortcut)
  await shell.keyboard.press('Control+w');
  await sleep(800);
  snap = await invoke('get_snapshot');
  check('Ctrl+W closes the tab', !snap.workspace.tabs.some((t) => t.id === tab));
  await shell.keyboard.press('Control+Shift+t');
  await sleep(1200);
  snap = await invoke('get_snapshot');
  check('Ctrl+Shift+T brings it back', snap.workspace.tabs.some((t) => t.url.startsWith('http://127.0.0.1:8765')));

  // ---- Ctrl+T: type, Enter -> a new tab that searches
  const before = (await invoke('get_snapshot')).workspace.tabs.length;
  await shell.keyboard.press('Control+t');
  await shell.waitForSelector('[data-part="palette"] input', { timeout: 4000 });
  await shell.keyboard.type('hello athanor');
  await sleep(300);
  await shell.keyboard.press('Enter');
  await sleep(1500);
  snap = await invoke('get_snapshot');
  const searched = snap.workspace.tabs.find((t) => /google\.com\/search\?q=hello(\+|%20)athanor/.test(t.url));
  check('Ctrl+T, text, Enter opens a new tab that searches', snap.workspace.tabs.length === before + 1 && Boolean(searched), snap.workspace.tabs.map((t) => t.url).join(' | '));

  server.close();
  console.log(failed ? `RESULT: FAIL (${failed})` : 'RESULT: PASS');
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error('ERR', e.message); process.exit(3); });
