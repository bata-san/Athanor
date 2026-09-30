//! Engine-independent extensions and themes for Athanor.
//! Host applications own the webview, persistence, permission prompts, and RPC bridge.

mod manifest;
mod pattern;
mod registry;
mod theme;

pub use manifest::*;
pub use pattern::*;
pub use registry::*;
pub use theme::*;

/// Version of the host API provided by this crate.
pub const HOST_VERSION: &str = env!("CARGO_PKG_VERSION");

#[cfg(test)]
mod tests;
