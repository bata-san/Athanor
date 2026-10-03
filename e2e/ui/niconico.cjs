// "Sign in with Google" on Niconico must reach Google's sign-in page. (real-app, needs network, signs in nowhere)
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
  await invoke('navigate', { tab, input: 'https://account.nicovideo.jp/login' });
  await sleep(6000);
  const list = () => all().filter((p) => !/tauri\.localhost/.test(p.url())).map((p) => p.url().slice(0, 100));
  console.log('pages', JSON.stringify(list()));
  const page = all().find((p) => p.url().includes('nicovideo.jp'));
  console.log('text', (await page.evaluate(() => document.body.innerText)).replace(/\s+/g, ' ').slice(0, 400));
  console.log('frames', JSON.stringify(page.frames().map((f) => f.url().slice(0, 80))));
  console.log('clickables', JSON.stringify(await page.evaluate(() => Array.from(document.querySelectorAll('a,button,[role=button],img')).map((e) => (e.tagName + ':' + (e.alt || e.textContent || e.getAttribute('aria-label') || '').trim().slice(0, 25) + ':' + (e.getAttribute('href') || e.getAttribute('src') || '').slice(0, 50))).slice(0, 25))));
  const buttons = await page.$$eval('a,button', (els) => els.map((e) => (e.textContent || '').trim().slice(0, 30) + '|' + (e.getAttribute('href') || '').slice(0, 70) + '|' + (e.getAttribute('target') || '')).filter((t) => /google/i.test(t)));
  console.log('google buttons', JSON.stringify(buttons));
  const blocked = []; browser.contexts().forEach((c) => c.on('response', (r) => { if (r.status() === 403) blocked.push(r.url().slice(0, 110)); }));
  const consoleMsgs = []; page.on('console', (m) => { if (/error|block|popup/i.test(m.text())) consoleMsgs.push(m.text().slice(0, 150)); });
  const before = (await invoke('get_snapshot')).workspace.tabs.length;
  await page.evaluate(() => { const b = Array.from(document.querySelectorAll('button')).find((x) => (x.getAttribute('aria-label') || x.textContent).includes('Google')); const r = b.getBoundingClientRect(); window.__r = [r.x, r.y, r.width, r.height, getComputedStyle(b).pointerEvents, b.disabled]; b.click(); }).catch((e) => console.log('click failed', e.message.slice(0, 100)));
  console.log('rect', JSON.stringify(await page.evaluate(() => window.__r)));
  await sleep(8000);
  const snap = await invoke('get_snapshot');
  console.log('tabs', before, '->', snap.workspace.tabs.length, JSON.stringify(snap.workspace.tabs.map((t) => t.url.slice(0, 80))));
  console.log('pages', JSON.stringify(list()));
  console.log('403', JSON.stringify(blocked));
  console.log('console', JSON.stringify(consoleMsgs));
  const gp = all().find((p) => p.url().includes('accounts.google.com'));
  if (gp) console.log('ua', await gp.evaluate(() => navigator.userAgent + ' | webdriver=' + navigator.webdriver + ' | brands=' + JSON.stringify(navigator.userAgentData && navigator.userAgentData.brands) + ' | text=' + document.body.innerText.replace(/\s+/g, ' ').slice(0, 160)));
  const g = all().find((p) => p.url().includes('accounts.google.com'));
  console.log(g ? 'RESULT: reached Google: ' + g.url().slice(0, 80) : 'RESULT: FAIL did not reach Google');
  process.exit(g ? 0 : 1);
})().catch((e) => { console.error('ERR', e.message); process.exit(3); });
