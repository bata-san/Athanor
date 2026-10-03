// A login form that POSTs, sets a cookie and redirects must arrive as a POST and end logged in. (needs network for the host name)
const { chromium } = require('playwright-core');
const http = require('node:http');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  if (!process.env.ATHANOR_DATA_DIR) { console.log('Refusing to run without ATHANOR_DATA_DIR.'); process.exit(2); }
  const seen = [];
  const host = process.env.LOGIN_HOST || 'localtest.me';
  const server = http.createServer((req, res) => {
    let body = ''; req.on('data', (d) => (body += d)); req.on('end', () => {
      seen.push(`${req.method} ${req.url} ${body.slice(0, 40)}`);
      if (req.method === 'POST' && req.url === '/login') { res.writeHead(302, { location: '/home', 'set-cookie': 'sid=abc; Path=/; HttpOnly' }); res.end(); return; }
      res.setHeader('content-type', 'text/html; charset=utf-8');
      if (req.url === '/home') { res.end(`<!doctype html><title>Home</title><body>${(req.headers.cookie || '').includes('sid=abc') ? 'LOGGED IN' : 'LOGGED OUT'}`); return; }
      res.end('<!doctype html><title>Login</title><body><div class="ad-banner advert">x</div><form method=post action=/login><input name=user value=bob><button id=go>Log in</button></form>');
    });
  });
  await new Promise((r) => server.listen(8778, '127.0.0.1', r));
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
  const all = () => browser.contexts().flatMap((c) => c.pages());
  let shell;
  for (let i = 0; i < 40 && !shell; i++) { shell = all().find((p) => /^https?:\/\/(tauri\.localhost|localhost:1420)/.test(p.url())); if (!shell) await sleep(250); }
  const invoke = (cmd, args = {}) => shell.evaluate(([c, a]) => window.__TAURI_INTERNALS__.invoke(c, a), [cmd, args]);
  let failed = 0;
  const check = (n, ok, d) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? ' - ' + d : ''}`); if (!ok) failed++; };
  await invoke('set_settings', { patch: { onboarded: true } });
  const tab = (await invoke('get_snapshot')).workspace.activeTab;
  await invoke('navigate', { tab, input: `http://${host}:8778/` });
  await sleep(2500);
  const page = all().find((p) => p.url().includes(`${host}:8778`));
  await page.click('#go');
  await sleep(3500);
  const text = await all().find((p) => p.url().includes(`${host}:8778`)).evaluate(() => document.body.innerText).catch(() => '?');
  console.log('server saw:', JSON.stringify(seen));
  check('the form arrived as a POST', seen.some((s) => s.startsWith('POST /login') && s.includes('user=bob')));
  check('and ended on the home page, logged in', text.includes('LOGGED IN'), text);
  server.close();
  console.log(failed ? `RESULT: FAIL (${failed})` : 'RESULT: PASS');
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error('ERR', e.message); process.exit(3); });
