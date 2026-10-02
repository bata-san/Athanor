// A GitHub release asset (redirects to release-assets.githubusercontent.com) downloads instead of showing an error page.
const { chromium } = require('playwright-core');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  if (!process.env.ATHANOR_DATA_DIR) { console.log('Refusing to run without ATHANOR_DATA_DIR.'); process.exit(2); }
  const url = process.env.DL_URL;
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
  const all = () => browser.contexts().flatMap((c) => c.pages());
  let shell;
  for (let i = 0; i < 40 && !shell; i++) { shell = all().find((p) => /^https?:\/\/(tauri\.localhost|localhost:1420)/.test(p.url())); if (!shell) await sleep(250); }
  const invoke = (cmd, args = {}) => shell.evaluate(([c, a]) => window.__TAURI_INTERNALS__.invoke(c, a), [cmd, args]);
  await invoke('set_settings', { patch: Object.assign({ onboarded: true }, JSON.parse(process.env.PATCH || '{}')) });
  const tab = (await invoke('get_snapshot')).workspace.activeTab;
  await invoke('navigate', { tab, input: url });
  for (const t of [3, 6, 10, 15]) {
    await sleep(t === 3 ? 3000 : 4000);
    const s = await invoke('get_snapshot');
    const rt = s.runtime[tab];
    const pages = all().filter((p) => !/tauri\.localhost/.test(p.url()));
    const text = await Promise.all(pages.map((p) => p.evaluate(() => document.body && document.body.innerText.slice(0, 90).replace(/\s+/g, ' ')).catch(() => '?')));
    console.log(`t+${t}`, JSON.stringify({ failed: rt && rt.failed, loading: rt && rt.loading, downloads: (s.downloads || []).map((d) => [d.state, d.received, d.total, d.path && d.path.slice(-30)]), pages: pages.map((p) => p.url().slice(0, 60)), text }));
  }
  process.exit(0);
})().catch((e) => { console.error('ERR', e.message); process.exit(3); });
