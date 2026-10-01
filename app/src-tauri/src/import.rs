//! First-run data import from other browsers (Windows). The readers live in `athanor-import`; this module resolves
//! what the shell asked for (a detected browser + profile, or a bookmarks file), runs the readers off the UI thread
//! and hands the result to the controller. The shell never passes raw paths for browsers: it names a detected
//! browser/profile, and the path is looked up here again.

use crate::browser::Browser;
use athanor_core::{import::ImportNode, Id};
use athanor_import::{BookmarkNode, DetectedBrowser, HistoryEntry};
use serde::{Deserialize, Serialize};
use std::sync::Arc;

/// Imported history is capped so the omnibox stays instant.
const HISTORY_LIMIT: usize = 20_000;
/// Imported bookmarks are capped so the sidebar and session file stay small.
const BOOKMARK_LIMIT: usize = 5_000;
const MAX_FILE_BYTES: u64 = 64 * 1024 * 1024;

#[derive(Debug, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum ImportSource {
    Browser { browser: String, profile: String },
    File { path: String },
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportRequest {
    pub source: ImportSource,
    pub bookmarks: bool,
    pub history: bool,
}

#[derive(Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportReport {
    pub bookmarks: usize,
    pub folders: usize,
    pub history: usize,
    pub skipped: usize,
    pub space: Option<Id>,
    /// Non-fatal problems (e.g. history could not be read while the bookmarks were).
    pub warnings: Vec<String>,
}

pub fn detect() -> Vec<DetectedBrowser> {
    athanor_import::detect()
}

fn convert(nodes: Vec<BookmarkNode>) -> Vec<ImportNode> {
    nodes
        .into_iter()
        .map(|node| match node {
            BookmarkNode::Folder { name, children } => ImportNode::Folder {
                name,
                children: convert(children),
            },
            BookmarkNode::Link { title, url } => ImportNode::Link { title, url },
        })
        .collect()
}

fn history_items(entries: Vec<HistoryEntry>) -> Vec<(String, String, u32, u64)> {
    entries
        .into_iter()
        .map(|e| (e.url, e.title, e.visits, e.last_visit_ms.max(0) as u64))
        .collect()
}

pub fn run(browser: &Arc<Browser>, request: ImportRequest) -> Result<ImportReport, String> {
    let mut report = ImportReport::default();
    match request.source {
        ImportSource::File { path } => {
            if !request.bookmarks {
                return Err("nothing to import".into());
            }
            let meta = std::fs::metadata(&path).map_err(|e| e.to_string())?;
            if !meta.is_file() || meta.len() > MAX_FILE_BYTES {
                return Err("that file is too large or is not a file".into());
            }
            let lower = path.to_ascii_lowercase();
            if !(lower.ends_with(".html") || lower.ends_with(".htm")) {
                return Err("choose a bookmarks file exported as HTML".into());
            }
            let text = std::fs::read_to_string(&path).map_err(|e| e.to_string())?;
            let nodes = convert(athanor_import::parse_bookmarks_html(&text));
            let counts = browser.import_bookmarks("From file", &nodes, BOOKMARK_LIMIT);
            report.bookmarks = counts.tabs;
            report.folders = counts.folders;
            report.skipped = counts.skipped;
            report.space = counts.space;
        }
        ImportSource::Browser {
            browser: browser_id,
            profile: profile_id,
        } => {
            let detected = athanor_import::detect();
            let found = detected.iter().find(|b| b.id == browser_id).and_then(|b| {
                b.profiles
                    .iter()
                    .find(|p| p.id == profile_id)
                    .map(|p| (b, p))
            });
            let Some((source, profile)) = found else {
                return Err("that browser profile was not found any more".into());
            };
            let mut attempted = 0;
            let mut failed = 0;
            if request.bookmarks && profile.has_bookmarks {
                attempted += 1;
                match athanor_import::read_bookmarks(source.engine, profile) {
                    Ok(tree) => {
                        let counts = browser.import_bookmarks(
                            &format!("From {}", source.name),
                            &convert(tree),
                            BOOKMARK_LIMIT,
                        );
                        report.bookmarks = counts.tabs;
                        report.folders = counts.folders;
                        report.skipped = counts.skipped;
                        report.space = counts.space;
                    }
                    Err(e) => {
                        failed += 1;
                        report.warnings.push(format!("Bookmarks: {e}"));
                    }
                }
            }
            if request.history && profile.has_history {
                attempted += 1;
                match athanor_import::read_history(source.engine, profile, HISTORY_LIMIT) {
                    Ok(entries) => {
                        report.history =
                            browser.import_history(history_items(entries), HISTORY_LIMIT)
                    }
                    Err(e) => {
                        failed += 1;
                        report.warnings.push(format!("History: {e}"));
                    }
                }
            }
            if attempted == 0 {
                return Err("this profile has nothing to import".into());
            }
            if failed == attempted {
                return Err(report.warnings.join(" · "));
            }
        }
    }
    Ok(report)
}
