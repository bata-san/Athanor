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
        let sink = self.sink.clone();
        let tab: Id = id.to_string();

        let mut builder =
            WebviewBuilder::new(tab_label(id), WebviewUrl::External(parsed)).devtools(true);
        if let Some(ua) = &opts.user_agent {
            builder = builder.user_agent(ua);
        }
        for s in &opts.init_scripts {
            builder = builder.initialization_script(s.clone());
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
            builder = builder.on_new_window(|_, _| NewWindowResponse::Deny);
        }

        let wv = self
            .window
            .add_child(
                builder,
                LogicalPosition::new(rect.x, rect.y),
                LogicalSize::new(rect.w.max(1.0), rect.h.max(1.0)),
            )
            .map_err(err)?;
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
            wv.with_webview(move |pw| {
                let controller = pw.controller();
                if let Err(e) = unsafe { crate::win::attach(&controller, ctx) } {
                    log::error!("webview2 attach failed: {e}");
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
        self.get(id)?.set_bounds(bounds(rect)).map_err(err)
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
        #[cfg(windows)]
        {
            let wv = self.get(id)?;
            let (tx, rx) = std::sync::mpsc::channel();
            wv.with_webview(move |pw| unsafe {
                let _ = crate::win::capture_png(&pw.controller(), tx);
            })
            .map_err(err)?;
            rx.recv_timeout(std::time::Duration::from_secs(10))
                .map_err(err)?
                .map_err(EngineError::Engine)
        }
        #[cfg(not(windows))]
        {
            let _ = id;
            Err(EngineError::Engine(
                "page capture is not supported on this platform yet".into(),
            ))
        }
    }

    fn open_devtools(&self, id: &str) -> EngineResult {
        self.get(id)?.open_devtools();
        Ok(())
    }
}
