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
}

impl DesktopEngine {
    pub fn new(_app: &AppHandle, window: Window, filter: Arc<Filter>) -> Self {
        Self {
            window,
            filter,
            sink: Arc::new(Mutex::new(None)),
            tabs: Mutex::new(HashMap::new()),
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
        #[cfg(not(windows))]
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
    fn create_tab(
        &self,
        id: &str,
        url: &str,
        rect: Rect,
        visible: bool,
        opts: &TabOptions,
    ) -> EngineResult {
        let parsed: url::Url = url.parse().map_err(err)?;
        #[cfg(windows)]
        let _ = &parsed;
        let sink = self.sink.clone();
        let tab: Id = id.to_string();

        // On Windows the page is loaded only after our hooks are attached (see below); otherwise the very
        // first navigation would bypass document-start scripts, https upgrade and request blocking setup.
        #[cfg(windows)]
        let initial: url::Url = "about:blank".parse().map_err(err)?;
        #[cfg(not(windows))]
        let initial = parsed.clone();
        let mut builder =
            WebviewBuilder::new(tab_label(id), WebviewUrl::External(initial)).devtools(true);
        #[cfg(windows)]
        if let Some(root) = std::env::var_os("ATHANOR_DATA_DIR") {
            builder = builder.data_directory(std::path::PathBuf::from(root).join("wv"));
        }
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
            let base = std::env::var_os("ATHANOR_DATA_DIR")
                .map(std::path::PathBuf::from)
                .or_else(|| self.window.app_handle().path().app_local_data_dir().ok());
            if let Some(base) = base {
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
            builder = builder.on_page_load(move |_, payload| {
                if let Some(s) = s3.lock().as_ref() {
                    let loading = matches!(payload.event(), tauri::webview::PageLoadEvent::Started);
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
                let popup =
                    tauri::WebviewWindowBuilder::new(&app, label, WebviewUrl::External(url))
                        .window_features(features)
                        .title("Athanor");
                #[cfg(windows)]
                let popup = if let Some(root) = std::env::var_os("ATHANOR_DATA_DIR") {
                    popup.data_directory(std::path::PathBuf::from(root).join("wv"))
                } else {
                    popup
                };
                match popup.build() {
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
        #[cfg(not(windows))]
        let _ = &self.filter;

        self.tabs.lock().insert(id.to_string(), wv);
        Ok(())
    }

    fn close_tab(&self, id: &str) -> EngineResult {
        if let Some(wv) = self.tabs.lock().remove(id) {
            wv.close().map_err(err)?;
        }
        Ok(())
    }

    fn navigate(&self, id: &str, url: &str) -> EngineResult {
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
        #[cfg(not(windows))]
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
        #[cfg(not(windows))]
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
        #[cfg(not(windows))]
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
        #[cfg(not(windows))]
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
            let _ = (id, script, reply);
            Err(athanor_core::engine::EngineError::Engine(
                "not supported".into(),
            ))
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
        #[cfg(not(windows))]
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
        #[cfg(not(windows))]
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
        #[cfg(not(windows))]
        {
            let _ = (id, muted);
            Ok(())
        }
    }

    fn capture_png(&self, id: &str) -> EngineResult<Vec<u8>> {
        self.capture(id, false)
    }

    fn capture_frame(&self, id: &str) -> EngineResult<(&'static str, Vec<u8>)> {
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
