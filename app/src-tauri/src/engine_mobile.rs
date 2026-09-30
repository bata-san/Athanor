//! Rust adapter for the Kotlin `AthanorEngine` Tauri Android plugin.

use crate::jni_bridge;
use athanor_core::{
    engine::{EngineBackend, EngineError, EngineResult, EventSink, TabOptions},
    layout::Rect,
};
use base64::{engine::general_purpose::STANDARD, Engine as _};
use parking_lot::Mutex;
use serde::Serialize;
use std::collections::HashSet;
use tauri::{
    plugin::{Builder as PluginBuilder, PluginApi, PluginHandle, TauriPlugin},
    AppHandle, Manager, Wry,
};

pub(crate) struct NativePlugin(PluginHandle<Wry>);

/// Registers the Kotlin implementation in the generated Android project.  The local
/// plugin approach keeps the Rust/Kotlin contract together without introducing a
/// separately published plugin crate.
pub(crate) fn plugin() -> TauriPlugin<Wry> {
    PluginBuilder::<Wry>::new("athanor-engine")
        .setup(|app, api: PluginApi<Wry, ()>| {
            let handle = api.register_android_plugin("dev.athanor.browser", "AthanorEngine")?;
            app.manage(NativePlugin(handle));
            Ok(())
        })
        .build()
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct CreateTab<'a> {
    id: &'a str,
    url: &'a str,
    x: f64,
    y: f64,
    w: f64,
    h: f64,
    visible: bool,
    user_agent: &'a Option<String>,
    init_scripts: &'a [String],
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct TabCommand<'a> {
    id: &'a str,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Navigate<'a> {
    id: &'a str,
    url: &'a str,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Bounds<'a> {
    id: &'a str,
    x: f64,
    y: f64,
    w: f64,
    h: f64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Visibility<'a> {
    id: &'a str,
    visible: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Script<'a> {
    id: &'a str,
    script: &'a str,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Zoom<'a> {
    id: &'a str,
    factor: f64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Muted<'a> {
    id: &'a str,
    muted: bool,
}

pub(crate) struct MobileEngine {
    plugin: PluginHandle<Wry>,
    tabs: Mutex<HashSet<String>>,
}

impl MobileEngine {
    pub(crate) fn new(app: &AppHandle) -> EngineResult<Self> {
        let plugin = app.state::<NativePlugin>().0.clone();
        Ok(Self {
            plugin,
            tabs: Mutex::new(HashSet::new()),
        })
    }

    pub(crate) fn set_sink(&self, sink: EventSink) {
        jni_bridge::set_event_sink(sink);
    }

    fn ensure_tab(&self, id: &str) -> EngineResult {
        if self.tabs.lock().contains(id) {
            Ok(())
        } else {
            Err(EngineError::UnknownTab(id.to_string()))
        }
    }

    fn call<P: Serialize>(&self, command: &str, payload: P) -> EngineResult {
        self.plugin
            .run_mobile_plugin::<serde_json::Value>(command, payload)
            .map(|_| ())
            .map_err(|e| EngineError::Engine(e.to_string()))
    }
}

impl EngineBackend for MobileEngine {
    fn create_tab(
        &self,
        id: &str,
        url: &str,
        rect: Rect,
        visible: bool,
        opts: &TabOptions,
    ) -> EngineResult {
        let payload = CreateTab {
            id,
            url,
            x: rect.x,
            y: rect.y,
            w: rect.w,
            h: rect.h,
            visible,
            user_agent: &opts.user_agent,
            init_scripts: &opts.init_scripts,
        };
        self.call("createTab", payload)?;
        self.tabs.lock().insert(id.to_string());
        Ok(())
    }

    fn close_tab(&self, id: &str) -> EngineResult {
        if !self.tabs.lock().contains(id) {
            return Ok(());
        }
        self.call("closeTab", TabCommand { id })?;
        self.tabs.lock().remove(id);
        Ok(())
    }

    fn navigate(&self, id: &str, url: &str) -> EngineResult {
        self.ensure_tab(id)?;
        self.call("navigate", Navigate { id, url })
    }
    fn go_back(&self, id: &str) -> EngineResult {
        self.ensure_tab(id)?;
        self.call("goBack", TabCommand { id })
    }
    fn go_forward(&self, id: &str) -> EngineResult {
        self.ensure_tab(id)?;
        self.call("goForward", TabCommand { id })
    }
    fn reload(&self, id: &str) -> EngineResult {
        self.ensure_tab(id)?;
        self.call("reload", TabCommand { id })
    }
    fn stop(&self, id: &str) -> EngineResult {
        self.ensure_tab(id)?;
        self.call("stop", TabCommand { id })
    }

    fn set_bounds(&self, id: &str, rect: Rect) -> EngineResult {
        self.ensure_tab(id)?;
        self.call(
            "setBounds",
            Bounds {
                id,
                x: rect.x,
                y: rect.y,
                w: rect.w,
                h: rect.h,
            },
        )
    }

    fn set_visible(&self, id: &str, visible: bool) -> EngineResult {
        self.ensure_tab(id)?;
        self.call("setVisible", Visibility { id, visible })
    }

    fn focus(&self, id: &str) -> EngineResult {
        self.ensure_tab(id)?;
        self.call("focus", TabCommand { id })
    }
    fn eval(&self, id: &str, script: &str) -> EngineResult {
        self.ensure_tab(id)?;
        self.call("eval", Script { id, script })
    }
    fn set_zoom(&self, id: &str, factor: f64) -> EngineResult {
        self.ensure_tab(id)?;
        self.call("setZoom", Zoom { id, factor })
    }
    fn set_muted(&self, id: &str, muted: bool) -> EngineResult {
        self.ensure_tab(id)?;
        self.call("setMuted", Muted { id, muted })
    }
    fn open_devtools(&self, id: &str) -> EngineResult {
        self.ensure_tab(id)?;
        self.call("openDevtools", TabCommand { id })
    }

    fn capture_png(&self, id: &str) -> EngineResult<Vec<u8>> {
        self.ensure_tab(id)?;
        let encoded: String = self
            .plugin
            .run_mobile_plugin("capturePng", TabCommand { id })
            .map_err(|e| EngineError::Engine(e.to_string()))?;
        STANDARD
            .decode(encoded)
            .map_err(|e| EngineError::Engine(format!("invalid PNG from Android WebView: {e}")))
    }

    fn discard(&self, id: &str) -> EngineResult {
        if !self.tabs.lock().contains(id) {
            return Ok(());
        }
        self.call("discard", TabCommand { id })?;
        self.tabs.lock().remove(id);
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use athanor_core::engine::EngineEvent;

    #[test]
    fn kotlin_event_shape_deserializes_like_core_event() {
        let event: EngineEvent = serde_json::from_str(
            r#"{"type":"urlChanged","tab":"t1","url":"https://example.com/"}"#,
        )
        .unwrap();
        assert_eq!(
            event,
            EngineEvent::UrlChanged {
                tab: "t1".into(),
                url: "https://example.com/".into()
            }
        );
        let action: EngineEvent = serde_json::from_str(r#"{"type":"contextAction","tab":"t1","action":"send-image-to-board","data":"https://example.com/a.png"}"#).unwrap();
        assert!(matches!(action, EngineEvent::ContextAction { .. }));
    }
}
