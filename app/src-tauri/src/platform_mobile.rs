//! Android bootstrap: the Tauri shell is the configured `main` webview; tab pages are
//! sibling native Android WebViews managed by `AthanorEngine`.

#[cfg(target_os = "android")]
use crate::{
    browser::{Browser, Paths},
    engine_mobile::MobileEngine,
    filter::Filter,
};
#[cfg(target_os = "android")]
use std::sync::Arc;
#[cfg(target_os = "android")]
use tauri::App;

#[cfg(target_os = "android")]
pub fn init(
    app: &mut App,
    filter: Arc<Filter>,
    paths: Paths,
) -> Result<Arc<Browser>, Box<dyn std::error::Error>> {
    use tauri::Manager;

    // Android creates this shell webview from tauri.android.conf.json before Rust setup runs.
    // The Kotlin plugin anchors tab WebViews to its native view parent and computes their
    // physical bounds from this shell's CSS-pixel viewport and display density.
    app.get_webview_window("main")
        .ok_or("Android shell webview `main` was not created")?;
    crate::jni_bridge::install_filter(filter.clone())?;

    let engine = Arc::new(MobileEngine::new(app.handle())?);
    let (tx, rx) = tokio::sync::mpsc::unbounded_channel();
    engine.set_sink(Arc::new(move |ev| {
        let _ = tx.send(ev);
    }));
    let browser = Browser::new(app.handle().clone(), engine, filter, paths);
    browser.start(rx);
    Ok(browser)
}

#[cfg(not(target_os = "android"))]
pub fn init(
    _app: &mut tauri::App,
    _filter: std::sync::Arc<crate::filter::Filter>,
    _paths: crate::browser::Paths,
) -> Result<std::sync::Arc<crate::browser::Browser>, Box<dyn std::error::Error>> {
    Err("the mobile engine adapter currently supports Android only".into())
}
