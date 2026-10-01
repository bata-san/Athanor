//! Athanor application shell (Tauri). Desktop and Android entry point.

mod boards;
#[cfg(windows)]
mod brand;
mod browser;
mod commands;
mod devservers;
#[cfg(desktop)]
mod engine_desktop;
#[cfg(target_os = "android")]
mod engine_mobile;
#[cfg(windows)]
mod errorpage;
mod ext_host;
mod filter;
#[cfg(windows)]
mod import;
#[cfg(target_os = "android")]
mod jni_bridge;
mod pagetools;
#[cfg(desktop)]
#[path = "platform_desktop.rs"]
mod platform;
#[cfg(mobile)]
#[path = "platform_mobile.rs"]
mod platform;
mod shield;
mod state;
#[cfg(desktop)]
mod updater;
#[cfg(windows)]
mod webfont;
#[cfg(windows)]
mod win;
#[cfg(windows)]
mod win_ui;

use browser::{Browser, Paths};
use ext_host::ExtHost;
use filter::Filter;
use std::sync::Arc;
use tauri::{http::Response, Emitter, Manager, RunEvent};

fn asset_response(app: &tauri::AppHandle, hash: &str) -> Response<Vec<u8>> {
    let not_found = || {
        Response::builder()
            .status(404)
            .body(Vec::new())
            .expect("static response")
    };
    let Some(browser) = app.try_state::<Arc<Browser>>() else {
        return not_found();
    };
    match boards::assets(&browser.paths).get(hash) {
        Ok((bytes, mime)) => Response::builder()
            .header("Content-Type", mime)
            .header("Access-Control-Allow-Origin", "*")
            .header("Cache-Control", "max-age=31536000, immutable")
            .header("X-Content-Type-Options", "nosniff")
            .header(
                "Content-Security-Policy",
                "default-src 'none'; style-src 'unsafe-inline'; sandbox",
            )
            .body(bytes)
            .unwrap_or_else(|_| not_found()),
        Err(_) => not_found(),
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default();
    #[cfg(target_os = "android")]
    let builder = builder.plugin(engine_mobile::plugin());
    #[cfg(desktop)]
    let builder = builder
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(updater::Pending::default());
    let app = builder
        .register_uri_scheme_protocol("athanor-ext", |ctx, req| {
            let not_found = || {
                Response::builder()
                    .status(404)
                    .body(Vec::new())
                    .expect("static response")
            };
            let Some(host) = ctx.app_handle().try_state::<Arc<ExtHost>>() else {
                return not_found();
            };
            match host.serve(req.uri().path()) {
                Ok((bytes, mime, csp)) => Response::builder()
                    .header("Content-Type", mime)
                    .header("Content-Security-Policy", csp)
                    .header("X-Content-Type-Options", "nosniff")
                    .header("Cache-Control", "no-store")
                    .body(bytes)
                    .unwrap_or_else(|_| not_found()),
                Err(_) => not_found(),
            }
        })
        .register_uri_scheme_protocol("athanor-asset", |ctx, req| {
            asset_response(ctx.app_handle(), req.uri().path().trim_start_matches('/'))
        })
        .setup(|app| {
            // ATHANOR_DATA_DIR points the session/settings/history files elsewhere (used by end-to-end tests).
            let data = match std::env::var_os("ATHANOR_DATA_DIR") {
                Some(dir) if !dir.is_empty() => std::path::PathBuf::from(dir),
                _ => app.path().app_data_dir()?,
            };
            std::fs::create_dir_all(&data)?;
            let paths = Paths { root: data };
            // Default web font: must be in place before the first WebView2 starts.
            #[cfg(windows)]
            webfont::prepare(
                &app.path().app_local_data_dir()?,
                webfont::enabled_in(&paths.file("settings.json")),
            );
            let filter = Arc::new(Filter::new(paths.adblock()));
            let ext_host = ExtHost::new(paths.clone());
            {
                let host = ext_host.clone();
                filter.set_injector(Arc::new(move |url, phase| host.page_scripts(url, phase)));
            }
            app.manage(ext_host);

            let paths_for_shield = paths.clone();
            let browser = platform::init(app, filter.clone(), paths)?;
            {
                let shield = shield::Shield::new(paths_for_shield);
                app.manage(shield.clone());
                let b = browser.clone();
                let filter_for_apply = filter.clone();
                let host = app.state::<Arc<ExtHost>>().inner().clone();
                let first = std::sync::Once::new();
                filter.start(
                    browser.settings().adblock_enabled,
                    Arc::new(move || {
                        // After the first rules load, add extension lists and the user's own filters.
                        first.call_once(|| {
                            let (s, f, h) =
                                (shield.clone(), filter_for_apply.clone(), host.clone());
                            std::thread::spawn(move || {
                                s.apply(&f, &h);
                                if h.refresh_remote_filter_lists() {
                                    s.apply(&f, &h);
                                }
                            });
                        });
                        b.emit_adblock();
                    }),
                );
            }
            {
                let host = app.state::<Arc<ExtHost>>().inner().clone();
                let handle = app.handle().clone();
                browser.set_theme_hook(move |theme| {
                    let _ = handle.emit("athanor://shell-css", host.shell_css(theme));
                });
            }
            app.manage(browser);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_snapshot,
            commands::get_shell_css,
            commands::list_themes,
            commands::set_theme,
            commands::set_space_theme,
            commands::get_panels,
            commands::get_commands,
            commands::run_extension_command,
            commands::extension_rpc,
            commands::open_tab,
            commands::navigate,
            commands::activate_tab,
            commands::close_tab,
            commands::duplicate_tab,
            commands::reload,
            commands::zoom_page,
            commands::find_in_page,
            commands::hard_reload,
            commands::print_page,
            commands::set_software_rendering,
            commands::reopen_closed,
            commands::resolve_script_dialog,
            commands::resolve_permission,
            commands::reset_site_permissions,
            commands::reveal_download,
            commands::focus_shell,
            commands::focus_page,
            commands::run_shortcut,
            commands::toggle_fullscreen,
            commands::stop,
            commands::go_back,
            commands::go_forward,
            commands::set_pinned,
            commands::set_muted,
            commands::move_tab,
            commands::close_other_tabs,
            commands::close_tabs_below,
            commands::restore_tab,
            commands::copy_url,
            commands::create_folder,
            commands::rename_folder,
            commands::toggle_folder,
            commands::delete_folder,
            commands::set_folder_color,
            commands::add_space,
            commands::rename_space,
            commands::update_space,
            commands::remove_space,
            commands::switch_space,
            commands::auto_file_all,
            commands::set_filing_rules,
            commands::archive_inactive_now,
            commands::split_with,
            commands::unsplit,
            commands::set_split_ratio,
            commands::focus_pane,
            commands::get_split_rects,
            commands::set_content_bounds,
            commands::set_overlay_open,
            commands::capture_frame,
            commands::import_detect,
            commands::import_run,
            commands::import_pick_file,
            commands::set_page_radius,
            commands::resolve_context_menu,
            commands::context_action,
            commands::set_viewport_emulation,
            commands::omnibox_suggest,
            commands::open_devtools,
            commands::run_dev_tool,
            commands::list_dev_servers,
            commands::list_boards,
            commands::get_board,
            commands::create_board,
            commands::save_board,
            commands::delete_board,
            commands::board_put_asset,
            commands::board_add_from_url,
            commands::open_board_window,
            commands::set_board_always_on_top,
            commands::send_page_image_to_board,
            commands::get_user_filters,
            commands::set_user_filters,
            commands::get_adblock_status,
            commands::set_adblock_enabled,
            commands::set_adblock_list_enabled,
            commands::update_adblock_lists,
            commands::get_site_shield,
            commands::set_site_shield,
            commands::get_settings,
            commands::set_settings,
            commands::list_extensions,
            commands::set_extension_enabled,
            commands::install_extension,
            commands::remove_extension,
            commands::pick_directory,
            commands::window_minimize,
            commands::window_toggle_maximize,
            commands::window_close,
            commands::window_start_drag,
            commands::window_is_maximized,
            #[cfg(desktop)]
            updater::check_update,
            #[cfg(desktop)]
            updater::download_update,
            #[cfg(desktop)]
            updater::install_update,
        ])
        .build(tauri::generate_context!())
        .expect("error while building Athanor");

    app.run(|handle, event| match event {
        RunEvent::ExitRequested { .. } => {
            if let Some(b) = handle.try_state::<Arc<Browser>>() {
                b.save();
            }
        }
        #[cfg(windows)]
        RunEvent::Exit => webfont::release(),
        _ => {}
    });
}
