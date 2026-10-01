// Real-app check of the tab overview (Ctrl+Space): all tabs as a grid of page pictures, click to go there.
//
//   set ATHANOR_DATA_DIR=<empty temp dir>
//   set WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9222
//   athanor.exe
//   node e2e/ui/tab-overview.cjs [outDir]
const { chromium } = require('playwright-core');
const http = require('node:http');
const path = require('node:path');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const out = process.argv[2] || process.env.TEMP || '.';

(async () => {
  if (!process.env.ATHANOR_DATA_DIR) { console.log('Refusing to run without ATHANOR_DATA_DIR.'); process.exit(2); }
  const colours = { a: '#e11d48', b: '#2563eb', c: '#16a34a', d: '#d97706', e: '#7c3aed' };
  const server = http.createServer((req, res) => {
    const name = req.url.replace(/^\//, '').split('?')[0] || 'home';
    res.setHeader('content-type', 'text/html; charset=utf-8');
    res.end(`<!doctype html><title>Page ${name}</title><body style="margin:0;background:${colours[name] || '#444'};color:#fff;font:700 120px sans-serif;display:grid;place-items:center;height:100vh">${name}</body>`);
  });
  await new Promise((r) => server.listen(8773, '127.0.0.1', r));
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
  const all = () => browser.contexts().flatMap((c) => c.pages());
  let shell;
  for (let i = 0; i < 40 && !shell; i++) { shell = all().find((p) => /^https?:\/\/(tauri\.localhost|localhost:1420)/.test(p.url())); if (!shell) await sleep(250); }
  if (!shell) { console.log('RESULT: shell not found'); process.exit(2); }
  const invoke = (cmd, args = {}) => shell.evaluate(([c, a]) => window.__TAURI_INTERNALS__.invoke(c, a), [cmd, args]);
  let failed = 0;
  const check = (name, ok, detail) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' - ' + detail : ''}`); if (!ok) failed++; };
  const snapshot = () => invoke('get_snapshot');
  const activeName = async () => { const s = await snapshot(); const t = s.workspace.tabs.find((x) => x.id === s.workspace.activeTab); return t ? t.url.replace('http://127.0.0.1:8773/', '') : null; };
  const overview = '[data-part="tab-overview"]';

  await invoke('set_settings', { patch: { onboarded: true, autoFile: false } });
  let snap = await snapshot();
  for (const t of snap.workspace.tabs) await invoke('close_tab', { tab: t.id }).catch(() => {});
  await sleep(500);
  const id = {};
  // Visit each page in turn and stay a moment: the picture of a page is taken while it is in front.
  for (const name of ['a', 'b', 'c', 'd', 'e']) { id[name] = await invoke('open_tab', { url: `http://127.0.0.1:8773/${name}` }); await sleep(3200); }
  snap = await snapshot();
  for (const t of snap.workspace.tabs) if (!Object.values(id).includes(t.id)) await invoke('close_tab', { tab: t.id });
  await invoke('activate_tab', { tab: id.c });
  await sleep(2500);

  await shell.keyboard.press('Control+Space');
  await shell.waitForSelector(overview, { timeout: 4000 }).then(() => check('Ctrl+Space opens the overview', true), () => check('Ctrl+Space opens the overview', false));
  await sleep(500);
  const cards = await shell.$$eval('[data-part="tab-card"]', (els) => els.map((e) => ({ id: e.dataset.tab, active: e.dataset.active, picture: Boolean(e.querySelector('img')) })));
  check('one card per tab, in sidebar order', cards.map((c) => c.id).join(',') === ['a', 'b', 'c', 'd', 'e'].map((n) => id[n]).join(','), String(cards.length));
  check('the current tab is marked', cards.filter((c) => c.active === 'true').map((c) => c.id).join() === id.c);
  check('cards show page pictures', cards.filter((c) => c.picture).length >= 3, `${cards.filter((c) => c.picture).length} of ${cards.length}`);
  check('focus starts on the current tab', await shell.evaluate((tab) => document.activeElement?.dataset?.tab === tab, id.c));
  await shell.screenshot({ path: path.join(out, 'tab-overview.png') });

  await shell.keyboard.press('ArrowRight');
  await sleep(150);
  check('arrow keys move focus across the grid', await shell.evaluate((tab) => document.activeElement?.dataset?.tab === tab, id.d));

  await shell.fill('input[aria-label="Search tabs"]', 'Page b');
  await sleep(400);
  check('search filters the cards', (await shell.$$('[data-part="tab-card"]')).length === 1);
  await shell.fill('input[aria-label="Search tabs"]', 'zzz-nothing');
  await sleep(400);
  check('no match leaves no cards', (await shell.$$('[data-part="tab-card"]')).length === 0);
  await shell.fill('input[aria-label="Search tabs"]', '');
  await sleep(400);

  await shell.click(`[data-part="tab-card"][data-tab="${id.b}"]`);
  await sleep(600);
  check('clicking a card goes to that tab', (await activeName()) === 'b');
  check('and closes the overview', (await shell.$(overview)) === null);

  await shell.keyboard.press('Control+Space');
  await shell.waitForSelector(overview, { timeout: 4000 });
  await shell.keyboard.press('Escape');
  await sleep(500);
  check('Esc closes it without changing tab', (await shell.$(overview)) === null && (await activeName()) === 'b');

  await shell.keyboard.press('Control+Space');
  await shell.waitForSelector(overview, { timeout: 4000 });
  await sleep(300);
  await shell.keyboard.press('Control+Space');
  await sleep(500);
  check('Ctrl+Space toggles it closed', (await shell.$(overview)) === null);

  await shell.keyboard.press('Control+Space');
  await shell.waitForSelector(overview, { timeout: 4000 });
  await shell.hover(`[data-part="tab-card"][data-tab="${id.e}"]`);
  await shell.click(`[data-part="tab-card"][data-tab="${id.e}"] [data-part="tab-card-close"]`);
  await sleep(800);
  snap = await snapshot();
  check('the card close button closes that tab only', !snap.workspace.tabs.some((t) => t.id === id.e) && snap.workspace.tabs.length === 4);
  check('the other cards stay', (await shell.$$('[data-part="tab-card"]')).length === 4);
  await shell.keyboard.press('Escape');
  await sleep(300);

  server.close();
  console.log(failed ? `RESULT: FAIL (${failed})` : 'RESULT: PASS');
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error('ERR', e.message); process.exit(3); });
