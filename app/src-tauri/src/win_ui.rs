//! WebView2 chrome that would otherwise look like Microsoft Edge, replaced by Athanor's own.
//!
//! Turned off in the engine and handed to the shell instead: the error page, JavaScript dialogs, permission prompts,
//! the download bubble, the link-hover status bubble, autofill popups and certificate interstitials. The user agent
//! and client-hint brands stop saying "Edge" too (see `brand.rs`). The engine only reports what happened
//! ([`EngineEvent`]); the shell draws the answer and calls back through `resolve_*`.

use crate::{brand, errorpage};
use athanor_core::engine::{EngineEvent, EventSink};
use parking_lot::Mutex;
use std::{
    cell::RefCell,
    collections::HashMap,
    sync::{
        atomic::{AtomicU32, Ordering},
        Arc,
    },
    time::{Duration, Instant},
};
use webview2_com::{take_pwstr, Microsoft::Web::WebView2::Win32::*, *};
use windows::core::{Interface, HSTRING, PWSTR};

fn pw(f: impl FnOnce(&mut PWSTR) -> windows::core::Result<()>) -> windows::core::Result<String> {
    let mut p = PWSTR::null();
    f(&mut p)?;
    Ok(take_pwstr(p))
}

/// Per-tab state the main navigation handlers need.
#[derive(Default)]
pub struct UiState {
    /// When this tab last started a download; a navigation that "fails" right after is the download, not an error.
    last_download: Mutex<Option<Instant>>,
}

impl UiState {
    pub fn download_just_started(&self) -> bool {
        self.last_download
            .lock()
            .is_some_and(|at| at.elapsed() < Duration::from_secs(4))
    }
}

struct PendingDialog {
    args: ICoreWebView2ScriptDialogOpeningEventArgs,
    deferral: ICoreWebView2Deferral,
}

struct PendingPermission {
    args: ICoreWebView2PermissionRequestedEventArgs,
    deferral: ICoreWebView2Deferral,
}

thread_local! {
    // WebView2 objects belong to the UI thread, so pending requests live there.
    static DIALOGS: RefCell<HashMap<String, PendingDialog>> = RefCell::new(HashMap::new());
    static PERMISSIONS: RefCell<HashMap<u32, PendingPermission>> = RefCell::new(HashMap::new());
    /// Downloads in flight: the operation object must outlive the handler that started it.
    static DOWNLOADS: RefCell<HashMap<u32, ICoreWebView2DownloadOperation>> = RefCell::new(HashMap::new());
}

static NEXT_PERMISSION: AtomicU32 = AtomicU32::new(1);
static NEXT_DOWNLOAD: AtomicU32 = AtomicU32::new(1);

/// Answer the pending JavaScript dialog of `tab` (UI thread).
pub fn resolve_script_dialog(tab: &str, accept: bool, text: &str) {
    if let Some(pending) = DIALOGS.with(|d| d.borrow_mut().remove(tab)) {
        unsafe {
            if accept {
                let _ = pending.args.SetResultText(&HSTRING::from(text));
                let _ = pending.args.Accept();
            }
            let _ = pending.deferral.Complete();
        }
    }
}

/// Answer a pending permission request (UI thread).
pub fn resolve_permission(request: u32, allow: bool) {
    if let Some(pending) = PERMISSIONS.with(|p| p.borrow_mut().remove(&request)) {
        unsafe {
            // The answer lives in Athanor's own settings; WebView2 must not keep a second copy.
            if let Ok(args3) = pending
                .args
                .cast::<ICoreWebView2PermissionRequestedEventArgs3>()
            {
                let _ = args3.SetSavesInProfile(false);
            }
            let _ = pending.args.SetState(if allow {
                COREWEBVIEW2_PERMISSION_STATE_ALLOW
            } else {
                COREWEBVIEW2_PERMISSION_STATE_DENY
            });
            let _ = pending.deferral.Complete();
        }
    }
}

/// Permission kinds worth asking about, with the name the shell shows. Everything else keeps the engine default.
fn permission_name(kind: COREWEBVIEW2_PERMISSION_KIND) -> Option<&'static str> {
    Some(match kind {
        COREWEBVIEW2_PERMISSION_KIND_MICROPHONE => "microphone",
        COREWEBVIEW2_PERMISSION_KIND_CAMERA => "camera",
        COREWEBVIEW2_PERMISSION_KIND_GEOLOCATION => "location",
        COREWEBVIEW2_PERMISSION_KIND_NOTIFICATIONS => "notifications",
        COREWEBVIEW2_PERMISSION_KIND_OTHER_SENSORS => "motion sensors",
        COREWEBVIEW2_PERMISSION_KIND_CLIPBOARD_READ => "clipboard",
        COREWEBVIEW2_PERMISSION_KIND_MULTIPLE_AUTOMATIC_DOWNLOADS => "multiple downloads",
        COREWEBVIEW2_PERMISSION_KIND_FILE_READ_WRITE => "files",
        COREWEBVIEW2_PERMISSION_KIND_MIDI_SYSTEM_EXCLUSIVE_MESSAGES => "MIDI devices",
        _ => return None,
    })
}

/// Show Athanor's error page in place of the failed page. `status` is `COREWEBVIEW2_WEB_ERROR_STATUS`.
///
/// # Safety
/// Calls raw COM interfaces on the UI thread.
pub unsafe fn show_error_page(
    core: &ICoreWebView2,
    url: &str,
    status: i32,
) -> windows::core::Result<()> {
    core.NavigateToString(&HSTRING::from(errorpage::render(url, status)))
}

/// A path next to `path` that does not exist yet (`name (1).ext`, `name (2).ext`, ...).
fn unique_path(path: &str) -> String {
    let p = std::path::Path::new(path);
    let reserved = |candidate: &std::path::Path| {
        DOWNLOADS.with(|downloads| {
            downloads.borrow().values().any(|op| unsafe {
                pw(|p| op.ResultFilePath(p))
                    .is_ok_and(|name| std::path::Path::new(&name) == candidate)
            })
        })
    };
    if !p.exists() && !reserved(p) {
        return path.to_owned();
    }
    let (stem, ext) = (
        p.file_stem().and_then(|s| s.to_str()).unwrap_or("download"),
        p.extension().and_then(|s| s.to_str()),
    );
    for n in 1..1000 {
        let name = match ext {
            Some(ext) => format!("{stem} ({n}).{ext}"),
            None => format!("{stem} ({n})"),
        };
        let candidate = p.with_file_name(name);
        if !candidate.exists() && !reserved(&candidate) {
            return candidate.to_string_lossy().into_owned();
        }
    }
    p.with_file_name(format!(
        "{stem}-{}.{}",
        NEXT_DOWNLOAD.load(Ordering::Relaxed),
        ext.unwrap_or("bin")
    ))
    .to_string_lossy()
    .into_owned()
}

/// UI thread only; resume the original operation rather than issuing a new request.
pub fn control_download(id: u32, action: &str) -> std::result::Result<(), String> {
    let operation = DOWNLOADS
        .with(|d| d.borrow().get(&id).cloned())
        .ok_or("This transfer is no longer available. Download it again from the original page.")?;
    unsafe {
        match action {
            "pause" => operation.Pause(),
            "cancel" => operation.Cancel(),
            "resume" => {
                let mut can = Default::default();
                operation.CanResume(&mut can).map_err(|e| e.to_string())?;
                if !can.as_bool() { return Err("This transfer cannot be resumed. Download it again from the original page.".into()); }
                operation.Resume()
            }
            _ => return Err("Unknown download action".into()),
        }.map_err(|e| e.to_string())
    }
}

fn download_error(reason: COREWEBVIEW2_DOWNLOAD_INTERRUPT_REASON) -> &'static str {
    match reason {
        COREWEBVIEW2_DOWNLOAD_INTERRUPT_REASON_FILE_NO_SPACE => "There is not enough disk space. Free up space and resume the download.",
        COREWEBVIEW2_DOWNLOAD_INTERRUPT_REASON_FILE_ACCESS_DENIED => "Athanor could not write to the download folder. Check the folder's permissions.",
        COREWEBVIEW2_DOWNLOAD_INTERRUPT_REASON_NETWORK_DISCONNECTED | COREWEBVIEW2_DOWNLOAD_INTERRUPT_REASON_NETWORK_FAILED | COREWEBVIEW2_DOWNLOAD_INTERRUPT_REASON_NETWORK_TIMEOUT => "The connection was interrupted. Check your network connection and resume if available.",
        COREWEBVIEW2_DOWNLOAD_INTERRUPT_REASON_SERVER_UNAUTHORIZED | COREWEBVIEW2_DOWNLOAD_INTERRUPT_REASON_SERVER_FORBIDDEN => "The server refused this download. Sign in or request a new download link from the original page.",
        COREWEBVIEW2_DOWNLOAD_INTERRUPT_REASON_FILE_MALICIOUS | COREWEBVIEW2_DOWNLOAD_INTERRUPT_REASON_FILE_BLOCKED_BY_POLICY | COREWEBVIEW2_DOWNLOAD_INTERRUPT_REASON_FILE_SECURITY_CHECK_FAILED => "The download was blocked by a security check or device policy.",
        COREWEBVIEW2_DOWNLOAD_INTERRUPT_REASON_SERVER_CERTIFICATE_PROBLEM => "The download server's certificate could not be verified.",
        _ => "The transfer could not finish. Resume if available, or download it again from the original page.",
    }
}

/// Wire up everything above for one tab.
///
/// # Safety
/// Calls raw COM interfaces; must run on the UI thread that owns `core`.
pub unsafe fn attach_ui(
    core: &ICoreWebView2,
    tab: &str,
    sink: &EventSink,
) -> windows::core::Result<Arc<UiState>> {
    let state = Arc::new(UiState::default());
    let mut token = 0i64;

    if let Ok(settings) = core.Settings() {
        let _ = settings.SetIsBuiltInErrorPageEnabled(false);
        let _ = settings.SetAreDefaultScriptDialogsEnabled(false);
        let _ = settings.SetIsStatusBarEnabled(false);
        if let Ok(settings4) = settings.cast::<ICoreWebView2Settings4>() {
            let _ = settings4.SetIsGeneralAutofillEnabled(false);
            let _ = settings4.SetIsPasswordAutosaveEnabled(false);
        }
        // Pages see Chromium + Athanor, not Microsoft Edge.
        if let Ok(settings2) = settings.cast::<ICoreWebView2Settings2>() {
            if let Ok(ua) = pw(|p| settings2.UserAgent(p)) {
                if let Some(params) = brand::user_agent_override(&ua, env!("CARGO_PKG_VERSION")) {
                    let _ = core.CallDevToolsProtocolMethod(
                        &HSTRING::from("Emulation.setUserAgentOverride"),
                        &HSTRING::from(params),
                        &CallDevToolsProtocolMethodCompletedHandler::create(Box::new(
                            |_, _| Ok(()),
                        )),
                    );
                }
            }
        }
    }

    // Link under the pointer.
    if let Ok(core12) = core.cast::<ICoreWebView2_12>() {
        let (sink, tab) = (sink.clone(), tab.to_owned());
        core12.add_StatusBarTextChanged(
            &StatusBarTextChangedEventHandler::create(Box::new(move |sender, _| {
                if let Some(core12) = sender.and_then(|core| core.cast::<ICoreWebView2_12>().ok()) {
                    let text = pw(|p| core12.StatusBarText(p)).unwrap_or_default();
                    sink(EngineEvent::StatusText {
                        tab: tab.clone(),
                        text,
                    });
                }
                Ok(())
            })),
            &mut token,
        )?;
    }

    // Bad certificates: refuse, and let the error page explain. There is no "continue anyway".
    if let Ok(core14) = core.cast::<ICoreWebView2_14>() {
        let _ = core14.add_ServerCertificateErrorDetected(
            &ServerCertificateErrorDetectedEventHandler::create(Box::new(|_, args| {
                if let Some(args) = args {
                    args.SetAction(COREWEBVIEW2_SERVER_CERTIFICATE_ERROR_ACTION_CANCEL)?;
                }
                Ok(())
            })),
            &mut token,
        );
    }

    // alert / confirm / prompt / beforeunload.
    {
        let (sink, tab) = (sink.clone(), tab.to_owned());
        core.add_ScriptDialogOpening(
            &ScriptDialogOpeningEventHandler::create(Box::new(move |_, args| {
                let Some(args) = args else { return Ok(()) };
                let mut kind = COREWEBVIEW2_SCRIPT_DIALOG_KIND_ALERT;
                args.Kind(&mut kind)?;
                let kind = match kind {
                    COREWEBVIEW2_SCRIPT_DIALOG_KIND_CONFIRM => "confirm",
                    COREWEBVIEW2_SCRIPT_DIALOG_KIND_PROMPT => "prompt",
                    COREWEBVIEW2_SCRIPT_DIALOG_KIND_BEFOREUNLOAD => "beforeunload",
                    _ => "alert",
                };
                let message = pw(|p| args.Message(p)).unwrap_or_default();
                let default_text = pw(|p| args.DefaultText(p)).unwrap_or_default();
                let origin = pw(|p| args.Uri(p)).unwrap_or_default();
                let deferral = args.GetDeferral()?;
                let previous = DIALOGS.with(|d| {
                    d.borrow_mut().insert(
                        tab.clone(),
                        PendingDialog {
                            args: args.clone(),
                            deferral,
                        },
                    )
                });
                if let Some(old) = previous {
                    let _ = old.deferral.Complete();
                }
                sink(EngineEvent::ScriptDialog {
                    tab: tab.clone(),
                    kind: kind.to_owned(),
                    message,
                    default_text,
                    origin,
                });
                Ok(())
            })),
            &mut token,
        )?;
    }

    // Camera, microphone, location, ...
    {
        let (sink, tab) = (sink.clone(), tab.to_owned());
        core.add_PermissionRequested(
            &PermissionRequestedEventHandler::create(Box::new(move |_, args| {
                let Some(args) = args else { return Ok(()) };
                let mut kind = COREWEBVIEW2_PERMISSION_KIND_UNKNOWN_PERMISSION;
                args.PermissionKind(&mut kind)?;
                let Some(name) = permission_name(kind) else {
                    return Ok(());
                };
                let origin = pw(|p| args.Uri(p)).unwrap_or_default();
                let deferral = args.GetDeferral()?;
                let id = NEXT_PERMISSION.fetch_add(1, Ordering::Relaxed);
                PERMISSIONS.with(|p| {
                    p.borrow_mut().insert(
                        id,
                        PendingPermission {
                            args: args.clone(),
                            deferral,
                        },
                    )
                });
                sink(EngineEvent::PermissionRequest {
                    tab: tab.clone(),
                    id,
                    origin,
                    kind: name.to_owned(),
                });
                Ok(())
            })),
            &mut token,
        )?;
    }

    // Downloads: no Edge bubble; the shell shows progress and the finished file.
    if let Ok(core4) = core.cast::<ICoreWebView2_4>() {
        let (sink, tab, state) = (sink.clone(), tab.to_owned(), state.clone());
        core4.add_DownloadStarting(
            &DownloadStartingEventHandler::create(Box::new(move |_, args| {
                let Some(args) = args else { return Ok(()) };
                let operation = args.DownloadOperation()?;
                let path = unique_path(&pw(|p| args.ResultFilePath(p))?);
                args.SetResultFilePath(&HSTRING::from(path.as_str()))?;
                args.SetHandled(true)?;
                *state.last_download.lock() = Some(Instant::now());
                let id = NEXT_DOWNLOAD.fetch_add(1, Ordering::Relaxed);
                let name = std::path::Path::new(&path)
                    .file_name()
                    .map(|n| n.to_string_lossy().into_owned())
                    .unwrap_or_else(|| "download".into());
                let report = {
                    let (sink, tab, path, name) =
                        (sink.clone(), tab.clone(), path.clone(), name.clone());
                    move |operation: &ICoreWebView2DownloadOperation, state: &str| {
                        let (mut received, mut total) = (0i64, 0i64);
                        let _ = operation.BytesReceived(&mut received);
                        let _ = operation.TotalBytesToReceive(&mut total);
                        let mut can_resume = Default::default();
                        let _ = operation.CanResume(&mut can_resume);
                        let mut reason = COREWEBVIEW2_DOWNLOAD_INTERRUPT_REASON_NONE;
                        let _ = operation.InterruptReason(&mut reason);
                        sink(EngineEvent::Download {
                            tab: tab.clone(),
                            id,
                            name: name.clone(),
                            path: path.clone(),
                            state: state.to_owned(),
                            received: received.max(0) as u64,
                            total: total.max(0) as u64,
                            error: (state == "failed").then(|| download_error(reason).into()),
                            can_resume: can_resume.as_bool(),
                        });
                    }
                };
                report(&operation, "started");
                DOWNLOADS.with(|d| d.borrow_mut().insert(id, operation.clone()));
                let mut inner_token = 0i64;
                {
                    let report = report.clone();
                    let last = Mutex::new(Instant::now());
                    operation.add_BytesReceivedChanged(
                        &BytesReceivedChangedEventHandler::create(Box::new(move |sender, _| {
                            if let Some(op) = sender {
                                let mut last = last.lock();
                                if last.elapsed() >= Duration::from_millis(350) {
                                    *last = Instant::now();
                                    report(&op, "progress");
                                }
                            }
                            Ok(())
                        })),
                        &mut inner_token,
                    )?;
                }
                operation.add_StateChanged(
                    &StateChangedEventHandler::create(Box::new(move |sender, _| {
                        if let Some(op) = sender {
                            let mut st = COREWEBVIEW2_DOWNLOAD_STATE_IN_PROGRESS;
                            let _ = op.State(&mut st);
                            match st {
                                COREWEBVIEW2_DOWNLOAD_STATE_COMPLETED => {
                                    report(&op, "done");
                                    DOWNLOADS.with(|d| d.borrow_mut().remove(&id));
                                }
                                COREWEBVIEW2_DOWNLOAD_STATE_INTERRUPTED => {
                                    let mut reason = COREWEBVIEW2_DOWNLOAD_INTERRUPT_REASON_NONE;
                                    let _ = op.InterruptReason(&mut reason);
                                    let state = match reason {
                                        COREWEBVIEW2_DOWNLOAD_INTERRUPT_REASON_USER_CANCELED => {
                                            "cancelled"
                                        }
                                        COREWEBVIEW2_DOWNLOAD_INTERRUPT_REASON_USER_PAUSED => {
                                            "paused"
                                        }
                                        _ => "failed",
                                    };
                                    report(&op, state);
                                    let mut resumable = Default::default();
                                    let _ = op.CanResume(&mut resumable);
                                    if state == "cancelled" || !resumable.as_bool() {
                                        DOWNLOADS.with(|d| d.borrow_mut().remove(&id));
                                    }
                                }
                                _ => report(&op, "progress"),
                            }
                        }
                        Ok(())
                    })),
                    &mut inner_token,
                )?;
                Ok(())
            })),
            &mut token,
        )?;
    }

    Ok(state)
}
