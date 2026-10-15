//! Desktop engine adapter: every tab is a native child webview of the main window.

use crate::filter::Filter;
use athanor_core::{
    engine::{EngineBackend, EngineError, EngineEvent, EngineResult, EventSink, TabOptions},
    layout::Rect,
    Id,
};
use parking_lot::Mutex;
use std::{collections::HashMap, sync::Arc};
use tauri::{
    webview::{NewWindowResponse, WebviewBuilder},
    AppHandle, LogicalPosition, LogicalSize, Webview, WebviewUrl, Window, Wry,
};

pub fn tab_label(id: &str) -> String {
    format!("tab-{id}")
}

pub struct DesktopEngine {
    window: Window,
    filter: Arc<Filter>,
    sink: Arc<Mutex<Option<EventSink>>>,
    tabs: Mutex<HashMap<Id, Webview<Wry>>>,
    #[cfg(target_os = "macos")]
    radius: std::sync::atomic::AtomicI32,
    #[cfg(target_os = "macos")]
    muted: Arc<Mutex<std::collections::HashSet<Id>>>,
}

impl DesktopEngine {
    pub fn new(_app: &AppHandle, window: Window, filter: Arc<Filter>) -> Self {
        Self {
            window,
            filter,
            sink: Arc::new(Mutex::new(None)),
            tabs: Mutex::new(HashMap::new()),
            #[cfg(target_os = "macos")]
            radius: std::sync::atomic::AtomicI32::new(0),
            #[cfg(target_os = "macos")]
            muted: Arc::new(Mutex::new(std::collections::HashSet::new())),
        }
    }

    pub fn set_sink(&self, sink: EventSink) {
        *self.sink.lock() = Some(sink);
    }

    fn get(&self, id: &str) -> EngineResult<Webview<Wry>> {
        self.tabs
            .lock()
            .get(id)
            .cloned()
            .ok_or_else(|| EngineError::UnknownTab(id.to_string()))
    }

    fn capture(&self, id: &str, jpeg: bool) -> EngineResult<Vec<u8>> {
        #[cfg(windows)]
        {
            let wv = self.get(id)?;
            let (tx, rx) = std::sync::mpsc::channel();
            wv.with_webview(move |pw| unsafe {
                let _ = crate::win::capture_image(&pw.controller(), jpeg, tx);
            })
            .map_err(err)?;
            rx.recv_timeout(std::time::Duration::from_secs(10))
                .map_err(err)?
                .map_err(EngineError::Engine)
        }
        #[cfg(target_os = "macos")]
        {
            let _ = jpeg;
            crate::macos::capture(&self.get(id)?)
        }
        #[cfg(not(any(windows, target_os = "macos")))]
        {
            let _ = (id, jpeg);
            Err(EngineError::Engine(
                "page capture is not supported on this platform yet".into(),
            ))
        }
    }
}

fn err(e: impl std::fmt::Display) -> EngineError {
    EngineError::Engine(e.to_string())
}

fn bounds(r: Rect) -> tauri::Rect {
    tauri::Rect {
        position: LogicalPosition::new(r.x, r.y).into(),
        size: LogicalSize::new(r.w.max(1.0), r.h.max(1.0)).into(),
    }
}

impl EngineBackend for DesktopEngine {
    fn control_download(&self, id: u32, action: &str) -> EngineResult {
        #[cfg(windows)]
        {
            let (tx, rx) = std::sync::mpsc::channel();
            let action = action.to_owned();
            self.window
                .run_on_main_thread(move || {
                    let _ = tx.send(crate::win_ui::control_download(id, &action));
                })
                .map_err(err)?;
            rx.recv_timeout(std::time::Duration::from_secs(5))
                .map_err(err)?
                .map_err(err)
        }
        #[cfg(not(windows))]
        {
            let _ = (id, action);
            Err(err("Download controls are unavailable on this platform"))
        }
    }
    fn create_tab(
        &self,
        id: &str,
        url: &str,
        rect: Rect,
        visible: bool,
        opts: &TabOptions,
    ) -> EngineResult {
        #[cfg(target_os = "macos")]
        let parsed: url::Url = self
            .filter
            .rewrite_navigation(url)
            .as_deref()
            .unwrap_or(url)
            .parse()
            .map_err(err)?;
        #[cfg(not(target_os = "macos"))]
        let parsed: url::Url = url.parse().map_err(err)?;
        #[cfg(windows)]
        let _ = &parsed;
        let sink = self.sink.clone();
        let tab: Id = id.to_string();

        // On Windows the page is loaded only after our hooks are attached (see below); otherwise the very
        // first navigation would bypass document-start scripts, https upgrade and request blocking setup.
        #[cfg(any(windows, target_os = "macos"))]
        let initial: url::Url = "about:blank".parse().map_err(err)?;
        #[cfg(not(any(windows, target_os = "macos")))]
        let initial = parsed.clone();
        let mut builder = WebviewBuilder::new(tab_label(id), WebviewUrl::External(initial))
            .incognito(opts.incognito)
            .devtools(true);
        if let Some(ua) = &opts.user_agent {
            builder = builder.user_agent(ua);
        }
        for s in &opts.init_scripts {
            builder = builder.initialization_script(s.clone());
        }
        // No GPU: WebView2 takes that switch per browser process, so such tabs live in a second one with its own
        // profile folder (their sign-ins are carried over by cookie when the tab is switched).
        #[cfg(windows)]
        if opts.software_rendering {
            use tauri::Manager;
            if let Ok(base) = self.window.app_handle().path().app_local_data_dir() {
                let mut args = String::from(
                    "--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection --disable-gpu --disable-gpu-compositing",
                );
                // End-to-end tests attach to this second browser on its own debugging port.
                if let Ok(port) = std::env::var("ATHANOR_SOFTWARE_DEBUG_PORT") {
                    args.push_str(&format!(" --remote-debugging-port={port}"));
                }
                builder = builder
                    .data_directory(base.join("EBWebView-software"))
                    .additional_browser_args(&args);
            }
        }

        // Cross-platform fallbacks; on Windows the WebView2 hooks in `win.rs` report everything itself.
        #[cfg(not(windows))]
        {
            #[cfg(not(target_os = "macos"))]
            {
                let (s1, t1) = (sink.clone(), tab.clone());
                builder = builder.on_new_window(move |url, _| {
                    if let Some(s) = s1.lock().as_ref() {
                        s(EngineEvent::NewTabRequested {
                            from: t1.clone(),
                            url: url.to_string(),
                        });
                    }
                    NewWindowResponse::Deny
                });
            }
            let (s2, t2) = (sink.clone(), tab.clone());
            builder = builder.on_document_title_changed(move |_, title| {
                if let Some(s) = s2.lock().as_ref() {
                    s(EngineEvent::TitleChanged {
                        tab: t2.clone(),
                        title,
                    });
                }
            });
            let (s3, t3) = (sink.clone(), tab.clone());
            #[cfg(target_os = "macos")]
            let filter = self.filter.clone();
            #[cfg(target_os = "macos")]
            let muted_tabs = self.muted.clone();
            builder = builder.on_page_load(move |view, payload| {
                #[cfg(not(target_os = "macos"))]
                let _ = &view;
                let loading = matches!(payload.event(), tauri::webview::PageLoadEvent::Started);
                #[cfg(target_os = "macos")]
                {
                    if !loading {
                        // Started is provisional: destination scripts must never run in the old page.
                        // Guard queued evaluations against a subsequent navigation as well.
                        if muted_tabs.lock().contains(&t3) {
                            let _ = view.eval(mute_script(true));
                        }
                        let source = serde_json::json!(payload.url().as_str());
                        let mut scripts = filter.injections(payload.url().as_str(), 0);
                        scripts.extend(filter.page_script_injections(payload.url().as_str(), 1));
                        scripts.extend(filter.page_script_injections(payload.url().as_str(), 2));
                        for script in scripts {
                            let _ = view.eval(format!("(() => {{ if (location.href !== {source}) return;\n{script}\n}})()"));
                        }
                        let s = s3.clone();
                        let t = t3.clone();
                        let _ = view.eval_with_callback("document.querySelector('link[rel~=icon]')?.href || new URL('/favicon.ico', location.href).href", move |json| {
                            if let (Some(sink), Ok(url)) = (s.lock().as_ref(), serde_json::from_str::<String>(&json)) {
                                sink(EngineEvent::FaviconChanged { tab: t.clone(), url });
                            }
                        });
                    }
                }
                if let Some(s) = s3.lock().as_ref() {
                    s(EngineEvent::UrlChanged {
                        tab: t3.clone(),
                        url: payload.url().to_string(),
                    });
                    s(EngineEvent::LoadingChanged {
                        tab: t3.clone(),
                        loading,
                    });
                }
            });
        }
        #[cfg(target_os = "macos")]
        {
            let app = tauri::Manager::app_handle(&self.window).clone();
            builder = builder.on_new_window(move |url, features| {
                static NEXT: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(1);
                let label = format!(
                    "popup-{}",
                    NEXT.fetch_add(1, std::sync::atomic::Ordering::Relaxed)
                );
                // WebKit requires the supplied configuration to retain window.opener and the original request.
                match tauri::WebviewWindowBuilder::new(&app, label, WebviewUrl::External(url))
                    .window_features(features)
                    .title("Athanor")
                    .build()
                {
                    Ok(window) => {
                        let _ = crate::macos::register(window.as_ref());
                        NewWindowResponse::Create { window }
                    }
                    Err(_) => NewWindowResponse::Deny,
                }
            });
            use tauri::webview::DownloadEvent;
            let transfers = Arc::new(Mutex::new(
                HashMap::<String, (u32, std::path::PathBuf)>::new(),
            ));
            let (sink, tab) = (sink.clone(), tab.clone());
            builder = builder.on_download(move |_, event| {
                static NEXT: std::sync::atomic::AtomicU32 = std::sync::atomic::AtomicU32::new(1);
                match event {
                    DownloadEvent::Requested { url, destination } => {
                        let mut active = transfers.lock();
                        // Wry's macOS completion event carries the URL but no transfer ID/path.
                        // Serialise identical URLs so a completion can never mark the wrong file as done.
                        if active.contains_key(url.as_str()) {
                            let id = NEXT.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
                            if let Some(sink) = sink.lock().as_ref() {
                                sink(download_event(&tab, id, destination, "failed", Some("A download from this address is already running. Wait for it to finish before starting another.".into())));
                            }
                            return false;
                        }
                        let requested = destination.clone();
                        let stem = requested.file_stem().unwrap_or_default().to_string_lossy();
                        let extension = requested.extension().map(|e| format!(".{}", e.to_string_lossy())).unwrap_or_default();
                        let mut suffix = 1u32;
                        while destination.exists() || active.values().any(|(_, path)| path == destination) {
                            *destination = requested.with_file_name(format!("{stem} ({suffix}){extension}"));
                            suffix += 1;
                        }
                        let id = NEXT.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
                        active.insert(url.to_string(), (id, destination.clone()));
                        if let Some(sink) = sink.lock().as_ref() {
                            sink(download_event(&tab, id, destination, "started", None));
                        }
                    }
                    DownloadEvent::Finished { url, success, .. } => {
                        if let Some((id, path)) = transfers.lock().remove(url.as_str()) {
                            let state = if success { "done" } else { "failed" };
                            let error = (!success).then(|| "WebKit could not finish the download. Try again from the original page.".into());
                            if let Some(sink) = sink.lock().as_ref() { sink(download_event(&tab, id, &path, state, error)); }
                        }
                    }
                    _ => {}
                }
                true
            });
        }
        #[cfg(windows)]
        {
            let _ = &sink;
            let _ = &tab;
            // A page that opens a sized window (Google / Apple / Microsoft sign-in, payment pages) needs a real popup
            // that keeps its link to the opener, or it reports "blocked" and the sign-in never completes. Everything
            // else becomes a tab (see `win.rs`).
            let app = tauri::Manager::app_handle(&self.window).clone();
            builder = builder.on_new_window(move |url, features| {
                if features.size().is_none() && features.position().is_none() {
                    return NewWindowResponse::Deny;
                }
                static NEXT: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(1);
                let label = format!(
                    "popup-{}",
                    NEXT.fetch_add(1, std::sync::atomic::Ordering::Relaxed)
                );
                match tauri::WebviewWindowBuilder::new(&app, label, WebviewUrl::External(url))
                    .window_features(features)
                    .title("Athanor")
                    .build()
                {
                    Ok(window) => NewWindowResponse::Create { window },
                    Err(_) => NewWindowResponse::Deny,
                }
            });
        }

        // Tests give the software browser its own debugging port; the shared environment variable would otherwise
        // hand it the main browser's port. (WebView2 reads the variable while the environment is created.)
        let swap_env =
            opts.software_rendering && std::env::var_os("ATHANOR_SOFTWARE_DEBUG_PORT").is_some();
        let saved_env = std::env::var_os("WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS");
        if swap_env {
            std::env::set_var("WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS", "");
        }
        let added = self.window.add_child(
            builder,
            LogicalPosition::new(rect.x, rect.y),
            LogicalSize::new(rect.w.max(1.0), rect.h.max(1.0)),
        );
        if swap_env {
            match saved_env {
                Some(value) => std::env::set_var("WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS", value),
                None => std::env::remove_var("WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS"),
            }
        }
        let wv = added.map_err(err)?;
        if !visible {
            wv.hide().map_err(err)?;
        }

        #[cfg(windows)]
        {
            let sink_fn: EventSink = {
                let sink = self.sink.clone();
                Arc::new(move |ev: EngineEvent| {
                    if let Some(s) = sink.lock().as_ref() {
                        s(ev);
                    }
                })
            };
            let ctx = crate::win::Ctx {
                tab: tab.clone(),
                sink: sink_fn,
                filter: self.filter.clone(),
                page_url: Arc::new(Mutex::new(url.to_string())),
            };
            let target = url.to_string();
            let seed = opts.seed_cookies.clone();
            wv.with_webview(move |pw| {
                let controller = pw.controller();
                if let Err(e) = unsafe { crate::win::attach(&controller, ctx) } {
                    eprintln!("webview2 attach failed: {e}");
                }
                // New views start with the stage's rounded clip (it is re-applied on every resize).
                if crate::win::corner_radius() > 0 {
                    let _ = unsafe { crate::win::apply_corner_radius(&controller) };
                }
                // Hooks are in place: start the real navigation now (after the carried-over cookies, if any).
                let started = match &seed {
                    Some(cookies) => unsafe {
                        crate::win::seed_cookies_and_navigate(&controller, cookies, &target)
                    },
                    None => unsafe { crate::win::navigate(&controller, &target) },
                };
                if let Err(e) = started {
                    eprintln!("initial navigation failed: {e}");
                }
            })
            .map_err(err)?;
        }
        #[cfg(target_os = "macos")]
        {
            let observer_sink = self.sink.clone();
            crate::macos::attach(
                &wv,
                tab,
                Arc::new(move |event| {
                    if let Some(sink) = observer_sink.lock().as_ref() {
                        sink(event);
                    }
                }),
            )
            .map_err(err)?;
            crate::macos::radius(&wv, self.radius.load(std::sync::atomic::Ordering::Relaxed));
            wv.navigate(parsed).map_err(err)?;
        }
        #[cfg(not(any(windows, target_os = "macos")))]
        let _ = &self.filter;

        self.tabs.lock().insert(id.to_string(), wv);
        Ok(())
    }

    fn close_tab(&self, id: &str) -> EngineResult {
        #[cfg(target_os = "macos")]
        self.muted.lock().remove(id);
        if let Some(wv) = self.tabs.lock().remove(id) {
            #[cfg(target_os = "macos")]
            crate::macos::detach(&wv).map_err(err)?;
            wv.close().map_err(err)?;
        }
        Ok(())
    }

    fn navigate(&self, id: &str, url: &str) -> EngineResult {
        #[cfg(target_os = "macos")]
        let rewritten = self.filter.rewrite_navigation(url);
        #[cfg(target_os = "macos")]
        let url = rewritten.as_deref().unwrap_or(url);
        self.get(id)?
            .navigate(url.parse().map_err(err)?)
            .map_err(err)
    }

    fn go_back(&self, id: &str) -> EngineResult {
        let wv = self.get(id)?;
        #[cfg(windows)]
        return wv
            .with_webview(|pw| unsafe {
                let _ = crate::win::go_back(&pw.controller());
            })
            .map_err(err);
        #[cfg(target_os = "macos")]
        return crate::macos::action(&wv, 0, 0).map_err(err);
        #[cfg(not(any(windows, target_os = "macos")))]
        wv.eval("history.back()").map_err(err)
    }

    fn go_forward(&self, id: &str) -> EngineResult {
        let wv = self.get(id)?;
        #[cfg(windows)]
        return wv
            .with_webview(|pw| unsafe {
                let _ = crate::win::go_forward(&pw.controller());
            })
            .map_err(err);
        #[cfg(target_os = "macos")]
        return crate::macos::action(&wv, 1, 0).map_err(err);
        #[cfg(not(any(windows, target_os = "macos")))]
        wv.eval("history.forward()").map_err(err)
    }

    fn reload(&self, id: &str) -> EngineResult {
        self.get(id)?.reload().map_err(err)
    }

    fn stop(&self, id: &str) -> EngineResult {
        let wv = self.get(id)?;
        #[cfg(windows)]
        return wv
            .with_webview(|pw| unsafe {
                let _ = crate::win::stop(&pw.controller());
            })
            .map_err(err);
        #[cfg(target_os = "macos")]
        return crate::macos::action(&wv, 2, 0).map_err(err);
        #[cfg(not(any(windows, target_os = "macos")))]
        wv.eval("window.stop()").map_err(err)
    }

    fn set_bounds(&self, id: &str, rect: Rect) -> EngineResult {
        let wv = self.get(id)?;
        wv.set_bounds(bounds(rect)).map_err(err)?;
        // The rounded clip is a fixed shape: redo it for the new size (queued after the resize on the UI thread).
        #[cfg(windows)]
        if crate::win::corner_radius() > 0 {
            let _ = wv.with_webview(|pw| unsafe {
                let _ = crate::win::apply_corner_radius(&pw.controller());
            });
        }
        Ok(())
    }

    fn set_corner_radius(&self, radius: i32) -> EngineResult {
        #[cfg(windows)]
        {
            crate::win::store_corner_radius(radius);
            let views: Vec<_> = self.tabs.lock().values().cloned().collect();
            for wv in views {
                let _ = wv.with_webview(|pw| unsafe {
                    let _ = crate::win::apply_corner_radius(&pw.controller());
                });
            }
        }
        #[cfg(target_os = "macos")]
        {
            self.radius
                .store(radius, std::sync::atomic::Ordering::Relaxed);
            for view in self.tabs.lock().values() {
                crate::macos::radius(view, radius);
            }
        }
        #[cfg(not(any(windows, target_os = "macos")))]
        let _ = radius;
        Ok(())
    }

    fn set_visible(&self, id: &str, visible: bool) -> EngineResult {
        let wv = self.get(id)?;
        if visible { wv.show() } else { wv.hide() }.map_err(err)
    }

    fn focus(&self, id: &str) -> EngineResult {
        self.get(id)?.set_focus().map_err(err)
    }

    fn eval(&self, id: &str, script: &str) -> EngineResult {
        self.get(id)?.eval(script).map_err(err)
    }

    fn set_zoom(&self, id: &str, factor: f64) -> EngineResult {
        self.get(id)?.set_zoom(factor).map_err(err)
    }

    fn eval_json(
        &self,
        id: &str,
        script: &str,
        reply: Box<dyn FnOnce(String) + Send>,
    ) -> EngineResult {
        #[cfg(windows)]
        {
            let script = script.to_string();
            self.get(id)?
                .with_webview(move |pw| unsafe {
                    let _ = crate::win::eval_json(&pw.controller(), &script, reply);
                })
                .map_err(err)
        }
        #[cfg(not(windows))]
        {
            let reply = Mutex::new(Some(reply));
            self.get(id)?
                .eval_with_callback(script, move |json| {
                    if let Some(reply) = reply.lock().take() {
                        reply(json);
                    }
                })
                .map_err(err)
        }
    }

    fn devtools_json(
        &self,
        id: &str,
        method: &str,
        params: &str,
        reply: Box<dyn FnOnce(String) + Send>,
    ) -> EngineResult {
        #[cfg(windows)]
        {
            let (method, params) = (method.to_string(), params.to_string());
            self.get(id)?
                .with_webview(move |pw| unsafe {
                    let _ = crate::win::devtools_json(&pw.controller(), &method, &params, reply);
                })
                .map_err(err)
        }
        #[cfg(target_os = "macos")]
        {
            let _ = params;
            if method == "Page.getNavigationHistory" {
                crate::macos::history(&self.get(id)?, reply).map_err(err)
            } else {
                Err(err("Chromium DevTools Protocol is unavailable in WebKit"))
            }
        }
        #[cfg(not(any(windows, target_os = "macos")))]
        {
            let _ = (id, method, params, reply);
            Err(athanor_core::engine::EngineError::Engine(
                "not supported".into(),
            ))
        }
    }

    fn devtools_call(&self, id: &str, method: &str, params: &str) -> EngineResult {
        #[cfg(windows)]
        {
            let (method, params) = (method.to_string(), params.to_string());
            self.get(id)?
                .with_webview(move |pw| unsafe {
                    let _ = crate::win::devtools_call(&pw.controller(), &method, &params);
                })
                .map_err(err)
        }
        #[cfg(target_os = "macos")]
        {
            match method {
                "Page.reload" => crate::macos::action(&self.get(id)?, 3, 0).map_err(err),
                "Page.navigateToHistoryEntry" => {
                    #[derive(serde::Deserialize)]
                    struct Entry {
                        #[serde(rename = "entryId")]
                        id: i64,
                    }
                    let entry: Entry = serde_json::from_str(params).map_err(err)?;
                    crate::macos::action(&self.get(id)?, 4, entry.id).map_err(err)
                }
                _ => Err(err("Chromium DevTools Protocol is unavailable in WebKit")),
            }
        }
        #[cfg(not(any(windows, target_os = "macos")))]
        {
            let _ = (id, method, params);
            Err(athanor_core::engine::EngineError::Engine(
                "not supported".into(),
            ))
        }
    }

    fn set_muted(&self, id: &str, muted: bool) -> EngineResult {
        #[cfg(windows)]
        return self
            .get(id)?
            .with_webview(move |pw| unsafe {
                let _ = crate::win::set_muted(&pw.controller(), muted);
            })
            .map_err(err);
        #[cfg(target_os = "macos")]
        {
            let view = self.get(id)?;
            if muted {
                self.muted.lock().insert(id.to_owned());
            } else {
                self.muted.lock().remove(id);
            }
            view.eval(mute_script(muted)).map_err(err)
        }
        #[cfg(not(any(windows, target_os = "macos")))]
        {
            let _ = (id, muted);
            Ok(())
        }
    }

    fn capture_png(&self, id: &str) -> EngineResult<Vec<u8>> {
        self.capture(id, false)
    }

    fn capture_frame(&self, id: &str) -> EngineResult<(&'static str, Vec<u8>)> {
        #[cfg(target_os = "macos")]
        return self.capture(id, false).map(|png| ("image/png", png));
        #[cfg(not(target_os = "macos"))]
        self.capture(id, true).map(|jpeg| ("image/jpeg", jpeg))
    }

    fn resolve_context_menu(&self, id: &str, command: Option<i32>) -> EngineResult {
        #[cfg(windows)]
        {
            let tab = id.to_string();
            self.get(id)?
                .with_webview(move |_| crate::win::resolve_context_menu(&tab, command))
                .map_err(err)
        }
        #[cfg(not(windows))]
        {
            let _ = (id, command);
            Ok(())
        }
    }

    fn resolve_script_dialog(&self, id: &str, accept: bool, text: &str) -> EngineResult {
        #[cfg(windows)]
        {
            let (tab, text) = (id.to_string(), text.to_string());
            self.get(id)?
                .with_webview(move |_| crate::win_ui::resolve_script_dialog(&tab, accept, &text))
                .map_err(err)
        }
        #[cfg(not(windows))]
        {
            let _ = (id, accept, text);
            Ok(())
        }
    }

    fn resolve_permission(&self, id: &str, request: u32, allow: bool) -> EngineResult {
        #[cfg(windows)]
        {
            self.get(id)?
                .with_webview(move |_| crate::win_ui::resolve_permission(request, allow))
                .map_err(err)
        }
        #[cfg(not(windows))]
        {
            let _ = (id, request, allow);
            Ok(())
        }
    }

    fn open_devtools(&self, id: &str) -> EngineResult {
        self.get(id)?.open_devtools();
        Ok(())
    }
}

#[cfg(target_os = "macos")]
fn download_event(
    tab: &str,
    id: u32,
    path: &std::path::Path,
    state: &str,
    error: Option<String>,
) -> EngineEvent {
    let bytes = if state == "done" {
        std::fs::metadata(path).map_or(0, |m| m.len())
    } else {
        0
    };
    EngineEvent::Download {
        tab: tab.into(),
        id,
        name: path
            .file_name()
            .map_or_else(|| "Download".into(), |n| n.to_string_lossy().into_owned()),
        path: path.to_string_lossy().into_owned(),
        state: state.into(),
        received: bytes,
        total: bytes,
        error,
        can_resume: false,
    }
}

#[cfg(target_os = "macos")]
fn mute_script(muted: bool) -> String {
    format!(
        r#"(() => {{
                const on = {muted};
                window.__athanorMuteObserver?.disconnect();
                const saved = window.__athanorMutedMedia || new Map();
                window.__athanorMutedMedia = saved;
                const apply = () => document.querySelectorAll('video,audio').forEach(media => {{
                    if (!saved.has(media)) saved.set(media, media.muted);
                    media.muted = true;
                }});
                if (on) {{
                    apply();
                    const observer = new MutationObserver(apply);
                    observer.observe(document, {{childList:true, subtree:true}});
                    window.__athanorMuteObserver = observer;
                }} else {{
                    for (const [media, previous] of saved) media.muted = previous;
                    saved.clear();
                }}
            }})()"#
    )
}
