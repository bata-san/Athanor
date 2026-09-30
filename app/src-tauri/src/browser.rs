//! The browser controller: owns workspace state, reacts to engine events and keeps the engine in sync.
//!
//! Flow: a command mutates [`Inner`] under a short lock, calls [`Browser::reconcile`] (which diffs desired vs
//! actual native webviews and talks to the [`EngineBackend`]), then [`Browser::changed`] which schedules a
//! throttled snapshot to the shell and a debounced save.

use crate::{filter::Filter, state::*};
use athanor_core::{
    devtools,
    engine::{EngineBackend, EngineEvent, TabOptions},
    filing::{Filer, Rule},
    history::History,
    layout::{Dir, Rect},
    model::{MoveDest, OpenOptions},
    store, urlutil, Id, Millis, Workspace,
};
use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use std::{
    collections::{HashMap, HashSet},
    path::PathBuf,
    sync::Arc,
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use tauri::{AppHandle, Emitter};
use tokio::sync::Notify;

/// Gap between split panes in CSS px.
const SPLIT_GAP: f64 = 4.0;

pub fn now() -> Millis {
    SystemTime::now().duration_since(UNIX_EPOCH).map_or(0, |d| d.as_millis() as Millis)
}

#[derive(Clone)]
pub struct Paths {
    pub root: PathBuf,
}

impl Paths {
    pub fn file(&self, name: &str) -> PathBuf {
        self.root.join(name)
    }
    pub fn boards(&self) -> PathBuf {
        self.root.join("boards")
    }
    pub fn assets(&self) -> PathBuf {
        self.root.join("assets")
    }
    pub fn extensions(&self) -> PathBuf {
        self.root.join("extensions")
    }
    pub fn adblock(&self) -> PathBuf {
        self.root.join("adblock")
    }
}

#[derive(Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct Session {
    workspace: Option<Workspace>,
    filer: Option<Filer>,
}

#[derive(Clone, Copy, Debug, PartialEq)]
struct Live {
    visible: bool,
    rect: Rect,
}

struct Inner {
    ws: Workspace,
    runtime: HashMap<Id, TabRuntime>,
    settings: Settings,
    filer: Filer,
    history: History,
    bounds: Rect,
    overlay: bool,
    live: HashMap<Id, Live>,
    /// Tabs that must have a (hidden) webview even though they are not on screen.
    want_live: HashSet<Id>,
    emulation: HashMap<Id, (f64, f64)>,
    blocked_total: u64,
    focus_next: bool,
    closed: Vec<String>,
    had_split: bool,
}

#[derive(Default)]
struct Plan {
    discard: Vec<Id>,
    create: Vec<(Id, String, Rect, bool)>,
    place: Vec<(Id, Rect)>,
    show: Vec<Id>,
    hide: Vec<Id>,
    focus: Option<Id>,
}

pub struct Browser {
    app: AppHandle,
    engine: Arc<dyn EngineBackend>,
    pub filter: Arc<Filter>,
    pub paths: Paths,
    inner: Mutex<Inner>,
    apply_lock: Mutex<()>,
    snap_notify: Notify,
    save_notify: Notify,
}

impl Browser {
    pub fn new(app: AppHandle, engine: Arc<dyn EngineBackend>, filter: Arc<Filter>, paths: Paths) -> Arc<Self> {
        let settings: Settings = store::load_or_default(&paths.file("settings.json")).unwrap_or_default();
        let session: Session = store::load_or_default(&paths.file("session.json")).unwrap_or_default();
        let history: History = store::load_or_default(&paths.file("history.json")).unwrap_or_default();
        let mut ws = if settings.restore_session { session.workspace.unwrap_or_default() } else { Workspace::default() };
        if ws.spaces.is_empty() {
            ws = Workspace::default();
        }
        if ws.tabs.is_empty() {
            ws.open_tab(urlutil::NEW_TAB_URL, OpenOptions::default(), now());
        } else if ws.active_tab.as_deref().and_then(|a| ws.tab(a)).is_none() {
            let first = ws.tabs.iter().find(|t| !t.archived).map(|t| t.id.clone());
            match first {
                Some(id) => {
                    ws.activate(&id, now());
                }
                None => {
                    ws.open_tab(urlutil::NEW_TAB_URL, OpenOptions::default(), now());
                }
            }
        }
        let runtime = ws
            .tabs
            .iter()
            .map(|t| (t.id.clone(), TabRuntime { secure: urlutil::is_secure(&t.url), ..Default::default() }))
            .collect();
        filter.https_upgrade.store(settings.https_upgrade, std::sync::atomic::Ordering::Relaxed);
        filter.strip_tracking.store(settings.strip_tracking, std::sync::atomic::Ordering::Relaxed);
        let inner = Inner {
            ws,
            runtime,
            settings,
            filer: session.filer.unwrap_or_default(),
            history,
            bounds: Rect::new(0.0, 0.0, 1.0, 1.0),
            overlay: false,
            live: HashMap::new(),
            want_live: HashSet::new(),
            emulation: HashMap::new(),
            blocked_total: 0,
            focus_next: false,
            closed: vec![],
            had_split: false,
        };
        Arc::new(Self {
            app,
            engine,
            filter,
            paths,
            inner: Mutex::new(inner),
            apply_lock: Mutex::new(()),
            snap_notify: Notify::new(),
            save_notify: Notify::new(),
        })
    }

    /// Spawn the background tasks: throttled snapshot emitter, debounced saver, archiver.
    pub fn start(self: &Arc<Self>, mut events: tokio::sync::mpsc::UnboundedReceiver<EngineEvent>) {
        let this = self.clone();
        tauri::async_runtime::spawn(async move {
            loop {
                this.snap_notify.notified().await;
                tokio::time::sleep(Duration::from_millis(16)).await;
                this.emit_snapshot();
            }
        });
        let this = self.clone();
        tauri::async_runtime::spawn(async move {
            loop {
                this.save_notify.notified().await;
                tokio::time::sleep(Duration::from_millis(800)).await;
                this.save();
            }
        });
        let this = self.clone();
        tauri::async_runtime::spawn(async move {
            while let Some(ev) = events.recv().await {
                let this = this.clone();
                let _ = tauri::async_runtime::spawn_blocking(move || this.handle_event(ev)).await;
            }
        });
        let this = self.clone();
        tauri::async_runtime::spawn(async move {
            let mut tick = tokio::time::interval(Duration::from_secs(60));
            loop {
                tick.tick().await;
                let this = this.clone();
                let _ = tauri::async_runtime::spawn_blocking(move || this.archive_inactive(false)).await;
            }
        });
        // initial paint
        self.changed();
    }

    // ---------- snapshot / persistence ----------

    pub fn snapshot(&self) -> Snapshot {
        let g = self.inner.lock();
        Snapshot {
            workspace: g.ws.clone(),
            runtime: g.runtime.clone(),
            settings: g.settings.clone(),
            filing_rules: g.filer.rules.clone(),
            platform: platform(),
            version: env!("CARGO_PKG_VERSION"),
            blocked_total: g.blocked_total,
        }
    }

    fn emit_snapshot(&self) {
        let _ = self.app.emit("athanor://snapshot", self.snapshot());
        if let Some(rects) = self.split_rects() {
            let _ = self.app.emit("athanor://split-rects", rects);
        }
    }

    fn changed(&self) {
        self.snap_notify.notify_one();
        self.save_notify.notify_one();
    }

    pub fn save(&self) {
        let (session, settings, history) = {
            let g = self.inner.lock();
            (
                Session { workspace: Some(g.ws.clone()), filer: Some(g.filer.clone()) },
                g.settings.clone(),
                g.history.clone(),
            )
        };
        let _ = store::save_atomic(&self.paths.file("session.json"), &session);
        let _ = store::save_atomic(&self.paths.file("settings.json"), &settings);
        let _ = store::save_atomic(&self.paths.file("history.json"), &history);
    }

    /// Push the current adblock status (lists, counters, updating flag) to the shell.
    pub fn emit_adblock(&self) {
        let _ = self.app.emit("athanor://adblock", self.filter.status());
    }

    pub fn toast(&self, level: &str, message: impl Into<String>) {
        let _ = self.app.emit("athanor://toast", serde_json::json!({ "level": level, "message": message.into() }));
    }

    pub fn app(&self) -> &AppHandle {
        &self.app
    }

    // ---------- engine sync ----------

    fn desired_panes(g: &Inner) -> Vec<(Id, Rect)> {
        if g.overlay {
            return vec![];
        }
        let Some(active) = g.ws.active_tab.as_deref() else { return vec![] };
        let mut panes: Vec<(Id, Rect)> = match &g.ws.split {
            Some(s) if s.root.contains(active) => s.root.rects(g.bounds, SPLIT_GAP),
            _ => match g.ws.tab(active) {
                Some(t) if !urlutil::is_internal(&t.url) => vec![(t.id.clone(), g.bounds)],
                _ => vec![],
            },
        };
        panes.retain(|(id, _)| g.ws.tab(id).is_some_and(|t| !urlutil::is_internal(&t.url)));
        for (id, rect) in &mut panes {
            if let Some(&(w, h)) = g.emulation.get(id) {
                let (nw, nh) = (w.min(rect.w), h.min(rect.h));
                *rect = Rect::new(rect.x + (rect.w - nw) / 2.0, rect.y, nw, nh);
            }
        }
        panes
    }

    fn plan(g: &mut Inner) -> Plan {
        let mut plan = Plan::default();
        let panes = Self::desired_panes(g);
        let visible: HashSet<&Id> = panes.iter().map(|(id, _)| id).collect();

        // Tabs that no longer deserve a renderer: gone, archived, or navigated to an internal page.
        let stale: Vec<Id> = g
            .live
            .keys()
            .filter(|id| g.ws.tab(id).is_none_or(|t| t.archived || urlutil::is_internal(&t.url)))
            .cloned()
            .collect();
        for id in stale {
            g.live.remove(&id);
            g.want_live.remove(&id);
            plan.discard.push(id);
        }

        for (id, rect) in &panes {
            match g.live.get_mut(id) {
                None => {
                    let url = g.ws.tab(id).map(|t| t.url.clone()).unwrap_or_default();
                    plan.create.push((id.clone(), url, *rect, true));
                    g.live.insert(id.clone(), Live { visible: true, rect: *rect });
                }
                Some(l) => {
                    if l.rect != *rect {
                        plan.place.push((id.clone(), *rect));
                        l.rect = *rect;
                    }
                    if !l.visible {
                        plan.show.push(id.clone());
                        l.visible = true;
                    }
                }
            }
        }
        let pending: Vec<Id> = g.want_live.iter().filter(|id| !g.live.contains_key(*id)).cloned().collect();
        for id in pending {
            if let Some(t) = g.ws.tab(&id).filter(|t| !t.archived && !urlutil::is_internal(&t.url)) {
                let rect = g.bounds;
                plan.create.push((id.clone(), t.url.clone(), rect, false));
                g.live.insert(id.clone(), Live { visible: false, rect });
            }
            g.want_live.remove(&id);
        }
        for (id, l) in g.live.iter_mut() {
            if !visible.contains(id) && l.visible {
                plan.hide.push(id.clone());
                l.visible = false;
            }
        }
        if g.focus_next {
            g.focus_next = false;
            plan.focus = g.ws.active_tab.clone().filter(|a| visible.contains(a));
        }
        plan
    }

    fn reconcile(&self) {
        let plan = {
            let mut g = self.inner.lock();
            let plan = Self::plan(&mut g);
            g.had_split = g.ws.split.is_some();
            plan
        };
        let _guard = self.apply_lock.lock();
        for id in &plan.discard {
            if let Err(e) = self.engine.discard(id) {
                log::debug!("discard {id}: {e}");
            }
        }
        for (id, url, rect, visible) in &plan.create {
            let opts = TabOptions::default();
            if let Err(e) = self.engine.create_tab(id, url, *rect, *visible, &opts) {
                log::error!("create_tab {id}: {e}");
                let mut g = self.inner.lock();
                g.live.remove(id);
            }
        }
        for (id, rect) in &plan.place {
            let _ = self.engine.set_bounds(id, *rect);
        }
        for id in &plan.show {
            let _ = self.engine.set_visible(id, true);
        }
        for id in &plan.hide {
            let _ = self.engine.set_visible(id, false);
        }
        if let Some(id) = &plan.focus {
            let _ = self.engine.focus(id);
        }
    }

    fn sync(&self) {
        self.reconcile();
        self.changed();
    }

    // ---------- engine events ----------

    pub fn handle_event(self: &Arc<Self>, ev: EngineEvent) {
        match ev {
            EngineEvent::NavigationStarted { tab, url } => {
                let mut g = self.inner.lock();
                if let Some(r) = g.runtime.get_mut(&tab) {
                    r.loading = true;
                    r.blocked = 0;
                    r.secure = urlutil::is_secure(&url);
                }
                drop(g);
                self.changed();
            }
            EngineEvent::UrlChanged { tab, url } => {
                if url == "about:blank" {
                    return;
                }
                let mut g = self.inner.lock();
                if g.ws.tab(&tab).is_none() {
                    return;
                }
                g.ws.update_tab(&tab, Some(&url), None, None);
                if let Some(r) = g.runtime.get_mut(&tab) {
                    r.secure = urlutil::is_secure(&url);
                }
                let title = g.ws.tab(&tab).map(|t| t.title.clone()).unwrap_or_default();
                g.history.record(&url, &title, now());
                self.auto_file_locked(&mut g, &tab);
                drop(g);
                self.changed();
            }
            EngineEvent::TitleChanged { tab, title } => {
                let mut g = self.inner.lock();
                g.ws.update_tab(&tab, None, Some(&title), None);
                if let Some(url) = g.ws.tab(&tab).map(|t| t.url.clone()) {
                    g.history.set_title(&url, &title);
                }
                self.auto_file_locked(&mut g, &tab);
                drop(g);
                self.changed();
            }
            EngineEvent::FaviconChanged { tab, url } => {
                self.inner.lock().ws.update_tab(&tab, None, None, Some(&url));
                self.changed();
            }
            EngineEvent::LoadingChanged { tab, loading } => {
                let mut g = self.inner.lock();
                if let Some(r) = g.runtime.get_mut(&tab) {
                    r.loading = loading;
                }
                if !loading {
                    if let Some(url) = g.ws.tab(&tab).map(|t| t.url.clone()) {
                        g.history.bump(&url);
                    }
                }
                drop(g);
                self.changed();
            }
            EngineEvent::HistoryChanged { tab, can_go_back, can_go_forward } => {
                if let Some(r) = self.inner.lock().runtime.get_mut(&tab) {
                    r.can_go_back = can_go_back;
                    r.can_go_forward = can_go_forward;
                }
                self.changed();
            }
            EngineEvent::AudioChanged { tab, audible } => {
                if let Some(r) = self.inner.lock().runtime.get_mut(&tab) {
                    r.audible = audible;
                }
                self.changed();
            }
            EngineEvent::NewTabRequested { from, url } => {
                let url = if url == "about:blank" { urlutil::NEW_TAB_URL.to_string() } else { url };
                self.open_tab(OpenArgs { url: Some(url), parent: Some(from), ..Default::default() });
            }
            EngineEvent::Shortcut { combo, .. } => self.shortcut(&combo),
            EngineEvent::ContextAction { action, data, .. } => {
                if action == "send-image-to-board" {
                    match crate::boards::inbox_id(&self.paths).and_then(|id| {
                        crate::boards::add_from_url(&self.paths, &id, &data, 0.0, 0.0).map(|()| id)
                    }) {
                        Ok(id) => {
                            let _ = self.app.emit("athanor://board-changed", serde_json::json!({ "id": id }));
                            self.toast("success", "Image added to the Inbox board");
                        }
                        Err(e) => self.toast("error", format!("Couldn't add image: {e}")),
                    }
                }
            }
            EngineEvent::Blocked { tab, .. } => {
                let mut g = self.inner.lock();
                g.blocked_total += 1;
                if let Some(r) = g.runtime.get_mut(&tab) {
                    r.blocked += 1;
                }
                drop(g);
                self.changed();
            }
        }
    }

    fn auto_file_locked(&self, g: &mut Inner, tab: &str) {
        if g.settings.auto_file {
            let filer = g.filer.clone();
            g.ws.auto_file(tab, &filer);
        }
    }

    pub fn shortcut(self: &Arc<Self>, combo: &str) {
        let active = self.inner.lock().ws.active_tab.clone();
        match combo {
            "Ctrl+W" => {
                if let Some(t) = active {
                    self.close_tab(&t);
                }
            }
            "Ctrl+Tab" => self.cycle(1),
            "Ctrl+Shift+Tab" => self.cycle(-1),
            "Alt+Left" => {
                if let Some(t) = active {
                    let _ = self.engine.go_back(&t);
                }
            }
            // Android system back: history -> close child tab -> let the shell close overlays / exit.
            "Back" => {
                let action = {
                    let g = self.inner.lock();
                    match active.as_deref().and_then(|a| g.ws.tab(a).map(|t| (a, t))) {
                        Some((a, _)) if g.overlay => {
                            let _ = a;
                            None
                        }
                        Some((a, _)) if g.runtime.get(a).is_some_and(|r| r.can_go_back) => Some((a.to_string(), false)),
                        Some((a, t)) if t.parent.is_some() => Some((a.to_string(), true)),
                        _ => None,
                    }
                };
                match action {
                    Some((t, false)) => {
                        let _ = self.engine.go_back(&t);
                    }
                    Some((t, true)) => self.close_tab(&t),
                    None => {
                        let _ = self.app.emit("athanor://shortcut", serde_json::json!({ "combo": "Back" }));
                    }
                }
            }
            "Alt+Right" => {
                if let Some(t) = active {
                    let _ = self.engine.go_forward(&t);
                }
            }
            "F5" => {
                if let Some(t) = active {
                    let _ = self.engine.reload(&t);
                }
            }
            "F12" => {
                if let Some(t) = active {
                    let _ = self.engine.open_devtools(&t);
                }
            }
            "Ctrl+Shift+T" => {
                let url = self.inner.lock().closed.pop();
                if let Some(u) = url {
                    self.open_tab(OpenArgs { url: Some(u), ..Default::default() });
                }
            }
            "Ctrl+\\" => {
                let next = {
                    let g = self.inner.lock();
                    let space = g.ws.active_space.clone();
                    let list = g.ws.visible_tabs(&space);
                    let pos = list.iter().position(|t| Some(&t.id) == g.ws.active_tab.as_ref());
                    pos.and_then(|p| list.get((p + 1) % list.len().max(1))).map(|t| t.id.clone())
                };
                if let Some(n) = next {
                    self.split_with(&n, Dir::Row, false);
                }
            }
            c if c.starts_with("Ctrl+") && c.len() == 6 && c.as_bytes()[5].is_ascii_digit() => {
                let n = (c.as_bytes()[5] - b'0') as usize;
                let target = {
                    let g = self.inner.lock();
                    let list = g.ws.visible_tabs(&g.ws.active_space);
                    if n == 9 { list.last().map(|t| t.id.clone()) } else { list.get(n.saturating_sub(1)).map(|t| t.id.clone()) }
                };
                if let Some(t) = target {
                    self.activate_tab(&t);
                }
            }
            // UI-only combos: the shell owns them.
            other => {
                let _ = self.app.emit("athanor://shortcut", serde_json::json!({ "combo": other }));
            }
        }
    }

    fn cycle(self: &Arc<Self>, delta: i32) {
        let target = {
            let g = self.inner.lock();
            let list = g.ws.visible_tabs(&g.ws.active_space);
            if list.is_empty() {
                return;
            }
            let pos = list.iter().position(|t| Some(&t.id) == g.ws.active_tab.as_ref()).unwrap_or(0) as i32;
            let n = list.len() as i32;
            list[(((pos + delta) % n + n) % n) as usize].id.clone()
        };
        self.activate_tab(&target);
    }

    // ---------- tabs ----------

    pub fn open_tab(self: &Arc<Self>, a: OpenArgs) -> Id {
        let (id, _) = {
            let mut g = self.inner.lock();
            let url = match a.url.as_deref() {
                None | Some("") => urlutil::NEW_TAB_URL.to_string(),
                Some(u) => urlutil::resolve_input(u, &g.settings.search_engine).into_url(),
            };
            let opts = OpenOptions {
                space: a.space.clone(),
                parent: a.parent.clone(),
                folder: a.folder.clone(),
                pinned: a.pinned.unwrap_or(false),
                background: a.background.unwrap_or(false),
            };
            let id = g.ws.open_tab(&url, opts, now());
            g.runtime.insert(id.clone(), TabRuntime { secure: urlutil::is_secure(&url), ..Default::default() });
            self.auto_file_locked(&mut g, &id);
            if a.background.unwrap_or(false) {
                g.want_live.insert(id.clone());
            } else {
                g.focus_next = url != urlutil::NEW_TAB_URL;
            }
            (id, url)
        };
        self.sync();
        id
    }

    pub fn navigate(self: &Arc<Self>, tab: &str, input: &str) {
        let mut engine_nav = None;
        {
            let mut g = self.inner.lock();
            if g.ws.tab(tab).is_none() {
                return;
            }
            let url = urlutil::resolve_input(input, &g.settings.search_engine).into_url();
            let was_live = g.live.contains_key(tab);
            g.ws.update_tab(tab, Some(&url), Some(""), None);
            if let Some(r) = g.runtime.get_mut(tab) {
                r.secure = urlutil::is_secure(&url);
                r.loading = !urlutil::is_internal(&url);
            }
            if was_live && !urlutil::is_internal(&url) {
                engine_nav = Some(url);
            }
            g.focus_next = true;
        }
        if let Some(url) = engine_nav {
            let _ = self.engine.navigate(tab, &url);
        }
        self.sync();
    }

    pub fn activate_tab(self: &Arc<Self>, tab: &str) {
        {
            let mut g = self.inner.lock();
            if !g.ws.activate(tab, now()) {
                return;
            }
            g.focus_next = true;
        }
        self.sync();
    }

    pub fn close_tab(self: &Arc<Self>, tab: &str) {
        let closed_url = {
            let mut g = self.inner.lock();
            let Some(t) = g.ws.tab(tab).cloned() else { return };
            if !urlutil::is_internal(&t.url) {
                g.closed.push(t.url.clone());
                if g.closed.len() > 25 {
                    g.closed.remove(0);
                }
            }
            let out = g.ws.close_tab(tab);
            g.runtime.remove(tab);
            g.emulation.remove(tab);
            g.want_live.remove(tab);
            g.live.remove(tab);
            if g.ws.tabs.is_empty() {
                let space = g.ws.active_space.clone();
                g.ws.open_tab(
                    urlutil::NEW_TAB_URL,
                    OpenOptions { space: Some(space), ..Default::default() },
                    now(),
                );
                let id = g.ws.active_tab.clone().unwrap_or_default();
                g.runtime.insert(id, TabRuntime::default());
            } else if out.next_active.is_some() {
                g.focus_next = true;
            }
            g.ws.prune_empty_auto_folders();
            t.url
        };
        let _ = closed_url;
        let _ = self.engine.close_tab(tab);
        self.sync();
    }

    pub fn close_many(self: &Arc<Self>, ids: Vec<Id>) {
        for id in ids {
            self.close_tab(&id);
        }
    }

    pub fn tabs_to_close(&self, tab: &str, below_only: bool) -> Vec<Id> {
        let g = self.inner.lock();
        let Some(t) = g.ws.tab(tab) else { return vec![] };
        let space = t.space.clone();
        let mut out = vec![];
        let mut after = !below_only;
        for x in g.ws.tabs.iter().filter(|x| x.space == space) {
            if x.id == tab {
                after = true;
                continue;
            }
            if after && !x.pinned {
                out.push(x.id.clone());
            }
        }
        out
    }

    pub fn duplicate_tab(self: &Arc<Self>, tab: &str) -> Option<Id> {
        let (url, folder, space) = {
            let g = self.inner.lock();
            let t = g.ws.tab(tab)?;
            (t.url.clone(), t.folder.clone(), t.space.clone())
        };
        Some(self.open_tab(OpenArgs { url: Some(url), parent: Some(tab.to_string()), folder, space: Some(space), ..Default::default() }))
    }

    pub fn with_ws<R>(self: &Arc<Self>, f: impl FnOnce(&mut Workspace) -> R) -> R {
        let r = f(&mut self.inner.lock().ws);
        self.sync();
        r
    }

    pub fn set_pinned(self: &Arc<Self>, tab: &str, pinned: bool) {
        self.with_ws(|w| w.set_pinned(tab, pinned));
    }

    pub fn set_muted(self: &Arc<Self>, tab: &str, muted: bool) {
        self.with_ws(|w| w.set_muted(tab, muted));
        let _ = self.engine.set_muted(tab, muted);
    }

    pub fn move_tab(self: &Arc<Self>, tab: &str, dest: MoveDest) {
        self.with_ws(|w| w.move_tab(tab, dest));
    }

    pub fn restore_tab(self: &Arc<Self>, tab: &str) {
        self.activate_tab(tab);
    }

    pub fn archive_inactive(self: &Arc<Self>, force: bool) {
        let n = {
            let mut g = self.inner.lock();
            let hours = g.settings.archive_after_hours;
            if hours == 0 && !force {
                return;
            }
            let ttl = if force { 0 } else { Millis::from(hours) * 3_600_000 };
            let n = g.ws.archive_inactive(now(), ttl).len();
            g.ws.prune_empty_auto_folders();
            n
        };
        if n > 0 {
            self.sync();
        }
    }

    pub fn auto_file_all(self: &Arc<Self>) {
        {
            let mut g = self.inner.lock();
            let filer = g.filer.clone();
            let ids: Vec<Id> = g.ws.tabs.iter().filter(|t| t.folder.is_none() && !t.pinned).map(|t| t.id.clone()).collect();
            for id in ids {
                g.ws.auto_file(&id, &filer);
            }
        }
        self.sync();
    }

    pub fn set_filing_rules(self: &Arc<Self>, rules: Vec<Rule>) {
        self.inner.lock().filer.rules = rules;
        self.changed();
    }

    // ---------- split ----------

    pub fn split_with(self: &Arc<Self>, tab: &str, dir: Dir, new_first: bool) -> bool {
        let ok = self.inner.lock().ws.split_with(tab, dir, new_first);
        if ok {
            self.sync();
        }
        ok
    }

    pub fn split_rects(&self) -> Option<SplitRects> {
        let g = self.inner.lock();
        let s = g.ws.split.as_ref()?;
        Some(SplitRects {
            panes: s.root.rects(g.bounds, SPLIT_GAP).into_iter().map(|(tab, rect)| Pane { tab, rect }).collect(),
            dividers: s.root.dividers(g.bounds, SPLIT_GAP),
        })
    }

    // ---------- layout ----------

    pub fn set_content_bounds(self: &Arc<Self>, r: Rect) {
        {
            let mut g = self.inner.lock();
            if g.bounds == r {
                return;
            }
            g.bounds = r;
        }
        self.sync();
    }

    pub fn set_overlay_open(self: &Arc<Self>, open: bool) {
        {
            let mut g = self.inner.lock();
            if g.overlay == open {
                return;
            }
            g.overlay = open;
        }
        self.sync();
    }

    pub fn set_viewport_emulation(self: &Arc<Self>, tab: &str, preset: Option<&str>) {
        {
            let mut g = self.inner.lock();
            match preset {
                Some("mobile") => g.emulation.insert(tab.to_string(), (390.0, 844.0)),
                Some("tablet") => g.emulation.insert(tab.to_string(), (820.0, 1180.0)),
                Some("laptop") => g.emulation.insert(tab.to_string(), (1280.0, 800.0)),
                _ => g.emulation.remove(tab),
            };
            // force a re-place even if the pane rect is otherwise unchanged
            if let Some(l) = g.live.get_mut(tab) {
                l.rect = Rect::default();
            }
        }
        self.sync();
    }

    // ---------- settings ----------

    pub fn settings(&self) -> Settings {
        self.inner.lock().settings.clone()
    }

    pub fn set_settings(self: &Arc<Self>, patch: SettingsPatch) {
        let s = {
            let mut g = self.inner.lock();
            g.settings.apply(patch);
            g.settings.clone()
        };
        self.filter.https_upgrade.store(s.https_upgrade, std::sync::atomic::Ordering::Relaxed);
        self.filter.strip_tracking.store(s.strip_tracking, std::sync::atomic::Ordering::Relaxed);
        self.changed();
    }

    // ---------- omnibox ----------

    pub fn suggest(&self, query: &str) -> Vec<Suggestion> {
        let q = query.trim();
        if q.is_empty() {
            return vec![];
        }
        let g = self.inner.lock();
        let ql = q.to_lowercase();
        let mut out = vec![];
        match urlutil::resolve_input(q, &g.settings.search_engine) {
            urlutil::Resolved::Url(u) => out.push(Suggestion {
                kind: "url",
                title: u.clone(),
                subtitle: "Go to address".into(),
                url: Some(u),
                tab: None,
                icon: None,
                command: None,
            }),
            urlutil::Resolved::Search(u) => out.push(Suggestion {
                kind: "search",
                title: format!("Search for \"{q}\""),
                subtitle: urlutil::display_host(&g.settings.search_engine),
                url: Some(u),
                tab: None,
                icon: None,
                command: None,
            }),
        }
        for t in g.ws.tabs.iter().filter(|t| !t.archived).filter(|t| t.title.to_lowercase().contains(&ql) || t.url.to_lowercase().contains(&ql)).take(5) {
            out.push(Suggestion {
                kind: "tab",
                title: if t.title.is_empty() { urlutil::display_host(&t.url) } else { t.title.clone() },
                subtitle: t.url.clone(),
                url: Some(t.url.clone()),
                tab: Some(t.id.clone()),
                icon: t.favicon.clone(),
                command: None,
            });
        }
        for e in g.history.search(q, 6, now()) {
            if out.iter().any(|s| s.url.as_deref() == Some(e.url.as_str())) {
                continue;
            }
            out.push(Suggestion {
                kind: "history",
                title: if e.title.is_empty() { urlutil::display_host(&e.url) } else { e.title.clone() },
                subtitle: e.url.clone(),
                url: Some(e.url.clone()),
                tab: None,
                icon: None,
                command: None,
            });
        }
        out
    }

    pub fn run_dev_tool(tool: devtools::Tool, input: &str) -> Result<String, String> {
        devtools::run(tool, input)
    }

    pub fn open_devtools(&self, tab: &str) {
        let _ = self.engine.open_devtools(tab);
    }

    pub fn copy_url(&self, tab: &str) -> Option<String> {
        self.inner.lock().ws.tab(tab).map(|t| t.url.clone())
    }

    pub fn reload_stop(&self, tab: &str, what: &str) {
        let _ = match what {
            "reload" => self.engine.reload(tab),
            "stop" => self.engine.stop(tab),
            "back" => self.engine.go_back(tab),
            _ => self.engine.go_forward(tab),
        };
    }

    /// Screenshot a tab into a board (PureRef-style capture).
    pub fn capture_to_board(&self, tab: &str, board_id: &str) -> Result<(), String> {
        let png = self.engine.capture_png(tab).map_err(|e| e.to_string())?;
        let size = imagesize::blob_size(&png).map_err(|e| e.to_string())?;
        let hash = crate::boards::assets(&self.paths).put(&png, "image/png").map_err(|e| e.to_string())?;
        let url = self.copy_url(tab);
        crate::boards::add_asset(&self.paths, board_id, &hash, "image/png", size.width as f64, size.height as f64, url)?;
        let _ = self.app.emit("athanor://board-changed", serde_json::json!({ "id": board_id }));
        Ok(())
    }

}

#[derive(Clone, Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenArgs {
    pub url: Option<String>,
    pub parent: Option<Id>,
    pub folder: Option<Id>,
    pub space: Option<Id>,
    pub background: Option<bool>,
    pub pinned: Option<bool>,
}
