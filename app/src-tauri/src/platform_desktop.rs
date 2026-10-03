//! Desktop bootstrap: a frameless window holding the shell webview plus one native child webview per tab.

use crate::{
    browser::{Browser, Paths},
    engine_desktop::DesktopEngine,
    filter::Filter,
};
use std::sync::Arc;
use tauri::{webview::WebviewBuilder, App, LogicalPosition, WebviewUrl};

pub fn init(
    app: &mut App,
    filter: Arc<Filter>,
    paths: Paths,
) -> Result<Arc<Browser>, Box<dyn std::error::Error>> {
    let window = tauri::window::WindowBuilder::new(app, "main")
        .title("Athanor")
        .inner_size(1360.0, 860.0)
        .min_inner_size(420.0, 320.0)
        .decorations(false)
        .build()?;
    let size = window
        .inner_size()?
        .to_logical::<f64>(window.scale_factor()?);
    let shell_builder = WebviewBuilder::new("shell", WebviewUrl::App("index.html".into()))
        .auto_resize()
        .devtools(true);
    // The private e2e run must never attach to the user's normal WebView2 profile.
    #[cfg(windows)]
    let shell_builder = if std::env::var_os("ATHANOR_DATA_DIR").is_some() {
        let builder = shell_builder.data_directory(paths.root.join("wv"));
        match std::env::var("WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS") {
            Ok(args) => builder.additional_browser_args(&args),
            Err(_) => builder,
        }
    } else {
        shell_builder
    };
    let shell = window.add_child(shell_builder, LogicalPosition::new(0.0, 0.0), size)?;
    #[cfg(windows)]
    let _ = shell.with_webview(|pw| unsafe {
        let _ = crate::win::lock_shell_zoom(&pw.controller());
    });
    #[cfg(not(windows))]
    let _ = shell;
    let engine = Arc::new(DesktopEngine::new(app.handle(), window, filter.clone()));
    let (tx, rx) = tokio::sync::mpsc::unbounded_channel();
    engine.set_sink(Arc::new(move |ev| {
        let _ = tx.send(ev);
    }));
    let browser = Browser::new(app.handle().clone(), engine, filter, paths);
    browser.start(rx);
    Ok(browser)
}
