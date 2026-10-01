// Drives the running Athanor (WebView2) over CDP: right-clicks inside a real page and checks that the shell
// draws the engine's menu (shadcn) and that choosing an entry runs the engine command.
//
//   WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS="--remote-debugging-port=9222 --host-resolver-rules=\"MAP shield-test.example.com 127.0.0.1\"" athanor
//   node e2e/shield/server.cjs        # serves the test page on :8099
//   node e2e/ui/context-menu.cjs [outDir]
const { chromium } = require('playwright-core');
const path = require('node:path');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const out = process.argv[2] || process.env.TEMP || '.';

(async () => {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
  const all = () => browser.contexts().flatMap((c) => c.pages());
  const shell = all().find((p) => /^https?:\/\/(tauri\.localhost|localhost:1420)/.test(p.url()));
  if (!shell) { console.log('RESULT: shell not found', all().map((p) => p.url())); process.exit(2); }
  const invoke = (cmd, args = {}) => shell.evaluate(([c, a]) => window.__TAURI_INTERNALS__.invoke(c, a), [cmd, args]);

  await invoke('set_settings', { patch: { onboarded: true } }); // skip the first-run welcome overlay
  const snap = await invoke('get_snapshot');
  const tab = snap.workspace.activeTab;
  for (const t of snap.workspace.tabs) if (t.id !== tab && /shield-test|link-target/.test(t.url)) await invoke('close_tab', { tab: t.id });
  await sleep(500);
  await invoke('navigate', { tab, input: 'http://shield-test.example.com:8099/' });
  let page;
  for (let i = 0; i < 40 && !page; i++) { await sleep(250); page = all().find((p) => p.url().startsWith('http://shield-test.example.com:8099')); }
  if (!page) { console.log('RESULT: test page not found', all().map((p) => p.url())); process.exit(2); }
  await sleep(1500);

  // Right-click through CDP so it takes the same route as a real mouse click.
  const client = await page.context().newCDPSession(page);
  const rightClick = async (x, y) => {
    await client.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
    await client.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'right', buttons: 2, clickCount: 1 });
    await client.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'right', buttons: 0, clickCount: 1 });
  };
  const menuItems = () => shell.evaluate(() => [...document.querySelectorAll('[data-part="page-context-menu"] [role="menuitem"]')].map((e) => ({ name: e.getAttribute('data-command'), text: e.textContent.trim() })));
  const waitMenu = async () => { for (let i = 0; i < 30; i++) { const items = await menuItems(); if (items.length) return items; await sleep(100); } return []; };
  const names = (items) => items.map((i) => i.name);
  const frames = () => shell.evaluate(() => document.querySelectorAll('[data-part="frozen-page"]').length);
  const center = (selector) => page.evaluate((sel) => { const b = document.querySelector(sel).getBoundingClientRect(); return { x: b.x + Math.min(b.width / 2, 20), y: b.y + b.height / 2 }; }, selector);

  let failed = 0;
  const check = (name, ok, detail) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' - ' + detail : ''}`); if (!ok) failed++; };

  // 1) plain page
  await rightClick(700, 400);
  const items = await waitMenu();
  console.log('page entries:', JSON.stringify(items));
  check('page menu opens in the shell', names(items).includes('back') && names(items).includes('reload'));
  let frozenCount = await frames();
  for (let i = 0; i < 20 && frozenCount !== 1; i++) { await sleep(100); frozenCount = await frames(); }
  check('page is frozen behind the menu', frozenCount === 1);
  const geometry = await shell.evaluate(() => { const m = document.querySelector('[data-part="page-context-menu"]'); const r = m && m.getBoundingClientRect(); const c = document.querySelector('[data-part="content"]').getBoundingClientRect(); return r && { menuX: r.x, menuY: r.y, contentX: c.x, contentY: c.y, dpr: devicePixelRatio }; });
  console.log('geometry', JSON.stringify(geometry));
  check('menu opens at the click position', geometry && Math.abs(geometry.menuX - (geometry.contentX + 700 / geometry.dpr)) < 3 && Math.abs(geometry.menuY - (geometry.contentY + 400 / geometry.dpr)) < 3);
  await shell.screenshot({ path: path.join(out, 'ctx-page.png') });

  // 2) choose "Reload": the engine must run it and the shell must clean up
  await page.evaluate(() => { window.__marker = 42; });
  await shell.evaluate(() => document.querySelector('[data-part="page-context-menu"] [data-command="reload"]').click());
  await sleep(1200);
  check('choosing an entry closes the menu and unfreezes', (await menuItems()).length === 0 && (await frames()) === 0);
  page = all().find((p) => p.url().startsWith('http://shield-test.example.com:8099')) || page;
  const marker = await page.evaluate(() => window.__marker).catch(() => 'error');
  check('the engine executed Reload', marker === undefined, `marker=${marker}`);

  // 3) dismiss path
  await rightClick(700, 420);
  await waitMenu();
  await shell.keyboard.press('Escape');
  await sleep(600);
  check('Escape dismisses and unfreezes', (await menuItems()).length === 0 && (await frames()) === 0);
  check('page still responsive', (await page.evaluate(() => 1 + 1).catch(() => null)) === 2);

  // 4) link
  const link = await center('#t-link');
  await rightClick(link.x, link.y);
  const linkItems = await waitMenu();
  console.log('link entries:', JSON.stringify(linkItems));
  check('link menu has Open link in new tab', linkItems.some((i) => i.text === 'Open link in new tab'));
  const before = await invoke('get_snapshot');
  await shell.evaluate(() => [...document.querySelectorAll('[data-part="page-context-menu"] [role="menuitem"]')].find((e) => e.textContent.trim() === 'Open link in new tab').click());
  await sleep(1200);
  const afterLink = await invoke('get_snapshot');
  check('Open link in new tab opened a tab', afterLink.workspace.tabs.length === before.workspace.tabs.length + 1 && afterLink.workspace.tabs.some((t) => t.url.endsWith('/link-target')));
  for (const t of afterLink.workspace.tabs.filter((t) => t.url.endsWith('/link-target'))) await invoke('close_tab', { tab: t.id });
  await sleep(500);
  await invoke('activate_tab', { tab });
  await sleep(500);

  // 5) image
  const img = await center('#t-img');
  await rightClick(img.x, img.y);
  const imgItems = await waitMenu();
  console.log('image entries:', JSON.stringify(imgItems));
  check('image menu has Send image to board', imgItems.some((i) => i.text === 'Send image to board'));
  await shell.keyboard.press('Escape');
  await sleep(500);

  // 6) selection
  await page.evaluate(() => { const r = document.createRange(); r.selectNodeContents(document.querySelector('h1')); const s = getSelection(); s.removeAllRanges(); s.addRange(r); });
  const h1 = await center('h1');
  await rightClick(h1.x, h1.y);
  const sel = await waitMenu();
  console.log('selection entries:', JSON.stringify(sel));
  check('selection menu has our Search entry and Copy', sel.some((i) => /^Search/.test(i.text)) && names(sel).includes('copy'));
  await shell.screenshot({ path: path.join(out, 'ctx-selection.png') });
  await shell.keyboard.press('Escape');
  await sleep(400);

  console.log(failed ? `RESULT: FAIL (${failed})` : 'RESULT: PASS');
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error('ERR', e.message); process.exit(3); });
