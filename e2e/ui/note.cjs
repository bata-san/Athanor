// Opening note.com must not take over every tab afterwards.
const { chromium } = require('playwright-core');
const { execFileSync } = require('node:child_process');
const path = require('node:path');
const grab = (name) => execFileSync('powershell', ['-NoProfile', '-File', '.briefs/shot.ps1', path.join(process.env.TEMP, name + '.png')]);
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
  const show = async (label) => { await sleep(4000); const snap = await invoke('get_snapshot'); console.log(label, JSON.stringify(snap.workspace.tabs.map((t) => [t.url.slice(0, 50), t.title.slice(0, 20)])), JSON.stringify(all().filter((p) => !/tauri\.localhost/.test(p.url())).map((p) => p.url().slice(0, 50)))); };
  await invoke('navigate', { tab, input: process.env.NOTE_URL || 'https://note.com/' });
  await show('note');
  grab('note1');
  await invoke('open_tab', { url: 'https://example.com/' }); await show('example'); grab('note2');
  await invoke('open_tab', { url: 'https://www.wikipedia.org/' }); await show('wiki');
  // Scroll and click around note the way a person would, then open other pages.
  const notePage = all().find((p) => p.url().startsWith('https://note.com'));
  const links = await notePage.$$eval('a[href*="/n/"]', (as) => as.slice(0, 3).map((a) => a.href));
  console.log('article links', links.length);
  if (links[0]) { await invoke('navigate', { tab, input: links[0] }); await show('article'); }
  await invoke('navigate', { tab, input: 'https://note.com/' }); await show('note again');
  await invoke('open_tab', { url: 'https://github.com/' }); await show('github');
  const snap = await invoke('get_snapshot');
  for (const t of snap.workspace.tabs) { await invoke('activate_tab', { tab: t.id }); await sleep(1200); const f = await invoke('capture_frame', { tab: t.id }).catch((e) => String(e)); console.log('frame', t.url.slice(0, 30), String(f).length, String(f).slice(0, 30)); }
  process.exit(0);
})().catch((e) => { console.error('ERR', e.message); process.exit(3); });
