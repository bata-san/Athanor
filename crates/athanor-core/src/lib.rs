//! Athanor core: everything that is *browser logic* and nothing that is *browser engine*.
//!
//! This crate must never depend on Tauri, wry, WebView2, Android or any UI toolkit.
//! The engine is reached only through [`engine::EngineBackend`], so a Chromium/WebView
//! upgrade (or an engine swap) touches the platform adapters and nothing in here.

pub mod board;
pub mod devtools;
pub mod engine;
pub mod filing;
pub mod history;
pub mod import;
pub mod layout;
pub mod model;
pub mod plan;
pub mod store;
pub mod urlutil;

pub use model::{Folder, Id, Space, Tab, Workspace};

/// Milliseconds since the Unix epoch. Passed in explicitly so logic stays deterministic in tests.
pub type Millis = u64;

pub fn new_id() -> Id {
    uuid::Uuid::new_v4().simple().to_string()
}
