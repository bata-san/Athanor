// Real-app check of Ctrl+1..9 (pinned first, then down the sidebar), the number badges, and that a folder keeps
// its name when it is closed.
//
//   set ATHANOR_DATA_DIR=<empty temp dir>
//   set WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9222
//   athanor.exe
//   node e2e/ui/tab-order.cjs [outDir]
const { chromium } = require('playwright-core');
const http = require('node:http');
const path = require('node:path');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const out = process.argv[2] || process.env.TEMP || '.';

(async () => {
  if (!process.env.ATHANOR_DATA_DIR) { console.log('Refusing to run without ATHANOR_DATA_DIR.'); process.exit(2); }
  const server = http.createServer((req, res) => { res.setHeader('content-type', 'text/html; charset=utf-8'); res.end(`<!doctype html><title>${req.url.slice(1) || 'home'}</title><body>${req.url}</body>`); });
  await new Promise((r) => server.listen(8772, '127.0.0.1', r));
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
  const all = () => browser.contexts().flatMap((c) => c.pages());
  let shell;
  for (let i = 0; i < 40 && !shell; i++) { shell = all().find((p) => /^https?:\/\/(tauri\.localhost|localhost:1420)/.test(p.url())); if (!shell) await sleep(250); }
  if (!shell) { console.log('RESULT: shell not found'); process.exit(2); }
  const invoke = (cmd, args = {}) => shell.evaluate(([c, a]) => window.__TAURI_INTERNALS__.invoke(c, a), [cmd, args]);
  let failed = 0;
  const check = (name, ok, detail) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' - ' + detail : ''}`); if (!ok) failed++; };
  const snapshot = () => invoke('get_snapshot');
  const activeName = async () => { const s = await snapshot(); const t = s.workspace.tabs.find((x) => x.id === s.workspace.activeTab); return t ? t.url.replace('http://127.0.0.1:8772/', '') : null; };

  await invoke('set_settings', { patch: { onboarded: true, autoFile: false } }); // the test arranges the folders itself
  let snap = await snapshot();
  const space = snap.workspace.activeSpace;
  for (const t of snap.workspace.tabs) await invoke('close_tab', { tab: t.id }).catch(() => {});
  await sleep(500);
  // tabs: a b c d e (creation order), c is pinned, b and d live in the folder "Work"
  const id = {};
  for (const name of ['a', 'b', 'c', 'd', 'e']) { id[name] = await invoke('open_tab', { url: `http://127.0.0.1:8772/${name}` }); await sleep(250); }
  snap = await snapshot();
  // the tab that was left over from closing everything is not part of the test: close any other tab
  for (const t of snap.workspace.tabs) if (!Object.values(id).includes(t.id)) await invoke('close_tab', { tab: t.id });
  await invoke('set_pinned', { tab: id.c, pinned: true });
  await invoke('create_folder', { space, name: 'Work' });
  snap = await snapshot();
  const folder = snap.workspace.folders.find((f) => f.name === 'Work');
  await invoke('move_tab', { tab: id.b, folder: folder.id });
  await invoke('move_tab', { tab: id.d, folder: folder.id });
  await sleep(1200);

  // sidebar order is: c (pinned) | Work: b, d | a, e
  const press = async (n) => { await shell.keyboard.press(`Control+${n}`); await sleep(500); return activeName(); };
  check('Ctrl+1 is the pinned tab', (await press(1)) === 'c');
  check('Ctrl+2 is the first tab of the first folder', (await press(2)) === 'b');
  check('Ctrl+3 is the next one down', (await press(3)) === 'd');
  check('Ctrl+4 is the first loose tab', (await press(4)) === 'a');
  check('Ctrl+5 is the last tab', (await press(5)) === 'e');
  check('Ctrl+9 is always the last tab', (await press(9)) === 'e');

  // while Ctrl is held the rows show their numbers
  await shell.keyboard.down('Control');
  await sleep(300);
  const badges = await shell.$$eval('[data-part="tab-number"]', (els) => els.map((e) => e.textContent));
  await shell.screenshot({ path: path.join(out, 'tab-numbers.png') });
  await shell.keyboard.up('Control');
  await sleep(300);
  check('holding Ctrl shows 1-5 on the rows', badges.join(',') === '1,2,3,4,5', badges.join(','));
  check('letting go hides them', (await shell.$$('[data-part="tab-number"]')).length === 0);

  // close the folder: its name stays readable, and the numbers skip the hidden tabs
  await invoke('toggle_folder', { id: folder.id });
  await sleep(500);
  const label = await shell.$eval('[data-part="folder-header"] .sb-label', (el) => { const s = getComputedStyle(el); return { text: el.textContent, opacity: Number(s.opacity), width: el.getBoundingClientRect().width }; });
  console.log('closed folder label:', JSON.stringify(label));
  check('a closed folder still shows its name', label.text === 'Work' && label.opacity > 0.9 && label.width > 20);
  await shell.screenshot({ path: path.join(out, 'folder-closed.png') });
  check('with the folder closed, Ctrl+2 skips its hidden tabs', (await press(2)) === 'a');
  check('and Ctrl+9 is still the last tab', (await press(9)) === 'e');
  // Ctrl+Tab still walks every tab, hidden ones included
  await press(1);
  const walked = [];
  for (let i = 0; i < 5; i++) { await shell.keyboard.press('Control+Tab'); await sleep(450); walked.push(await activeName()); }
  check('Ctrl+Tab walks the sidebar order, folders included', walked.join(',') === 'b,d,a,e,c', walked.join(','));

  server.close();
  console.log(failed ? `RESULT: FAIL (${failed})` : 'RESULT: PASS');
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error('ERR', e.message); process.exit(3); });
