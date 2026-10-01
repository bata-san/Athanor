# Updates and the default web font

## Auto-update (desktop)

* The shell checks the release feed about 8 seconds after start-up (setting `autoUpdate`, default on), downloads a newer version in the background and shows a toast with **Restart**. Nothing is installed until the user presses it. Settings -> About has **Check for updates** and the switch.
* Commands (`app/src-tauri/src/updater.rs`): `check_update() -> UpdateInfo | null`, `download_update()`, `install_update()` (saves the session, runs the installer in passive mode, restarts). Desktop only; Android has no updater.
* The feed is `https://github.com/bata-san/Athanor/releases/download/updater/latest.json`, the asset of a rolling release tagged `updater` (a fixed URL that also works while releases are pre-releases). Every download is verified against the public key in `tauri.conf.json` (`plugins.updater.pubkey`) before the installer runs. `ATHANOR_UPDATE_URL` replaces the feed (tests; release builds only accept https).
* Windows updates come from the NSIS installer, so a copy installed with the installer updates itself. A standalone `athanor.exe` copied around by hand is not replaced by it.

### Releasing

1. Bump the version in `Cargo.toml` (`[workspace.package]`) and `app/src-tauri/tauri.conf.json`.
2. Run the **Release** workflow with the tag `v<version>`. It builds and signs the installer (secret `TAURI_SIGNING_PRIVATE_KEY`), publishes the release with the installer, the APK and `SHA256SUMS.txt`, and replaces `latest.json` on the `updater` release.

The signing key is generated once (`npx tauri signer generate`); keep the private half safe: without it no update can be signed for installs that carry the matching public key.

## Default web font

`app/src-tauri/src/webfont.rs` (Windows). Before the first WebView2 starts, the bundled IBM Plex Sans JP (Regular and Bold, `app/src-tauri/fonts/*.ttf.gz`, SIL OFL: `fonts/OFL.txt`) is unpacked into the app's local data folder and registered with Windows for the session only (`AddFontResourceEx`; removed again on exit), and the WebView2 profile's default fonts (standard and sans-serif; common and Japanese scripts) are pointed at it in `EBWebView/Default/Preferences`. Pages that name their own font are not changed. Setting `webFont` (Settings -> Appearance) turns it off; it applies from the next start. `e2e/ui/web-font.cjs` checks it on the real app with a page that has no stylesheet.
