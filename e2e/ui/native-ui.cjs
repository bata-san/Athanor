// Real-app check that nothing Edge-looking is left: error page, identity, JavaScript dialogs, permission prompts,
// downloads, link preview.
//
//   set ATHANOR_DATA_DIR=<empty temp dir>
//   set WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9222
//   athanor.exe
//   node e2e/ui/native-ui.cjs [outDir]
const { chromium } = require('playwright-core');
const http = require('node:http');
const path = require('node:path');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const out = process.argv[2] || process.env.TEMP || '.';


// Raw DevTools sessions: Playwright's Page-domain session would answer JavaScript dialogs itself.
async function targets() { return (await fetch('http://127.0.0.1:9222/json')).json(); }
function rawSession(wsUrl) {
  return new Promise((resolve) => {
    const ws = new WebSocket(wsUrl); let id = 0; const pending = new Map();
    ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); } };
    ws.onopen = () => resolve({
      eval: (expression) => new Promise((r) => { const i = ++id; pending.set(i, (d) => r(d.result && d.result.result ? d.result.result.value : undefined)); ws.send(JSON.stringify({ id: i, method: 'Runtime.evaluate', params: { expression, awaitPromise: true, returnByValue: true } })); }),
      close: () => ws.close(),
    });
  });
}

(async () => {
  if (!process.env.ATHANOR_DATA_DIR) { console.log('Refusing to run without ATHANOR_DATA_DIR.'); process.exit(2); }
  const server = http.createServer((req, res) => {
    if (req.url.startsWith('/file.bin')) { res.setHeader('content-type', 'application/octet-stream'); res.setHeader('content-disposition', 'attachment; filename="athanor-test.bin"'); res.end(Buffer.alloc(300000, 7)); return; }
    res.setHeader('content-type', 'text/html; charset=utf-8');
    res.end('<!doctype html><title>Native UI</title><body style="font:16px sans-serif"><p><a id="link" href="/somewhere/else?x=1" style="display:inline-block;padding:30px;font-size:24px">A link to hover</a></p></body>');
  });
  await new Promise((r) => server.listen(8766, '127.0.0.1', r));
  let failed = 0;
  const check = (name, ok, detail) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' - ' + detail : ''}`); if (!ok) failed++; };
  // ---- JavaScript dialogs (the page keeps waiting until we answer)
  {
    const shellTarget = (await targets()).find((t) => /tauri\.localhost/.test(t.url));
    const rawShell = await rawSession(shellTarget.webSocketDebuggerUrl);
    const first = JSON.parse(await rawShell.eval(`window.__TAURI_INTERNALS__.invoke('set_settings', { patch: { onboarded: true } }).then(() => window.__TAURI_INTERNALS__.invoke('get_snapshot')).then((s) => JSON.stringify({ tab: s.workspace.activeTab }))`));
    await rawShell.eval(`window.__TAURI_INTERNALS__.invoke('navigate', { tab: ${JSON.stringify(first.tab)}, input: 'http://127.0.0.1:8766/' }).then(() => 1)`);
    await sleep(2500);
    const pageTarget = (await targets()).find((t) => t.url.startsWith('http://127.0.0.1:8766'));
    const rawPage = await rawSession(pageTarget.webSocketDebuggerUrl);
    await rawPage.eval(`window.__answer = 'pending'; setTimeout(() => { window.__answer = String(window.confirm('Delete everything?')); }, 0); 1`);
    await sleep(1200);
    const dialogText = await rawShell.eval(`(document.querySelector('[data-part="script-dialog"]') || {}).textContent || ''`);
    check('confirm() opens our dialog', dialogText !== '');
    check('it shows the message and the site', /Delete everything\?/.test(dialogText) && /127\.0\.0\.1:8766/.test(dialogText), dialogText.slice(0, 90));
    await rawShell.eval(`document.querySelector('[data-part="script-dialog"] button[type="submit"]').click(); 1`);
    await sleep(600);
    check('OK returns true to the page', (await rawPage.eval('window.__answer')) === 'true');
    await rawPage.eval(`window.__answer = 'pending'; setTimeout(() => { window.__answer = String(window.confirm('Again?')); }, 0); 1`);
    await sleep(900);
    await rawShell.eval(`Array.from(document.querySelectorAll('[data-part="script-dialog"] button')).find((b) => /Cancel/.test(b.textContent)).click(); 1`);
    await sleep(600);
    check('Cancel returns false to the page', (await rawPage.eval('window.__answer')) === 'false');
    await rawPage.eval(`window.__alerted = 'pending'; setTimeout(() => { window.alert('Heads up'); window.__alerted = 'done'; }, 0); 1`);
    await sleep(900);
    await rawShell.eval(`document.querySelector('[data-part="script-dialog"] button[type="submit"]').click(); 1`);
    await sleep(500);
    check('alert() blocks until OK', (await rawPage.eval('window.__alerted')) === 'done');
    // ---- downloads (Playwright would take them over, so this runs on the raw session too)
    await rawShell.eval(`window.__TAURI_INTERNALS__.invoke('navigate', { tab: ${JSON.stringify(first.tab)}, input: 'http://127.0.0.1:8766/file.bin' }).then(() => 1)`);
    let toastText = '';
    for (let i = 0; i < 40; i++) { toastText = await rawShell.eval(`Array.from(document.querySelectorAll('[data-sonner-toast]')).map((el) => el.textContent).join(' | ')`); if (/Downloaded/.test(toastText)) break; await sleep(250); }
    check('a download shows our toast with "Show in folder"', /Downloaded athanor-test\.bin/.test(toastText) && /Show in folder/.test(toastText), toastText);
    const after = JSON.parse(await rawShell.eval(`window.__TAURI_INTERNALS__.invoke('get_snapshot').then((s) => JSON.stringify(s.workspace.tabs.find((t) => t.id === ${JSON.stringify(first.tab)})))`));
    check('the tab stays on its page after a download', !after.url.endsWith('file.bin'), after.url);
    // ---- permission prompt (raw session: Playwright answers permission requests itself)
    // A fresh origin per run: the engine remembers answers per origin in its profile.
    const permHost = 'perm-' + Date.now() + '.localhost';
    await rawShell.eval(`window.__TAURI_INTERNALS__.invoke('navigate', { tab: ${JSON.stringify(first.tab)}, input: 'http://${permHost}:8766/?perm' }).then(() => 1)`);
    await sleep(2200);
    const permTarget = (await targets()).find((t) => t.url.includes('.localhost:8766/?perm'));
    const permPage = await rawSession(permTarget.webSocketDebuggerUrl);
    const ask = `window.__geo = ''; navigator.geolocation.getCurrentPosition(() => { window.__geo = 'allowed'; }, (e) => { window.__geo = 'denied:' + e.code; }); 1`;
    await permPage.eval(ask);
    let askText = '';
    for (let i = 0; i < 24 && !askText; i++) { await sleep(250); askText = await rawShell.eval(`(document.querySelector('[data-part="permission-dialog"]') || {}).textContent || ''`); }
    check('a permission request opens our dialog', askText !== '');
    check('it names the site and what it wants', /perm-\d+\.localhost:8766 wants to know your location/.test(askText), askText.slice(0, 80));
    await rawShell.eval(`Array.from(document.querySelectorAll('[data-part="permission-dialog"] button')).find((b) => /Block/.test(b.textContent)).click(); 1`);
    await sleep(900);
    check('Block is passed to the page', /denied/.test(await permPage.eval('window.__geo')));
    await permPage.eval(ask);
    await sleep(1500);
    check('the answer is remembered for the site (no second prompt)', (await rawShell.eval(`document.querySelector('[data-part="permission-dialog"]') ? 'open' : 'none'`)) === 'none' && /denied/.test(await permPage.eval('window.__geo')));
    await rawShell.eval(`window.__TAURI_INTERNALS__.invoke('reset_site_permissions').then(() => 1)`);
    permPage.close();
    rawShell.close(); rawPage.close();
  }
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
  const all = () => browser.contexts().flatMap((c) => c.pages());
  let shell;
  for (let i = 0; i < 40 && !shell; i++) { shell = all().find((p) => /^https?:\/\/(tauri\.localhost|localhost:1420)/.test(p.url())); if (!shell) await sleep(250); }
  if (!shell) { console.log('RESULT: shell not found'); process.exit(2); }
  const invoke = (cmd, args = {}) => shell.evaluate(([c, a]) => window.__TAURI_INTERNALS__.invoke(c, a), [cmd, args]);
  const pageFor = async (pred, ms = 20000) => { for (let i = 0; i < ms / 250; i++) { const p = all().find((x) => pred(x.url())); if (p) return p; await sleep(250); } return null; };

  await invoke('set_settings', { patch: { onboarded: true } });
  const tab = (await invoke('get_snapshot')).workspace.activeTab;

  // ---- identity
  await invoke('navigate', { tab, input: 'http://127.0.0.1:8766/' });
  let page = await pageFor((u) => u.startsWith('http://127.0.0.1:8766'));
  await sleep(1200);
  const ident = await page.evaluate(() => ({ ua: navigator.userAgent, brands: (navigator.userAgentData?.brands ?? []).map((b) => b.brand) }));
  console.log('identity:', JSON.stringify(ident));
  check('the user agent does not say Edge', !/Edg/.test(ident.ua));
  check('client-hint brands are Chromium + Athanor', ident.brands.includes('Athanor') && !ident.brands.some((b) => /Edge/i.test(b)));

  // ---- link preview in the address pill
  await page.hover('#link');
  await sleep(700);
  const hover = await shell.$eval('[data-part="hover-link"]', (el) => el.textContent).catch(() => null);
  check('hovering a link shows it in the address pill', hover !== null && hover.includes('/somewhere/else'), String(hover));
  await page.mouse.move(2, 400);

  // ---- error page
  await invoke('navigate', { tab, input: 'http://127.0.0.1:1/never' });
  let errPage = null;
  for (let i = 0; i < 60 && !errPage; i++) { for (const p of all()) { if (p.url().startsWith('data:') || p.url() === 'about:blank') { const t = await p.title().catch(() => ''); if (/reach|find|open/i.test(t)) errPage = p; } } if (!errPage) await sleep(250); }
  check('a failed page shows Athanor’s error page', errPage !== null);
  if (errPage) {
    const body = await errPage.evaluate(() => document.body.innerText);
    console.log('error page text:', JSON.stringify(body.slice(0, 160)));
    check('it explains the problem and offers Try again', /Try again/.test(body) && /127\.0\.0\.1/.test(body));
    check('nothing in it mentions Edge or Microsoft', !/edge|microsoft/i.test(body));
  }
  const failedTab = (await invoke('get_snapshot')).workspace.tabs.find((t) => t.id === tab);
  check('the tab keeps the address that failed', failedTab.url === 'http://127.0.0.1:1/never', failedTab.url);
  await sleep(300);
  await shell.screenshot({ path: path.join(out, 'error-shell.png') });

  server.close();
  console.log(failed ? `RESULT: FAIL (${failed})` : 'RESULT: PASS');
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error('ERR', e.message); process.exit(3); });
