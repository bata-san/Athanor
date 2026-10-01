//! Read a user's bookmarks and history out of other browsers so they can be brought into Athanor.
//!
//! Pure data code: no UI, no engine, no network. Everything works on copies of the other browser's files
//! (their databases are usually locked while the browser runs) and never writes to the source profile.
//! Passwords, cookies and saved cards are deliberately out of scope.

use serde::{Deserialize, Serialize};
use std::path::PathBuf;

mod chromium;
mod detect;
mod firefox;
mod html;
mod sqlite;
mod util;

pub use detect::{detect, detect_in, Roots};
pub use html::parse_bookmarks_html;

#[derive(Debug, thiserror::Error)]
pub enum ImportError {
    #[error("{0}")]
    Io(#[from] std::io::Error),
    #[error("{0}")]
    Json(#[from] serde_json::Error),
    #[error("{0}")]
    Sqlite(#[from] rusqlite::Error),
    #[error("{0}")]
    Other(String),
}

pub type Result<T> = std::result::Result<T, ImportError>;

/// Which family of on-disk formats a browser uses.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Engine {
    Chromium,
    Firefox,
}

/// One browser found on this machine.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DetectedBrowser {
    /// Stable id: `chrome`, `edge`, `brave`, `vivaldi`, `opera`, `opera-gx`, `chromium`, `firefox`.
    pub id: String,
    pub name: String,
    pub engine: Engine,
    pub profiles: Vec<Profile>,
}

/// A user profile inside a browser.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Profile {
    /// Folder name for Chromium (`Default`, `Profile 1`), profile directory name for Firefox.
    pub id: String,
    /// Human name (`Person 1`, `Work`, `default-release`).
    pub name: String,
    #[serde(skip)]
    pub dir: PathBuf,
    pub has_bookmarks: bool,
    pub has_history: bool,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum BookmarkNode {
    Folder {
        name: String,
        children: Vec<BookmarkNode>,
    },
    Link {
        title: String,
        url: String,
    },
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HistoryEntry {
    pub url: String,
    pub title: String,
    pub visits: u32,
    /// Last visit, Unix milliseconds.
    pub last_visit_ms: i64,
}

/// Bookmarks of a profile as a forest of folders/links (top-level "Bookmarks bar", "Other bookmarks"... are folders).
pub fn read_bookmarks(engine: Engine, profile: &Profile) -> Result<Vec<BookmarkNode>> {
    match engine {
        Engine::Chromium => chromium::read_bookmarks(&profile.dir),
        Engine::Firefox => firefox::read_bookmarks(&profile.dir),
    }
}

/// The most recently visited pages of a profile (http/https only), newest first, at most `limit`.
pub fn read_history(engine: Engine, profile: &Profile, limit: usize) -> Result<Vec<HistoryEntry>> {
    match engine {
        Engine::Chromium => chromium::read_history(&profile.dir, limit),
        Engine::Firefox => firefox::read_history(&profile.dir, limit),
    }
}

/// Number of links in a bookmark forest.
pub fn count_links(nodes: &[BookmarkNode]) -> usize {
    nodes
        .iter()
        .map(|n| match n {
            BookmarkNode::Link { .. } => 1,
            BookmarkNode::Folder { children, .. } => count_links(children),
        })
        .sum()
}

/// Number of folders in a bookmark forest.
pub fn count_folders(nodes: &[BookmarkNode]) -> usize {
    nodes
        .iter()
        .map(|n| match n {
            BookmarkNode::Link { .. } => 0,
            BookmarkNode::Folder { children, .. } => 1 + count_folders(children),
        })
        .sum()
}
