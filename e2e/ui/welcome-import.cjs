// First-run welcome + import, on the real app with an empty data dir.
//
//   set ATHANOR_DATA_DIR=<empty temp dir>
//   set WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9222
//   athanor.exe        (dev build also needs the vite server on :1420)
//   node e2e/ui/welcome-import.cjs [outDir]
//
// Imports from the first Chromium browser found on this machine, read-only; it only ever writes into the temp
// data dir, so run it with ATHANOR_DATA_DIR set.
const { chromium } = require('playwright-core');
const path = require('node:path');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const out = process.argv[2] || process.env.TEMP || '.';

(async () => {
  if (!process.env.ATHANOR_DATA_DIR) { console.log('Refusing to run without ATHANOR_DATA_DIR (it would import into your real profile).'); process.exit(2); }
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
  const all = () => browser.contexts().flatMap((c) => c.pages());
  let shell;
  for (let i = 0; i < 40 && !shell; i++) { shell = all().find((p) => /^https?:\/\/(tauri\.localhost|localhost:1420)/.test(p.url())); if (!shell) await sleep(250); }
  if (!shell) { console.log('RESULT: shell not found'); process.exit(2); }
  const invoke = (cmd, args = {}) => shell.evaluate(([c, a]) => window.__TAURI_INTERNALS__.invoke(c, a), [cmd, args]);
  let failed = 0;
  const check = (name, ok, detail) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' - ' + detail : ''}`); if (!ok) failed++; };

  await shell.waitForSelector('[data-part="welcome"]', { timeout: 15000 });
  check('welcome overlay is shown on first run', true);
  const snap = await invoke('get_snapshot');
  check('settings: not onboarded, Google search + start page', snap.settings.onboarded === false && snap.settings.searchEngine.startsWith('https://www.google.com/search') && snap.settings.homepage === 'https://www.google.com/');
  check('first tab opens google.com', snap.workspace.tabs.length === 1 && /^https:\/\/www\.google\.com\/?/.test(snap.workspace.tabs[0].url), snap.workspace.tabs[0] && snap.workspace.tabs[0].url);
  await shell.screenshot({ path: path.join(out, 'welcome-1.png') });

  await shell.click('footer button:has-text("Get started")');
  await shell.waitForSelector('[role="radiogroup"][aria-label="Browser to import from"]', { timeout: 15000 });
  const names = await shell.$$eval('[role="radiogroup"][aria-label="Browser to import from"] [role="radio"]', (els) => els.map((e) => e.textContent.trim()));
  console.log('detected:', JSON.stringify(names));
  check('browsers on this machine are listed', names.length > 0);
  await shell.screenshot({ path: path.join(out, 'welcome-2.png') });

  const before = await invoke('get_snapshot');
  await shell.click('button:has-text("Import from")');
  await shell.waitForSelector('text=Bookmarks', { timeout: 120000 }).catch(() => {});
  let done = false;
  for (let i = 0; i < 240 && !done; i++) { done = await shell.$('button:has-text("Import another")') !== null || await shell.$('[role="alert"]') !== null; if (!done) await sleep(500); }
  const alert = await shell.$('[role="alert"]');
  check('import finished without an error', done && !alert, alert ? await alert.textContent() : '');
  await shell.screenshot({ path: path.join(out, 'welcome-3.png') });

  const after = await invoke('get_snapshot');
  const addedTabs = after.workspace.tabs.length - before.workspace.tabs.length;
  const importSpace = after.workspace.spaces.find((s) => /^From /.test(s.name));
  console.log('new spaces:', after.workspace.spaces.map((s) => s.name), 'added tabs:', addedTabs);
  check('bookmarks became archived tabs in a "From ..." space', !!importSpace && addedTabs > 0 && after.workspace.tabs.filter((t) => t.space === importSpace.id).every((t) => t.archived));
  check('the active space did not change', after.workspace.activeSpace === before.workspace.activeSpace);
  const suggestions = await invoke('omnibox_suggest', { query: 'google' });
  check('imported history feeds the address suggestions', Array.isArray(suggestions) && suggestions.length > 0, `${suggestions.length} suggestions for "google"`);

  // walk to the end and finish
  for (const label of ['Continue', 'Continue', 'Continue']) { await shell.click(`footer button:has-text("${label}")`); await sleep(500); }
  await shell.screenshot({ path: path.join(out, 'welcome-5.png') });
  await shell.click('footer button:has-text("Open Athanor")');
  await sleep(800);
  const gone = (await shell.$('[data-part="welcome"]')) === null;
  const final = await invoke('get_snapshot');
  check('finishing closes the overlay and remembers it', gone && final.settings.onboarded === true);

  console.log(failed ? `RESULT: FAIL (${failed})` : 'RESULT: PASS');
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error('ERR', e.message); process.exit(3); });
