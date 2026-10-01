// The window follows a drag on its empty chrome from the very first press (no need to maximise it first).
// Runs on a private copy of the app (see the e2e README); it moves that window only.
//
//   node e2e/ui/window-drag.cjs
const { chromium } = require('playwright-core');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  if (!process.env.ATHANOR_DATA_DIR) { console.log('Refusing to run without ATHANOR_DATA_DIR.'); process.exit(2); }
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
  let shell;
  for (let i = 0; i < 40 && !shell; i++) { shell = browser.contexts().flatMap((c) => c.pages()).find((p) => /^https?:\/\/(tauri\.localhost|localhost:1420)/.test(p.url())); if (!shell) await sleep(250); }
  if (!shell) { console.log('RESULT: shell not found'); process.exit(2); }
  const invoke = (cmd, args = {}) => shell.evaluate(([c, a]) => window.__TAURI_INTERNALS__.invoke(c, a), [cmd, args]);
  let failed = 0;
  const check = (name, ok, detail) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' - ' + detail : ''}`); if (!ok) failed++; };
  await invoke('set_settings', { patch: { onboarded: true } });
  await sleep(500);
  const before = await invoke('window_get_position');
  // A real mouse reports true screen coordinates; the synthetic mouse of the test tool derives them from the window
  // position (so the window would chase its own pointer). Send pointer events with fixed screen coordinates instead.
  await shell.evaluate(async () => {
    const header = document.querySelector('[data-part="sidebar-header"]');
    const target = header.querySelector('[data-part="page-title"]');
    const r = target.getBoundingClientRect();
    const init = (x, y, extra = {}) => ({ bubbles: true, cancelable: true, pointerId: 1, button: 0, buttons: 1, clientX: r.x + 10, clientY: r.y + 4, screenX: x, screenY: y, ...extra });
    target.dispatchEvent(new PointerEvent('pointerdown', init(500, 400)));
    for (let i = 1; i <= 10; i++) { header.dispatchEvent(new PointerEvent('pointermove', init(500 + i * 10, 400 + i * 6))); await new Promise((res) => setTimeout(res, 30)); }
    header.dispatchEvent(new PointerEvent('pointerup', init(600, 460, { buttons: 0 })));
  });
  await sleep(500);
  const after = await invoke('window_get_position');
  console.log('before', JSON.stringify(before), 'after', JSON.stringify(after));
  check('dragging the header moves the window', Math.abs(after[0] - before[0] - 100) < 4 && Math.abs(after[1] - before[1] - 60) < 4, `${after[0] - before[0]}, ${after[1] - before[1]}`);
  // a click on a button inside the header is still a click
  const tabsBefore = (await invoke('get_snapshot')).settings.sidebarCompact;
  await shell.click('[data-part="sidebar-header"] button');
  await sleep(500);
  check('buttons in the header still work', (await invoke('get_snapshot')).settings.sidebarCompact !== tabsBefore);
  await invoke('set_settings', { patch: { sidebarCompact: false } });
  console.log(failed ? `RESULT: FAIL (${failed})` : 'RESULT: PASS');
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error('ERR', e.message); process.exit(3); });
