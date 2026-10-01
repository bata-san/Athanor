//! Tauri commands: the shell-facing API described in `docs/IPC.md`. Thin wrappers over [`Browser`].

use crate::{
    boards::{self, BoardSummary},
    browser::{Browser, OpenArgs},
    devservers,
    ext_host::{CommandInfo, ExtHost, ExtensionInfo, PanelInfo, ThemeInfo},
    shield::Shield,
    state::*,
};
use athanor_adblock::user::LineIssue;
use athanor_core::{
    board::Board,
    devtools::Tool,
    filing::Rule,
    layout::{Dir, Rect},
    model::MoveDest,
    Id,
};
use std::sync::Arc;
use tauri::{AppHandle, Emitter, Manager, State};

type B<'a> = State<'a, Arc<Browser>>;
type R<T = ()> = Result<T, String>;

fn e(err: impl std::fmt::Display) -> String {
    err.to_string()
}

// ---------- bootstrap ----------

#[tauri::command]
pub async fn get_snapshot(b: B<'_>) -> R<Snapshot> {
    Ok(b.snapshot())
}

#[tauri::command]
pub async fn get_shell_css(b: B<'_>, host: State<'_, Arc<ExtHost>>) -> R<String> {
    Ok(host.shell_css(&b.settings().theme))
}

#[tauri::command]
pub async fn list_themes(host: State<'_, Arc<ExtHost>>) -> R<Vec<ThemeInfo>> {
    Ok(host.themes())
}

#[tauri::command]
pub async fn set_theme(b: B<'_>, app: AppHandle, host: State<'_, Arc<ExtHost>>, id: String) -> R {
    b.set_settings(SettingsPatch {
        theme: Some(id.clone()),
        ..Default::default()
    });
    let _ = app.emit("athanor://shell-css", host.shell_css(&id));
    Ok(())
}

#[tauri::command]
pub async fn set_space_theme(b: B<'_>, space: Id, theme: Option<String>) -> R {
    b.with_ws(|w| {
        if let Some(s) = w.spaces.iter_mut().find(|s| s.id == space) {
            s.theme = theme;
        }
    });
    Ok(())
}

#[tauri::command]
pub async fn get_panels(host: State<'_, Arc<ExtHost>>) -> R<Vec<PanelInfo>> {
    Ok(host.panels())
}

#[tauri::command]
pub async fn get_commands(host: State<'_, Arc<ExtHost>>) -> R<Vec<CommandInfo>> {
    Ok(host.commands())
}

#[tauri::command]
pub async fn run_extension_command(
    b: B<'_>,
    host: State<'_, Arc<ExtHost>>,
    ext: String,
    id: String,
) -> R {
    host.run_command(&b, &ext, &id)
}

#[tauri::command]
pub async fn extension_rpc(
    b: B<'_>,
    host: State<'_, Arc<ExtHost>>,
    ext: String,
    method: String,
    params: serde_json::Value,
) -> R<serde_json::Value> {
    host.rpc(&b, &ext, &method, params)
}

// ---------- tabs ----------

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn open_tab(
    b: B<'_>,
    url: Option<String>,
    parent: Option<Id>,
    folder: Option<Id>,
    space: Option<Id>,
    background: Option<bool>,
    pinned: Option<bool>,
) -> R<Id> {
    Ok(b.open_tab(OpenArgs {
        url,
        parent,
        folder,
        space,
        background,
        pinned,
    }))
}

#[tauri::command]
pub async fn navigate(b: B<'_>, tab: Id, input: String) -> R {
    b.navigate(&tab, &input);
    Ok(())
}

#[tauri::command]
pub async fn activate_tab(b: B<'_>, tab: Id) -> R {
    b.activate_tab(&tab);
    Ok(())
}

#[tauri::command]
pub async fn close_tab(b: B<'_>, tab: Id) -> R {
    b.close_tab(&tab);
    Ok(())
}

#[tauri::command]
pub async fn duplicate_tab(b: B<'_>, tab: Id) -> R<Option<Id>> {
    Ok(b.duplicate_tab(&tab))
}

#[tauri::command]
pub async fn reload(b: B<'_>, tab: Id) -> R {
    b.reload_stop(&tab, "reload");
    Ok(())
}

#[tauri::command]
pub async fn stop(b: B<'_>, tab: Id) -> R {
    b.reload_stop(&tab, "stop");
    Ok(())
}

#[tauri::command]
pub async fn go_back(b: B<'_>, tab: Id) -> R {
    b.reload_stop(&tab, "back");
    Ok(())
}

#[tauri::command]
pub async fn go_forward(b: B<'_>, tab: Id) -> R {
    b.reload_stop(&tab, "forward");
    Ok(())
}

#[tauri::command]
pub async fn set_pinned(b: B<'_>, tab: Id, pinned: bool) -> R {
    b.set_pinned(&tab, pinned);
    Ok(())
}

#[tauri::command]
pub async fn set_muted(b: B<'_>, tab: Id, muted: bool) -> R {
    b.set_muted(&tab, muted);
    Ok(())
}

#[tauri::command]
pub async fn move_tab(
    b: B<'_>,
    tab: Id,
    space: Option<Id>,
    folder: Option<Id>,
    before: Option<Id>,
    pinned: Option<bool>,
) -> R {
    b.move_tab(
        &tab,
        MoveDest {
            space,
            folder,
            before,
            pinned,
        },
    );
    Ok(())
}

#[tauri::command]
pub async fn close_other_tabs(b: B<'_>, tab: Id) -> R {
    let ids: Vec<Id> = {
        let mut v = b.tabs_to_close(&tab, false);
        v.retain(|x| *x != tab);
        v
    };
    b.close_many(ids);
    Ok(())
}

#[tauri::command]
pub async fn close_tabs_below(b: B<'_>, tab: Id) -> R {
    let ids = b.tabs_to_close(&tab, true);
    b.close_many(ids);
    Ok(())
}

#[tauri::command]
pub async fn restore_tab(b: B<'_>, tab: Id) -> R {
    b.restore_tab(&tab);
    Ok(())
}

#[tauri::command]
pub async fn copy_url(b: B<'_>, app: AppHandle, tab: Id) -> R {
    if let Some(url) = b.copy_url(&tab) {
        // Clipboard is written by the shell (navigator.clipboard); ask it to do so.
        let _ = app.emit("athanor://copy", url);
    }
    Ok(())
}

// ---------- folders & spaces ----------

#[tauri::command]
pub async fn create_folder(b: B<'_>, space: Id, name: String) -> R<Id> {
    Ok(b.with_ws(|w| w.create_folder(&space, &name, false)))
}

#[tauri::command]
pub async fn rename_folder(b: B<'_>, id: Id, name: String) -> R {
    b.with_ws(|w| w.rename_folder(&id, &name));
    Ok(())
}

#[tauri::command]
pub async fn toggle_folder(b: B<'_>, id: Id) -> R {
    b.with_ws(|w| w.toggle_folder(&id));
    Ok(())
}

#[tauri::command]
pub async fn delete_folder(b: B<'_>, id: Id, close_tabs: bool) -> R {
    let to_close = b.with_ws(|w| w.delete_folder(&id, close_tabs));
    b.close_many(to_close);
    Ok(())
}

#[tauri::command]
pub async fn set_folder_color(b: B<'_>, id: Id, color: Option<String>) -> R {
    b.with_ws(|w| {
        if let Some(f) = w.folders.iter_mut().find(|f| f.id == id) {
            f.color = color;
        }
    });
    Ok(())
}

#[tauri::command]
pub async fn add_space(b: B<'_>, name: String, icon: String, color: String) -> R<Id> {
    Ok(b.with_ws(|w| {
        let id = w.add_space(&name, &icon, &color);
        w.active_space = id.clone();
        id
    }))
}

#[tauri::command]
pub async fn rename_space(b: B<'_>, id: Id, name: String) -> R {
    b.with_ws(|w| {
        if let Some(s) = w.spaces.iter_mut().find(|s| s.id == id) {
            s.name = name;
        }
    });
    Ok(())
}

#[tauri::command]
pub async fn update_space(b: B<'_>, id: Id, icon: Option<String>, color: Option<String>) -> R {
    b.with_ws(|w| {
        if let Some(s) = w.spaces.iter_mut().find(|s| s.id == id) {
            if let Some(i) = icon {
                s.icon = i;
            }
            if let Some(c) = color {
                s.color = c;
            }
        }
    });
    Ok(())
}

#[tauri::command]
pub async fn remove_space(b: B<'_>, id: Id) -> R {
    b.with_ws(|w| w.remove_space(&id, None));
    Ok(())
}

#[tauri::command]
pub async fn switch_space(b: B<'_>, id: Id) -> R {
    let exists = b.with_ws(|w| w.space(&id).is_some());
    if !exists {
        return Ok(());
    }
    // prefer the most recently used tab of that space; an empty space gets a fresh new-tab page
    let target = b.with_ws(|w| {
        w.active_space = id.clone();
        w.visible_tabs(&id)
            .iter()
            .max_by_key(|t| t.last_active)
            .map(|t| t.id.clone())
    });
    match target {
        Some(t) => b.activate_tab(&t),
        None => {
            b.open_tab(OpenArgs {
                space: Some(id),
                ..Default::default()
            });
        }
    }
    Ok(())
}

// ---------- filing / archive ----------

#[tauri::command]
pub async fn auto_file_all(b: B<'_>) -> R {
    b.auto_file_all();
    Ok(())
}

#[tauri::command]
pub async fn set_filing_rules(b: B<'_>, rules: Vec<Rule>) -> R {
    b.set_filing_rules(rules);
    Ok(())
}

#[tauri::command]
pub async fn archive_inactive_now(b: B<'_>) -> R {
    b.archive_inactive(true);
    Ok(())
}

// ---------- split view ----------

#[tauri::command]
pub async fn split_with(b: B<'_>, tab: Id, dir: Dir, new_first: Option<bool>) -> R<bool> {
    Ok(b.split_with(&tab, dir, new_first.unwrap_or(false)))
}

#[tauri::command]
pub async fn unsplit(b: B<'_>) -> R {
    b.with_ws(|w| w.unsplit());
    Ok(())
}

#[tauri::command]
pub async fn set_split_ratio(b: B<'_>, path: Vec<bool>, ratio: f64) -> R {
    b.with_ws(|w| {
        if let Some(s) = &mut w.split {
            s.root.set_ratio(&path, ratio);
        }
    });
    Ok(())
}

#[tauri::command]
pub async fn focus_pane(b: B<'_>, tab: Id) -> R {
    b.activate_tab(&tab);
    Ok(())
}

#[tauri::command]
pub async fn get_split_rects(b: B<'_>) -> R<Option<SplitRects>> {
    Ok(b.split_rects())
}

// ---------- layout ----------

#[tauri::command]
pub async fn set_content_bounds(b: B<'_>, x: f64, y: f64, w: f64, h: f64) -> R {
    b.set_content_bounds(Rect::new(x, y, w.max(1.0), h.max(1.0)));
    Ok(())
}

#[tauri::command]
pub async fn set_overlay_open(b: B<'_>, open: bool) -> R {
    b.set_overlay_open(open);
    Ok(())
}

#[tauri::command]
pub async fn set_viewport_emulation(b: B<'_>, tab: Id, preset: Option<String>) -> R {
    b.set_viewport_emulation(&tab, preset.as_deref());
    Ok(())
}

// ---------- omnibox / dev ----------

#[tauri::command]
pub async fn omnibox_suggest(b: B<'_>, query: String) -> R<Vec<Suggestion>> {
    Ok(b.suggest(&query))
}

#[tauri::command]
pub async fn open_devtools(b: B<'_>, tab: Id) -> R {
    b.open_devtools(&tab);
    Ok(())
}

#[tauri::command]
pub async fn run_dev_tool(tool: Tool, input: String) -> R<String> {
    Browser::run_dev_tool(tool, &input)
}

#[tauri::command]
pub async fn list_dev_servers() -> R<Vec<DevServer>> {
    Ok(devservers::scan().await)
}

// ---------- boards ----------

#[tauri::command]
pub async fn list_boards(b: B<'_>) -> R<Vec<BoardSummary>> {
    Ok(boards::list(&b.paths))
}

#[tauri::command]
pub async fn get_board(b: B<'_>, id: Id) -> R<Board> {
    boards::get(&b.paths, &id)
}

#[tauri::command]
pub async fn create_board(b: B<'_>, name: String) -> R<Board> {
    boards::create(&b.paths, &name)
}

#[tauri::command]
pub async fn save_board(b: B<'_>, app: AppHandle, board: Board) -> R {
    boards::save(&b.paths, &board)?;
    let _ = app.emit(
        "athanor://board-changed",
        serde_json::json!({ "id": board.id }),
    );
    Ok(())
}

#[tauri::command]
pub async fn delete_board(b: B<'_>, id: Id) -> R {
    boards::delete(&b.paths, &id)
}

#[tauri::command]
pub async fn board_put_asset(b: B<'_>, data_base64: String, mime: String) -> R<String> {
    boards::put_asset(&b.paths, &data_base64, &mime)
}

#[tauri::command]
pub async fn board_add_from_url(
    b: B<'_>,
    app: AppHandle,
    id: Id,
    url: String,
    cx: f64,
    cy: f64,
) -> R {
    let paths = b.paths.clone();
    let id2 = id.clone();
    tauri::async_runtime::spawn_blocking(move || boards::add_from_url(&paths, &id2, &url, cx, cy))
        .await
        .map_err(e)??;
    let _ = app.emit("athanor://board-changed", serde_json::json!({ "id": id }));
    Ok(())
}

#[tauri::command]
pub async fn open_board_window(app: AppHandle, id: Id) -> R {
    use tauri::{WebviewUrl, WebviewWindowBuilder};
    let label = format!("board-{id}");
    if let Some(w) = app.get_webview_window(&label) {
        let _ = w.set_focus();
        return Ok(());
    }
    let script = format!("if(!location.hash)history.replaceState(null,'','#/board/{id}')");
    WebviewWindowBuilder::new(&app, label, WebviewUrl::App("index.html".into()))
        .title("Athanor Board")
        .inner_size(900.0, 640.0)
        .initialization_script(script)
        .build()
        .map_err(e)?;
    Ok(())
}

#[tauri::command]
pub async fn set_board_always_on_top(app: AppHandle, id: Id, on: bool) -> R {
    #[cfg(desktop)]
    if let Some(w) = app.get_webview_window(&format!("board-{id}")) {
        w.set_always_on_top(on).map_err(e)?;
    }
    #[cfg(mobile)]
    let _ = (&app, &id, on);
    Ok(())
}

#[tauri::command]
pub async fn send_page_image_to_board(b: B<'_>, tab: Id, board_id: Id) -> R {
    let browser = b.inner().clone();
    tauri::async_runtime::spawn_blocking(move || browser.capture_to_board(&tab, &board_id))
        .await
        .map_err(e)?
}

#[tauri::command]
pub async fn capture_frame(b: B<'_>, tab: Id) -> R<String> {
    let browser = b.inner().clone();
    tauri::async_runtime::spawn_blocking(move || browser.capture_frame(&tab))
        .await
        .map_err(e)?
}

#[tauri::command]
pub async fn resolve_context_menu(b: B<'_>, tab: Id, command: Option<i32>) -> R {
    b.resolve_context_menu(&tab, command);
    Ok(())
}

#[tauri::command]
pub async fn context_action(b: B<'_>, action: String, data: String) -> R {
    b.context_action(&action, &data);
    Ok(())
}

// ---------- adblock ----------

#[tauri::command]
pub async fn get_adblock_status(b: B<'_>) -> R<crate::filter::AdblockStatus> {
    Ok(b.filter.status())
}

#[tauri::command]
pub async fn set_adblock_enabled(b: B<'_>, enabled: bool) -> R {
    b.set_settings(SettingsPatch {
        adblock_enabled: Some(enabled),
        ..Default::default()
    });
    b.filter.set_enabled(enabled);
    b.emit_adblock();
    Ok(())
}

#[tauri::command]
pub async fn set_adblock_list_enabled(b: B<'_>, id: String, enabled: bool) -> R {
    b.filter.set_list_enabled(&id, enabled);
    let browser = b.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        browser.filter.rebuild();
        browser.emit_adblock();
    });
    b.emit_adblock();
    Ok(())
}

#[tauri::command]
pub async fn update_adblock_lists(b: B<'_>) -> R {
    let browser = b.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        browser.filter.update_blocking();
        browser.emit_adblock();
    });
    b.emit_adblock();
    Ok(())
}

#[tauri::command]
pub async fn get_site_shield(b: B<'_>, host: String) -> R<bool> {
    Ok(!b.filter.site_disabled(&host))
}

#[tauri::command]
pub async fn set_site_shield(b: B<'_>, host: String, enabled: bool) -> R {
    b.filter.set_site_disabled(&host, !enabled);
    b.emit_adblock();
    Ok(())
}

// ---------- settings / extensions ----------

#[tauri::command]
pub async fn get_settings(b: B<'_>) -> R<Settings> {
    Ok(b.settings())
}

#[tauri::command]
pub async fn set_settings(b: B<'_>, patch: SettingsPatch) -> R {
    b.set_settings(patch);
    Ok(())
}

#[tauri::command]
pub async fn list_extensions(host: State<'_, Arc<ExtHost>>) -> R<Vec<ExtensionInfo>> {
    Ok(host.extensions())
}

/// Extension filter lists changed: recompile the engine off the UI path and tell the shell.
fn reapply_shield(b: &B<'_>, host: &State<'_, Arc<ExtHost>>, shield: &State<'_, Arc<Shield>>) {
    let (browser, host, shield) = (
        b.inner().clone(),
        host.inner().clone(),
        shield.inner().clone(),
    );
    tauri::async_runtime::spawn_blocking(move || {
        host.refresh_remote_filter_lists();
        shield.apply(&browser.filter, &host);
        browser.emit_adblock();
    });
}

fn refresh_shell_css(app: &AppHandle, b: &Browser, host: &ExtHost) {
    let _ = app.emit("athanor://shell-css", host.shell_css(&b.settings().theme));
}

#[tauri::command]
pub async fn get_user_filters(shield: State<'_, Arc<Shield>>) -> R<String> {
    Ok(shield.user_filters())
}

/// Save "My filters" and recompile; returns the lines the engine cannot parse.
#[tauri::command]
pub async fn set_user_filters(
    b: B<'_>,
    shield: State<'_, Arc<Shield>>,
    host: State<'_, Arc<ExtHost>>,
    text: String,
) -> R<Vec<LineIssue>> {
    let issues = shield.set_user_filters(text)?;
    let (browser, shield, host) = (
        b.inner().clone(),
        shield.inner().clone(),
        host.inner().clone(),
    );
    tauri::async_runtime::spawn_blocking(move || {
        shield.apply(&browser.filter, &host);
        browser.emit_adblock();
    });
    Ok(issues)
}

#[tauri::command]
pub async fn set_extension_enabled(
    b: B<'_>,
    app: AppHandle,
    host: State<'_, Arc<ExtHost>>,
    shield: State<'_, Arc<Shield>>,
    id: String,
    enabled: bool,
) -> R {
    host.set_enabled(&id, enabled);
    reapply_shield(&b, &host, &shield);
    refresh_shell_css(&app, &b, &host);
    Ok(())
}

#[tauri::command]
pub async fn install_extension(
    b: B<'_>,
    app: AppHandle,
    host: State<'_, Arc<ExtHost>>,
    shield: State<'_, Arc<Shield>>,
    path: String,
) -> R {
    host.install(std::path::Path::new(&path))?;
    reapply_shield(&b, &host, &shield);
    refresh_shell_css(&app, &b, &host);
    Ok(())
}

#[tauri::command]
pub async fn remove_extension(
    b: B<'_>,
    app: AppHandle,
    host: State<'_, Arc<ExtHost>>,
    shield: State<'_, Arc<Shield>>,
    id: String,
) -> R {
    host.remove(&id)?;
    reapply_shield(&b, &host, &shield);
    refresh_shell_css(&app, &b, &host);
    Ok(())
}

#[tauri::command]
pub async fn pick_directory(app: AppHandle) -> R<Option<String>> {
    #[cfg(desktop)]
    {
        use tauri_plugin_dialog::DialogExt;
        let (tx, rx) = tokio::sync::oneshot::channel();
        app.dialog().file().pick_folder(move |p| {
            let _ = tx.send(p.map(|p| p.to_string()));
        });
        rx.await.map_err(e)
    }
    // Android has no folder picker; extensions are installed from the desktop app.
    #[cfg(mobile)]
    {
        let _ = app;
        Ok(None)
    }
}

// ---------- window (desktop) ----------

// Window chrome only exists on desktop; on Android these are harmless no-ops so the shell can call them blindly.
#[cfg(desktop)]
fn main_window(app: &AppHandle) -> R<tauri::Window> {
    app.get_window("main")
        .ok_or_else(|| "no main window".to_string())
}

#[tauri::command]
pub async fn window_minimize(app: AppHandle) -> R {
    #[cfg(desktop)]
    return main_window(&app)?.minimize().map_err(e);
    #[cfg(mobile)]
    {
        let _ = app;
        Ok(())
    }
}

#[tauri::command]
pub async fn window_toggle_maximize(app: AppHandle) -> R {
    #[cfg(desktop)]
    {
        let w = main_window(&app)?;
        if w.is_maximized().map_err(e)? {
            w.unmaximize()
        } else {
            w.maximize()
        }
        .map_err(e)
    }
    #[cfg(mobile)]
    {
        let _ = app;
        Ok(())
    }
}

#[tauri::command]
pub async fn window_close(app: AppHandle) -> R {
    #[cfg(desktop)]
    return main_window(&app)?.close().map_err(e);
    #[cfg(mobile)]
    {
        let _ = app;
        Ok(())
    }
}

#[tauri::command]
pub async fn window_start_drag(app: AppHandle) -> R {
    #[cfg(desktop)]
    return main_window(&app)?.start_dragging().map_err(e);
    #[cfg(mobile)]
    {
        let _ = app;
        Ok(())
    }
}

#[tauri::command]
pub async fn window_is_maximized(app: AppHandle) -> R<bool> {
    #[cfg(desktop)]
    return main_window(&app)?.is_maximized().map_err(e);
    #[cfg(mobile)]
    {
        let _ = app;
        Ok(false)
    }
}
