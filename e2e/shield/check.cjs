// Drives the running Athanor over CDP (shell -> navigate command) and inspects the test tab.
const { chromium } = require('playwright-core');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
  const all = () => browser.contexts().flatMap((c) => c.pages());
  const shell = all().find((p) => p.url().startsWith('http://tauri.localhost'));
  if (!shell) { console.log('RESULT: shell not found'); process.exit(2); }
  await shell.evaluate(() => window.__TAURI_INTERNALS__.invoke('set_settings', { patch: { onboarded: true } })); // skip the first-run welcome overlay
  const snap = await shell.evaluate(() => window.__TAURI_INTERNALS__.invoke('get_snapshot'));
  const tab = snap.workspace.activeTab;
  await shell.evaluate(([t]) => window.__TAURI_INTERNALS__.invoke('navigate', { tab: t, input: 'http://shield-test.example.com:8099/' }), [tab]);
  let page;
  for (let i = 0; i < 40 && !page; i++) { await sleep(250); page = all().find((p) => p.url().startsWith('http://shield-test.example.com:8099')); }
  console.log('pages:', all().map((p) => p.url()));
  if (!page) { console.log('RESULT: test page not found'); process.exit(2); }
  await sleep(3500);
  const r = await page.evaluate(() => {
    const vis = (id) => {
      const e = document.getElementById(id);
      if (!e) return 'missing';
      const cs = getComputedStyle(e);
      return cs.display === 'none' || cs.visibility === 'hidden' || e.offsetHeight === 0 ? 'hidden' : 'visible';
    };
    return {
      adBanner: vis('t-ad-banner'), adsbygoogle: vis('t-adsbygoogle'), idRule: vis('AdSkyscraper'), plain: vis('t-plain'), lateAd: vis('t-late-ad'),
      scripts: window.__results.scripts, localLoaded: !!window.__localLoaded,
      styleTags: [...document.querySelectorAll('style')].map((s) => s.textContent.length),
    };
  });
  console.log(JSON.stringify(r, null, 1));
  const after = await shell.evaluate(() => window.__TAURI_INTERNALS__.invoke('get_snapshot'));
  console.log('blocked on tab:', after.runtime[tab] && after.runtime[tab].blocked, 'total:', after.blockedTotal);
  const ok = r.adBanner === 'hidden' && r.adsbygoogle === 'hidden' && r.idRule === 'hidden' && r.plain === 'visible' && r.lateAd === 'hidden'
    && r.scripts.gpt === 'blocked' && r.scripts.analytics === 'blocked' && r.scripts.local === 'loaded';
  console.log(ok ? 'RESULT: PASS' : 'RESULT: FAIL');
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.error('ERR', e.message); process.exit(3); });
