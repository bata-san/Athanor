// A Cloudflare challenge page must be shown as the page, not replaced by Athanor's error page. (real-app, needs network)
const { chromium } = require('playwright-core');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  if (!process.env.ATHANOR_DATA_DIR) { console.log('Refusing to run without ATHANOR_DATA_DIR.'); process.exit(2); }
  const site = process.env.CF_SITE || 'https://nowsecure.nl/';
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
  const all = () => browser.contexts().flatMap((c) => c.pages());
  let shell;
  for (let i = 0; i < 40 && !shell; i++) { shell = all().find((p) => /^https?:\/\/(tauri\.localhost|localhost:1420)/.test(p.url())); if (!shell) await sleep(250); }
  const invoke = (cmd, args = {}) => shell.evaluate(([c, a]) => window.__TAURI_INTERNALS__.invoke(c, a), [cmd, args]);
  await invoke('set_settings', { patch: { onboarded: true } });
  const tab = (await invoke('get_snapshot')).workspace.activeTab;
  const watch = (pg) => { if (pg.__w) return; pg.__w = 1; pg.on('requestfailed', (r) => console.log('  FAILED', r.method(), r.resourceType(), r.url().slice(0, 110), r.failure()?.errorText)); pg.on('response', (r) => { if (r.request().isNavigationRequest()) console.log('  NAV', r.status(), r.request().method(), r.url().slice(0, 110)); }); };
  const ctxs = browser.contexts(); ctxs.forEach((c) => { c.pages().forEach(watch); c.on('page', watch); });
  await invoke('navigate', { tab, input: site });
  for (const t of [3, 8, 15]) {
    await sleep((t === 3 ? 3 : t === 8 ? 5 : 7) * 1000);
    const pages = all().filter((p) => !/tauri\.localhost|localhost:1420/.test(p.url()));
    const info = await Promise.all(pages.map(async (p) => ({ url: p.url().slice(0, 80), title: await p.title().catch(() => '?'), text: (await p.evaluate(() => document.body.innerText.slice(0, 160)).catch(() => '?')).replace(/\s+/g, ' ') })));
    console.log(`t+${t}s`, JSON.stringify(info));
    const snap = (await invoke('get_snapshot')); const rt = snap.runtime[tab]; console.log('   runtime:', JSON.stringify(rt && { loading: rt.loading, error: rt.error, failed: rt.failed }));
  }
  process.exit(0);
})().catch((e) => { console.error('ERR', e.message); process.exit(3); });
