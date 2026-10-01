// Real-app check of the Human-Interface-Guidelines pass: per-tab hardware acceleration, Undo for closed tabs,
// menu rules, interface size, Reduce Motion and Increase Contrast.
//
//   set ATHANOR_DATA_DIR=<empty temp dir>
//   set WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9222
//   set ATHANOR_SOFTWARE_DEBUG_PORT=9223   (the software-rendering browser listens there)
//   athanor.exe
//   node e2e/ui/hig.cjs [outDir]
const { chromium } = require('playwright-core');
const http = require('node:http');
const path = require('node:path');
const { execSync } = require('node:child_process');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const out = process.argv[2] || process.env.TEMP || '.';

(async () => {
  if (!process.env.ATHANOR_DATA_DIR) { console.log('Refusing to run without ATHANOR_DATA_DIR.'); process.exit(2); }
  const server = http.createServer((req, res) => { res.setHeader('content-type', 'text/html; charset=utf-8'); res.end('<!doctype html><title>HIG</title><body style="font:16px sans-serif">Hello</body>'); });
  await new Promise((r) => server.listen(8771, '127.0.0.1', r));
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
  const second = { browser: null };
  const all = () => [...browser.contexts().flatMap((c) => c.pages()), ...(second.browser ? second.browser.contexts().flatMap((c) => c.pages()) : [])];
  let shell;
  for (let i = 0; i < 40 && !shell; i++) { shell = all().find((p) => /^https?:\/\/(tauri\.localhost|localhost:1420)/.test(p.url())); if (!shell) await sleep(250); }
  if (!shell) { console.log('RESULT: shell not found'); process.exit(2); }
  const invoke = (cmd, args = {}) => shell.evaluate(([c, a]) => window.__TAURI_INTERNALS__.invoke(c, a), [cmd, args]);
  let failed = 0;
  const check = (name, ok, detail) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' - ' + detail : ''}`); if (!ok) failed++; };
  const pageFor = async (pred, ms = 20000) => { for (let i = 0; i < ms / 250; i++) { const p = all().find((x) => pred(x.url())); if (p) return p; await sleep(250); } return null; };
  const gpuScript = "$ProgressPreference='SilentlyContinue'; 'GPUPROCS=' + @(Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'msedgewebview2.exe' -and $_.CommandLine -match 'disable-gpu' -and $_.CommandLine -notmatch '--type=' }).Count";
  const gpuFlags = () => { try { return execSync('powershell -NoProfile -EncodedCommand ' + Buffer.from(gpuScript, 'utf16le').toString('base64')).toString().trim(); } catch (e) { return 'err ' + e.message; } };
  const renderer = (page) => page.evaluate(() => { const gl = document.createElement('canvas').getContext('webgl'); if (!gl) return 'none'; const ext = gl.getExtension('WEBGL_debug_renderer_info'); return ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER); });

  await invoke('set_settings', { patch: { onboarded: true } });
  let snap = await invoke('get_snapshot');
  const tab = snap.workspace.activeTab;
  await invoke('navigate', { tab, input: 'http://127.0.0.1:8771/' });
  let page = await pageFor((u) => u.startsWith('http://127.0.0.1:8771'));
  await sleep(1200);

  // ---- menus follow Apple's rules
  await shell.click('[data-part="tab"]', { button: 'right' });
  await shell.waitForSelector('[role="menu"]', { timeout: 3000 });
  const menu = await shell.$eval('[role="menu"]', (el) => el.textContent);
  console.log('tab menu:', JSON.stringify(menu));
  check('the tab menu shows no keyboard shortcuts', !/Ctrl|Alt|Shift/.test(menu));
  check('unavailable items are hidden, not dimmed', !/Split with Current Tab/.test(menu) && !/Close Other Tabs/.test(menu) && !/Close Tabs Below/.test(menu));
  check('labels use title-style capitalisation', /Duplicate Tab/.test(menu) && /Copy Address/.test(menu) && /Close Tab/.test(menu));
  check('it offers the hardware acceleration switch', /Turn Off Hardware Acceleration/.test(menu));
  await shell.screenshot({ path: path.join(out, 'hig-menu.png') });
  await shell.keyboard.press('Escape');
  await sleep(300);

  // ---- hardware acceleration per tab
  const before = await renderer(page);
  console.log('renderer (GPU):', before);
  await page.evaluate(() => { document.cookie = 'athanor_test=carried; path=/'; });
  await invoke('set_software_rendering', { tab, software: true });
  await sleep(3500);
  for (let i = 0; i < 20 && !second.browser; i++) { try { second.browser = await chromium.connectOverCDP('http://127.0.0.1:9223'); } catch { await sleep(500); } }
  check('the software browser is reachable on its own debugging port', Boolean(second.browser));
  page = await pageFor((u) => u.startsWith('http://127.0.0.1:8771'));
  snap = await invoke('get_snapshot');
  check('the tab is marked as software-rendered', snap.workspace.tabs.find((t) => t.id === tab)?.softwareRendering === true);
  const after = await renderer(page);
  console.log('renderer (software):', after);
  check('its renderer is not the GPU one', after !== before && /swiftshader|basic render|software|llvmpipe|warp/i.test(after), `${before} -> ${after}`);
  check('sign-ins come along (cookies carried over)', /athanor_test=carried/.test(await page.evaluate(() => document.cookie)));
  check('the sidebar row shows the switch is off', (await shell.$('[data-part="tab"] [aria-label="Hardware acceleration is off"]')) !== null);
  const flags = gpuFlags();
  const gpuProcs = Number((String(flags).match(/GPUPROCS=(\d+)/) || [0, 0])[1]);
  check('a second browser process runs with the GPU disabled', gpuProcs >= 1, gpuProcs + ' process(es)');
  await invoke('set_software_rendering', { tab, software: false });
  await sleep(3500);
  page = await pageFor((u) => u.startsWith('http://127.0.0.1:8771'));
  check('turning it back on restores the GPU renderer', (await renderer(page)) === before);
  check('and the cookies come back too', /athanor_test=carried/.test(await page.evaluate(() => document.cookie)));

  // ---- Undo after closing a tab
  const secondTab = await invoke('open_tab', { url: 'http://127.0.0.1:8771/?second' });
  await sleep(1500);
  const n = (await invoke('get_snapshot')).workspace.tabs.length;
  await invoke('close_tab', { tab: secondTab });
  await shell.waitForSelector('[data-sonner-toast]', { timeout: 4000 }).catch(() => {});
  const toastText = await shell.$$eval('[data-sonner-toast]', (els) => els.map((e) => e.textContent).join(' | ')).catch(() => '');
  check('closing a tab offers Undo', /Closed/.test(toastText) && /Undo/.test(toastText), toastText);
  await shell.click('[data-sonner-toast] button:has-text("Undo")').catch(() => {});
  await sleep(1500);
  const reopened = (await invoke('get_snapshot')).workspace.tabs.filter((t) => t.url.includes('?second')).length;
  const afterUndo = (await invoke('get_snapshot')).workspace.tabs;
  check('Undo brings the page back', reopened === 1 && afterUndo.length === n, `${reopened} reopened, ${afterUndo.length} tabs (was ${n}): ` + afterUndo.map((t) => t.url).join(' | '));

  // ---- Interface size
  const base = await shell.evaluate(() => ({ font: parseFloat(getComputedStyle(document.documentElement).fontSize), side: document.querySelector('[data-part="sidebar"]').getBoundingClientRect().width, bar: document.querySelector('[data-part="toolbar"]').getBoundingClientRect().height }));
  await invoke('set_settings', { patch: { uiScale: 150 } });
  await sleep(600);
  const big = await shell.evaluate(() => ({ font: parseFloat(getComputedStyle(document.documentElement).fontSize), side: document.querySelector('[data-part="sidebar"]').getBoundingClientRect().width, bar: document.querySelector('[data-part="toolbar"]').getBoundingClientRect().height, content: document.querySelector('[data-part="content"]').getBoundingClientRect().x }));
  console.log('interface size 100% -> 150%:', JSON.stringify(base), JSON.stringify(big));
  check('150% scales text, sidebar and toolbar together', Math.abs(big.font / base.font - 1.5) < 0.02 && Math.abs(big.side / base.side - 1.5) < 0.03 && Math.abs(big.bar / base.bar - 1.5) < 0.03);
  check('the page area follows (it starts at the sidebar edge)', Math.abs(big.content - big.side) < 12, `${big.content} vs ${big.side}`);
  await shell.screenshot({ path: path.join(out, 'hig-150.png') });
  await invoke('set_settings', { patch: { uiScale: 100 } });
  await sleep(500);

  // ---- Reduce Motion and Increase Contrast
  await invoke('set_settings', { patch: { reduceMotion: true, highContrast: true } });
  await sleep(400);
  const flagsAttr = await shell.evaluate(() => ({ motion: document.documentElement.dataset.reduceMotion, contrast: document.documentElement.dataset.contrast, muted: getComputedStyle(document.documentElement).getPropertyValue('--muted-foreground').trim(), duration: getComputedStyle(document.querySelector('[data-part="sidebar"]')).transitionDuration }));
  console.log('flags:', JSON.stringify(flagsAttr));
  check('Reduce Motion stops transitions', flagsAttr.motion === 'true' && /^(0s|1e-0[1-9]s|0\.0+1m?s)/.test(flagsAttr.duration.split(',')[0].trim()), flagsAttr.duration);
  check('Increase Contrast darkens secondary text', flagsAttr.contrast === 'high' && /#3f3f46/i.test(flagsAttr.muted), flagsAttr.muted);
  await invoke('set_settings', { patch: { reduceMotion: false, highContrast: false } });

  server.close();
  console.log(failed ? `RESULT: FAIL (${failed})` : 'RESULT: PASS');
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error('ERR', e.message); process.exit(3); });
