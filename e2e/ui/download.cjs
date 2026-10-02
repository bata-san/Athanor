// A link that turns into a download saves the file and leaves the page alone: no error page, no second copy.
const { chromium } = require('playwright-core');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  if (!process.env.ATHANOR_DATA_DIR) { console.log('Refusing to run without ATHANOR_DATA_DIR.'); process.exit(2); }
  const name = `athanor-e2e-${Date.now()}.bin`;
  const server = http.createServer((req, res) => {
    if (req.url === '/file') { res.writeHead(200, { 'content-type': 'application/octet-stream', 'content-disposition': `attachment; filename="${name}"` }); res.end(Buffer.alloc(200000, 7)); return; }
    res.setHeader('content-type', 'text/html'); res.end('<!doctype html><title>Home</title><body><a id=dl href="/file">Download</a>');
  });
  await new Promise((r) => server.listen(8777, '127.0.0.1', r));
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
  const all = () => browser.contexts().flatMap((c) => c.pages());
  let shell;
  for (let i = 0; i < 40 && !shell; i++) { shell = all().find((p) => /^https?:\/\/(tauri\.localhost|localhost:1420)/.test(p.url())); if (!shell) await sleep(250); }
  const invoke = (cmd, args = {}) => shell.evaluate(([c, a]) => window.__TAURI_INTERNALS__.invoke(c, a), [cmd, args]);
  let failed = 0;
  const check = (n, ok, d) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? ' - ' + d : ''}`); if (!ok) failed++; };
  await invoke('set_settings', { patch: { onboarded: true } });
  const tab = (await invoke('get_snapshot')).workspace.activeTab;
  await invoke('navigate', { tab, input: 'http://127.0.0.1:8777/' });
  await sleep(1500);
  const page = all().find((p) => p.url().startsWith('http://127.0.0.1:8777'));
  await page.click('#dl');
  await sleep(4000);
  const dir = path.join(process.env.USERPROFILE, 'Downloads');
  const saved = fs.readdirSync(dir).filter((f) => f.startsWith(name.replace('.bin', '')));
  const rt = (await invoke('get_snapshot')).runtime[tab];
  check('the file was saved once', saved.length === 1, saved.join(','));
  check('no error page', !(rt && rt.failed));
  for (const f of saved) fs.unlinkSync(path.join(dir, f));
  server.close();
  console.log(failed ? `RESULT: FAIL (${failed})` : 'RESULT: PASS');
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error('ERR', e.message); process.exit(3); });
