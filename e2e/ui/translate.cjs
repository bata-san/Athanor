// "Translate page" keeps the page's structure and scripts intact, and can put the original back. (real-app, needs network)
const { chromium } = require('playwright-core');
const http = require('node:http');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const PAGE = `<!doctype html><title>Welcome to the shop</title><body>
<h1 id=h>Welcome to the shop</h1>
<p id=p>We sell <b id=b>fresh bread</b> and <a id=a href="#x">tasty cakes</a> every morning.</p>
<button id=btn title="Add this item to your basket">Add to basket</button>
<pre id=code>const keepMe = "do not translate";</pre>
<input id=inp placeholder="Search for products">
<script>window.clicks=0;document.getElementById('btn').addEventListener('click',()=>{window.clicks++});window.sig=Array.from(document.querySelectorAll('*')).map(e=>e.tagName+'#'+e.id).join();</script>`;
(async () => {
  if (!process.env.ATHANOR_DATA_DIR) { console.log('Refusing to run without ATHANOR_DATA_DIR.'); process.exit(2); }
  const server = http.createServer((req, res) => { res.setHeader('content-type', 'text/html; charset=utf-8'); res.end(PAGE); });
  await new Promise((r) => server.listen(8776, '127.0.0.1', r));
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
  const all = () => browser.contexts().flatMap((c) => c.pages());
  let shell;
  for (let i = 0; i < 40 && !shell; i++) { shell = all().find((p) => /^https?:\/\/(tauri\.localhost|localhost:1420)/.test(p.url())); if (!shell) await sleep(250); }
  const invoke = (cmd, args = {}) => shell.evaluate(([c, a]) => window.__TAURI_INTERNALS__.invoke(c, a), [cmd, args]);
  let failed = 0;
  const check = (name, ok, detail) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' - ' + detail : ''}`); if (!ok) failed++; };
  await invoke('set_settings', { patch: { onboarded: true } });
  const tab = (await invoke('get_snapshot')).workspace.activeTab;
  await invoke('navigate', { tab, input: 'http://127.0.0.1:8776/' });
  await sleep(1500);
  const page = all().find((p) => p.url().startsWith('http://127.0.0.1:8776'));
  const read = () => page.evaluate(() => ({ h: document.getElementById('h').textContent, p: document.getElementById('p').textContent, b: document.getElementById('b').textContent, a: document.getElementById('a').textContent, btn: document.getElementById('btn').textContent, title: document.getElementById('btn').title, code: document.getElementById('code').textContent, ph: document.getElementById('inp').placeholder, doc: document.title, sig: Array.from(document.querySelectorAll('*')).map((e) => e.tagName + '#' + e.id).join(), orig: window.sig }));
  const before = await read();
  await invoke('translate_page', { tab, lang: 'ja' });
  let after;
  for (let i = 0; i < 40; i++) { await sleep(500); after = await read(); if (after.h !== before.h) break; }
  console.log(JSON.stringify({ h: after.h, p: after.p, b: after.b, a: after.a, btn: after.btn, title: after.title, ph: after.ph, doc: after.doc }));
  check('the heading is translated', /[\u3040-\u30ff\u4e00-\u9fff]/.test(after.h));
  check('a sentence split by <b> and <a> stays one sentence', /[\u3040-\u30ff]/.test(after.p) && after.b !== before.b && after.a !== before.a);
  check('button label, tooltip, placeholder and tab title are translated', [after.btn, after.title, after.ph, after.doc].every((t) => /[\u3040-\u30ff\u4e00-\u9fff]/.test(t)));
  check('code is left alone', after.code === before.code);
  check('the tree is exactly the same', after.sig === before.sig && after.sig === after.orig);
  await page.click('#btn');
  check('the page script still works', (await page.evaluate(() => window.clicks)) === 1);
  // Through the real menu: right-click, press T.
  const client = await page.context().newCDPSession(page);
  const at = { x: 400, y: 300 };
  await client.send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...at });
  await client.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...at, button: 'right', buttons: 2, clickCount: 1 });
  await client.send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...at, button: 'right', buttons: 0, clickCount: 1 });
  await shell.waitForSelector('[data-part="page-context-menu"]', { timeout: 4000 });
  check('the menu offers Show original while translated', (await shell.textContent('[data-part="page-context-menu"] [data-command="athanor-translate"]')).includes('Show original'));
  await shell.keyboard.press('t');
  await sleep(800);
  const restored = await read();
  check('Show original puts everything back', restored.h === before.h && restored.p === before.p && restored.btn === before.btn && restored.title === before.title && restored.ph === before.ph && restored.doc === before.doc);
  server.close();
  console.log(failed ? `RESULT: FAIL (${failed})` : 'RESULT: PASS');
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error('ERR', e.message); process.exit(3); });
