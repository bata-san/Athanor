// Real-app check of the built-in YouTube handling and the DRM switch (needs network).
//
//   set ATHANOR_DATA_DIR=<empty temp dir>
//   set WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9222
//   athanor.exe
//   node e2e/ui/youtube-drm.cjs
const { chromium } = require('playwright-core');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  if (!process.env.ATHANOR_DATA_DIR) { console.log('Refusing to run without ATHANOR_DATA_DIR.'); process.exit(2); }
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
  const all = () => browser.contexts().flatMap((c) => c.pages());
  let shell;
  for (let i = 0; i < 40 && !shell; i++) { shell = all().find((p) => /^https?:\/\/(tauri\.localhost|localhost:1420)/.test(p.url())); if (!shell) await sleep(250); }
  if (!shell) { console.log('RESULT: shell not found'); process.exit(2); }
  const invoke = (cmd, args = {}) => shell.evaluate(([c, a]) => window.__TAURI_INTERNALS__.invoke(c, a), [cmd, args]);
  let failed = 0;
  const check = (name, ok, detail) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' - ' + detail : ''}`); if (!ok) failed++; };
  const pageFor = async (prefix, ms = 20000) => { for (let i = 0; i < ms / 250; i++) { const p = all().find((x) => x.url().startsWith(prefix)); if (p) return p; await sleep(250); } return null; };

  await invoke('set_settings', { patch: { onboarded: true } });
  let snap = await invoke('get_snapshot');
  const tab = snap.workspace.activeTab;
  check('Google is the default search engine and start page', snap.settings.searchEngine.startsWith('https://www.google.com/search') && snap.settings.homepage === 'https://www.google.com/');

  // lists + engine resources (needed for the engine-side scriptlets)
  await invoke('update_adblock_lists');
  for (let i = 0; i < 120; i++) { const st = await invoke('get_adblock_status'); if (!st.updating) break; await sleep(1000); }

  // ---- YouTube
  await invoke('navigate', { tab, input: 'https://www.youtube.com/watch?v=jNQXAC9IVRw' });
  const yt = await pageFor('https://www.youtube.com/watch');
  if (!yt) { check('YouTube page opened', false); } else {
    await sleep(6000);
    const state = await yt.evaluate(() => ({
      hook: globalThis.__athanorYtAds === 1,
      style: !!document.getElementById('athanor-yt-style'),
      adPlacements: globalThis.ytInitialPlayerResponse && 'adPlacements' in globalThis.ytInitialPlayerResponse,
      playerAds: globalThis.ytInitialPlayerResponse && 'playerAds' in globalThis.ytInitialPlayerResponse,
      hasResponse: !!globalThis.ytInitialPlayerResponse,
      jsonParsePatched: !/\[native code\]/.test(Function.prototype.toString.call(JSON.parse)),
      adShowing: !!document.querySelector('.html5-video-player.ad-showing'),
    }));
    console.log('youtube state:', JSON.stringify(state));
    check('youtube-ads.js is injected', state.hook && state.style);
    check('ad data is gone from the initial player response', state.hasResponse && !state.adPlacements && !state.playerAds);
    check('JSON.parse is wrapped (scriptlet + fallback)', state.jsonParsePatched);
    check('no ad is playing', !state.adShowing);
  }

  // ---- DRM
  const probe = `navigator.requestMediaKeySystemAccess('com.widevine.alpha', [{ initDataTypes: ['cenc'], videoCapabilities: [{ contentType: 'video/mp4; codecs="avc1.42E01E"' }] }]).then(() => 'granted', (e) => e.name + ': ' + e.message)`;
  await invoke('set_settings', { patch: { blockDrm: true } });
  await invoke('navigate', { tab, input: 'https://example.com/' });
  let page = await pageFor('https://example.com');
  await sleep(1500);
  const off = page ? await page.evaluate(probe) : 'no page';
  console.log('DRM off ->', off);
  check('Turn off DRM: encrypted media is refused with our message', /NotSupportedError: Encrypted media is turned off in Athanor/.test(off));
  await invoke('set_settings', { patch: { blockDrm: false } });
  await invoke('navigate', { tab, input: 'https://example.org/' });
  page = await pageFor('https://example.org');
  await sleep(1500);
  const on = page ? await page.evaluate(probe) : 'no page';
  console.log('DRM on ->', on);
  check('With the switch off the page is not told DRM is disabled', !/turned off in Athanor/.test(on));

  console.log(failed ? `RESULT: FAIL (${failed})` : 'RESULT: PASS');
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error('ERR', e.message); process.exit(3); });
