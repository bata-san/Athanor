// note.com: open an article by clicking it, go Back, then open other pages - nothing may stay stuck on note.
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
  const state = async (label) => { await sleep(3500); const s = await invoke('get_snapshot'); const rt = s.runtime[tab]; console.log(label, JSON.stringify(s.workspace.tabs.map((t) => t.url.slice(0, 45))), 'back', rt && rt.canGoBack, 'fwd', rt && rt.canGoForward, 'pages', JSON.stringify(all().filter((p) => !/tauri\.localhost/.test(p.url())).map((p) => p.url().slice(0, 45)))); };
  await invoke('navigate', { tab, input: 'https://note.com/' });
  await state('home');
  const home = all().find((p) => p.url().startsWith('https://note.com'));
  const links = await home.$$eval('a[href]', (as) => as.map((a) => [a.href, a.target]).filter(([h]) => /^https:\/\/note\.com\/[^/?#]+\/n\/n[0-9a-f]+/.test(h)).slice(0, 3));
  console.log('same-site article links', JSON.stringify(links));
  const href = links[0] && links[0][0];
  console.log('clicking', href);
  await home.click(`a[href="${href}"]`).catch((e) => console.log('click failed', e.message.slice(0, 80)));
  await state('article');
  await shell.click('[data-part="toolbar"] button[aria-label="Back"]');
  await state('after back');
  
  await invoke('open_tab', { url: 'https://example.com/' });
  await state('example opened');
  await invoke('open_tab', { url: 'https://www.wikipedia.org/' });
  await state('wiki opened');
  const pages = all().filter((p) => !/tauri\.localhost/.test(p.url())).map((p) => p.url());
  const stuck = await shell.evaluate(() => document.querySelectorAll('[data-part="frozen-page"]').length);
  const ok = pages.some((u) => u.startsWith('https://example.com')) && pages.some((u) => u.includes('wikipedia.org')) && stuck === 0;
  console.log(ok ? 'RESULT: PASS' : 'RESULT: FAIL (pages ' + pages.join(' ') + ', frozen pictures ' + stuck + ')');
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.error('ERR', e.message); process.exit(3); });
