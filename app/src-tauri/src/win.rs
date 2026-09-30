//! Windows / WebView2 adapter internals.
//!
//! Tauri gives us a child webview; here we reach through to `ICoreWebView2` to get the events a browser needs
//! that no cross-platform wrapper exposes: SPA URL changes, history state, favicons, audio state, native
//! accelerator interception, request blocking and early script injection. All of this stays inside the adapter;
//! nothing above `EngineBackend` knows WebView2 exists.

use crate::filter::{DetailedVerdict, Filter, Kind};
use athanor_core::engine::{EngineEvent, EventSink};
use parking_lot::Mutex;
use serde::Deserialize;
use std::{collections::HashSet, sync::Arc, time::Instant};
use webview2_com::{Microsoft::Web::WebView2::Win32::*, take_pwstr, *};
use windows::{
    Win32::UI::Input::KeyboardAndMouse::GetKeyState,
    core::{HSTRING, Interface, PWSTR},
};

pub struct Ctx {
    pub tab: String,
    pub sink: EventSink,
    pub filter: Arc<Filter>,
    /// Top-level URL of the tab; used as the "source" for third-party checks.
    pub page_url: Arc<Mutex<String>>,
}

fn pw(f: impl FnOnce(&mut PWSTR) -> windows::core::Result<()>) -> windows::core::Result<String> {
    let mut p = PWSTR::null();
    f(&mut p)?;
    Ok(take_pwstr(p))
}

fn kind_of(ctx: COREWEBVIEW2_WEB_RESOURCE_CONTEXT) -> Kind {
    match ctx {
        COREWEBVIEW2_WEB_RESOURCE_CONTEXT_DOCUMENT => Kind::Document,
        COREWEBVIEW2_WEB_RESOURCE_CONTEXT_STYLESHEET => Kind::Stylesheet,
        COREWEBVIEW2_WEB_RESOURCE_CONTEXT_IMAGE => Kind::Image,
        COREWEBVIEW2_WEB_RESOURCE_CONTEXT_MEDIA => Kind::Media,
        COREWEBVIEW2_WEB_RESOURCE_CONTEXT_FONT => Kind::Font,
        COREWEBVIEW2_WEB_RESOURCE_CONTEXT_SCRIPT => Kind::Script,
        COREWEBVIEW2_WEB_RESOURCE_CONTEXT_XML_HTTP_REQUEST => Kind::Xhr,
        COREWEBVIEW2_WEB_RESOURCE_CONTEXT_FETCH => Kind::Fetch,
        COREWEBVIEW2_WEB_RESOURCE_CONTEXT_WEBSOCKET => Kind::WebSocket,
        COREWEBVIEW2_WEB_RESOURCE_CONTEXT_PING => Kind::Ping,
        _ => Kind::Other,
    }
}

fn is_web(uri: &str) -> bool {
    uri.starts_with("http://") || uri.starts_with("https://")
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct CosmeticQueryMessage {
    #[serde(rename = "athanorShield")]
    version: u8,
    #[serde(rename = "type")]
    kind: String,
    id: String,
    classes: Vec<String>,
    ids: Vec<String>,
}

struct CosmeticQueryBudget {
    started: Instant,
    requests: u16,
}

impl Default for CosmeticQueryBudget {
    fn default() -> Self {
        Self {
            started: Instant::now(),
            requests: 0,
        }
    }
}

fn cosmetic_query_response(
    filter: &Filter,
    source: &str,
    raw: &str,
    budget: &Mutex<CosmeticQueryBudget>,
) -> Option<String> {
    if raw.len() > 128 * 1024 || !is_web(source) {
        return None;
    }
    {
        let mut budget = budget.lock();
        if budget.started.elapsed().as_secs() >= 1 {
            budget.started = Instant::now();
            budget.requests = 0;
        }
        if budget.requests >= 300 {
            return None;
        }
        budget.requests += 1;
    }
    let query: CosmeticQueryMessage = serde_json::from_str(raw).ok()?;
    if query.version != 1
        || query.kind != "cosmetic-query"
        || query.id.is_empty()
        || query.id.len() > 64
        || !query
            .id
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
        || query.classes.len() > 512
        || query.ids.len() > 512
        || query.classes.len() + query.ids.len() > 512
        || query
            .classes
            .iter()
            .chain(&query.ids)
            .any(|token| token.len() > 256)
    {
        return None;
    }
    let selectors = filter.cosmetic_query(source, &query.classes, &query.ids, &HashSet::new());
    let mut css = String::new();
    for group in selectors.chunks(200) {
        let next_len = group.iter().map(String::len).sum::<usize>() + group.len() + 28;
        if css.len().saturating_add(next_len) > 768 * 1024 {
            break;
        }
        for (index, selector) in group.iter().enumerate() {
            if index > 0 {
                css.push(',');
            }
            css.push_str(selector);
        }
        css.push_str("{display:none!important}\n");
    }
    serde_json::to_string(&serde_json::json!({
        "athanorShield": 1,
        "type": "cosmetic-response",
        "id": query.id,
        "css": css,
    }))
    .ok()
}

fn document_start_payload(filter: &Filter, url: &str) -> Option<String> {
    let payload = filter.cosmetic_js(url)?;
    let url_json = serde_json::to_string(url).ok()?;
    Some(format!(
        "(()=>{{if(location.href!=={url_json}||globalThis.__athanorDocStartDone)return;Object.defineProperty(globalThis,'__athanorDocStartDone',{{value:true}});try{{{payload}}}catch(_e){{}}}})();"
    ))
}

unsafe fn register_main_document_start(
    core: &ICoreWebView2,
    filter: Arc<Filter>,
    url: &str,
    armed: Arc<Mutex<HashSet<String>>>,
) -> windows::core::Result<bool> {
    if !filter.enabled() || !is_web(url) {
        return Ok(false);
    }
    let Some(script) = document_start_payload(&filter, url) else {
        return Ok(false);
    };
    if armed.lock().remove(url) {
        return Ok(false);
    }
    let registration_core = core.clone();
    let navigation_core = core.clone();
    let next_url = url.to_owned();
    let next_armed = armed.clone();
    let handler =
        AddScriptToExecuteOnDocumentCreatedCompletedHandler::create(Box::new(move |result, _| {
            if result.is_err() {
                log::debug!("document-start script registration completed with an error");
            }
            next_armed.lock().insert(next_url.clone());
            if let Err(error) = unsafe { navigation_core.Navigate(&HSTRING::from(next_url)) } {
                log::debug!("document-start adblock re-navigation failed: {error}");
            }
            Ok(())
        }));
    if let Err(error) = unsafe {
        registration_core.AddScriptToExecuteOnDocumentCreated(&HSTRING::from(script), &handler)
    } {
        log::debug!("document-start adblock registration failed: {error}");
        return Ok(false);
    }
    Ok(true)
}

unsafe fn register_frame_message_handler(
    frame: &ICoreWebView2Frame,
    filter: Arc<Filter>,
    budget: Arc<Mutex<CosmeticQueryBudget>>,
) -> windows::core::Result<()> {
    let frame2 = frame.cast::<ICoreWebView2Frame2>()?;
    let mut token = 0i64;
    unsafe {
        frame2.add_WebMessageReceived(
            &FrameWebMessageReceivedEventHandler::create(Box::new(move |sender, args| {
                let (Some(frame), Some(args)) = (sender, args) else {
                    return Ok(());
                };
                let source = pw(|p| args.Source(p))?;
                let raw = pw(|p| args.WebMessageAsJson(p))?;
                if let Some(response) = cosmetic_query_response(&filter, &source, &raw, &budget) {
                    if let Ok(frame2) = frame.cast::<ICoreWebView2Frame2>() {
                        let _ = frame2.PostWebMessageAsJson(&HSTRING::from(response));
                    }
                }
                Ok(())
            })),
            &mut token,
        )
    }
}

unsafe fn register_frame_document_start(
    core: ICoreWebView2,
    frame: ICoreWebView2Frame,
    filter: Arc<Filter>,
    url: String,
    armed: Arc<Mutex<HashSet<(usize, String)>>>,
) -> windows::core::Result<bool> {
    if !filter.enabled() || !is_web(&url) {
        return Ok(false);
    }
    let Some(script) = document_start_payload(&filter, &url) else {
        return Ok(false);
    };
    let key = (frame.as_raw() as usize, url.clone());
    if armed.lock().remove(&key) {
        return Ok(false);
    }
    let frame2 = frame.cast::<ICoreWebView2Frame2>()?;
    let next_armed = armed.clone();
    let script_url = url.clone();
    let frame_for_resume = frame2.clone();
    let resume = serde_json::to_string(&url).ok();
    let handler =
        AddScriptToExecuteOnDocumentCreatedCompletedHandler::create(Box::new(move |result, _| {
            if result.is_err() {
                log::debug!("frame document-start script registration completed with an error");
            }
            next_armed.lock().insert(key);
            if let Some(url) = resume {
                let js = format!("location.replace({url});");
                let _ = unsafe {
                    frame_for_resume.ExecuteScript(
                        &HSTRING::from(js),
                        &ExecuteScriptCompletedHandler::create(Box::new(|_, _| Ok(()))),
                    )
                };
            }
            Ok(())
        }));
    if let Err(error) =
        unsafe { core.AddScriptToExecuteOnDocumentCreated(&HSTRING::from(script), &handler) }
    {
        log::debug!("frame document-start adblock registration failed for {script_url}: {error}");
        return Ok(false);
    }
    Ok(true)
}

/// Map a key press to an Athanor combo string. `None` = not ours, let the page have it.
fn combo(vk: u32, ctrl: bool, shift: bool, alt: bool) -> Option<&'static str> {
    Some(match (vk, ctrl, shift, alt) {
        (0x54, true, false, false) => "Ctrl+T",
        (0x54, true, true, false) => "Ctrl+Shift+T",
        (0x57, true, false, false) => "Ctrl+W",
        (0x4C, true, false, false) => "Ctrl+L",
        (0x4B, true, false, false) => "Ctrl+K",
        (0x42, true, false, false) => "Ctrl+B",
        (0x44, true, true, false) => "Ctrl+Shift+D",
        (0x52, true, false, false) | (0x74, false, false, false) => "F5",
        (0x7B, false, false, false) => "F12",
        (0x09, true, false, false) => "Ctrl+Tab",
        (0x09, true, true, false) => "Ctrl+Shift+Tab",
        (0x25, false, false, true) => "Alt+Left",
        (0x27, false, false, true) => "Alt+Right",
        (0xDC, true, false, false) => "Ctrl+\\",
        (0x31, true, false, false) => "Ctrl+1",
        (0x32, true, false, false) => "Ctrl+2",
        (0x33, true, false, false) => "Ctrl+3",
        (0x34, true, false, false) => "Ctrl+4",
        (0x35, true, false, false) => "Ctrl+5",
        (0x36, true, false, false) => "Ctrl+6",
        (0x37, true, false, false) => "Ctrl+7",
        (0x38, true, false, false) => "Ctrl+8",
        (0x39, true, false, false) => "Ctrl+9",
        _ => return None,
    })
}

/// Wire every event we care about for one tab. Must run on the UI thread (call from `with_webview`).
///
/// # Safety
/// Calls raw COM interfaces; `controller` must be a live controller owned by the current thread.
pub unsafe fn attach(controller: &ICoreWebView2Controller, ctx: Ctx) -> windows::core::Result<()> {
    let core = controller.CoreWebView2()?;
    let mut token = 0i64;
    let tab = ctx.tab.clone();

    // The small generic-cosmetic collector runs at document creation in every frame. Site
    // resources are registered separately before each matching navigation is resumed.
    if let Ok(settings) = core.Settings() {
        let _ = settings.SetIsWebMessageEnabled(true);
    }
    let bootstrap =
        AddScriptToExecuteOnDocumentCreatedCompletedHandler::create(Box::new(|_, _| Ok(())));
    core.AddScriptToExecuteOnDocumentCreated(
        &HSTRING::from(athanor_adblock::COSMETIC_BRIDGE_JS),
        &bootstrap,
    )?;
    let cosmetic_budget = Arc::new(Mutex::new(CosmeticQueryBudget::default()));
    {
        let filter = ctx.filter.clone();
        let budget = cosmetic_budget.clone();
        core.add_WebMessageReceived(
            &WebMessageReceivedEventHandler::create(Box::new(move |sender, args| {
                let (Some(core), Some(args)) = (sender, args) else {
                    return Ok(());
                };
                let source = pw(|p| args.Source(p))?;
                let raw = pw(|p| args.WebMessageAsJson(p))?;
                if let Some(response) = cosmetic_query_response(&filter, &source, &raw, &budget) {
                    let _ = core.PostWebMessageAsJson(&HSTRING::from(response));
                }
                Ok(())
            })),
            &mut token,
        )?;
    }
    {
        let frame_armed = Arc::new(Mutex::new(HashSet::<(usize, String)>::new()));
        let filter_for_frames = ctx.filter.clone();
        let main_core = core.clone();
        let frame_armed_for_events = frame_armed.clone();
        let budget_for_frames = cosmetic_budget.clone();
        if let Ok(core4) = core.cast::<ICoreWebView2_4>() {
            core4.add_FrameCreated(
                &FrameCreatedEventHandler::create(Box::new(move |_, args| {
                    let Some(args) = args else { return Ok(()) };
                    let frame = args.Frame()?;
                    unsafe {
                        register_frame_message_handler(
                            &frame,
                            filter_for_frames.clone(),
                            budget_for_frames.clone(),
                        )?;
                    }
                    let frame2 = frame.cast::<ICoreWebView2Frame2>()?;
                    let core_for_nav = main_core.clone();
                    let filter_for_nav = filter_for_frames.clone();
                    let armed = frame_armed_for_events.clone();
                    let mut frame_token = 0i64;
                    frame2.add_NavigationStarting(
                        &FrameNavigationStartingEventHandler::create(Box::new(
                            move |sender, args| {
                                let (Some(frame), Some(args)) = (sender, args) else {
                                    return Ok(());
                                };
                                let url = pw(|p| args.Uri(p))?;
                                if unsafe {
                                    register_frame_document_start(
                                        core_for_nav.clone(),
                                        frame,
                                        filter_for_nav.clone(),
                                        url,
                                        armed.clone(),
                                    )?
                                } {
                                    args.SetCancel(true)?;
                                }
                                Ok(())
                            },
                        )),
                        &mut frame_token,
                    )?;
                    Ok(())
                })),
                &mut token,
            )?;
        }
    }

    // --- URL / title / history / loading ---
    {
        let (sink, tab, page_url) = (ctx.sink.clone(), tab.clone(), ctx.page_url.clone());
        core.add_SourceChanged(
            &SourceChangedEventHandler::create(Box::new(move |sender, _| {
                if let Some(core) = sender {
                    if let Ok(url) = pw(|p| core.Source(p)) {
                        *page_url.lock() = url.clone();
                        sink(EngineEvent::UrlChanged {
                            tab: tab.clone(),
                            url,
                        });
                    }
                }
                Ok(())
            })),
            &mut token,
        )?;
    }
    {
        let (sink, tab) = (ctx.sink.clone(), tab.clone());
        core.add_DocumentTitleChanged(
            &DocumentTitleChangedEventHandler::create(Box::new(move |sender, _| {
                if let Some(core) = sender {
                    if let Ok(title) = pw(|p| core.DocumentTitle(p)) {
                        sink(EngineEvent::TitleChanged {
                            tab: tab.clone(),
                            title,
                        });
                    }
                }
                Ok(())
            })),
            &mut token,
        )?;
    }
    {
        let (sink, tab) = (ctx.sink.clone(), tab.clone());
        core.add_HistoryChanged(
            &HistoryChangedEventHandler::create(Box::new(move |sender, _| {
                if let Some(core) = sender {
                    let (mut back, mut fwd) = (Default::default(), Default::default());
                    core.CanGoBack(&mut back)?;
                    core.CanGoForward(&mut fwd)?;
                    sink(EngineEvent::HistoryChanged {
                        tab: tab.clone(),
                        can_go_back: back.as_bool(),
                        can_go_forward: fwd.as_bool(),
                    });
                }
                Ok(())
            })),
            &mut token,
        )?;
    }
    {
        // Navigation start: rewrite (https upgrade / tracking params) or announce loading.
        let (sink, tab, filter, page_url) = (
            ctx.sink.clone(),
            tab.clone(),
            ctx.filter.clone(),
            ctx.page_url.clone(),
        );
        let start_armed = Arc::new(Mutex::new(HashSet::<String>::new()));
        let armed = start_armed.clone();
        core.add_NavigationStarting(
            &NavigationStartingEventHandler::create(Box::new(move |sender, args| {
                let (Some(core), Some(args)) = (sender, args) else {
                    return Ok(());
                };
                let uri = pw(|p| args.Uri(p))?;
                if is_web(&uri) {
                    if let Some(new_uri) = filter.rewrite_navigation(&uri) {
                        args.SetCancel(true)?;
                        core.Navigate(&HSTRING::from(new_uri))?;
                        return Ok(());
                    }
                    if unsafe {
                        register_main_document_start(&core, filter.clone(), &uri, armed.clone())?
                    } {
                        args.SetCancel(true)?;
                        return Ok(());
                    }
                }
                let mut user_initiated = Default::default();
                let _ = args.IsUserInitiated(&mut user_initiated);
                *page_url.lock() = uri.clone();
                sink(EngineEvent::NavigationStarted {
                    tab: tab.clone(),
                    url: uri,
                });
                Ok(())
            })),
            &mut token,
        )?;
    }
    {
        let (sink, tab, filter, page_url) = (
            ctx.sink.clone(),
            tab.clone(),
            ctx.filter.clone(),
            ctx.page_url.clone(),
        );
        core.add_NavigationCompleted(
            &NavigationCompletedEventHandler::create(Box::new(move |sender, args| {
                if let (Some(core), Some(args)) = (&sender, &args) {
                    let mut ok = Default::default();
                    if args.IsSuccess(&mut ok).is_ok() && !ok.as_bool() {
                        let failed = page_url.lock().clone();
                        if let Some(orig) = filter.upgrade_fallback(&failed) {
                            core.Navigate(&HSTRING::from(orig))?;
                        }
                    }
                }
                if let Some(core) = sender {
                    let (mut back, mut fwd) = (Default::default(), Default::default());
                    core.CanGoBack(&mut back)?;
                    core.CanGoForward(&mut fwd)?;
                    sink(EngineEvent::LoadingChanged {
                        tab: tab.clone(),
                        loading: false,
                    });
                    sink(EngineEvent::HistoryChanged {
                        tab: tab.clone(),
                        can_go_back: back.as_bool(),
                        can_go_forward: fwd.as_bool(),
                    });
                }
                Ok(())
            })),
            &mut token,
        )?;
    }

    // --- cosmetic filtering + extension scripts (idempotent scripts; phases: start / end / idle) ---
    {
        let run = |filter: Arc<Filter>, phase: u8| {
            move |core: &ICoreWebView2| -> windows::core::Result<()> {
                let url = pw(|p| core.Source(p))?;
                if !is_web(&url) {
                    return Ok(());
                }
                for js in filter.page_script_injections(&url, phase) {
                    core.ExecuteScript(
                        &HSTRING::from(js),
                        None::<&ICoreWebView2ExecuteScriptCompletedHandler>,
                    )?;
                }
                Ok(())
            }
        };
        let start = run(ctx.filter.clone(), 0);
        core.add_ContentLoading(
            &ContentLoadingEventHandler::create(Box::new(move |sender, _| {
                if let Some(core) = sender {
                    let _ = start(&core);
                }
                Ok(())
            })),
            &mut token,
        )?;
        if let Ok(core2) = core.cast::<ICoreWebView2_2>() {
            let end = run(ctx.filter.clone(), 1);
            core2.add_DOMContentLoaded(
                &DOMContentLoadedEventHandler::create(Box::new(move |sender, _| {
                    if let Some(core) = sender {
                        let _ = end(&core);
                    }
                    Ok(())
                })),
                &mut token,
            )?;
        }
        let idle = run(ctx.filter.clone(), 2);
        core.add_NavigationCompleted(
            &NavigationCompletedEventHandler::create(Box::new(move |sender, _| {
                if let Some(core) = sender {
                    let _ = idle(&core);
                }
                Ok(())
            })),
            &mut token,
        )?;
    }

    // --- new windows become new tabs ---
    {
        let (sink, tab, filter, page_url) = (
            ctx.sink.clone(),
            tab.clone(),
            ctx.filter.clone(),
            ctx.page_url.clone(),
        );
        core.add_NewWindowRequested(
            &NewWindowRequestedEventHandler::create(Box::new(move |_, args| {
                let Some(args) = args else { return Ok(()) };
                let uri = pw(|p| args.Uri(p))?;
                args.SetHandled(true)?;
                if !filter.enabled() {
                    if is_web(&uri) || uri == "about:blank" {
                        sink(EngineEvent::NewTabRequested {
                            from: tab.clone(),
                            url: uri,
                        });
                    }
                    return Ok(());
                }
                if !is_web(&uri) {
                    if uri == "about:blank" {
                        sink(EngineEvent::NewTabRequested {
                            from: tab.clone(),
                            url: uri,
                        });
                    }
                    return Ok(());
                }
                let source = page_url.lock().clone();
                match filter.verdict_with_rewrite(&uri, &source, Kind::Document) {
                    DetailedVerdict::Block | DetailedVerdict::Respond { .. } => {
                        sink(EngineEvent::Blocked {
                            tab: tab.clone(),
                            url: uri,
                        });
                    }
                    DetailedVerdict::Allow => {
                        sink(EngineEvent::NewTabRequested {
                            from: tab.clone(),
                            url: uri,
                        });
                    }
                    DetailedVerdict::Rewrite { url } => {
                        sink(EngineEvent::NewTabRequested {
                            from: tab.clone(),
                            url,
                        });
                    }
                }
                Ok(())
            })),
            &mut token,
        )?;
    }

    // --- favicon ---
    if let Ok(core15) = core.cast::<ICoreWebView2_15>() {
        let (sink, tab) = (ctx.sink.clone(), tab.clone());
        core15.add_FaviconChanged(
            &FaviconChangedEventHandler::create(Box::new(move |sender, _| {
                if let Some(core) = sender {
                    if let Ok(core15) = core.cast::<ICoreWebView2_15>() {
                        if let Ok(url) = pw(|p| core15.FaviconUri(p)) {
                            if !url.is_empty() {
                                sink(EngineEvent::FaviconChanged {
                                    tab: tab.clone(),
                                    url,
                                });
                            }
                        }
                    }
                }
                Ok(())
            })),
            &mut token,
        )?;
    }

    // --- audio ---
    if let Ok(core8) = core.cast::<ICoreWebView2_8>() {
        let (sink, tab) = (ctx.sink.clone(), tab.clone());
        core8.add_IsDocumentPlayingAudioChanged(
            &IsDocumentPlayingAudioChangedEventHandler::create(Box::new(move |sender, _| {
                if let Some(core) = sender {
                    if let Ok(core8) = core.cast::<ICoreWebView2_8>() {
                        let mut playing = Default::default();
                        core8.IsDocumentPlayingAudio(&mut playing)?;
                        sink(EngineEvent::AudioChanged {
                            tab: tab.clone(),
                            audible: playing.as_bool(),
                        });
                    }
                }
                Ok(())
            })),
            &mut token,
        )?;
    }

    // --- request blocking ---
    if let Ok(core2) = core.cast::<ICoreWebView2_2>() {
        let env = core2.Environment()?;
        core.AddWebResourceRequestedFilter(
            &HSTRING::from("*"),
            COREWEBVIEW2_WEB_RESOURCE_CONTEXT_ALL,
        )?;
        let (sink, tab, filter, page_url) = (
            ctx.sink.clone(),
            tab.clone(),
            ctx.filter.clone(),
            ctx.page_url.clone(),
        );
        core.add_WebResourceRequested(
            &WebResourceRequestedEventHandler::create(Box::new(move |_, args| {
                let Some(args) = args else { return Ok(()) };
                if !filter.enabled() {
                    return Ok(());
                }
                let mut rc = COREWEBVIEW2_WEB_RESOURCE_CONTEXT_ALL;
                args.ResourceContext(&mut rc)?;
                let uri = pw(|p| args.Request()?.Uri(p))?;
                if !is_web(&uri) {
                    return Ok(());
                }
                let source = page_url.lock().clone();
                let kind = if rc == COREWEBVIEW2_WEB_RESOURCE_CONTEXT_DOCUMENT {
                    if uri == source {
                        return Ok(());
                    }
                    Kind::Subdocument
                } else {
                    kind_of(rc)
                };
                match filter.verdict_with_rewrite(&uri, &source, kind) {
                    DetailedVerdict::Allow => {}
                    DetailedVerdict::Block => {
                        let resp = env.CreateWebResourceResponse(
                            None,
                            403,
                            &HSTRING::from("Blocked"),
                            &HSTRING::from(""),
                        )?;
                        args.SetResponse(&resp)?;
                        sink(EngineEvent::Blocked {
                            tab: tab.clone(),
                            url: uri,
                        });
                    }
                    DetailedVerdict::Respond { mime, body } => {
                        let stream = windows::Win32::UI::Shell::SHCreateMemStream(Some(&body));
                        let headers = HSTRING::from(format!(
                            "Content-Type: {mime}\r\nCache-Control: no-store\r\n"
                        ));
                        let resp = env.CreateWebResourceResponse(
                            stream.as_ref(),
                            200,
                            &HSTRING::from("OK"),
                            &headers,
                        )?;
                        args.SetResponse(&resp)?;
                        sink(EngineEvent::Blocked {
                            tab: tab.clone(),
                            url: uri,
                        });
                    }
                    DetailedVerdict::Rewrite { url } => {
                        let headers = HSTRING::from(format!(
                            "Location: {url}\r\nCache-Control: no-store\r\n"
                        ));
                        let resp = env.CreateWebResourceResponse(
                            None,
                            307,
                            &HSTRING::from("Temporary Redirect"),
                            &headers,
                        )?;
                        args.SetResponse(&resp)?;
                    }
                }
                Ok(())
            })),
            &mut token,
        )?;
    }

    // --- context menu: "Send image to board" ---
    if let Ok(core11) = core.cast::<ICoreWebView2_11>() {
        let env9 = core
            .cast::<ICoreWebView2_2>()?
            .Environment()?
            .cast::<ICoreWebView2Environment9>()?;
        let (sink, tab) = (ctx.sink.clone(), tab.clone());
        core11.add_ContextMenuRequested(
            &ContextMenuRequestedEventHandler::create(Box::new(move |_, args| {
                let Some(args) = args else { return Ok(()) };
                let target = args.ContextMenuTarget()?;
                let mut kind = COREWEBVIEW2_CONTEXT_MENU_TARGET_KIND_PAGE;
                target.Kind(&mut kind)?;
                if kind != COREWEBVIEW2_CONTEXT_MENU_TARGET_KIND_IMAGE {
                    return Ok(());
                }
                let src = pw(|p| target.SourceUri(p))?;
                if !is_web(&src) {
                    return Ok(());
                }
                let item = env9.CreateContextMenuItem(
                    &HSTRING::from("Send image to Athanor board"),
                    None,
                    COREWEBVIEW2_CONTEXT_MENU_ITEM_KIND_COMMAND,
                )?;
                let (sink, tab) = (sink.clone(), tab.clone());
                let mut item_token = 0i64;
                item.add_CustomItemSelected(
                    &CustomItemSelectedEventHandler::create(Box::new(move |_, _| {
                        sink(EngineEvent::ContextAction {
                            tab: tab.clone(),
                            action: "send-image-to-board".into(),
                            data: src.clone(),
                        });
                        Ok(())
                    })),
                    &mut item_token,
                )?;
                let items = args.MenuItems()?;
                let mut count = 0u32;
                items.Count(&mut count)?;
                items.InsertValueAtIndex(count.min(1), &item)?;
                Ok(())
            })),
            &mut token,
        )?;
    }

    // --- native shortcuts (before the page sees them) ---
    {
        let (sink, tab) = (ctx.sink.clone(), tab.clone());
        controller.add_AcceleratorKeyPressed(
            &AcceleratorKeyPressedEventHandler::create(Box::new(move |_, args| {
                let Some(args) = args else { return Ok(()) };
                let mut kind = COREWEBVIEW2_KEY_EVENT_KIND_KEY_UP;
                args.KeyEventKind(&mut kind)?;
                if kind != COREWEBVIEW2_KEY_EVENT_KIND_KEY_DOWN
                    && kind != COREWEBVIEW2_KEY_EVENT_KIND_SYSTEM_KEY_DOWN
                {
                    return Ok(());
                }
                let mut vk = 0u32;
                args.VirtualKey(&mut vk)?;
                let down = |k: i32| GetKeyState(k) < 0;
                if let Some(c) = combo(vk, down(0x11), down(0x10), down(0x12)) {
                    args.SetHandled(true)?;
                    sink(EngineEvent::Shortcut {
                        tab: tab.clone(),
                        combo: c.to_string(),
                    });
                }
                Ok(())
            })),
            &mut token,
        )?;
    }

    Ok(())
}

pub unsafe fn go_back(controller: &ICoreWebView2Controller) -> windows::core::Result<()> {
    controller.CoreWebView2()?.GoBack()
}

pub unsafe fn go_forward(controller: &ICoreWebView2Controller) -> windows::core::Result<()> {
    controller.CoreWebView2()?.GoForward()
}

pub unsafe fn stop(controller: &ICoreWebView2Controller) -> windows::core::Result<()> {
    controller.CoreWebView2()?.Stop()
}

pub unsafe fn set_muted(
    controller: &ICoreWebView2Controller,
    muted: bool,
) -> windows::core::Result<()> {
    controller
        .CoreWebView2()?
        .cast::<ICoreWebView2_8>()?
        .SetIsMuted(muted)
}

/// Screenshot the visible area of the page as PNG. The result is delivered through `tx` (from the UI thread).
pub unsafe fn capture_png(
    controller: &ICoreWebView2Controller,
    tx: std::sync::mpsc::Sender<std::result::Result<Vec<u8>, String>>,
) -> windows::core::Result<()> {
    use windows::Win32::{
        System::Com::{IStream, STREAM_SEEK_SET},
        UI::Shell::SHCreateMemStream,
    };
    let core = controller.CoreWebView2()?;
    let stream: IStream = SHCreateMemStream(None).ok_or_else(|| {
        windows::core::Error::from_hresult(windows::Win32::Foundation::E_OUTOFMEMORY)
    })?;
    let reader = stream.clone();
    let done = tx.clone();
    core.CapturePreview(
        COREWEBVIEW2_CAPTURE_PREVIEW_IMAGE_FORMAT_PNG,
        &stream,
        &CapturePreviewCompletedHandler::create(Box::new(move |res| {
            let out = res.map_err(|e| e.to_string()).and_then(|()| unsafe {
                reader
                    .Seek(0, STREAM_SEEK_SET, None)
                    .map_err(|e| e.to_string())?;
                let mut bytes = Vec::new();
                let mut buf = vec![0u8; 64 * 1024];
                loop {
                    let mut read = 0u32;
                    let hr =
                        reader.Read(buf.as_mut_ptr().cast(), buf.len() as u32, Some(&mut read));
                    if hr.is_err() {
                        return Err(format!("stream read failed: {hr:?}"));
                    }
                    if read == 0 {
                        break;
                    }
                    bytes.extend_from_slice(&buf[..read as usize]);
                }
                Ok(bytes)
            });
            let _ = done.send(out);
            Ok(())
        })),
    )
    .inspect_err(|e| {
        let _ = tx.send(Err(e.to_string()));
    })
}
