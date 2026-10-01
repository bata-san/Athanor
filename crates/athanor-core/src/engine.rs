//! The seam between Athanor and the web engine (Chromium via WebView2 / Android System WebView).
//!
//! Everything engine-specific lives behind [`EngineBackend`]. Adapters (`app/src-tauri` for desktop,
//! the Kotlin plugin for Android) implement it and report back through [`EngineEvent`]s. When Chromium or the
//! webview runtime changes, only an adapter should ever need editing.

use crate::{layout::Rect, Id};
use serde::{Deserialize, Serialize};
use std::sync::Arc;

#[derive(Debug, thiserror::Error)]
pub enum EngineError {
    #[error("unknown tab {0}")]
    UnknownTab(Id),
    #[error("engine: {0}")]
    Engine(String),
}

pub type EngineResult<T = ()> = Result<T, EngineError>;

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TabOptions {
    pub user_agent: Option<String>,
    /// Extra JS run at document start in every frame (extension userscripts, shortcuts bridge, ...).
    pub init_scripts: Vec<String>,
    pub incognito: bool,
}

/// What was under the pointer when the page's context menu was requested.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ContextTarget {
    /// `page`, `image`, `selection`, `audio` or `video`.
    pub kind: String,
    pub page_url: String,
    pub link_url: Option<String>,
    pub link_text: Option<String>,
    /// Image / media source address.
    pub source_url: Option<String>,
    pub selection_text: Option<String>,
    pub editable: bool,
}

/// One entry of the engine's own context menu. The shell draws the menu; the engine runs the chosen `id`.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ContextItem {
    pub id: i32,
    /// The engine's unlocalised name (lowercase English, e.g. `copy`, `select all`); stable enough to pick icons.
    pub name: String,
    /// Localised text to show.
    pub label: String,
    /// `command`, `checkbox`, `radio`, `separator` or `submenu`.
    pub kind: String,
    pub enabled: bool,
    pub checked: bool,
    pub shortcut: Option<String>,
    pub children: Vec<ContextItem>,
}

/// What the engine reports back. `tab` is always the Athanor tab id.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum EngineEvent {
    #[serde(rename_all = "camelCase")]
    NavigationStarted { tab: Id, url: String },
    #[serde(rename_all = "camelCase")]
    UrlChanged { tab: Id, url: String },
    #[serde(rename_all = "camelCase")]
    TitleChanged { tab: Id, title: String },
    #[serde(rename_all = "camelCase")]
    FaviconChanged { tab: Id, url: String },
    #[serde(rename_all = "camelCase")]
    LoadingChanged { tab: Id, loading: bool },
    #[serde(rename_all = "camelCase")]
    HistoryChanged {
        tab: Id,
        can_go_back: bool,
        can_go_forward: bool,
    },
    #[serde(rename_all = "camelCase")]
    AudioChanged { tab: Id, audible: bool },
    /// Page asked for a new window / tab (`target=_blank`, `window.open`).
    #[serde(rename_all = "camelCase")]
    NewTabRequested { from: Id, url: String },
    /// Engine-level shortcut (Ctrl+T etc. intercepted before the page saw it).
    #[serde(rename_all = "camelCase")]
    Shortcut { tab: Id, combo: String },
    #[serde(rename_all = "camelCase")]
    Blocked { tab: Id, url: String },
    /// The page asked for a context menu. The engine keeps the request open until the shell answers through
    /// [`EngineBackend::resolve_context_menu`]. `x`/`y` are logical pixels from the top-left of the tab's view.
    #[serde(rename_all = "camelCase")]
    PageContextMenu {
        tab: Id,
        x: f64,
        y: f64,
        target: ContextTarget,
        items: Vec<ContextItem>,
    },
    /// A custom context-menu entry was chosen (e.g. `send-image-to-board` with the image URL as `data`).
    #[serde(rename_all = "camelCase")]
    ContextAction {
        tab: Id,
        action: String,
        data: String,
    },
}

pub type EventSink = Arc<dyn Fn(EngineEvent) + Send + Sync>;

pub trait EngineBackend: Send + Sync {
    fn create_tab(
        &self,
        id: &str,
        url: &str,
        bounds: Rect,
        visible: bool,
        opts: &TabOptions,
    ) -> EngineResult;
    fn close_tab(&self, id: &str) -> EngineResult;
    fn navigate(&self, id: &str, url: &str) -> EngineResult;
    fn go_back(&self, id: &str) -> EngineResult;
    fn go_forward(&self, id: &str) -> EngineResult;
    fn reload(&self, id: &str) -> EngineResult;
    fn stop(&self, id: &str) -> EngineResult;
    fn set_bounds(&self, id: &str, bounds: Rect) -> EngineResult;
    fn set_visible(&self, id: &str, visible: bool) -> EngineResult;
    fn focus(&self, id: &str) -> EngineResult;
    fn eval(&self, id: &str, script: &str) -> EngineResult;
    fn set_zoom(&self, id: &str, factor: f64) -> EngineResult;
    fn set_muted(&self, id: &str, muted: bool) -> EngineResult;
    fn open_devtools(&self, id: &str) -> EngineResult;
    /// Screenshot of the visible page as PNG bytes. Optional capability.
    fn capture_png(&self, _id: &str) -> EngineResult<Vec<u8>> {
        Err(EngineError::Engine(
            "page capture is not supported by this engine".into(),
        ))
    }
    /// Smaller/faster screenshot used to freeze the page behind shell overlays (JPEG). Defaults to PNG.
    fn capture_frame(&self, id: &str) -> EngineResult<(&'static str, Vec<u8>)> {
        self.capture_png(id).map(|png| ("image/png", png))
    }
    /// Answer a pending [`EngineEvent::PageContextMenu`]: run the engine command `command`, or just dismiss
    /// the menu when it is `None`. Always call it exactly once per event.
    fn resolve_context_menu(&self, _id: &str, _command: Option<i32>) -> EngineResult {
        Ok(())
    }
    /// Round the corners of every tab view (physical pixels; 0 = square). Optional capability.
    fn set_corner_radius(&self, _radius: i32) -> EngineResult {
        Ok(())
    }
    /// Free the renderer of a tab but keep the Athanor tab entry (archive / memory saver).
    fn discard(&self, id: &str) -> EngineResult {
        self.close_tab(id)
    }
}
