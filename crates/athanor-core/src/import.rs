//! Bringing bookmarks in from other browsers.
//!
//! Athanor has no separate bookmark store: a bookmark becomes an **archived tab** (it keeps its title and address
//! but loads nothing until you click it), and bookmark folders become folders of a dedicated space. That way an
//! imported library shows up in the same sidebar, searchable from the command bar, without costing any memory.

use crate::{
    model::{Folder, Space, Tab, Workspace},
    new_id, Id, Millis,
};
use serde::Serialize;
use std::collections::HashSet;

/// A bookmark tree as read from another browser.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum ImportNode {
    Folder {
        name: String,
        children: Vec<ImportNode>,
    },
    Link {
        title: String,
        url: String,
    },
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportCounts {
    /// The space that received the bookmarks (created on first use).
    pub space: Option<Id>,
    pub folders: usize,
    pub tabs: usize,
    /// Links ignored because they were duplicates or over the cap.
    pub skipped: usize,
}

fn is_web(url: &str) -> bool {
    url.starts_with("http://") || url.starts_with("https://")
}

impl Workspace {
    /// Import `nodes` into the space called `space_name` (created if missing, never made active).
    /// Nested folders are flattened into one level named `Parent / Child`, since folders are flat.
    /// At most `max_tabs` links are imported; addresses already present in that space are skipped.
    pub fn import_bookmarks(
        &mut self,
        space_name: &str,
        nodes: &[ImportNode],
        now: Millis,
        max_tabs: usize,
    ) -> ImportCounts {
        let space = match self.spaces.iter().find(|s| s.name == space_name) {
            Some(space) => space.id.clone(),
            None => {
                let id = new_id();
                self.spaces.push(Space {
                    id: id.clone(),
                    name: space_name.to_string(),
                    icon: "Archive".into(),
                    color: "#71717a".into(),
                    theme: None,
                });
                id
            }
        };
        let mut seen: HashSet<String> = self
            .tabs
            .iter()
            .filter(|t| t.space == space)
            .map(|t| t.url.clone())
            .collect();
        let mut counts = ImportCounts {
            space: Some(space.clone()),
            ..Default::default()
        };
        // Depth-first, in document order: reverse-push children so the first child is popped first.
        let mut work: Vec<(Option<String>, &ImportNode)> =
            nodes.iter().rev().map(|n| (None, n)).collect();
        let mut folder_ids: std::collections::HashMap<String, Id> =
            std::collections::HashMap::new();
        while let Some((path, node)) = work.pop() {
            match node {
                ImportNode::Folder { name, children } => {
                    let name = name.trim();
                    let full = match &path {
                        Some(parent) if !name.is_empty() => format!("{parent} / {name}"),
                        Some(parent) => parent.clone(),
                        None if !name.is_empty() => name.to_string(),
                        None => "Imported".to_string(),
                    };
                    for child in children.iter().rev() {
                        work.push((Some(full.clone()), child));
                    }
                }
                ImportNode::Link { title, url } => {
                    if !is_web(url) || url.len() > 2048 {
                        continue;
                    }
                    if counts.tabs >= max_tabs || !seen.insert(url.clone()) {
                        counts.skipped += 1;
                        continue;
                    }
                    let folder = path.as_ref().map(|full| {
                        folder_ids
                            .entry(full.clone())
                            .or_insert_with(|| {
                                let existing = self
                                    .folders
                                    .iter()
                                    .find(|f| f.space == space && f.name == *full)
                                    .map(|f| f.id.clone());
                                existing.unwrap_or_else(|| {
                                    let id = new_id();
                                    self.folders.push(Folder {
                                        id: id.clone(),
                                        name: full.clone(),
                                        space: space.clone(),
                                        collapsed: true,
                                        color: None,
                                        auto: false,
                                    });
                                    counts.folders += 1;
                                    id
                                })
                            })
                            .clone()
                    });
                    let title = title.trim();
                    self.tabs.push(Tab {
                        id: new_id(),
                        url: url.clone(),
                        title: if title.is_empty() {
                            url.clone()
                        } else {
                            title.to_string()
                        },
                        favicon: None,
                        space: space.clone(),
                        folder,
                        pinned: false,
                        parent: None,
                        created: now,
                        last_active: now,
                        archived: true,
                        muted: false,
                        auto_filed: false,
                        software_rendering: false,
                    });
                    counts.tabs += 1;
                }
            }
        }
        counts
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn link(title: &str, url: &str) -> ImportNode {
        ImportNode::Link {
            title: title.into(),
            url: url.into(),
        }
    }
    fn folder(name: &str, children: Vec<ImportNode>) -> ImportNode {
        ImportNode::Folder {
            name: name.into(),
            children,
        }
    }

    #[test]
    fn bookmarks_become_archived_tabs_in_a_new_space_with_flattened_folders() {
        let mut ws = Workspace::default();
        let before_spaces = ws.spaces.len();
        let active = ws.active_space.clone();
        let nodes = vec![
            folder(
                "Bookmarks bar",
                vec![
                    link("Rust", "https://rust-lang.org"),
                    folder("Dev", vec![link("Tauri", "https://tauri.app")]),
                ],
            ),
            link("Loose", "https://loose.test"),
        ];
        let counts = ws.import_bookmarks("Imported", &nodes, 1_000, 100);
        assert_eq!(counts.tabs, 3);
        assert_eq!(counts.folders, 2);
        assert_eq!(ws.spaces.len(), before_spaces + 1);
        assert_eq!(ws.active_space, active, "import never switches space");
        let space = counts.space.unwrap();
        let names: Vec<_> = ws
            .folders
            .iter()
            .filter(|f| f.space == space)
            .map(|f| f.name.as_str())
            .collect();
        assert_eq!(names, vec!["Bookmarks bar", "Bookmarks bar / Dev"]);
        assert!(ws
            .tabs
            .iter()
            .filter(|t| t.space == space)
            .all(|t| t.archived));
        let tauri = ws
            .tabs
            .iter()
            .find(|t| t.url == "https://tauri.app")
            .unwrap();
        assert_eq!(
            ws.folders
                .iter()
                .find(|f| Some(&f.id) == tauri.folder.as_ref())
                .unwrap()
                .name,
            "Bookmarks bar / Dev"
        );
        assert!(ws
            .tabs
            .iter()
            .find(|t| t.url == "https://loose.test")
            .unwrap()
            .folder
            .is_none());
    }

    #[test]
    fn duplicates_non_web_links_and_the_cap_are_skipped_and_reimport_is_idempotent() {
        let mut ws = Workspace::default();
        let nodes = vec![
            link("A", "https://a.test"),
            link("A again", "https://a.test"),
            link("js", "javascript:alert(1)"),
            link("B", "https://b.test"),
            link("C", "https://c.test"),
        ];
        let counts = ws.import_bookmarks("Imported", &nodes, 0, 2);
        assert_eq!(counts.tabs, 2);
        assert_eq!(
            counts.skipped, 2,
            "duplicate + over the cap; the non-web link is dropped silently"
        );
        let again = ws.import_bookmarks("Imported", &nodes, 0, 10);
        assert_eq!(again.tabs, 1, "only the new C; A and B already exist");
        assert_eq!(ws.spaces.iter().filter(|s| s.name == "Imported").count(), 1);
    }
}
