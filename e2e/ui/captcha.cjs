// Does a CAPTCHA widget render? (real-app, needs network)  set ATHANOR_DATA_DIR + remote debugging as in the other e2e scripts.
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
  await invoke('navigate', { tab, input: 'https://www.google.com/recaptcha/api2/demo' });
  await sleep(8000);
  const page = all().find((p) => p.url().includes('recaptcha/api2/demo'));
  if (!page) { console.log('RESULT: demo page not found', all().map((p) => p.url())); process.exit(1); }
  const frames = page.frames().map((f) => f.url());
  console.log('frames:', JSON.stringify(frames, null, 1));
  const box = await page.evaluate(() => { const f = document.querySelector('iframe[src*="recaptcha"]'); if (!f) return null; const r = f.getBoundingClientRect(); return { w: r.width, h: r.height, vis: getComputedStyle(f).visibility }; });
  console.log('widget iframe:', JSON.stringify(box));
  const src = await page.evaluate(() => document.querySelector('iframe[src*="recaptcha"]').src);
  console.log('src:', src);
  await page.screenshot({ path: require('node:path').join(process.env.TEMP, 'captcha.png') });
  const net = await page.evaluate(() => performance.getEntriesByType('resource').map((r) => r.name.slice(0, 90)).filter((n) => /recaptcha|gstatic/.test(n)));
  console.log('resources:', JSON.stringify(net));
  const anchor = page.frames().find((f) => f.url().includes('recaptcha/api2/anchor'));
  const checkbox = anchor ? await anchor.locator('#recaptcha-anchor').count() : 0;
  console.log('anchor frame:', anchor ? 'loaded' : 'missing', 'checkbox:', checkbox);
  console.log(box && box.w > 100 && checkbox ? 'RESULT: PASS' : 'RESULT: FAIL');
  process.exit(0);
})().catch((e) => { console.error('ERR', e.message); process.exit(3); });
