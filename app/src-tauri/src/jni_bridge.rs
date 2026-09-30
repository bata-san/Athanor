//! Small, panic-contained JNI surface called by Android WebView clients.

use crate::filter::{Filter, Kind};
use athanor_core::engine::{EngineEvent, EventSink};
use jni::{
    objects::{JObject, JString},
    sys::{jboolean, jint, jstring, JNI_FALSE, JNI_TRUE},
    JNIEnv,
};
use parking_lot::Mutex;
use std::{
    collections::HashMap,
    panic::{catch_unwind, AssertUnwindSafe},
    sync::{Arc, OnceLock},
    time::Instant,
};

static FILTER: OnceLock<Arc<Filter>> = OnceLock::new();
static EVENT_SINK: OnceLock<Mutex<Option<EventSink>>> = OnceLock::new();
static BLOCKED_THROTTLE: OnceLock<Mutex<HashMap<String, Instant>>> = OnceLock::new();

pub(crate) fn install_filter(filter: Arc<Filter>) -> Result<(), &'static str> {
    FILTER
        .set(filter)
        .map_err(|_| "Android filter was already initialized")
}

pub(crate) fn set_event_sink(sink: EventSink) {
    *EVENT_SINK.get_or_init(|| Mutex::new(None)).lock() = Some(sink);
}

fn java_string(env: &mut JNIEnv<'_>, value: &JString<'_>) -> Option<String> {
    env.get_string(value)
        .ok()
        .map(|s| s.to_string_lossy().into_owned())
}

fn emit(event: EngineEvent) {
    let sink = EVENT_SINK.get_or_init(|| Mutex::new(None)).lock().clone();
    if let Some(sink) = sink {
        sink(event);
    }
}

fn kind_from_int(kind: jint) -> Kind {
    match kind {
        0 => Kind::Document,
        1 => Kind::Subdocument,
        2 => Kind::Stylesheet,
        3 => Kind::Script,
        4 => Kind::Image,
        5 => Kind::Font,
        6 => Kind::Media,
        7 => Kind::Xhr,
        8 => Kind::Fetch,
        9 => Kind::WebSocket,
        10 => Kind::Ping,
        _ => Kind::Other,
    }
}

fn report_blocked(tab: &str, url: &str) {
    let now = Instant::now();
    let mut last = BLOCKED_THROTTLE
        .get_or_init(|| Mutex::new(HashMap::new()))
        .lock();
    let should_emit = last
        .get(tab)
        .map(|at| now.duration_since(*at).as_millis() >= 100)
        .unwrap_or(true);
    if should_emit {
        last.insert(tab.to_string(), now);
        emit(EngineEvent::Blocked {
            tab: tab.to_string(),
            url: url.to_string(),
        });
    }
}

fn return_string(env: &mut JNIEnv<'_>, value: String) -> jstring {
    env.new_string(value)
        .map(|s| s.into_raw())
        .unwrap_or(std::ptr::null_mut())
}

#[no_mangle]
pub extern "system" fn Java_dev_athanor_browser_AthanorEngine_nativeShouldBlock(
    mut env: JNIEnv<'_>,
    _this: JObject<'_>,
    tab: JString<'_>,
    url: JString<'_>,
    source: JString<'_>,
    kind: jint,
) -> jboolean {
    let result = catch_unwind(AssertUnwindSafe(|| {
        let (Some(tab), Some(url), Some(source)) = (
            java_string(&mut env, &tab),
            java_string(&mut env, &url),
            java_string(&mut env, &source),
        ) else {
            return false;
        };
        let Some(filter) = FILTER.get() else {
            return false;
        };
        let blocked = filter.should_block(&url, &source, kind_from_int(kind));
        if blocked {
            report_blocked(&tab, &url);
        }
        blocked
    }))
    .unwrap_or(false);
    if result {
        JNI_TRUE
    } else {
        JNI_FALSE
    }
}

#[no_mangle]
pub extern "system" fn Java_dev_athanor_browser_AthanorEngine_nativeInjections(
    mut env: JNIEnv<'_>,
    _this: JObject<'_>,
    page_url: JString<'_>,
    phase: jint,
) -> jstring {
    catch_unwind(AssertUnwindSafe(|| {
        let Some(page_url) = java_string(&mut env, &page_url) else {
            return return_string(&mut env, "[]".into());
        };
        let Some(filter) = FILTER.get() else {
            return return_string(&mut env, "[]".into());
        };
        let injections = filter.injections(&page_url, phase.clamp(0, 2) as u8);
        return_string(
            &mut env,
            serde_json::to_string(&injections).unwrap_or_else(|_| "[]".into()),
        )
    }))
    .unwrap_or(std::ptr::null_mut())
}

#[no_mangle]
pub extern "system" fn Java_dev_athanor_browser_AthanorEngine_nativeRewriteNavigation(
    mut env: JNIEnv<'_>,
    _this: JObject<'_>,
    url: JString<'_>,
) -> jstring {
    catch_unwind(AssertUnwindSafe(|| {
        let Some(url) = java_string(&mut env, &url) else {
            return std::ptr::null_mut();
        };
        let Some(filter) = FILTER.get() else {
            return std::ptr::null_mut();
        };
        filter
            .rewrite_navigation(&url)
            .map(|rewritten| return_string(&mut env, rewritten))
            .unwrap_or(std::ptr::null_mut())
    }))
    .unwrap_or(std::ptr::null_mut())
}

/// A main-frame navigation to `url` failed. If we had upgraded it from http, returns the original http URL
/// (and remembers not to upgrade that host again).
#[no_mangle]
pub extern "system" fn Java_dev_athanor_browser_AthanorEngine_nativeUpgradeFallback(
    mut env: JNIEnv<'_>,
    _this: JObject<'_>,
    url: JString<'_>,
) -> jstring {
    catch_unwind(AssertUnwindSafe(|| {
        let Some(url) = java_string(&mut env, &url) else {
            return std::ptr::null_mut();
        };
        let Some(filter) = FILTER.get() else {
            return std::ptr::null_mut();
        };
        filter
            .upgrade_fallback(&url)
            .map(|original| return_string(&mut env, original))
            .unwrap_or(std::ptr::null_mut())
    }))
    .unwrap_or(std::ptr::null_mut())
}

#[no_mangle]
pub extern "system" fn Java_dev_athanor_browser_AthanorEngine_nativeOnEvent(
    mut env: JNIEnv<'_>,
    _this: JObject<'_>,
    event_json: JString<'_>,
) {
    let _ = catch_unwind(AssertUnwindSafe(|| {
        let Some(json) = java_string(&mut env, &event_json) else {
            return;
        };
        match serde_json::from_str::<EngineEvent>(&json) {
            Ok(event) => emit(event),
            Err(error) => log::warn!("invalid Android engine event: {error}"),
        }
    }));
}

/// Source text of `crates/athanor-adblock/assets/cosmetic-bridge.js`. The Kotlin plugin fetches this
/// once per process and registers it with `WebViewCompat.addDocumentStartJavaScript`.
#[no_mangle]
pub extern "system" fn Java_dev_athanor_browser_AthanorEngine_cosmeticBridgeScript(
    mut env: JNIEnv<'_>,
    _this: JObject<'_>,
) -> jstring {
    catch_unwind(AssertUnwindSafe(|| {
        return_string(&mut env, athanor_adblock::COSMETIC_BRIDGE_JS.to_string())
    }))
    .unwrap_or(std::ptr::null_mut())
}

/// Answer one in-page generic-cosmetic query. `page_url` must come from native data (the WebView's
/// current URL or the message source origin), never from the page. Returns `null` when the message
/// is not a valid query, so the caller skips the reply and the page just loads without cosmetics.
#[no_mangle]
pub extern "system" fn Java_dev_athanor_browser_AthanorEngine_cosmeticQuery(
    mut env: JNIEnv<'_>,
    _this: JObject<'_>,
    page_url: JString<'_>,
    raw_json: JString<'_>,
) -> jstring {
    catch_unwind(AssertUnwindSafe(|| {
        let (Some(page_url), Some(raw)) = (
            java_string(&mut env, &page_url),
            java_string(&mut env, &raw_json),
        ) else {
            return std::ptr::null_mut();
        };
        let Some(filter) = FILTER.get() else {
            return std::ptr::null_mut();
        };
        filter
            .cosmetic_query_reply(&page_url, &raw)
            .map(|response| return_string(&mut env, response))
            .unwrap_or(std::ptr::null_mut())
    }))
    .unwrap_or(std::ptr::null_mut())
}

#[cfg(test)]
mod tests {
    use super::kind_from_int;
    use crate::filter::Kind;

    #[test]
    fn maps_android_resource_type_ordinals() {
        assert_eq!(kind_from_int(0), Kind::Document);
        assert_eq!(kind_from_int(5), Kind::Font);
        assert_eq!(kind_from_int(11), Kind::Other);
    }
}
