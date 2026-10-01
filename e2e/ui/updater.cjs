// Real-app check of the updater: an older build finds the published release, downloads it and verifies the signature.
// (It does not install: that would run the installer.)
//
//   set ATHANOR_DATA_DIR=<empty temp dir>
//   set WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9222
//   <an older athanor.exe than the latest release>
//   node e2e/ui/updater.cjs
const { chromium } = require('playwright-core');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  if (!process.env.ATHANOR_DATA_DIR) { console.log('Refusing to run without ATHANOR_DATA_DIR.'); process.exit(2); }
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
  const all = () => browser.contexts().flatMap((c) => c.pages());
  let shell;
  for (let i = 0; i < 40 && !shell; i++) { shell = all().find((p) => /^https?:\/\/(tauri\.localhost|localhost:1420)/.test(p.url())); if (!shell) await sleep(250); }
  if (!shell) { console.log('RESULT: shell not found'); process.exit(2); }
  const invoke = (cmd, args = {}) => shell.evaluate(([c, a]) => window.__TAURI_INTERNALS__.invoke(c, a).then((v) => ({ ok: v }), (e) => ({ err: String(e) })), [cmd, args]);
  let failed = 0;
  const check = (name, ok, detail) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' - ' + detail : ''}`); if (!ok) failed++; };
  const snap = (await invoke('get_snapshot')).ok;
  console.log('running version', snap.version);
  const found = await invoke('check_update');
  console.log('check_update ->', JSON.stringify(found));
  check('a newer release is found', found.ok && found.ok.version && found.ok.version !== snap.version);
  if (found.ok) {
    const dl = await invoke('download_update');
    check('installer downloads and its signature verifies', dl.err === undefined, dl.err);
  }
  console.log(failed ? `RESULT: FAIL (${failed})` : 'RESULT: PASS');
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error('ERR', e.message); process.exit(3); });
