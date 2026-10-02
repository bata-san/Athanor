// Ordinary sites must load, not end in "The connection was interrupted". (real-app, needs network)
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
  const sites = (process.env.SITES || 'https://www.youtube.com/,https://github.com/,https://www.wikipedia.org/,https://x.com/,https://www.amazon.co.jp/,https://news.ycombinator.com/,https://www.reddit.com/,https://www.google.com/search?q=athanor,https://zenn.dev/,https://qiita.com/').split(',');
  let bad = 0;
  for (const url of sites) {
    await invoke('navigate', { tab, input: url });
    await sleep(5000);
    const rt = (await invoke('get_snapshot')).runtime[tab];
    const t = (await invoke('get_snapshot')).workspace.tabs.find((x) => x.id === tab);
    console.log(rt && rt.failed ? 'FAIL' : 'ok  ', url, '->', t.url.slice(0, 50), '|', (t.title || '').slice(0, 30));
    if (rt && rt.failed) bad++;
  }
  console.log(bad ? `RESULT: FAIL (${bad})` : 'RESULT: PASS');
  process.exit(bad ? 1 : 0);
})().catch((e) => { console.error('ERR', e.message); process.exit(3); });
