// Raw-CDP variant for Android WebView (Playwright's connectOverCDP needs browser-level APIs WebView lacks).
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const base = 'http://127.0.0.1:9223';
const targets = async () => (await (await fetch(base + '/json/list')).json());
function evalIn(target, expression) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(target.webSocketDebuggerUrl);
    const t = setTimeout(() => { ws.close(); reject(new Error('cdp timeout')); }, 15000);
    ws.onopen = () => ws.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { expression, awaitPromise: true, returnByValue: true } }));
    ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id === 1) { clearTimeout(t); ws.close(); d.result.exceptionDetails ? reject(new Error(JSON.stringify(d.result.exceptionDetails.exception))) : resolve(d.result.result.value); } };
    ws.onerror = (e) => reject(new Error('ws error'));
  });
}
(async () => {
  const host = 'http://shield-test.example.com:8099/';
  let shell = (await targets()).find((t) => t.url.startsWith('http://tauri.localhost'));
  // First run has no downloaded lists yet; wait until the real rules are compiled in.
  for (let i = 0; i < 90; i++) {
    const st = await evalIn(shell, "window.__TAURI_INTERNALS__.invoke('get_adblock_status')");
    const easylist = st.lists.find((l) => l.id === 'easylist');
    if (easylist && easylist.ruleCount > 1000 && !st.updating) break;
    await sleep(1000);
  }
  const snap = await evalIn(shell, "window.__TAURI_INTERNALS__.invoke('get_snapshot')");
  const tab = snap.workspace.activeTab;
  await evalIn(shell, `window.__TAURI_INTERNALS__.invoke('navigate', { tab: '${tab}', input: '${host}' })`);
  let page; for (let i = 0; i < 40 && !page; i++) { await sleep(300); page = (await targets()).find((t) => t.url.startsWith(host)); }
  console.log('targets:', (await targets()).map((t) => t.url));
  if (!page) { console.log('RESULT: test page not found'); process.exit(2); }
  await sleep(4500);
  const r = await evalIn(page, `(() => { const vis = (id) => { const e = document.getElementById(id); if (!e) return 'missing'; const cs = getComputedStyle(e); return cs.display === 'none' || cs.visibility === 'hidden' || e.offsetHeight === 0 ? 'hidden' : 'visible'; };
    return { adBanner: vis('t-ad-banner'), articleAd: vis('t-adsbygoogle'), idRule: vis('AdSkyscraper'), plain: vis('t-plain'), lateAd: vis('t-late-ad'), scripts: window.__results && window.__results.scripts, cosmeticStyle: !!document.querySelector('style[data-athanor-cosmetics]') }; })()`);
  console.log(JSON.stringify(r, null, 1));
  const ok = r.adBanner === 'hidden' && r.articleAd === 'hidden' && r.idRule === 'hidden' && r.plain === 'visible' && r.lateAd === 'hidden'
    && r.scripts.gpt === 'blocked' && r.scripts.analytics === 'blocked' && r.scripts.local === 'loaded';
  console.log(ok ? 'RESULT: PASS' : 'RESULT: FAIL');
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.error('ERR', e.message); process.exit(3); });
