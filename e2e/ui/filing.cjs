// Real-app manual filing and Undo. Run only through .briefs/safe-run.ps1.
const { chromium } = require('playwright-core');
const http = require('node:http');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

(async () => {
  if (!process.env.ATHANOR_DATA_DIR) throw new Error('Private ATHANOR_DATA_DIR required');
  const server = http.createServer((_req, res) => { res.setHeader('content-type', 'text/html'); res.end('<title>Filing fixture</title><p>Filing fixture</p>'); });
  await new Promise((resolve) => server.listen(8779, '127.0.0.1', resolve));
  try {
    let browser;
    for (let attempt = 0; attempt < 20 && !browser; attempt++) {
      try { browser = await chromium.connectOverCDP('http://127.0.0.1:9222'); }
      catch (error) { if (attempt === 19) throw error; await sleep(500); }
    }
    let shell;
    for (let i = 0; i < 40 && !shell; i++) { shell = browser.contexts().flatMap((context) => context.pages()).find((page) => /^https?:\/\/(tauri\.localhost|localhost:1420)/.test(page.url())); if (!shell) await sleep(250); }
    if (!shell) throw new Error('Shell not found');
    const invoke = (command, args = {}) => shell.evaluate(([name, payload]) => window.__TAURI_INTERNALS__.invoke(name, payload), [command, args]);
    const snapshot = () => invoke('get_snapshot');
    const check = (label, ok) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`); if (!ok) throw new Error(label); };
    await invoke('set_settings', { patch: { onboarded: true, autoFile: true, archiveAfterHours: 0 } });
    await invoke('set_filing_rules', { rules: [{ id: 'fixture', folder: 'Fixture', host: '127.0.0.1', pathPrefix: '/filing/', titleContains: null, enabled: true }] });
    const ids = [];
    for (const name of ['one', 'two']) ids.push(await invoke('open_tab', { url: `http://127.0.0.1:8779/filing/${name}` }));
    await sleep(1000);
    let state = await snapshot();
    check('legacy autoFile true is ignored', state.settings.autoFile === false);
    check('opening matching tabs does not file them', ids.every((id) => state.workspace.tabs.find((tab) => tab.id === id)?.folder === null));
    await invoke('navigate', { tab: ids[0], input: 'http://127.0.0.1:8779/filing/renamed' });
    await sleep(500);
    state = await snapshot();
    check('navigating a matching tab does not file it', state.workspace.tabs.find((tab) => tab.id === ids[0])?.folder === null);
    await shell.getByRole('button', { name: 'File tabs into folders' }).first().click();
    await sleep(500);
    state = await snapshot();
    const folder = state.workspace.folders.find((entry) => entry.name === 'Fixture');
    check('File moves both tabs into the matching folder', Boolean(folder) && ids.every((id) => state.workspace.tabs.find((tab) => tab.id === id)?.folder === folder.id));
    check('toast reports the filing count', await shell.getByText('Filed 2 tabs into 1 folder').isVisible());
    await shell.getByRole('button', { name: 'File tabs into folders' }).first().click();
    check('a second File with no matches preserves Undo', await shell.getByRole('button', { name: 'Undo' }).isVisible());
    await shell.getByRole('button', { name: 'Undo' }).click();
    await sleep(500);
    state = await snapshot();
    check('Undo restores both loose tabs', ids.every((id) => state.workspace.tabs.find((tab) => tab.id === id)?.folder === null));
    check('Undo removes the newly empty folder', !state.workspace.folders.some((entry) => entry.id === folder.id));
    console.log('RESULT: PASS (7)');
    await browser.close();
  } finally { server.close(); }
})().catch((error) => { console.error('RESULT: FAIL', error); process.exitCode = 1; });
