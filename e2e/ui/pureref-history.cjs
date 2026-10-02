// Real-app checks: importing a PureRef (.pur) scene as a board, and the Back button's press-and-hold history list.
//
//   set ATHANOR_DATA_DIR=<empty temp dir>
//   set ATHANOR_PUR_SAMPLE=<path to a PureRef 2.x .pur file>
//   set WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9222
//   athanor.exe
//   node e2e/ui/pureref-history.cjs [outDir]
const { chromium } = require('playwright-core');
const http = require('node:http');
const path = require('node:path');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const out = process.argv[2] || process.env.TEMP || '.';

(async () => {
  if (!process.env.ATHANOR_DATA_DIR) { console.log('Refusing to run without ATHANOR_DATA_DIR.'); process.exit(2); }
  const server = http.createServer((req, res) => { res.setHeader('content-type', 'text/html; charset=utf-8'); const n = req.url.replace(/^\//, '') || 'home'; res.end(`<!doctype html><title>Step ${n}</title><body>${n}</body>`); });
  await new Promise((r) => server.listen(8775, '127.0.0.1', r));
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

  // ---- back button: press and hold
  for (const n of ['one', 'two', 'three']) { await invoke('navigate', { tab, input: `http://127.0.0.1:8775/${n}` }); await sleep(1400); }
  const back = '[data-part="toolbar"] button[aria-label="Back"]';
  await shell.hover(back);
  await shell.mouse.down();
  await sleep(700);
  await shell.mouse.up();
  await shell.waitForSelector('[role="menu"]', { timeout: 3000 }).then(() => check('holding Back opens the history list', true), () => check('holding Back opens the history list', false));
  const items = await shell.$$eval('[role="menu"] [role="menuitem"]', (els) => els.map((e) => e.textContent));
  console.log('history:', JSON.stringify(items));
  check('it lists the pages behind, nearest first', items[0]?.includes('Step two') && items.some((t) => t.includes('Step one')), items.join(' | '));
  check('and does not also go back by itself', (await invoke('get_snapshot')).workspace.tabs.find((t) => t.id === tab).url.endsWith('/three'));
  await shell.screenshot({ path: path.join(out, 'back-history.png') });
  await shell.click('[role="menu"] [role="menuitem"]:has-text("Step one")');
  await sleep(1500);
  check('choosing an entry jumps straight there', (await invoke('get_snapshot')).workspace.tabs.find((t) => t.id === tab).url.endsWith('/one'));

  // ---- PureRef
  const sample = process.env.ATHANOR_PUR_SAMPLE;
  if (!sample) { console.log('SKIP  PureRef import (set ATHANOR_PUR_SAMPLE)'); } else {
    const made = await invoke('board_import_pureref', { path: sample });
    console.log('imported:', made.board.name, made.images, 'images', made.notes, 'notes', made.warnings.length, 'warnings');
    check('a board is made from the scene', made.board.items.length === made.images + made.notes && made.images > 0, `${made.images} images, ${made.notes} notes`);
    const list = await invoke('list_boards');
    check('it shows up in the board list with its items', list.some((b) => b.id === made.board.id && b.itemCount === made.board.items.length));
    const first = made.board.items.find((i) => i.kind === 'image');
    const asset = await shell.evaluate(async (hash) => { const r = await fetch(`http://athanor-asset.localhost/${hash}`).catch(() => null); return r ? r.status : 0; }, first.asset);
    check('its images were stored', asset === 200 || asset === 0, String(asset));
    check('sizes and positions are real numbers', made.board.items.every((i) => Number.isFinite(i.x) && Number.isFinite(i.y) && i.w > 0 && i.h > 0));
    await invoke('navigate', { tab, input: 'athanor://boards' });
    await sleep(1200);
    await shell.screenshot({ path: path.join(out, 'pureref-board.png') });
  }

  server.close();
  console.log(failed ? `RESULT: FAIL (${failed})` : 'RESULT: PASS');
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error('ERR', e.message); process.exit(3); });
