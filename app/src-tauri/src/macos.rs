//! WKWebView operations that Tauri's portable API does not expose.
use crate::{browser::Browser, filter::Filter};
use athanor_core::engine::{EngineError, EngineEvent, EngineResult, EventSink};
use std::{
    ffi::{c_char, c_void, CStr, CString},
    sync::Arc,
};
use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem, Submenu},
    App, AppHandle, Emitter, Manager, Webview,
};

type TextReply = Box<dyn FnOnce(String) + Send>;
type CaptureReply = std::sync::mpsc::Sender<Result<Vec<u8>, String>>;
extern "C" {
    fn athanor_attach(
        view: *mut c_void,
        context: *mut c_void,
        callback: extern "C" fn(*mut c_void, i32, *const c_char, bool, bool),
        release: extern "C" fn(*mut c_void),
    );
    fn athanor_detach(view: *mut c_void);
    fn athanor_register(view: *mut c_void);
    fn athanor_action(view: *mut c_void, action: i32, entry: i64);
    fn athanor_history(
        view: *mut c_void,
        context: *mut c_void,
        callback: extern "C" fn(*mut c_void, *const c_char),
    );
    fn athanor_snapshot(
        view: *mut c_void,
        context: *mut c_void,
        callback: extern "C" fn(*mut c_void, *const u8, usize, *const c_char),
    );
    fn athanor_raise(view: *mut c_void);
    fn athanor_radius(view: *mut c_void, radius: f64);
    fn athanor_rules(
        json: *const c_char,
        context: *mut c_void,
        callback: extern "C" fn(*mut c_void, *const c_char),
    );
}

struct Observer {
    tab: String,
    sink: EventSink,
}
// Native strings/data are borrowed only for the duration of each callback and copied before returning.
fn native_text(text: *const c_char) -> String {
    if text.is_null() {
        String::new()
    } else {
        unsafe { CStr::from_ptr(text) }
            .to_string_lossy()
            .into_owned()
    }
}
extern "C" fn event(context: *mut c_void, kind: i32, text: *const c_char, a: bool, b: bool) {
    let observer = unsafe { &*context.cast::<Observer>() };
    let tab = observer.tab.clone();
    let event = match kind {
        0 => EngineEvent::UrlChanged {
            tab,
            url: native_text(text),
        },
        1 => EngineEvent::TitleChanged {
            tab,
            title: native_text(text),
        },
        2 => EngineEvent::LoadingChanged { tab, loading: a },
        3 => EngineEvent::HistoryChanged {
            tab,
            can_go_back: a,
            can_go_forward: b,
        },
        _ => return,
    };
    (observer.sink)(event);
}
extern "C" fn release_observer(context: *mut c_void) {
    drop(unsafe { Box::from_raw(context.cast::<Observer>()) });
}
pub fn attach(view: &Webview, tab: String, sink: EventSink) -> tauri::Result<()> {
    view.with_webview(move |native| unsafe {
        let observer = Box::new(Observer { tab, sink });
        athanor_attach(
            native.inner(),
            Box::into_raw(observer).cast(),
            event,
            release_observer,
        );
    })
}
pub fn detach(view: &Webview) -> tauri::Result<()> {
    view.with_webview(|native| unsafe { athanor_detach(native.inner()) })
}
pub fn register(view: &Webview) -> tauri::Result<()> {
    view.with_webview(|native| unsafe { athanor_register(native.inner()) })
}
pub fn action(view: &Webview, action: i32, entry: i64) -> tauri::Result<()> {
    view.with_webview(move |native| unsafe { athanor_action(native.inner(), action, entry) })
}
extern "C" fn text_reply(context: *mut c_void, text: *const c_char) {
    let reply = unsafe { Box::from_raw(context.cast::<TextReply>()) };
    reply(native_text(text));
}
pub fn history(view: &Webview, reply: TextReply) -> tauri::Result<()> {
    view.with_webview(move |native| unsafe {
        athanor_history(
            native.inner(),
            Box::into_raw(Box::new(reply)).cast(),
            text_reply,
        );
    })
}
extern "C" fn capture_reply(
    context: *mut c_void,
    bytes: *const u8,
    length: usize,
    error: *const c_char,
) {
    let reply = unsafe { Box::from_raw(context.cast::<CaptureReply>()) };
    let result = if !error.is_null() {
        Err(native_text(error))
    } else if bytes.is_null() || length == 0 {
        Err("The page returned an empty capture".into())
    } else {
        Ok(unsafe { std::slice::from_raw_parts(bytes, length) }.to_vec())
    };
    let _ = reply.send(result);
}
pub fn capture(view: &Webview) -> EngineResult<Vec<u8>> {
    let (tx, rx) = std::sync::mpsc::channel::<Result<Vec<u8>, String>>();
    view.with_webview(move |native| unsafe {
        athanor_snapshot(
            native.inner(),
            Box::into_raw(Box::new(tx)).cast(),
            capture_reply,
        );
    })
    .map_err(|e| EngineError::Engine(e.to_string()))?;
    rx.recv_timeout(std::time::Duration::from_secs(10))
        .map_err(|e| EngineError::Engine(e.to_string()))?
        .map_err(EngineError::Engine)
}
pub fn raise(view: &Webview) {
    let _ = view.with_webview(|native| unsafe { athanor_raise(native.inner()) });
}
pub fn radius(view: &Webview, radius: i32) {
    let _ = view.with_webview(move |native| unsafe {
        athanor_radius(native.inner(), radius.max(0) as f64)
    });
}

extern "C" fn rules_reply(context: *mut c_void, error: *const c_char) {
    let app = unsafe { Box::from_raw(context.cast::<AppHandle>()) };
    let error = native_text(error);
    if !error.is_empty() {
        log::error!("WebKit content rule compilation failed: {error}");
        let _ = app.emit("athanor://toast", serde_json::json!({"level":"error", "message":"Shield could not update macOS network rules. Previously compiled rules are retained. Try updating the lists again."}));
    }
}
pub fn refresh_rules(app: &AppHandle, filter: Arc<Filter>) {
    let app = app.clone();
    std::thread::spawn(move || {
        // Export and queue snapshots in order; WebKit compilation itself is asynchronous.
        static EXPORT: parking_lot::Mutex<()> = parking_lot::Mutex::new(());
        let _guard = EXPORT.lock();
        match filter
            .webkit_rules()
            .and_then(|json| CString::new(json).map_err(|e| e.to_string()))
        {
            Ok(json) => {
                let handle = app.clone();
                let _ = app.run_on_main_thread(move || unsafe {
                    athanor_rules(
                        json.as_ptr(),
                        Box::into_raw(Box::new(handle)).cast(),
                        rules_reply,
                    );
                });
            }
            Err(error) => log::error!("WebKit content rule export failed: {error}"),
        }
    });
}

fn command(
    app: &App,
    combo: &str,
    label: &str,
    accelerator: &str,
) -> tauri::Result<MenuItem<tauri::Wry>> {
    MenuItem::with_id(app, combo, label, true, Some(accelerator))
}

pub fn install_menu(app: &App) -> tauri::Result<()> {
    let application = Submenu::with_items(
        app,
        "Athanor",
        true,
        &[
            &PredefinedMenuItem::about(app, None, None)?,
            &command(app, "Ctrl+,", "Settings…", "Cmd+Comma")?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::services(app, None)?,
            &PredefinedMenuItem::hide(app, None)?,
            &PredefinedMenuItem::hide_others(app, None)?,
            &PredefinedMenuItem::show_all(app, None)?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::quit(app, None)?,
        ],
    )?;
    let file = Submenu::with_items(
        app,
        "File",
        true,
        &[
            &command(app, "Ctrl+T", "New Tab", "Cmd+T")?,
            &command(app, "Ctrl+W", "Close Tab", "Cmd+W")?,
            &command(app, "Ctrl+Shift+T", "Reopen Closed Tab", "Cmd+Shift+T")?,
            &MenuItem::with_id(
                app,
                "close-window",
                "Close Window",
                true,
                Some("Cmd+Shift+W"),
            )?,
            &command(app, "Ctrl+L", "Open Location…", "Cmd+L")?,
            &command(app, "Ctrl+P", "Print…", "Cmd+P")?,
        ],
    )?;
    // Native responder-chain actions keep editing available in both the shell and external pages.
    let edit = Submenu::with_items(
        app,
        "Edit",
        true,
        &[
            &PredefinedMenuItem::undo(app, None)?,
            &PredefinedMenuItem::redo(app, None)?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::cut(app, None)?,
            &PredefinedMenuItem::copy(app, None)?,
            &PredefinedMenuItem::paste(app, None)?,
            &PredefinedMenuItem::select_all(app, None)?,
            &PredefinedMenuItem::separator(app)?,
            &command(app, "Ctrl+F", "Find…", "Cmd+F")?,
            &command(app, "Ctrl+G", "Find Next", "Cmd+G")?,
            &command(app, "Ctrl+Shift+G", "Find Previous", "Cmd+Shift+G")?,
        ],
    )?;
    let view = Submenu::with_items(
        app,
        "View",
        true,
        &[
            &command(app, "Ctrl+B", "Toggle Sidebar", "Cmd+B")?,
            &command(app, "Ctrl+K", "Command Bar…", "Cmd+K")?,
            &command(app, "Ctrl+J", "Downloads…", "Cmd+J")?,
            &command(app, "Ctrl+Space", "Tab Overview…", "Cmd+Shift+Backslash")?,
            &command(app, "F5", "Reload", "Cmd+R")?,
            &command(app, "Ctrl+Shift+R", "Reload Without Cache", "Cmd+Shift+R")?,
            &command(app, "Ctrl+=", "Zoom In", "Cmd+Equal")?,
            &command(app, "Ctrl+-", "Zoom Out", "Cmd+Minus")?,
            &command(app, "Ctrl+0", "Actual Size", "Cmd+0")?,
            &command(app, "F12", "Page Inspector", "Cmd+Alt+I")?,
            &command(app, "Ctrl+Shift+D", "Developer Panel…", "Cmd+Shift+D")?,
            &command(app, "F11", "Toggle Full Screen", "Ctrl+Cmd+F")?,
        ],
    )?;
    let tabs = Submenu::new(app, "Tabs", true)?;
    for (combo, label, accelerator) in [
        ("Ctrl+Tab", "Next Tab", "Ctrl+Tab"),
        ("Ctrl+Shift+Tab", "Previous Tab", "Ctrl+Shift+Tab"),
        ("Alt+Left", "Back", "Cmd+BracketLeft"),
        ("Alt+Right", "Forward", "Cmd+BracketRight"),
        ("Ctrl+D", "Pin or Unpin Tab", "Cmd+D"),
        ("Ctrl+\\", "Split With Next Tab", "Cmd+Backslash"),
        ("Ctrl+Shift+F", "File Tabs Into Folders", "Cmd+Shift+F"),
    ] {
        tabs.append(&command(app, combo, label, accelerator)?)?;
    }
    for n in 1..=9 {
        tabs.append(&command(
            app,
            &format!("Ctrl+{n}"),
            &format!("Go to Tab {n}"),
            &format!("Cmd+{n}"),
        )?)?;
    }
    let window = Submenu::with_items(
        app,
        "Window",
        true,
        &[
            &PredefinedMenuItem::minimize(app, None)?,
            &PredefinedMenuItem::maximize(app, None)?,
            &PredefinedMenuItem::bring_all_to_front(app, None)?,
        ],
    )?;
    let help = Submenu::with_items(
        app,
        "Help",
        true,
        &[&command(app, "Ctrl+/", "Keyboard Shortcuts…", "Cmd+Slash")?],
    )?;
    app.set_menu(Menu::with_items(
        app,
        &[&application, &file, &edit, &view, &tabs, &window, &help],
    )?)?;
    app.on_menu_event(|app, event| {
        if event.id().as_ref() == "close-window" {
            for window in app.windows().values() {
                if window.is_focused().unwrap_or(false) {
                    let _ = window.close();
                    break;
                }
            }
            return;
        }
        if event.id().as_ref() == "Ctrl+W" {
            for window in app.windows().values() {
                if window.label() != "main" && window.is_focused().unwrap_or(false) {
                    let _ = window.close();
                    return;
                }
            }
        }
        if let Some(browser) = app.try_state::<Arc<Browser>>() {
            let combo = event.id().as_ref();
            if combo.starts_with("Ctrl+")
                || combo.starts_with("Alt+")
                || matches!(combo, "F5" | "F11" | "F12")
            {
                browser.shortcut(combo);
            }
        }
    });
    Ok(())
}
