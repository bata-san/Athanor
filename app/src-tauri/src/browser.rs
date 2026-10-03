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
    plan::{self, ViewState, SPLIT_GAP},
    store, urlutil, Id, Millis, Workspace,
};
use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    path::PathBuf,
    sync::{Arc, OnceLock},
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use tauri::{AppHandle, Emitter};
use tokio::sync::Notify;

pub fn now() -> Millis {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |d| d.as_millis() as Millis)
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

struct Inner {
    ws: Workspace,
    runtime: HashMap<Id, TabRuntime>,
    settings: Settings,
    filer: Filer,
    history: History,
    /// Everything the pure planner in [`athanor_core::plan`] needs: content bounds, overlay
    /// state, which tabs own a webview, viewport emulation and the pending focus request.
    view: ViewState,
    blocked_total: u64,
    closed: Vec<String>,
    /// The address each tab last really arrived at (a typed address that turns out to be a download is not one).
    committed: HashMap<String, String>,
    /// Cookies waiting for a tab that is being recreated in the other rendering mode.
    cookie_seed: HashMap<String, String>,
    had_split: bool,
}

type ThemeHook = Box<dyn Fn(&str) + Send + Sync>;

pub struct Browser {
    app: AppHandle,
    engine: Arc<dyn EngineBackend>,
    pub filter: Arc<Filter>,
    pub paths: Paths,
    inner: Mutex<Inner>,
    apply_lock: Mutex<()>,
    snap_notify: Notify,
    save_notify: Notify,
    /// Called with the effective theme id whenever it changes (settings theme or the active space's override).
    theme_hook: OnceLock<ThemeHook>,
    last_theme: Mutex<String>,
    /// Tabs whose page is currently shown translated.
    translated: Mutex<std::collections::HashSet<String>>,
}

impl Browser {
    pub fn new(
        app: AppHandle,
        engine: Arc<dyn EngineBackend>,
        filter: Arc<Filter>,
        paths: Paths,
    ) -> Arc<Self> {
        let settings: Settings =
            store::load_or_default(&paths.file("settings.json")).unwrap_or_default();
        let session: Session =
            store::load_or_default(&paths.file("session.json")).unwrap_or_default();
        let history: History = store::load_or_default::<History>(&paths.file("history.json"))
            .map(History::sanitized)
            .unwrap_or_default();
        let mut settings = settings;
        settings.sanitize();
        let mut ws = if settings.restore_session {
            session.workspace.unwrap_or_default()
        } else {
            Workspace::default()
        };
        if ws.spaces.is_empty() {
            ws = Workspace::default();
        }
        if ws.tabs.is_empty() {
            ws.open_tab(&settings.new_tab_url(), OpenOptions::default(), now());
        } else if ws.active_tab.as_deref().and_then(|a| ws.tab(a)).is_none() {
            let first = ws.tabs.iter().find(|t| !t.archived).map(|t| t.id.clone());
            match first {
                Some(id) => {
                    ws.activate(&id, now());
                }
                None => {
                    ws.open_tab(&settings.new_tab_url(), OpenOptions::default(), now());
                }
            }
        }
        // Sessions saved before built-in pages had titles.
        let ids: Vec<Id> = ws
            .tabs
            .iter()
            .filter(|t| t.title.is_empty() && urlutil::is_internal(&t.url))
            .map(|t| t.id.clone())
            .collect();
        for id in ids {
            let url = ws.tab(&id).map(|t| t.url.clone()).unwrap_or_default();
            ws.update_tab(&id, Some(&url), None, None);
        }
        // A session edited by hand (or from an older version) may point at an archived active tab.
        if let Some(active) = ws.active_tab.clone() {
            ws.activate(&active, now());
        }
        let runtime = ws
            .tabs
            .iter()
            .map(|t| {
                (
                    t.id.clone(),
                    TabRuntime {
                        secure: urlutil::is_secure(&t.url),
                        ..Default::default()
                    },
                )
            })
            .collect();
        filter
            .https_upgrade
            .store(settings.https_upgrade, std::sync::atomic::Ordering::Relaxed);
        filter.strip_tracking.store(
            settings.strip_tracking,
            std::sync::atomic::Ordering::Relaxed,
        );
        filter.set_youtube_ad_skip(settings.youtube_ad_skip);
        filter.set_block_drm(settings.block_drm);
        let inner = Inner {
            ws,
            runtime,
            settings,
            filer: session.filer.unwrap_or_default(),
            history,
            view: ViewState::default(),
            blocked_total: 0,
            closed: vec![],
            committed: HashMap::new(),
            cookie_seed: HashMap::new(),
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
            theme_hook: OnceLock::new(),
            last_theme: Mutex::new(String::new()),
            translated: Mutex::new(Default::default()),
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
                let _ = tauri::async_runtime::spawn_blocking(move || this.archive_inactive(false))
                    .await;
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

    /// Install the callback that (re)sends the shell CSS when the effective theme changes.
    pub fn set_theme_hook(&self, hook: impl Fn(&str) + Send + Sync + 'static) {
        let _ = self.theme_hook.set(Box::new(hook));
    }

    fn effective_theme(&self) -> String {
        let g = self.inner.lock();
        g.ws.space(&g.ws.active_space)
            .and_then(|s| s.theme.clone())
            .unwrap_or_else(|| g.settings.theme.clone())
    }

    fn emit_snapshot(&self) {
        let theme = self.effective_theme();
        if let Some(hook) = self.theme_hook.get() {
            let mut last = self.last_theme.lock();
            if *last != theme {
                *last = theme.clone();
                hook(&theme);
            }
        }
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
                Session {
                    workspace: Some(g.ws.clone()),
                    filer: Some(g.filer.clone()),
                },
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
        let _ = self.app.emit(
            "athanor://toast",
            serde_json::json!({ "level": level, "message": message.into() }),
        );
    }

    pub fn app(&self) -> &AppHandle {
        &self.app
    }

    // ---------- engine sync ----------

    fn reconcile(&self) {
        // Plan and apply under the same lock so two threads can never apply their plans out of order
        // (which would leave `view.live` and the real webviews permanently out of sync).
        let _guard = self.apply_lock.lock();
        let plan = {
            let mut g = self.inner.lock();
            g.had_split = g.ws.split.is_some();
            // Split the borrow once: the planner needs the workspace immutably and the view
            // state mutably, which a `MutexGuard` deref cannot do field by field.
            let Inner { ws, view, .. } = &mut *g;
            plan::plan(ws, view)
        };
        for id in &plan.discard {
            if let Err(e) = self.engine.discard(id) {
                log::debug!("discard {id}: {e}");
            }
        }
        for c in &plan.create {
            let (software, seed, muted) = {
                let mut g = self.inner.lock();
                let software = g.ws.tab(&c.id).is_some_and(|t| t.software_rendering);
                let muted = g.ws.tab(&c.id).is_some_and(|t| t.muted);
                (software, g.cookie_seed.remove(&c.id), muted)
            };
            let opts = TabOptions {
                software_rendering: software,
                seed_cookies: seed,
                ..TabOptions::default()
            };
            if let Err(e) = self
                .engine
                .create_tab(&c.id, &c.url, c.rect, c.visible, &opts)
            {
                log::error!("create_tab {}: {e}", c.id);
                let mut g = self.inner.lock();
                g.view.live.remove(&c.id);
            } else if muted {
                let _ = self.engine.set_muted(&c.id, true);
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
                if !url.starts_with("data:") && self.translated.lock().remove(&tab) {
                    self.translation_state(&tab, "original");
                }
                let mut g = self.inner.lock();
                // The error page is itself a navigation (to a data: document); it is not a place the tab went to.
                if url.starts_with("data:") && g.runtime.get(&tab).is_some_and(|r| r.failed) {
                    return;
                }
                if let Some(r) = g.runtime.get_mut(&tab) {
                    r.failed = false;
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
                if url.starts_with("data:") && g.runtime.get(&tab).is_some_and(|r| r.failed) {
                    return;
                }
                if g.ws.tab(&tab).is_none() {
                    return;
                }
                g.committed.insert(tab.clone(), url.clone());
                g.ws.update_tab(&tab, Some(&url), None, None);
                if let Some(r) = g.runtime.get_mut(&tab) {
                    r.secure = urlutil::is_secure(&url);
                }
                let title = g.ws.tab(&tab).map(|t| t.title.clone()).unwrap_or_default();
                g.history.record(&url, &title, now());
                self.auto_file_locked(&mut g, &tab);
                let zoom = crate::pagetools::zoom_key(&url)
                    .and_then(|host| g.settings.site_zoom.get(&host).copied())
                    .unwrap_or(1.0);
                drop(g);
                // Zoom belongs to the site, not to the tab: put the remembered level back after every navigation.
                let _ = self.engine.set_zoom(&tab, zoom);
                self.changed();
            }
            EngineEvent::LoadFailed { tab, .. } => {
                if let Some(r) = self.inner.lock().runtime.get_mut(&tab) {
                    r.failed = true;
                    r.loading = false;
                }
                self.changed();
            }
            EngineEvent::StatusText { .. } => {
                let _ = self.app.emit("athanor://status-text", &ev);
            }
            EngineEvent::ScriptDialog { .. } => {
                let _ = self.app.emit("athanor://script-dialog", &ev);
            }
            EngineEvent::Download {
                ref tab, ref state, ..
            } => {
                if state == "started" {
                    // The address that was typed turned out to be a file: the tab stays where it was.
                    let mut g = self.inner.lock();
                    let back = g.committed.get(tab).cloned();
                    if let Some(url) = back {
                        if g.ws.tab(tab).is_some_and(|t| t.url != url) {
                            g.ws.update_tab(tab, Some(&url), None, None);
                        }
                        if let Some(r) = g.runtime.get_mut(tab) {
                            r.loading = false;
                        }
                        drop(g);
                        self.changed();
                    }
                }
                let _ = self.app.emit("athanor://download", &ev);
            }
            EngineEvent::PermissionRequest {
                tab,
                id,
                origin,
                kind,
            } => {
                let key = crate::pagetools::permission_key(&origin, &kind);
                let known = self
                    .inner
                    .lock()
                    .settings
                    .site_permissions
                    .get(&key)
                    .copied();
                match known {
                    Some(allow) => {
                        let _ = self.engine.resolve_permission(&tab, id, allow);
                    }
                    None => {
                        let _ = self.app.emit(
                            "athanor://permission",
                            serde_json::json!({
                                "tab": tab, "id": id, "origin": origin, "kind": kind,
                                "host": crate::pagetools::permission_host(&origin),
                            }),
                        );
                    }
                }
            }
            EngineEvent::ZoomChanged { tab, factor } => {
                let mut g = self.inner.lock();
                let key =
                    g.ws.tab(&tab)
                        .and_then(|t| crate::pagetools::zoom_key(&t.url));
                if let Some(host) = key {
                    let changed = if (factor - 1.0).abs() < 0.01 {
                        g.settings.site_zoom.remove(&host).is_some()
                    } else {
                        let clamped = factor.clamp(0.25, 5.0);
                        g.settings.site_zoom.insert(host, clamped) != Some(clamped)
                    };
                    drop(g);
                    if changed {
                        self.changed();
                    }
                }
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
                self.inner
                    .lock()
                    .ws
                    .update_tab(&tab, None, None, Some(&url));
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
            EngineEvent::HistoryChanged {
                tab,
                can_go_back,
                can_go_forward,
            } => {
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
                let url = if url == "about:blank" {
                    urlutil::NEW_TAB_URL.to_string()
                } else {
                    url
                };
                self.open_tab(OpenArgs {
                    url: Some(url),
                    parent: Some(from),
                    ..Default::default()
                });
            }
            EngineEvent::Shortcut { combo, .. } => self.shortcut(&combo),
            EngineEvent::ContextAction { action, data, .. } => self.context_action(&action, &data),
            EngineEvent::PageContextMenu { .. } => {
                let _ = self.app.emit("athanor://context-menu", &ev);
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
                        Some((a, _)) if g.view.overlay => {
                            let _ = a;
                            None
                        }
                        Some((a, _)) if g.runtime.get(a).is_some_and(|r| r.can_go_back) => {
                            Some((a.to_string(), false))
                        }
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
                        let _ = self
                            .app
                            .emit("athanor://shortcut", serde_json::json!({ "combo": "Back" }));
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
            "Ctrl+Shift+R" => {
                if let Some(t) = active {
                    self.hard_reload(&t);
                }
            }
            "Ctrl+P" => {
                if let Some(t) = active {
                    let _ = self.engine.eval(&t, "window.print()");
                }
            }
            "F11" => self.toggle_fullscreen(),
            "Ctrl+=" | "Ctrl+-" | "Ctrl+0" => {
                if let Some(t) = active {
                    self.zoom_page(
                        &t,
                        if combo == "Ctrl+=" {
                            1
                        } else if combo == "Ctrl+-" {
                            -1
                        } else {
                            0
                        },
                    );
                }
            }
            "Ctrl+Shift+T" => {
                let url = self.inner.lock().closed.pop();
                if let Some(u) = url {
                    self.open_tab(OpenArgs {
                        url: Some(u),
                        ..Default::default()
                    });
                }
            }
            "Ctrl+\\" => {
                let next = {
                    let g = self.inner.lock();
                    let space = g.ws.active_space.clone();
                    let list = g.ws.visible_tabs(&space);
                    let pos = list
                        .iter()
                        .position(|t| Some(&t.id) == g.ws.active_tab.as_ref());
                    pos.and_then(|p| list.get((p + 1) % list.len().max(1)))
                        .map(|t| t.id.clone())
                };
                if let Some(n) = next {
                    self.split_with(&n, Dir::Row, false);
                }
            }
            c if c.starts_with("Ctrl+") && c.len() == 6 && c.as_bytes()[5].is_ascii_digit() => {
                let n = (c.as_bytes()[5] - b'0') as usize;
                let target = {
                    let g = self.inner.lock();
                    // Pinned tabs first, then down the sidebar; Ctrl+9 is the last one.
                    let list = g.ws.numbered_tabs(&g.ws.active_space);
                    if n == 9 {
                        list.last().map(|t| t.id.clone())
                    } else {
                        list.get(n.saturating_sub(1)).map(|t| t.id.clone())
                    }
                };
                if let Some(t) = target {
                    self.activate_tab(&t);
                }
            }
            // UI-only combos: the shell owns them.
            other => {
                let _ = self
                    .app
                    .emit("athanor://shortcut", serde_json::json!({ "combo": other }));
            }
        }
    }

    fn cycle(self: &Arc<Self>, delta: i32) {
        let target = {
            let g = self.inner.lock();
            let list = g.ws.sidebar_order(&g.ws.active_space);
            if list.is_empty() {
                return;
            }
            let pos = list
                .iter()
                .position(|t| Some(&t.id) == g.ws.active_tab.as_ref())
                .unwrap_or(0) as i32;
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
                None | Some("") => g.settings.new_tab_url(),
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
            g.runtime.insert(
                id.clone(),
                TabRuntime {
                    secure: urlutil::is_secure(&url),
                    ..Default::default()
                },
            );
            self.auto_file_locked(&mut g, &id);
            if a.background.unwrap_or(false) {
                g.view.want_live.insert(id.clone());
            } else {
                g.view.focus_next = url != urlutil::NEW_TAB_URL;
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
            let was_live = g.view.live.contains_key(tab);
            g.ws.update_tab(tab, Some(&url), Some(""), None);
            if let Some(r) = g.runtime.get_mut(tab) {
                r.secure = urlutil::is_secure(&url);
                r.loading = !urlutil::is_internal(&url);
            }
            if was_live && !urlutil::is_internal(&url) {
                engine_nav = Some(url);
            }
            g.view.focus_next = true;
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
            g.view.focus_next = true;
        }
        self.sync();
    }

    pub fn close_tab(self: &Arc<Self>, tab: &str) {
        let label = {
            let g = self.inner.lock();
            g.ws.tab(tab)
                .filter(|t| !urlutil::is_internal(&t.url))
                .map(|t| t.title.clone())
        };
        if self.close_tab_quiet(tab) {
            self.sync();
            if let Some(title) = label {
                // The shell offers Undo (a closed page is cheap to bring back, so no confirmation beforehand).
                let _ = self.app.emit(
                    "athanor://closed",
                    serde_json::json!({ "count": 1, "title": title }),
                );
            }
        }
    }

    /// Bring back the last `count` closed pages, oldest first (the order they were open in).
    pub fn reopen_closed(self: &Arc<Self>, count: usize) {
        let urls = {
            let mut g = self.inner.lock();
            let keep = g.closed.len().saturating_sub(count.max(1));
            g.closed.split_off(keep)
        };
        for url in urls {
            self.open_tab(OpenArgs {
                url: Some(url),
                ..Default::default()
            });
        }
    }

    /// Close without reconciling; returns whether the tab existed.
    fn close_tab_quiet(self: &Arc<Self>, tab: &str) -> bool {
        let closed_url = {
            let mut g = self.inner.lock();
            let Some(t) = g.ws.tab(tab).cloned() else {
                return false;
            };
            if !urlutil::is_internal(&t.url) {
                g.closed.push(t.url.clone());
                if g.closed.len() > 25 {
                    g.closed.remove(0);
                }
            }
            let out = g.ws.close_tab(tab);
            g.runtime.remove(tab);
            g.committed.remove(tab);
            g.view.emulation.remove(tab);
            g.view.want_live.remove(tab);
            g.view.live.remove(tab);
            if g.ws.tabs.is_empty() {
                let space = g.ws.active_space.clone();
                let home = g.settings.new_tab_url();
                g.ws.open_tab(
                    &home,
                    OpenOptions {
                        space: Some(space),
                        ..Default::default()
                    },
                    now(),
                );
                let id = g.ws.active_tab.clone().unwrap_or_default();
                g.runtime.insert(id, TabRuntime::default());
            } else if out.next_active.is_some() {
                g.view.focus_next = true;
            }
            g.ws.prune_empty_auto_folders();
            t.url
        };
        let _ = closed_url;
        {
            let _guard = self.apply_lock.lock();
            let _ = self.engine.close_tab(tab);
        }
        true
    }

    pub fn close_many(self: &Arc<Self>, ids: Vec<Id>) {
        let mut any = false;
        let mut pages = 0usize;
        for id in ids {
            let web = {
                let g = self.inner.lock();
                g.ws.tab(&id).is_some_and(|t| !urlutil::is_internal(&t.url))
            };
            if self.close_tab_quiet(&id) {
                any = true;
                pages += usize::from(web);
            }
        }
        if any {
            self.sync();
            if pages > 0 {
                let _ = self.app.emit(
                    "athanor://closed",
                    serde_json::json!({ "count": pages, "title": "" }),
                );
            }
        }
    }

    pub fn tabs_to_close(&self, tab: &str, below_only: bool) -> Vec<Id> {
        let g = self.inner.lock();
        let Some(t) = g.ws.tab(tab) else {
            return vec![];
        };
        let space = t.space.clone();
        let mut out = vec![];
        let mut after = !below_only;
        for x in g.ws.tabs.iter().filter(|x| x.space == space) {
            if x.id == tab {
                after = true;
                continue;
            }
            if after && !x.pinned && !x.archived {
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
        Some(self.open_tab(OpenArgs {
            url: Some(url),
            parent: Some(tab.to_string()),
            folder,
            space: Some(space),
            ..Default::default()
        }))
    }

    pub fn with_ws<R>(self: &Arc<Self>, f: impl FnOnce(&mut Workspace) -> R) -> R {
        let r = f(&mut self.inner.lock().ws);
        self.sync();
        r
    }

    pub fn set_pinned(self: &Arc<Self>, tab: &str, pinned: bool) {
        self.with_ws(|w| w.set_pinned(tab, pinned));
    }

    /// Switch one tab between GPU and software rendering. The tab is recreated at its address (a view cannot change
    /// mode in place); the cookies that apply to its address come along, so it stays signed in.
    pub fn set_software_rendering(self: &Arc<Self>, tab: &str, software: bool) {
        let (url, was_live) = {
            let g = self.inner.lock();
            let Some(t) = g.ws.tab(tab) else { return };
            if t.software_rendering == software {
                return;
            }
            (t.url.clone(), g.view.live.contains_key(tab))
        };
        let finish = {
            let this = self.clone();
            let tab = tab.to_string();
            move |cookies: Option<String>| {
                {
                    let mut g = this.inner.lock();
                    g.ws.set_software_rendering(&tab, software);
                    if let Some(cookies) = cookies {
                        g.cookie_seed.insert(tab.clone(), cookies);
                    }
                    g.view.live.remove(&tab);
                }
                let _ = this.engine.close_tab(&tab);
                this.sync();
            }
        };
        if !was_live || !url.starts_with("http") {
            finish(None);
            return;
        }
        let params = serde_json::json!({ "urls": [url] }).to_string();
        let on_cookies = {
            let finish = finish.clone();
            // Replied on the engine's thread: recreating the view happens elsewhere.
            move |json: String| {
                let finish = finish.clone();
                std::thread::spawn(move || finish(Some(json)));
            }
        };
        if self
            .engine
            .devtools_json(tab, "Network.getCookies", &params, Box::new(on_cookies))
            .is_err()
        {
            finish(None);
        }
    }

    pub fn set_muted(self: &Arc<Self>, tab: &str, muted: bool) {
        self.with_ws(|w| w.set_muted(tab, muted));
        let _ = self.engine.set_muted(tab, muted);
    }

    pub fn move_tab(self: &Arc<Self>, tab: &str, dest: MoveDest) {
        self.with_ws(|w| w.move_tab(tab, dest));
    }

    /// Bring bookmarks in as archived tabs of their own space (see `athanor_core::import`).
    pub fn import_bookmarks(
        self: &Arc<Self>,
        space_name: &str,
        nodes: &[athanor_core::import::ImportNode],
        max_tabs: usize,
    ) -> athanor_core::import::ImportCounts {
        self.with_ws(|w| w.import_bookmarks(space_name, nodes, now(), max_tabs))
    }

    /// Merge imported history into the omnibox history.
    pub fn import_history(
        self: &Arc<Self>,
        items: Vec<(String, String, u32, u64)>,
        ceiling: usize,
    ) -> usize {
        let n = self.inner.lock().history.import(items, ceiling);
        self.changed();
        n
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
            let ttl = if force {
                0
            } else {
                Millis::from(hours) * 3_600_000
            };
            // A tab that is playing sound is in use, however long ago it was last looked at.
            let busy: Vec<Id> = g
                .runtime
                .iter()
                .filter(|(_, r)| r.audible)
                .map(|(id, _)| id.clone())
                .collect();
            let n = g.ws.archive_inactive(now(), ttl, &busy).len();
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
            let ids: Vec<Id> =
                g.ws.tabs
                    .iter()
                    .filter(|t| t.folder.is_none() && !t.pinned)
                    .map(|t| t.id.clone())
                    .collect();
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
            panes: s
                .root
                .rects(g.view.bounds, SPLIT_GAP)
                .into_iter()
                .map(|(tab, rect)| Pane { tab, rect })
                .collect(),
            dividers: s.root.dividers(g.view.bounds, SPLIT_GAP),
        })
    }

    // ---------- layout ----------

    pub fn set_content_bounds(self: &Arc<Self>, r: Rect) {
        {
            let mut g = self.inner.lock();
            if g.view.bounds == r {
                return;
            }
            g.view.bounds = r;
        }
        self.sync();
    }

    pub fn set_overlay_open(self: &Arc<Self>, open: bool) {
        {
            let mut g = self.inner.lock();
            if g.view.overlay == open {
                return;
            }
            g.view.overlay = open;
        }
        self.sync();
    }

    /// Round the corners of the page views (physical px) so they can sit inside the shell's rounded stage.
    pub fn set_page_radius(&self, radius: i32) {
        let _ = self.engine.set_corner_radius(radius);
    }

    pub fn set_viewport_emulation(self: &Arc<Self>, tab: &str, preset: Option<&str>) {
        {
            let mut g = self.inner.lock();
            match preset {
                Some("mobile") => g.view.emulation.insert(tab.to_string(), (390.0, 844.0)),
                Some("tablet") => g.view.emulation.insert(tab.to_string(), (820.0, 1180.0)),
                Some("laptop") => g.view.emulation.insert(tab.to_string(), (1280.0, 800.0)),
                _ => g.view.emulation.remove(tab),
            };
            // force a re-place even if the pane rect is otherwise unchanged
            if let Some(l) = g.view.live.get_mut(tab) {
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
        self.filter
            .https_upgrade
            .store(s.https_upgrade, std::sync::atomic::Ordering::Relaxed);
        self.filter
            .strip_tracking
            .store(s.strip_tracking, std::sync::atomic::Ordering::Relaxed);
        self.filter.set_youtube_ad_skip(s.youtube_ad_skip);
        self.filter.set_block_drm(s.block_drm);
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
        for t in g
            .ws
            .tabs
            .iter()
            .filter(|t| !t.archived)
            .filter(|t| t.title.to_lowercase().contains(&ql) || t.url.to_lowercase().contains(&ql))
            .take(5)
        {
            out.push(Suggestion {
                kind: "tab",
                title: if t.title.is_empty() {
                    urlutil::display_host(&t.url)
                } else {
                    t.title.clone()
                },
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
                title: if e.title.is_empty() {
                    urlutil::display_host(&e.url)
                } else {
                    e.title.clone()
                },
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

    /// Zoom the page one step (`dir` > 0 in, < 0 out, 0 back to 100 %). Remembered for the site.
    pub fn zoom_page(self: &Arc<Self>, tab: &str, dir: i32) {
        let (key, current) = {
            let g = self.inner.lock();
            let Some(t) = g.ws.tab(tab) else { return };
            let key = crate::pagetools::zoom_key(&t.url);
            let current = key
                .as_ref()
                .and_then(|k| g.settings.site_zoom.get(k).copied())
                .unwrap_or(1.0);
            (key, current)
        };
        let next = crate::pagetools::zoom_step(current, dir);
        if self.engine.set_zoom(tab, next).is_err() {
            return;
        }
        if let Some(host) = key {
            let mut g = self.inner.lock();
            if (next - 1.0).abs() < 0.01 {
                g.settings.site_zoom.remove(&host);
            } else {
                g.settings.site_zoom.insert(host, next);
            }
            drop(g);
            self.changed();
        }
    }

    /// Reload ignoring the cache (falls back to a normal reload).
    pub fn hard_reload(&self, tab: &str) {
        if self
            .engine
            .devtools_call(tab, "Page.reload", r#"{"ignoreCache":true}"#)
            .is_err()
        {
            let _ = self.engine.reload(tab);
        }
    }

    /// Keyboard focus to the shell UI (e.g. the find bar) or back to a page.
    pub fn focus_shell(&self) {
        // Mobile has a single webview and no focus to move.
        #[cfg(desktop)]
        {
            use tauri::Manager;
            if let Some(shell) = self.app.get_webview("shell") {
                let _ = shell.set_focus();
            }
        }
    }

    pub fn focus_page(&self, tab: &str) {
        let _ = self.engine.focus(tab);
    }

    /// The shell's answer to a JavaScript dialog.
    pub fn resolve_script_dialog(&self, tab: &str, accept: bool, text: &str) {
        let _ = self.engine.resolve_script_dialog(tab, accept, text);
    }

    /// The shell's answer to a permission prompt; `remember` keeps it for that site.
    pub fn resolve_permission(
        &self,
        tab: &str,
        id: u32,
        allow: bool,
        remember: Option<(String, String)>,
    ) {
        if let Some((origin, kind)) = remember {
            let key = crate::pagetools::permission_key(&origin, &kind);
            self.inner
                .lock()
                .settings
                .site_permissions
                .insert(key, allow);
            self.changed();
        }
        let _ = self.engine.resolve_permission(tab, id, allow);
    }

    pub fn reset_site_permissions(&self) {
        self.inner.lock().settings.site_permissions.clear();
        self.changed();
    }

    /// Ask the page for its session history; the answer goes to the shell as `athanor://nav-history`.
    pub fn nav_history(&self, tab: &str) {
        let (app, tab_id) = (self.app.clone(), tab.to_string());
        let reply: Box<dyn FnOnce(String) + Send> = Box::new(move |json| {
            let value: serde_json::Value = serde_json::from_str(&json).unwrap_or_default();
            let current = value
                .get("currentIndex")
                .and_then(|v| v.as_i64())
                .unwrap_or(-1);
            let entries: Vec<serde_json::Value> = value
                .get("entries")
                .and_then(|v| v.as_array())
                .map(|list| {
                    list.iter()
                        .map(|entry| {
                            serde_json::json!({
                                "id": entry.get("id").and_then(|v| v.as_i64()).unwrap_or(0),
                                "url": entry.get("url").and_then(|v| v.as_str()).unwrap_or(""),
                                "title": entry.get("title").and_then(|v| v.as_str()).unwrap_or(""),
                            })
                        })
                        .collect()
                })
                .unwrap_or_default();
            let _ = app.emit(
                "athanor://nav-history",
                serde_json::json!({ "tab": tab_id, "current": current, "entries": entries }),
            );
        });
        let _ = self
            .engine
            .devtools_json(tab, "Page.getNavigationHistory", "{}", reply);
    }

    /// Jump to one entry of the session history (see [`Browser::nav_history`]).
    pub fn nav_history_go(&self, tab: &str, entry_id: i64) {
        let _ = self.engine.devtools_call(
            tab,
            "Page.navigateToHistoryEntry",
            &serde_json::json!({ "entryId": entry_id }).to_string(),
        );
    }

    fn translation_state(&self, tab: &str, state: &str) {
        let _ = self.app.emit(
            "athanor://translate",
            serde_json::json!({ "tab": tab, "state": state }),
        );
    }

    /// Translate the page of `tab` into `lang`, or put the original back when it is already translated. Only the
    /// text of the page's text nodes is replaced (see `translate.js`), so its structure and scripts are untouched.
    pub fn translate_page(self: &Arc<Self>, tab: &str, lang: &str) {
        let tab = tab.to_string();
        if self.translated.lock().remove(&tab) {
            let _ = self
                .engine
                .eval(&tab, "window.__athTr&&window.__athTr.restore()");
            self.translation_state(&tab, "original");
            return;
        }
        self.translated.lock().insert(tab.clone());
        self.translation_state(&tab, "working");
        let target = lang.to_string();
        let collect = format!(
            "{}
window.__athTr.collect()",
            crate::translate::PAGE_SCRIPT
        );
        let reply: Box<dyn FnOnce(String) + Send> = {
            let (this, tab) = (self.clone(), tab.clone());
            Box::new(move |json| {
                // Translating takes seconds; never on the engine's callback thread.
                std::thread::spawn(move || this.run_translation(&tab, &target, &json));
            })
        };
        if self.engine.eval_json(&tab, &collect, reply).is_err() {
            self.translated.lock().remove(&tab);
            self.translation_state(&tab, "original");
            self.toast("error", "This page can't be translated here");
        }
    }

    fn run_translation(self: &Arc<Self>, tab: &str, target: &str, json: &str) {
        let units: Vec<crate::translate::Unit> = serde_json::from_str(json).unwrap_or_default();
        if units.is_empty() {
            self.translated.lock().remove(tab);
            self.translation_state(tab, "original");
            self.toast("info", "Nothing on this page to translate");
            return;
        }
        let tight = target.starts_with("ja") || target.starts_with("zh");
        let (failed, error) = crate::translate::translate_all(&units, target, |results| {
            // The page may have moved on (or been restored) meanwhile; then there is nothing to write into.
            if !self.translated.lock().contains(tab) {
                return;
            }
            let list: Vec<serde_json::Value> = results
                .into_iter()
                .map(|(id, parts)| serde_json::json!([id, parts]))
                .collect();
            let script = format!(
                "window.__athTr&&window.__athTr.apply({},{})",
                serde_json::Value::Array(list),
                tight
            );
            let _ = self.engine.eval(tab, &script);
        });
        if !self.translated.lock().contains(tab) {
            return;
        }
        if failed > 0 {
            self.toast(
                "error",
                format!(
                    "Part of the page could not be translated{}",
                    error.map(|e| format!(": {e}")).unwrap_or_default()
                ),
            );
        }
        self.translation_state(tab, "done");
    }

    pub fn print_page(&self, tab: &str) {
        let _ = self.engine.eval(tab, "window.print()");
    }

    /// Full screen for the main window.
    pub fn toggle_fullscreen(&self) {
        #[cfg(desktop)]
        {
            use tauri::Manager;
            if let Some(window) = self.app.get_window("main") {
                let on = window.is_fullscreen().unwrap_or(false);
                let _ = window.set_fullscreen(!on);
            }
        }
    }

    /// One find-in-page action (`start`, `next`, `prev`, `clear`). The result goes to the shell as `athanor://find`.
    pub fn find_in_page(&self, tab: &str, action: &str, query: &str, match_case: bool) {
        let script = crate::pagetools::find_script(action, query, match_case);
        let (app, tab_id) = (self.app.clone(), tab.to_string());
        let reply: Box<dyn FnOnce(String) + Send> = Box::new(move |json| {
            let result =
                serde_json::from_str::<serde_json::Value>(&json).unwrap_or(serde_json::Value::Null);
            let (count, index) = (
                result.get("count").and_then(|v| v.as_u64()).unwrap_or(0),
                result.get("index").and_then(|v| v.as_u64()).unwrap_or(0),
            );
            let _ = app.emit(
                "athanor://find",
                serde_json::json!({ "tab": tab_id, "count": count, "index": index }),
            );
        });
        let _ = self.engine.eval_json(tab, &script, reply);
    }

    pub fn reload_stop(&self, tab: &str, what: &str) {
        let _ = match what {
            "reload" => {
                // Reloading the error page would reload the error page: try the address that failed instead.
                let failed_url = {
                    let g = self.inner.lock();
                    g.runtime
                        .get(tab)
                        .filter(|r| r.failed)
                        .and_then(|_| g.ws.tab(tab).map(|t| t.url.clone()))
                };
                match failed_url {
                    Some(url) => self.engine.navigate(tab, &url),
                    None => self.engine.reload(tab),
                }
            }
            "stop" => self.engine.stop(tab),
            "back" => self.engine.go_back(tab),
            _ => self.engine.go_forward(tab),
        };
    }

    /// A shell-drawn context-menu entry that needs the host (everything else is handled in the shell).
    pub fn context_action(self: &Arc<Self>, action: &str, data: &str) {
        if action != "send-image-to-board" {
            return;
        }
        // Downloading can take many seconds; never do it on the serial engine-event loop.
        let (this, data) = (self.clone(), data.to_string());
        std::thread::spawn(move || {
            match crate::boards::inbox_id(&this.paths).and_then(|id| {
                crate::boards::add_from_url(&this.paths, &id, &data, 0.0, 0.0).map(|()| id)
            }) {
                Ok(id) => {
                    let _ = this
                        .app
                        .emit("athanor://board-changed", serde_json::json!({ "id": id }));
                    this.toast("success", "Image added to the Inbox board");
                }
                Err(e) => this.toast("error", format!("Couldn't add image: {e}")),
            }
        });
    }

    /// Freeze-frame of a tab as a `data:` URL (the shell shows it while an overlay hides the native page).
    pub fn capture_frame(&self, tab: &str) -> Result<String, String> {
        use base64::Engine as _;
        let (mime, bytes) = self.engine.capture_frame(tab).map_err(|e| e.to_string())?;
        if bytes.len() > 24 * 1024 * 1024 {
            return Err("the captured page is too large".into());
        }
        Ok(format!(
            "data:{mime};base64,{}",
            base64::engine::general_purpose::STANDARD.encode(bytes)
        ))
    }

    /// Answer a pending page context menu (`None` dismisses it).
    pub fn resolve_context_menu(&self, tab: &str, command: Option<i32>) {
        let _ = self.engine.resolve_context_menu(tab, command);
    }

    /// Screenshot a tab into a board (PureRef-style capture).
    pub fn capture_to_board(&self, tab: &str, board_id: &str) -> Result<(), String> {
        let png = self.engine.capture_png(tab).map_err(|e| e.to_string())?;
        if png.len() > 40 * 1024 * 1024 {
            return Err("the captured page is too large".into());
        }
        let size = imagesize::blob_size(&png).map_err(|e| e.to_string())?;
        let hash = crate::boards::assets(&self.paths)
            .put(&png, "image/png")
            .map_err(|e| e.to_string())?;
        let url = self.copy_url(tab);
        crate::boards::add_asset(
            &self.paths,
            board_id,
            &hash,
            "image/png",
            size.width as f64,
            size.height as f64,
            url,
        )?;
        let _ = self.app.emit(
            "athanor://board-changed",
            serde_json::json!({ "id": board_id }),
        );
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
