//! Workspace model: spaces (Arc-style profiles), folders, tabs, split view, auto-archive.

use crate::{
    filing::Filer,
    layout::{Dir, Node},
    new_id, Millis,
};
use serde::{Deserialize, Serialize};

pub type Id = String;

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Tab {
    pub id: Id,
    pub url: String,
    #[serde(default)]
    pub title: String,
    #[serde(default)]
    pub favicon: Option<String>,
    pub space: Id,
    #[serde(default)]
    pub folder: Option<Id>,
    #[serde(default)]
    pub pinned: bool,
    /// Tab that opened this one (link / window.open). Used for filing and close-focus.
    #[serde(default)]
    pub parent: Option<Id>,
    pub created: Millis,
    pub last_active: Millis,
    /// Archived tabs keep their entry but their webview is discarded.
    #[serde(default)]
    pub archived: bool,
    #[serde(default)]
    pub muted: bool,
    /// True when the current folder was chosen by the auto-filer rather than the user.
    #[serde(default)]
    pub auto_filed: bool,
    /// Render this tab without the GPU. It then runs in its own browser process (see `docs/UI.md`).
    #[serde(default)]
    pub software_rendering: bool,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Folder {
    pub id: Id,
    pub name: String,
    pub space: Id,
    #[serde(default)]
    pub collapsed: bool,
    #[serde(default)]
    pub color: Option<String>,
    /// Created by the auto-filer (may be cleaned up when empty).
    #[serde(default)]
    pub auto: bool,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Space {
    pub id: Id,
    pub name: String,
    #[serde(default)]
    pub icon: String,
    #[serde(default)]
    pub color: String,
    /// Theme id override for this space.
    #[serde(default)]
    pub theme: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SplitState {
    pub root: Node,
    pub focused: Id,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Workspace {
    pub spaces: Vec<Space>,
    pub folders: Vec<Folder>,
    /// Global order; per-space / per-folder order is the order of appearance here.
    pub tabs: Vec<Tab>,
    pub active_space: Id,
    #[serde(default)]
    pub active_tab: Option<Id>,
    #[serde(default)]
    pub split: Option<SplitState>,
}

impl Default for Workspace {
    fn default() -> Self {
        let space = Space {
            id: new_id(),
            name: "Home".into(),
            icon: "flame".into(),
            color: "#f59e0b".into(),
            theme: None,
        };
        Self {
            active_space: space.id.clone(),
            spaces: vec![space],
            folders: vec![],
            tabs: vec![],
            active_tab: None,
            split: None,
        }
    }
}

#[derive(Clone, Debug, Default)]
pub struct OpenOptions {
    pub space: Option<Id>,
    pub parent: Option<Id>,
    pub folder: Option<Id>,
    pub pinned: bool,
    /// Open without switching to it.
    pub background: bool,
}

#[derive(Clone, Debug, Default)]
pub struct MoveDest {
    pub space: Option<Id>,
    pub folder: Option<Id>,
    /// Insert before this tab; `None` appends.
    pub before: Option<Id>,
    /// `None` keeps the tab's current pinned state - unless a folder is given, which always
    /// unpins, because a filed tab cannot sit in a folder. `Some(b)` forces the state.
    pub pinned: Option<bool>,
}

#[derive(Clone, Debug, PartialEq)]
pub struct CloseOutcome {
    pub removed: bool,
    /// Newly active tab if the closed one was active.
    pub next_active: Option<Id>,
}

impl Workspace {
    pub fn tab(&self, id: &str) -> Option<&Tab> {
        self.tabs.iter().find(|t| t.id == id)
    }

    fn tab_mut(&mut self, id: &str) -> Option<&mut Tab> {
        self.tabs.iter_mut().find(|t| t.id == id)
    }

    pub fn space(&self, id: &str) -> Option<&Space> {
        self.spaces.iter().find(|s| s.id == id)
    }

    /// Non-archived tabs of a space in display order.
    pub fn visible_tabs(&self, space: &str) -> Vec<&Tab> {
        self.tabs
            .iter()
            .filter(|t| t.space == space && !t.archived)
            .collect()
    }

    pub fn open_tab(&mut self, url: &str, opts: OpenOptions, now: Millis) -> Id {
        let parent = opts.parent.as_deref().and_then(|p| self.tab(p)).cloned();
        let space = opts
            .space
            .filter(|s| self.space(s).is_some())
            .or_else(|| parent.as_ref().map(|p| p.space.clone()))
            .unwrap_or_else(|| self.active_space.clone());
        // A folder id that no longer exists (deleted folder, stale extension call) is dropped
        // rather than stored, so the tab inherits its parent's folder like any other child.
        let folder = opts
            .folder
            .filter(|f| self.folders.iter().any(|x| &x.id == f));
        // Children of a filed tab stay next to their parent (Arc behaviour).
        let (folder, auto_filed) = match (folder, &parent) {
            (Some(f), _) => (Some(f), false),
            (None, Some(p)) if p.space == space && !opts.pinned => (p.folder.clone(), p.auto_filed),
            _ => (None, false),
        };
        let tab = Tab {
            id: new_id(),
            url: url.to_string(),
            title: crate::urlutil::internal_title(url)
                .unwrap_or_default()
                .to_string(),
            favicon: None,
            space,
            folder: if opts.pinned { None } else { folder },
            pinned: opts.pinned,
            parent: opts.parent,
            created: now,
            last_active: now,
            archived: false,
            muted: false,
            auto_filed,
            software_rendering: false,
        };
        let id = tab.id.clone();
        // Insert right after the parent so related tabs cluster; otherwise append.
        let pos = tab
            .parent
            .as_deref()
            .and_then(|p| self.tabs.iter().position(|t| t.id == p))
            .map(|i| i + 1);
        match pos {
            Some(i) => self.tabs.insert(i, tab),
            None => self.tabs.push(tab),
        }
        if !opts.background {
            self.activate(&id, now);
        }
        id
    }

    pub fn activate(&mut self, id: &str, now: Millis) -> bool {
        let Some(t) = self.tab_mut(id) else {
            return false;
        };
        t.last_active = now;
        t.archived = false;
        let space = t.space.clone();
        self.active_tab = Some(id.to_string());
        self.active_space = space;
        if let Some(s) = &mut self.split {
            if s.root.contains(id) {
                s.focused = id.to_string();
            }
        }
        true
    }

    pub fn close_tab(&mut self, id: &str) -> CloseOutcome {
        let Some(idx) = self.tabs.iter().position(|t| t.id == id) else {
            return CloseOutcome {
                removed: false,
                next_active: None,
            };
        };
        let was_active = self.active_tab.as_deref() == Some(id);
        let closed = self.tabs.remove(idx);
        self.detach_from_split(id);
        for t in &mut self.tabs {
            if t.parent.as_deref() == Some(id) {
                t.parent = closed.parent.clone();
            }
        }
        let mut next = None;
        if was_active {
            next = self.pick_next_after_close(&closed, idx);
            self.active_tab = next.clone();
            if let Some(n) = &next {
                let space = self.tab(n).map(|t| t.space.clone());
                if let Some(space) = space {
                    self.active_space = space;
                }
            }
        }
        CloseOutcome {
            removed: true,
            next_active: next,
        }
    }

    /// Pick the tab to activate after `closed` (already removed from `self.tabs` at `idx`).
    ///
    /// Prefers the parent, then the *display* neighbours of the closed tab's slot - creation
    /// order is not display order, [`Self::move_tab`] reorders tabs freely, so a tab dragged in
    /// front of its elder must stay the elder in this rule.
    fn pick_next_after_close(&self, closed: &Tab, idx: usize) -> Option<Id> {
        if let Some(p) = closed.parent.as_deref().and_then(|p| self.tab(p)) {
            if !p.archived {
                return Some(p.id.clone());
            }
        }
        let visible_here = |i: usize| {
            self.tabs
                .get(i)
                .is_some_and(|t| !t.archived && t.space == closed.space)
        };
        // `self.tabs[idx]` is whoever slid into the closed tab's slot; then the last one before it.
        let next = (idx..self.tabs.len())
            .find(|&i| visible_here(i))
            .or_else(|| (0..idx).rev().find(|&i| visible_here(i)));
        next.map(|i| self.tabs[i].id.clone())
            .or_else(|| self.tabs.iter().find(|t| !t.archived).map(|t| t.id.clone()))
    }

    pub fn update_tab(
        &mut self,
        id: &str,
        url: Option<&str>,
        title: Option<&str>,
        favicon: Option<&str>,
    ) {
        if let Some(t) = self.tab_mut(id) {
            if let Some(u) = url {
                t.url = u.to_string();
            }
            if let Some(v) = title {
                t.title = v.to_string();
            }
            if let Some(f) = favicon {
                t.favicon = Some(f.to_string());
            }
            // Built-in pages carry no document title; give them their display name.
            if t.title.is_empty() {
                if let Some(name) = crate::urlutil::internal_title(&t.url) {
                    t.title = name.to_string();
                }
            }
        }
    }

    pub fn set_pinned(&mut self, id: &str, pinned: bool) {
        if let Some(t) = self.tab_mut(id) {
            t.pinned = pinned;
            if pinned {
                t.folder = None;
                t.auto_filed = false;
            }
        }
    }

    pub fn set_software_rendering(&mut self, id: &str, software: bool) {
        if let Some(t) = self.tab_mut(id) {
            t.software_rendering = software;
        }
    }

    pub fn set_muted(&mut self, id: &str, muted: bool) {
        if let Some(t) = self.tab_mut(id) {
            t.muted = muted;
        }
    }

    pub fn move_tab(&mut self, id: &str, dest: MoveDest) -> bool {
        let Some(idx) = self.tabs.iter().position(|t| t.id == id) else {
            return false;
        };
        let mut tab = self.tabs.remove(idx);
        if let Some(s) = dest.space.filter(|s| self.space(s).is_some()) {
            tab.space = s;
        }
        // `None` keeps the tab pinned unless a folder is given (a filed tab cannot be pinned).
        let pinned = dest
            .pinned
            .unwrap_or_else(|| tab.pinned && dest.folder.is_none());
        tab.pinned = pinned;
        tab.folder = if pinned {
            None
        } else {
            dest.folder
                .filter(|f| self.folders.iter().any(|x| x.id == *f))
        };
        tab.auto_filed = false; // the user decided; never auto-refile
        let pos = dest
            .before
            .as_deref()
            .and_then(|b| self.tabs.iter().position(|t| t.id == b))
            .unwrap_or(self.tabs.len());
        self.tabs.insert(pos, tab);
        true
    }

    // ---- spaces & folders ----

    pub fn add_space(&mut self, name: &str, icon: &str, color: &str) -> Id {
        let s = Space {
            id: new_id(),
            name: name.into(),
            icon: icon.into(),
            color: color.into(),
            theme: None,
        };
        let id = s.id.clone();
        self.spaces.push(s);
        id
    }

    /// Removes a space; its tabs move to `into` (or the first remaining space). The last space is never removed.
    pub fn remove_space(&mut self, id: &str, into: Option<&str>) -> bool {
        if self.spaces.len() <= 1 || self.space(id).is_none() {
            return false;
        }
        let target = match into.filter(|t| *t != id && self.space(t).is_some()) {
            Some(t) => t.to_string(),
            None => match self.spaces.iter().find(|s| s.id != id) {
                Some(s) => s.id.clone(),
                // A corrupt session can hold two spaces that share one id, so "not the last
                // space" does not imply "there is another one". Refuse instead of panicking.
                None => return false,
            },
        };
        self.spaces.retain(|s| s.id != id);
        for f in self.folders.iter_mut().filter(|f| f.space == id) {
            f.space = target.clone();
        }
        for t in self.tabs.iter_mut().filter(|t| t.space == id) {
            t.space = target.clone();
        }
        if self.active_space == id {
            self.active_space = target;
        }
        true
    }

    /// Create a folder in `space`; an unknown space id falls back to the active space so a
    /// stale call cannot produce a folder that belongs to nothing.
    pub fn create_folder(&mut self, space: &str, name: &str, auto: bool) -> Id {
        let space = if self.space(space).is_some() {
            space.to_string()
        } else {
            self.active_space.clone()
        };
        let f = Folder {
            id: new_id(),
            name: name.into(),
            space,
            collapsed: false,
            color: None,
            auto,
        };
        let id = f.id.clone();
        self.folders.push(f);
        id
    }

    pub fn rename_folder(&mut self, id: &str, name: &str) {
        if let Some(f) = self.folders.iter_mut().find(|f| f.id == id) {
            f.name = name.into();
            f.auto = false; // renamed by the user => keep it
        }
    }

    pub fn toggle_folder(&mut self, id: &str) {
        if let Some(f) = self.folders.iter_mut().find(|f| f.id == id) {
            f.collapsed = !f.collapsed;
        }
    }

    /// Delete a folder. Its tabs are released to the space root, or returned for closing.
    pub fn delete_folder(&mut self, id: &str, close_tabs: bool) -> Vec<Id> {
        self.folders.retain(|f| f.id != id);
        let members: Vec<Id> = self
            .tabs
            .iter()
            .filter(|t| t.folder.as_deref() == Some(id))
            .map(|t| t.id.clone())
            .collect();
        if close_tabs {
            return members;
        }
        for t in self
            .tabs
            .iter_mut()
            .filter(|t| t.folder.as_deref() == Some(id))
        {
            t.folder = None;
            t.auto_filed = false;
        }
        vec![]
    }

    // ---- auto filing & archive ----

    /// Ask the filer where `tab_id` belongs and move it there, creating an auto folder if needed.
    /// Tabs the user placed themselves (folder set, not auto-filed) or pinned are left alone.
    pub fn auto_file(&mut self, tab_id: &str, filer: &Filer) -> Option<Id> {
        let (url, title, space, skip) = {
            let t = self.tab(tab_id)?;
            (
                t.url.clone(),
                t.title.clone(),
                t.space.clone(),
                t.pinned || t.folder.is_some(),
            )
        };
        if skip {
            return None;
        }
        let name = filer.suggest(&url, &title)?;
        let existing = self
            .folders
            .iter()
            .find(|f| f.space == space && f.name.eq_ignore_ascii_case(&name))
            .map(|f| f.id.clone());
        let folder = existing.unwrap_or_else(|| self.create_folder(&space, &name, true));
        let t = self.tab_mut(tab_id)?;
        if t.folder.as_deref() == Some(folder.as_str()) {
            return None;
        }
        t.folder = Some(folder.clone());
        t.auto_filed = true;
        Some(folder)
    }

    /// Remove auto-created folders that no longer hold any tab.
    pub fn prune_empty_auto_folders(&mut self) -> usize {
        let used: Vec<Id> = self.tabs.iter().filter_map(|t| t.folder.clone()).collect();
        let before = self.folders.len();
        self.folders.retain(|f| !f.auto || used.contains(&f.id));
        before - self.folders.len()
    }

    /// Archive tabs idle for longer than `ttl` ms. Pinned, active and split tabs are exempt.
    pub fn archive_inactive(&mut self, now: Millis, ttl: Millis) -> Vec<Id> {
        let active = self.active_tab.clone();
        let split: Vec<Id> = self
            .split
            .as_ref()
            .map(|s| s.root.tabs().into_iter().cloned().collect())
            .unwrap_or_default();
        let mut out = vec![];
        for t in &mut self.tabs {
            let idle = now.saturating_sub(t.last_active);
            if !t.pinned
                && !t.archived
                && idle >= ttl
                && active.as_deref() != Some(&t.id)
                && !split.contains(&t.id)
            {
                t.archived = true;
                out.push(t.id.clone());
            }
        }
        out
    }

    // ---- split view ----

    /// Show `other` next to the active tab (or add it to an existing split).
    pub fn split_with(&mut self, other: &str, dir: Dir, new_first: bool) -> bool {
        let Some(active) = self.active_tab.clone() else {
            return false;
        };
        if active == other || self.tab(other).is_none() {
            return false;
        }
        match &mut self.split {
            Some(s) if s.root.contains(other) => false,
            Some(s) => {
                let target = if s.root.contains(&s.focused) {
                    s.focused.clone()
                } else {
                    active
                };
                let ok = s.root.split_leaf(&target, other, dir, new_first);
                if ok {
                    s.focused = other.to_string();
                }
                ok
            }
            None => {
                let mut root = Node::leaf(active.clone());
                root.split_leaf(&active, other, dir, new_first);
                self.split = Some(SplitState {
                    root,
                    focused: other.to_string(),
                });
                true
            }
        }
    }

    pub fn unsplit(&mut self) {
        self.split = None;
    }

    fn detach_from_split(&mut self, id: &str) {
        let Some(s) = self.split.take() else { return };
        self.split = s.root.remove(id).and_then(|root| {
            if root.tabs().len() < 2 {
                return None;
            }
            let focused = if root.contains(&s.focused) {
                s.focused
            } else {
                root.tabs()[0].clone()
            };
            Some(SplitState { root, focused })
        });
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ws() -> Workspace {
        Workspace::default()
    }

    #[test]
    fn internal_pages_get_titles_on_open_and_navigate() {
        let mut w = ws();
        let a = w.open_tab("athanor://newtab", OpenOptions::default(), 1);
        assert_eq!(w.tab(&a).unwrap().title, "New tab");
        w.update_tab(&a, Some("https://example.com"), Some(""), None);
        assert_eq!(w.tab(&a).unwrap().title, "");
        w.update_tab(&a, Some("athanor://settings"), Some(""), None);
        assert_eq!(w.tab(&a).unwrap().title, "Settings");
    }

    #[test]
    fn open_activates_and_children_follow_parent() {
        let mut w = ws();
        let a = w.open_tab("https://a.test", OpenOptions::default(), 1);
        let f = w.create_folder(&w.active_space.clone(), "Work", false);
        w.move_tab(
            &a,
            MoveDest {
                folder: Some(f.clone()),
                ..Default::default()
            },
        );
        let b = w.open_tab(
            "https://b.test",
            OpenOptions {
                parent: Some(a.clone()),
                ..Default::default()
            },
            2,
        );
        assert_eq!(w.tab(&b).unwrap().folder.as_deref(), Some(f.as_str()));
        assert_eq!(w.active_tab.as_deref(), Some(b.as_str()));
        assert_eq!(w.tabs[1].id, b, "child sits right after its parent");
    }

    #[test]
    fn background_open_keeps_active() {
        let mut w = ws();
        let a = w.open_tab("https://a.test", OpenOptions::default(), 1);
        w.open_tab(
            "https://b.test",
            OpenOptions {
                background: true,
                ..Default::default()
            },
            2,
        );
        assert_eq!(w.active_tab.as_deref(), Some(a.as_str()));
    }

    #[test]
    fn closing_active_prefers_parent_then_neighbour() {
        let mut w = ws();
        let a = w.open_tab("https://a.test", OpenOptions::default(), 1);
        let b = w.open_tab(
            "https://b.test",
            OpenOptions {
                parent: Some(a.clone()),
                ..Default::default()
            },
            2,
        );
        let out = w.close_tab(&b);
        assert_eq!(out.next_active.as_deref(), Some(a.as_str()));
        let out = w.close_tab(&a);
        assert_eq!(out.next_active, None);
        assert_eq!(w.active_tab, None);
        assert!(!w.close_tab("nope").removed);
    }

    #[test]
    fn closing_active_follows_display_order_not_creation_order() {
        let mut w = ws();
        let a = w.open_tab("https://a.test", OpenOptions::default(), 1);
        let b = w.open_tab("https://b.test", OpenOptions::default(), 2);
        let c = w.open_tab("https://c.test", OpenOptions::default(), 3);
        // Drag the newest tab to the front: c,a,b. Its parent stays None, so only the
        // display neighbours can pick the successor.
        assert!(w.move_tab(
            &c,
            MoveDest {
                before: Some(a.clone()),
                ..Default::default()
            }
        ));
        assert_eq!(
            w.tabs.iter().map(|t| t.id.as_str()).collect::<Vec<_>>(),
            vec![c.as_str(), a.as_str(), b.as_str()]
        );
        assert!(w.activate(&c, 4));
        let out = w.close_tab(&c);
        assert_eq!(
            out.next_active.as_deref(),
            Some(a.as_str()),
            "the tab that took c's slot wins over the newer b"
        );
    }

    #[test]
    fn closing_the_last_visible_tab_falls_back_to_the_one_before_it() {
        let mut w = ws();
        let a = w.open_tab("https://a.test", OpenOptions::default(), 1);
        let b = w.open_tab("https://b.test", OpenOptions::default(), 2);
        let c = w.open_tab("https://c.test", OpenOptions::default(), 3);
        assert!(w.activate(&c, 4));
        let out = w.close_tab(&c);
        assert_eq!(
            out.next_active.as_deref(),
            Some(b.as_str()),
            "nothing follows c, so the nearest visible tab before it"
        );
        assert_eq!(w.active_tab.as_deref(), Some(b.as_str()));
        assert_eq!(w.active_space, w.tab(&b).unwrap().space);
        assert!(w.tab(&a).is_some());
    }

    #[test]
    fn closing_a_middle_tab_picks_the_one_that_slid_into_its_slot() {
        let mut w = ws();
        let a = w.open_tab("https://a.test", OpenOptions::default(), 1);
        let b = w.open_tab("https://b.test", OpenOptions::default(), 2);
        let c = w.open_tab("https://c.test", OpenOptions::default(), 3);
        assert!(w.activate(&b, 4));
        let out = w.close_tab(&b);
        assert_eq!(out.next_active.as_deref(), Some(c.as_str()));
        assert!(w.tab(&a).is_some());
    }

    #[test]
    fn closing_active_ignores_archived_neighbours() {
        let mut w = ws();
        let a = w.open_tab("https://a.test", OpenOptions::default(), 1);
        let b = w.open_tab("https://b.test", OpenOptions::default(), 2);
        w.tab_mut(&b).unwrap().archived = true;
        assert!(w.activate(&a, 3));
        let out = w.close_tab(&a);
        assert_eq!(out.next_active, None, "an archived tab is not a successor");
    }

    #[test]
    fn move_dest_pinned_none_keeps_a_pinned_tab_pinned() {
        let mut w = ws();
        let a = w.open_tab(
            "https://a.test",
            OpenOptions {
                pinned: true,
                ..Default::default()
            },
            1,
        );
        w.move_tab(&a, MoveDest::default());
        assert!(
            w.tab(&a).unwrap().pinned,
            "no folder, no explicit state: nothing changes"
        );
        assert_eq!(w.tab(&a).unwrap().folder, None);
    }

    #[test]
    fn move_dest_pinned_none_with_a_folder_unpins_and_files() {
        let mut w = ws();
        let a = w.open_tab(
            "https://a.test",
            OpenOptions {
                pinned: true,
                ..Default::default()
            },
            1,
        );
        let f = w.create_folder(&w.active_space.clone(), "Work", false);
        w.move_tab(
            &a,
            MoveDest {
                folder: Some(f.clone()),
                ..Default::default()
            },
        );
        let t = w.tab(&a).unwrap();
        assert!(!t.pinned, "a tab cannot be pinned and filed at once");
        assert_eq!(t.folder.as_deref(), Some(f.as_str()));
        assert!(
            !t.auto_filed,
            "the user placed it, so it is never auto-refiled"
        );
    }

    #[test]
    fn move_dest_pinned_is_honoured_explicitly() {
        let mut w = ws();
        let a = w.open_tab("https://a.test", OpenOptions::default(), 1);
        let f = w.create_folder(&w.active_space.clone(), "Work", false);
        // Some(true) drops the folder...
        w.move_tab(
            &a,
            MoveDest {
                folder: Some(f.clone()),
                pinned: Some(true),
                ..Default::default()
            },
        );
        assert!(w.tab(&a).unwrap().pinned);
        assert_eq!(w.tab(&a).unwrap().folder, None);
        // ...and Some(false) files it even though it was pinned.
        w.set_pinned(&a, true);
        w.move_tab(
            &a,
            MoveDest {
                folder: Some(f.clone()),
                pinned: Some(false),
                ..Default::default()
            },
        );
        assert!(!w.tab(&a).unwrap().pinned);
        assert_eq!(w.tab(&a).unwrap().folder.as_deref(), Some(f.as_str()));
    }

    #[test]
    fn open_and_create_reject_dangling_ids() {
        let mut w = ws();
        let home = w.active_space.clone();
        // A folder that does not exist is dropped, not stored.
        let a = w.open_tab(
            "https://a.test",
            OpenOptions {
                folder: Some("ghost".into()),
                ..Default::default()
            },
            1,
        );
        assert_eq!(w.tab(&a).unwrap().folder, None);
        // A space that does not exist falls back to the active one.
        let b = w.open_tab(
            "https://b.test",
            OpenOptions {
                space: Some("ghost".into()),
                ..Default::default()
            },
            2,
        );
        assert_eq!(w.tab(&b).unwrap().space, home);
        let f = w.create_folder("ghost", "Orphan", false);
        assert_eq!(
            w.folders.iter().find(|x| x.id == f).unwrap().space,
            home,
            "no folder belongs to a space that is not there"
        );
    }

    #[test]
    fn open_keeps_an_existing_folder_and_inherits_it_for_children() {
        let mut w = ws();
        let f = w.create_folder(&w.active_space.clone(), "Work", false);
        let a = w.open_tab(
            "https://a.test",
            OpenOptions {
                folder: Some(f.clone()),
                ..Default::default()
            },
            1,
        );
        assert_eq!(w.tab(&a).unwrap().folder.as_deref(), Some(f.as_str()));
        let b = w.open_tab(
            "https://b.test",
            OpenOptions {
                parent: Some(a),
                ..Default::default()
            },
            2,
        );
        assert_eq!(w.tab(&b).unwrap().folder.as_deref(), Some(f.as_str()));
    }

    #[test]
    fn auto_file_creates_folder_once_and_respects_user_choice() {
        let mut w = ws();
        let filer = Filer::default();
        let a = w.open_tab("https://github.com/x/y", OpenOptions::default(), 1);
        let b = w.open_tab("https://docs.rs/serde", OpenOptions::default(), 2);
        let fa = w.auto_file(&a, &filer).expect("filed");
        let fb = w.auto_file(&b, &filer).expect("filed");
        assert_eq!(fa, fb);
        assert_eq!(w.folders.len(), 1);
        assert!(w.folders[0].auto);
        // user drags b to the root -> never refiled
        w.move_tab(&b, MoveDest::default());
        assert!(
            w.auto_file(&b, &filer).is_some(),
            "unfiled tab may be filed again"
        );
        let f2 = w.create_folder(&w.active_space.clone(), "Mine", false);
        w.move_tab(
            &b,
            MoveDest {
                folder: Some(f2),
                ..Default::default()
            },
        );
        assert!(
            w.auto_file(&b, &filer).is_none(),
            "manual placement is respected"
        );
        w.set_pinned(&a, true);
        assert!(w.auto_file(&a, &filer).is_none());
    }

    #[test]
    fn prune_removes_only_empty_auto_folders() {
        let mut w = ws();
        let s = w.active_space.clone();
        w.create_folder(&s, "auto", true);
        w.create_folder(&s, "manual", false);
        assert_eq!(w.prune_empty_auto_folders(), 1);
        assert_eq!(w.folders[0].name, "manual");
    }

    #[test]
    fn archive_skips_pinned_active_and_split() {
        let mut w = ws();
        let a = w.open_tab("https://a.test", OpenOptions::default(), 0);
        let b = w.open_tab(
            "https://b.test",
            OpenOptions {
                background: true,
                ..Default::default()
            },
            0,
        );
        let c = w.open_tab(
            "https://c.test",
            OpenOptions {
                background: true,
                ..Default::default()
            },
            0,
        );
        let d = w.open_tab(
            "https://d.test",
            OpenOptions {
                background: true,
                ..Default::default()
            },
            0,
        );
        w.set_pinned(&b, true);
        assert!(w.split_with(&c, Dir::Row, false));
        let archived = w.archive_inactive(10_000, 1_000);
        assert_eq!(archived, vec![d.clone()]);
        assert!(w.tab(&d).unwrap().archived);
        assert!(w.activate(&d, 10_001));
        assert!(!w.tab(&d).unwrap().archived, "activating restores");
        assert_eq!(w.active_tab.as_deref(), Some(d.as_str()));
        let _ = a;
    }

    #[test]
    fn split_grow_and_collapse_on_close() {
        let mut w = ws();
        let a = w.open_tab("https://a.test", OpenOptions::default(), 1);
        let b = w.open_tab(
            "https://b.test",
            OpenOptions {
                background: true,
                ..Default::default()
            },
            1,
        );
        let c = w.open_tab(
            "https://c.test",
            OpenOptions {
                background: true,
                ..Default::default()
            },
            1,
        );
        assert!(w.activate(&a, 2));
        assert!(w.split_with(&b, Dir::Row, false));
        assert!(w.split_with(&c, Dir::Column, false));
        assert_eq!(w.split.as_ref().unwrap().root.tabs().len(), 3);
        assert!(!w.split_with(&c, Dir::Row, false), "already in split");
        w.close_tab(&c);
        assert_eq!(w.split.as_ref().unwrap().root.tabs().len(), 2);
        w.close_tab(&b);
        assert!(w.split.is_none(), "a one-pane split dissolves");
    }

    #[test]
    fn remove_space_moves_tabs_and_keeps_last() {
        let mut w = ws();
        let home = w.active_space.clone();
        let s2 = w.add_space("Work", "briefcase", "#3b82f6");
        let t = w.open_tab(
            "https://a.test",
            OpenOptions {
                space: Some(s2.clone()),
                ..Default::default()
            },
            1,
        );
        assert_eq!(w.active_space, s2);
        assert!(w.remove_space(&s2, None));
        assert_eq!(w.tab(&t).unwrap().space, home);
        assert_eq!(w.active_space, home);
        assert!(!w.remove_space(&home, None), "cannot remove the last space");
    }

    #[test]
    fn remove_space_refuses_when_every_space_shares_one_id() {
        let mut w = ws();
        let dup = w.active_space.clone();
        // A corrupt session: two entries, one id, so no other space exists to fall back to.
        let other = Space {
            id: dup.clone(),
            name: "Home (copy)".into(),
            icon: "flame".into(),
            color: "#f59e0b".into(),
            theme: None,
        };
        w.spaces.push(other);
        assert!(
            !w.remove_space(&dup, None),
            "no target space means no removal, and never a panic"
        );
        assert_eq!(w.spaces.len(), 2, "the workspace is left as it was");
        assert_eq!(w.active_space, dup);
    }

    #[test]
    fn serde_roundtrip() {
        let mut w = ws();
        let a = w.open_tab("https://a.test", OpenOptions::default(), 1);
        let b = w.open_tab(
            "https://b.test",
            OpenOptions {
                background: true,
                ..Default::default()
            },
            1,
        );
        w.activate(&a, 2);
        w.split_with(&b, Dir::Row, false);
        let json = serde_json::to_string(&w).unwrap();
        let back: Workspace = serde_json::from_str(&json).unwrap();
        assert_eq!(w, back);
    }
}
