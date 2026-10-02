// Right-clicking on a busy page (note.com) must never leave the page frozen under a picture.
const { chromium } = require('playwright-core');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  if (!process.env.ATHANOR_DATA_DIR) { console.log('Refusing to run without ATHANOR_DATA_DIR.'); process.exit(2); }
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
  const all = () => browser.contexts().flatMap((c) => c.pages());
  let shell;
  for (let i = 0; i < 40 && !shell; i++) { shell = all().find((p) => /^https?:\/\/(tauri\.localhost|localhost:1420)/.test(p.url())); if (!shell) await sleep(250); }
  const invoke = (cmd, args = {}) => shell.evaluate(([c, a]) => window.__TAURI_INTERNALS__.invoke(c, a), [cmd, args]);
  await invoke('set_settings', { patch: { onboarded: true } });
  const tab = (await invoke('get_snapshot')).workspace.activeTab;
  await invoke('navigate', { tab, input: process.env.NOTE_URL || 'https://note.com/' });
  await sleep(6000);
  const page = all().find((p) => p.url().startsWith('https://note.'));
  const client = await page.context().newCDPSession(page);
  const frozen = () => shell.evaluate(() => document.querySelectorAll('[data-part="frozen-page"]').length);
  let bad = 0;
  for (const [x, y] of [[300, 300], [600, 200], [100, 500], [700, 450], [20, 20]]) {
    await client.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
    await client.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'right', buttons: 2, clickCount: 1 });
    await client.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'right', buttons: 0, clickCount: 1 });
    await sleep(1500);
    const open = await shell.evaluate(() => !!document.querySelector('[data-part="page-context-menu"]'));
    if (open) await shell.keyboard.press('Escape');
    await sleep(900);
    const left = await frozen();
    console.log(`right-click ${x},${y}: menu ${open ? 'opened' : 'did not open'}, frozen pictures left: ${left}`);
    if (left) bad++;
  }
  console.log(bad ? 'RESULT: FAIL' : 'RESULT: PASS');
  process.exit(bad ? 1 : 0);
})().catch((e) => { console.error('ERR', e.message); process.exit(3); });
