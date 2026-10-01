//! Self-update (desktop). The shell asks for updates at start-up (setting `autoUpdate`), downloads in the background and
//! offers a restart; the update is installed only when the user agrees.
//!
//! Updates come from the GitHub release feed configured in `tauri.conf.json` (`plugins.updater`) and are verified
//! against the public key there before anything runs. `ATHANOR_UPDATE_URL` replaces the feed (used by tests).

use std::sync::Mutex;

use serde::Serialize;
use tauri::{AppHandle, Manager, State};
use tauri_plugin_updater::{Update, UpdaterExt};

#[derive(Default)]
pub struct Pending(Mutex<Slot>);

#[derive(Default)]
struct Slot {
    update: Option<Update>,
    bytes: Option<Vec<u8>>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateInfo {
    pub version: String,
    pub current: String,
    pub notes: Option<String>,
    pub downloaded: bool,
}

fn lock(pending: &Pending) -> std::sync::MutexGuard<'_, Slot> {
    pending.0.lock().unwrap_or_else(|e| e.into_inner())
}

/// Ask the feed whether a newer version exists. `None` means "up to date".
#[tauri::command]
pub async fn check_update(
    app: AppHandle,
    pending: State<'_, Pending>,
) -> Result<Option<UpdateInfo>, String> {
    let mut builder = app.updater_builder();
    if let Some(url) = std::env::var("ATHANOR_UPDATE_URL")
        .ok()
        .filter(|u| !u.is_empty())
    {
        let url = url
            .parse()
            .map_err(|e| format!("bad ATHANOR_UPDATE_URL: {e}"))?;
        builder = builder.endpoints(vec![url]).map_err(|e| e.to_string())?;
    }
    let updater = builder.build().map_err(|e| e.to_string())?;
    let found = updater.check().await.map_err(|e| e.to_string())?;
    let mut slot = lock(&pending);
    slot.bytes = None;
    Ok(found.map(|update| {
        let info = UpdateInfo {
            version: update.version.clone(),
            current: update.current_version.clone(),
            notes: update.body.clone(),
            downloaded: false,
        };
        slot.update = Some(update);
        info
    }))
}

/// Download the update found by `check_update` (signature is verified on install).
#[tauri::command]
pub async fn download_update(pending: State<'_, Pending>) -> Result<(), String> {
    let update = lock(&pending)
        .update
        .clone()
        .ok_or("no update to download")?;
    let bytes = update
        .download(|_, _| {}, || {})
        .await
        .map_err(|e| e.to_string())?;
    lock(&pending).bytes = Some(bytes);
    Ok(())
}

/// Install the downloaded update and restart. On Windows the installer ends this process itself.
#[tauri::command]
pub async fn install_update(app: AppHandle, pending: State<'_, Pending>) -> Result<(), String> {
    let (update, bytes) = {
        let mut slot = lock(&pending);
        (slot.update.clone(), slot.bytes.take())
    };
    let update = update.ok_or("no update to install")?;
    let bytes = match bytes {
        Some(bytes) => bytes,
        None => update
            .download(|_, _| {}, || {})
            .await
            .map_err(|e| e.to_string())?,
    };
    if let Some(browser) = app.try_state::<std::sync::Arc<crate::browser::Browser>>() {
        browser.save();
    }
    update.install(bytes).map_err(|e| e.to_string())?;
    app.restart()
}
