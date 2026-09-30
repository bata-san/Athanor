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
    window.add_child(
        WebviewBuilder::new("shell", WebviewUrl::App("index.html".into()))
            .auto_resize()
            .devtools(true),
        LogicalPosition::new(0.0, 0.0),
        size,
    )?;
    let engine = Arc::new(DesktopEngine::new(app.handle(), window, filter.clone()));
    let (tx, rx) = tokio::sync::mpsc::unbounded_channel();
    engine.set_sink(Arc::new(move |ev| {
        let _ = tx.send(ev);
    }));
    let browser = Browser::new(app.handle().clone(), engine, filter, paths);
    browser.start(rx);
    Ok(browser)
}
