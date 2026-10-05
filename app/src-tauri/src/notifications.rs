//! A small transparent native view for Sonner. CSS z-index cannot put shell DOM above tab webviews.
use parking_lot::Mutex;
use serde_json::Value;
use tauri::{AppHandle, Emitter, Manager, State};

#[derive(Default)]
pub struct NotificationHost {
    payload: Mutex<Value>,
    height: Mutex<f64>,
}

#[tauri::command]
pub fn get_notification_state(
    webview: tauri::Webview,
    host: State<'_, NotificationHost>,
) -> Result<Value, String> {
    if !matches!(webview.label(), "shell" | "notifications") {
        return Err("Only the notification interface can read messages".into());
    }
    Ok(host.payload.lock().clone())
}

#[tauri::command]
pub async fn sync_notifications(
    app: AppHandle,
    webview: tauri::Webview,
    host: State<'_, NotificationHost>,
    payload: Value,
) -> Result<(), String> {
    if webview.label() != "shell" {
        return Err("Only the shell can publish notifications".into());
    }
    if payload.to_string().len() > 256 * 1024 {
        return Err("Notification payload is too large".into());
    }
    *host.payload.lock() = payload;
    let queued = app.clone();
    let (send, receive) = tokio::sync::oneshot::channel();
    app.run_on_main_thread(move || {
        let result = layout(&queued)
            .and_then(|()| {
                let payload = queued.state::<NotificationHost>().payload.lock().clone();
                queued.emit_to("notifications", "athanor://notifications", payload)
            })
            .map_err(|error| error.to_string());
        let _ = send.send(result);
    })
    .map_err(|e| e.to_string())?;
    receive
        .await
        .map_err(|_| "The notification view could not be updated".to_string())?
}

#[tauri::command]
pub async fn notification_height(
    app: AppHandle,
    webview: tauri::Webview,
    host: State<'_, NotificationHost>,
    height: f64,
) -> Result<(), String> {
    if webview.label() != "notifications" {
        return Err("Only the notification interface can set its height".into());
    }
    if !height.is_finite() {
        return Err("Invalid notification height".into());
    }
    *host.height.lock() = height.clamp(64.0, 520.0);
    let queued = app.clone();
    app.run_on_main_thread(move || {
        let _ = layout(&queued);
    })
    .map_err(|e| e.to_string())
}

fn layout(app: &AppHandle) -> Result<(), tauri::Error> {
    let host = app.state::<NotificationHost>();
    let payload = host.payload.lock().clone();
    let visible = payload["items"]
        .as_array()
        .is_some_and(|items| !items.is_empty())
        && !payload["suppressed"].as_bool().unwrap_or(false);
    if !visible {
        if let Some(view) = app.get_webview("notifications") {
            view.hide()?;
        }
        return Ok(());
    }
    let Some(window) = app.get_window("main") else {
        return Ok(());
    };
    let size = window
        .inner_size()?
        .to_logical::<f64>(window.scale_factor()?);
    let scale = payload["scale"].as_f64().unwrap_or(100.0) / 100.0;
    let width = (388.0 * scale).min(size.width);
    let measured = *host.height.lock();
    let height = (if measured > 0.0 { measured } else { 240.0 }).min(size.height);
    let position = tauri::LogicalPosition::new(
        (size.width - width).max(0.0),
        (size.height - height).max(0.0),
    );
    let view = if let Some(view) = app.get_webview("notifications") {
        view.set_bounds(tauri::Rect {
            position: position.into(),
            size: tauri::LogicalSize::new(width, height).into(),
        })?;
        view
    } else {
        window.add_child(
            tauri::webview::WebviewBuilder::new(
                "notifications",
                tauri::WebviewUrl::App("index.html#/notifications".into()),
            )
            .transparent(true),
            position,
            tauri::LogicalSize::new(width, height),
        )?
    };
    view.show()?;
    raise(app);
    Ok(())
}

/// Tab creation and focus can raise another native container; keep the notification above it without taking focus.
pub fn raise(app: &AppHandle) {
    #[cfg(windows)]
    if let Some(view) = app.get_webview("notifications") {
        let _ = view.with_webview(|native| unsafe {
            use windows::Win32::UI::WindowsAndMessaging::{
                SetWindowPos, HWND_TOP, SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOSIZE,
            };
            let mut container = Default::default();
            if native.controller().ParentWindow(&mut container).is_ok() {
                let _ = SetWindowPos(
                    container,
                    Some(HWND_TOP),
                    0,
                    0,
                    0,
                    0,
                    SWP_NOACTIVATE | SWP_NOMOVE | SWP_NOSIZE,
                );
            }
        });
    }
    #[cfg(not(windows))]
    let _ = app;
}

pub fn resize(app: &AppHandle) {
    let _ = layout(app);
}
