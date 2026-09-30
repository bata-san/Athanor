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
        let space = Space { id: new_id(), name: "Home".into(), icon: "flame".into(), color: "#f59e0b".into(), theme: None };
        Self { active_space: space.id.clone(), spaces: vec![space], folders: vec![], tabs: vec![], active_tab: None, split: None }
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
    pub pinned: bool,
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
        self.tabs.iter().filter(|t| t.space == space && !t.archived).collect()
    }

    pub fn open_tab(&mut self, url: &str, opts: OpenOptions, now: Millis) -> Id {
        let parent = opts.parent.as_deref().and_then(|p| self.tab(p)).cloned();
        let space = opts
            .space
            .filter(|s| self.space(s).is_some())
            .or_else(|| parent.as_ref().map(|p| p.space.clone()))
            .unwrap_or_else(|| self.active_space.clone());
        // Children of a filed tab stay next to their parent (Arc behaviour).
        let (folder, auto_filed) = match (&opts.folder, &parent) {
            (Some(f), _) => (Some(f.clone()), false),
            (None, Some(p)) if p.space == space && !opts.pinned => (p.folder.clone(), p.auto_filed),
            _ => (None, false),
        };
        let tab = Tab {
            id: new_id(),
            url: url.to_string(),
            title: String::new(),
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
        let Some(t) = self.tab_mut(id) else { return false };
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
            return CloseOutcome { removed: false, next_active: None };
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
            next = self.pick_next_after_close(&closed);
            self.active_tab = next.clone();
            if let Some(n) = &next {
                let space = self.tab(n).map(|t| t.space.clone());
                if let Some(space) = space {
                    self.active_space = space;
                }
            }
        }
        CloseOutcome { removed: true, next_active: next }
    }

    fn pick_next_after_close(&self, closed: &Tab) -> Option<Id> {
        if let Some(p) = closed.parent.as_deref().and_then(|p| self.tab(p)) {
            if !p.archived {
                return Some(p.id.clone());
            }
        }
        let list: Vec<&Tab> = self.visible_tabs(&closed.space);
        // `closed` was already removed; choose by creation-order proximity to its old slot.
        let after = list.iter().find(|t| t.created >= closed.created).or_else(|| list.last());
        after.map(|t| t.id.clone()).or_else(|| self.tabs.iter().find(|t| !t.archived).map(|t| t.id.clone()))
    }

    pub fn update_tab(&mut self, id: &str, url: Option<&str>, title: Option<&str>, favicon: Option<&str>) {
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

    pub fn set_muted(&mut self, id: &str, muted: bool) {
        if let Some(t) = self.tab_mut(id) {
            t.muted = muted;
        }
    }

    pub fn move_tab(&mut self, id: &str, dest: MoveDest) -> bool {
        let Some(idx) = self.tabs.iter().position(|t| t.id == id) else { return false };
        let mut tab = self.tabs.remove(idx);
        if let Some(s) = dest.space.filter(|s| self.space(s).is_some()) {
            tab.space = s;
        }
        tab.pinned = dest.pinned;
        tab.folder = if dest.pinned { None } else { dest.folder.filter(|f| self.folders.iter().any(|x| x.id == *f)) };
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
        let s = Space { id: new_id(), name: name.into(), icon: icon.into(), color: color.into(), theme: None };
        let id = s.id.clone();
        self.spaces.push(s);
        id
    }

    /// Removes a space; its tabs move to `into` (or the first remaining space). The last space is never removed.
    pub fn remove_space(&mut self, id: &str, into: Option<&str>) -> bool {
        if self.spaces.len() <= 1 || self.space(id).is_none() {
            return false;
        }
        let target = into
            .filter(|t| *t != id && self.space(t).is_some())
            .map(str::to_string)
            .or_else(|| self.spaces.iter().find(|s| s.id != id).map(|s| s.id.clone()))
            .expect("at least two spaces");
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

    pub fn create_folder(&mut self, space: &str, name: &str, auto: bool) -> Id {
        let f = Folder { id: new_id(), name: name.into(), space: space.into(), collapsed: false, color: None, auto };
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
        let members: Vec<Id> = self.tabs.iter().filter(|t| t.folder.as_deref() == Some(id)).map(|t| t.id.clone()).collect();
        if close_tabs {
            return members;
        }
        for t in self.tabs.iter_mut().filter(|t| t.folder.as_deref() == Some(id)) {
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
            (t.url.clone(), t.title.clone(), t.space.clone(), t.pinned || t.folder.is_some())
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
        let split: Vec<Id> = self.split.as_ref().map(|s| s.root.tabs().into_iter().cloned().collect()).unwrap_or_default();
        let mut out = vec![];
        for t in &mut self.tabs {
            let idle = now.saturating_sub(t.last_active);
            if !t.pinned && !t.archived && idle >= ttl && active.as_deref() != Some(&t.id) && !split.contains(&t.id) {
                t.archived = true;
                out.push(t.id.clone());
            }
        }
        out
    }

    // ---- split view ----

    /// Show `other` next to the active tab (or add it to an existing split).
    pub fn split_with(&mut self, other: &str, dir: Dir, new_first: bool) -> bool {
        let Some(active) = self.active_tab.clone() else { return false };
        if active == other || self.tab(other).is_none() {
            return false;
        }
        match &mut self.split {
            Some(s) if s.root.contains(other) => false,
            Some(s) => {
                let target = if s.root.contains(&s.focused) { s.focused.clone() } else { active };
                let ok = s.root.split_leaf(&target, other, dir, new_first);
                if ok {
                    s.focused = other.to_string();
                }
                ok
            }
            None => {
                let mut root = Node::leaf(active.clone());
                root.split_leaf(&active, other, dir, new_first);
                self.split = Some(SplitState { root, focused: other.to_string() });
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
            let focused = if root.contains(&s.focused) { s.focused } else { root.tabs()[0].clone() };
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
    fn open_activates_and_children_follow_parent() {
        let mut w = ws();
        let a = w.open_tab("https://a.test", OpenOptions::default(), 1);
        let f = w.create_folder(&w.active_space.clone(), "Work", false);
        w.move_tab(&a, MoveDest { folder: Some(f.clone()), ..Default::default() });
        let b = w.open_tab("https://b.test", OpenOptions { parent: Some(a.clone()), ..Default::default() }, 2);
        assert_eq!(w.tab(&b).unwrap().folder.as_deref(), Some(f.as_str()));
        assert_eq!(w.active_tab.as_deref(), Some(b.as_str()));
        assert_eq!(w.tabs[1].id, b, "child sits right after its parent");
    }

    #[test]
    fn background_open_keeps_active() {
        let mut w = ws();
        let a = w.open_tab("https://a.test", OpenOptions::default(), 1);
        w.open_tab("https://b.test", OpenOptions { background: true, ..Default::default() }, 2);
        assert_eq!(w.active_tab.as_deref(), Some(a.as_str()));
    }

    #[test]
    fn closing_active_prefers_parent_then_neighbour() {
        let mut w = ws();
        let a = w.open_tab("https://a.test", OpenOptions::default(), 1);
        let b = w.open_tab("https://b.test", OpenOptions { parent: Some(a.clone()), ..Default::default() }, 2);
        let out = w.close_tab(&b);
        assert_eq!(out.next_active.as_deref(), Some(a.as_str()));
        let out = w.close_tab(&a);
        assert_eq!(out.next_active, None);
        assert_eq!(w.active_tab, None);
        assert!(!w.close_tab("nope").removed);
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
        assert!(w.auto_file(&b, &filer).is_some(), "unfiled tab may be filed again");
        let f2 = w.create_folder(&w.active_space.clone(), "Mine", false);
        w.move_tab(&b, MoveDest { folder: Some(f2), ..Default::default() });
        assert!(w.auto_file(&b, &filer).is_none(), "manual placement is respected");
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
        let b = w.open_tab("https://b.test", OpenOptions { background: true, ..Default::default() }, 0);
        let c = w.open_tab("https://c.test", OpenOptions { background: true, ..Default::default() }, 0);
        let d = w.open_tab("https://d.test", OpenOptions { background: true, ..Default::default() }, 0);
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
        let b = w.open_tab("https://b.test", OpenOptions { background: true, ..Default::default() }, 1);
        let c = w.open_tab("https://c.test", OpenOptions { background: true, ..Default::default() }, 1);
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
        let t = w.open_tab("https://a.test", OpenOptions { space: Some(s2.clone()), ..Default::default() }, 1);
        assert_eq!(w.active_space, s2);
        assert!(w.remove_space(&s2, None));
        assert_eq!(w.tab(&t).unwrap().space, home);
        assert_eq!(w.active_space, home);
        assert!(!w.remove_space(&home, None), "cannot remove the last space");
    }

    #[test]
    fn serde_roundtrip() {
        let mut w = ws();
        let a = w.open_tab("https://a.test", OpenOptions::default(), 1);
        let b = w.open_tab("https://b.test", OpenOptions { background: true, ..Default::default() }, 1);
        w.activate(&a, 2);
        w.split_with(&b, Dir::Row, false);
        let json = serde_json::to_string(&w).unwrap();
        let back: Workspace = serde_json::from_str(&json).unwrap();
        assert_eq!(w, back);
    }
}
