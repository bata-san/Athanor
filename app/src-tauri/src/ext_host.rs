//! Extension host: bridges the `athanor-ext` registry to the shell (themes, panels, commands, RPC)
//! and to pages (userscript injection). All policy lives in `athanor-ext`; this file only wires it up.

use crate::browser::{Browser, OpenArgs, Paths};
use athanor_core::store;
use athanor_ext::{Permission, Registry, RegistryState, RunAt, Source};
use parking_lot::RwLock;
use serde::Serialize;
use serde_json::{json, Value};
use std::{collections::BTreeMap, fs, sync::Arc};
use tauri::Emitter;

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ThemeInfo {
    pub id: String,
    pub name: String,
    pub dark: bool,
    pub source: &'static str,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ExtensionInfo {
    pub id: String,
    pub name: String,
    pub version: String,
    pub description: String,
    pub enabled: bool,
    pub source: &'static str,
    pub permissions: Vec<String>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PanelInfo {
    pub ext: String,
    pub id: String,
    pub title: String,
    pub icon: String,
    pub url: String,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct CommandInfo {
    pub ext: String,
    pub id: String,
    pub title: String,
    pub keybinding: Option<String>,
}

pub struct ExtHost {
    registry: RwLock<Registry>,
    paths: Paths,
}

fn perm_name(p: Permission) -> String {
    serde_json::to_value(p)
        .ok()
        .and_then(|v| v.as_str().map(str::to_string))
        .unwrap_or_default()
}

/// Base URL of the extension file protocol as seen from web content on this platform.
fn ext_base() -> &'static str {
    if cfg!(any(windows, target_os = "android")) {
        "http://athanor-ext.localhost"
    } else {
        "athanor-ext://localhost"
    }
}

impl ExtHost {
    pub fn new(paths: Paths) -> Arc<Self> {
        let mut registry = Registry::new();
        if let Ok(state) =
            store::load_or_default::<RegistryState>(&paths.file("extensions-state.json"))
        {
            registry.restore_state(state);
        }
        let dir = paths.extensions();
        let _ = std::fs::create_dir_all(&dir);
        for issue in registry.load_dir(&dir, Source::User) {
            log::warn!("extension {}: {}", issue.path.display(), issue.message);
        }
        Arc::new(Self {
            registry: RwLock::new(registry),
            paths,
        })
    }

    fn persist(&self) {
        let state = self.registry.read().state();
        let _ = store::save_atomic(&self.paths.file("extensions-state.json"), &state);
    }

    pub fn themes(&self) -> Vec<ThemeInfo> {
        self.registry
            .read()
            .themes()
            .into_iter()
            .map(|t| ThemeInfo {
                id: t.id,
                name: t.name,
                dark: t.dark,
                source: if t.ext_id.is_some() {
                    "extension"
                } else {
                    "builtin"
                },
            })
            .collect()
    }

    /// CSS for the shell: the theme's variables, then every enabled extension's shell CSS.
    pub fn shell_css(&self, theme: &str) -> String {
        let reg = self.registry.read();
        let base = reg
            .theme(theme)
            .or_else(|| reg.theme("monolith"))
            .map(|t| t.to_css())
            .unwrap_or_default();
        format!("{base}\n{}", reg.shell_css())
    }

    pub fn panels(&self) -> Vec<PanelInfo> {
        let base = ext_base();
        self.registry
            .read()
            .panels()
            .into_iter()
            .map(|p| PanelInfo {
                url: format!("{base}/{}/{}", p.ext_id, p.panel.entry),
                ext: p.ext_id,
                id: p.panel.id,
                title: p.panel.title,
                icon: p.panel.icon,
            })
            .collect()
    }

    pub fn commands(&self) -> Vec<CommandInfo> {
        self.registry
            .read()
            .commands()
            .into_iter()
            .map(|c| CommandInfo {
                ext: c.ext_id,
                id: c.command.id,
                title: c.command.title,
                keybinding: c.command.keybinding,
            })
            .collect()
    }

    /// Filter lists contributed by enabled extensions as `(engine list id, text)`. Local files are read
    /// directly; remote ones come from the on-disk cache filled by [`ExtHost::refresh_remote_filter_lists`].
    pub fn filter_list_texts(&self) -> Vec<(String, String)> {
        const MAX: u64 = 8 * 1024 * 1024;
        let clean = |s: &str| -> String {
            s.chars()
                .map(|c| {
                    if c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.') {
                        c
                    } else {
                        '-'
                    }
                })
                .collect()
        };
        let mut out = Vec::new();
        for c in self.registry.read().filter_lists() {
            let id = format!("ext-{}-{}", clean(&c.ext_id), clean(&c.list.id));
            let path = match (&c.local_file, &c.list.url) {
                (Some(p), _) => p.clone(),
                (None, Some(_)) => self.paths.file("ext-filters").join(format!("{id}.txt")),
                (None, None) => continue,
            };
            if fs::metadata(&path).map_or(true, |m| m.len() > MAX) {
                continue;
            }
            if let Ok(text) = fs::read_to_string(&path) {
                out.push((id, text));
            }
        }
        out
    }

    /// Download remote filter lists contributed by extensions (https only, size and time limited) into the
    /// cache. Returns true if anything changed.
    pub fn refresh_remote_filter_lists(&self) -> bool {
        const MAX: u64 = 8 * 1024 * 1024;
        let dir = self.paths.file("ext-filters");
        let _ = fs::create_dir_all(&dir);
        let mut changed = false;
        for c in self.registry.read().filter_lists() {
            let (None, Some(url)) = (&c.local_file, &c.list.url) else {
                continue;
            };
            if !url.starts_with("https://") {
                continue;
            }
            let id: String = format!("ext-{}-{}", c.ext_id, c.list.id)
                .chars()
                .map(|ch| {
                    if ch.is_ascii_alphanumeric() || matches!(ch, '-' | '_' | '.') {
                        ch
                    } else {
                        '-'
                    }
                })
                .collect();
            let agent = ureq::AgentBuilder::new()
                .timeout(std::time::Duration::from_secs(20))
                .build();
            let Ok(resp) = agent.get(url).call() else {
                continue;
            };
            let mut body = String::new();
            if std::io::Read::read_to_string(
                &mut std::io::Read::take(resp.into_reader(), MAX + 1),
                &mut body,
            )
            .is_err()
                || body.len() as u64 > MAX
            {
                continue;
            }
            let path = dir.join(format!("{id}.txt"));
            if fs::read_to_string(&path).ok().as_deref() != Some(body.as_str())
                && fs::write(&path, body).is_ok()
            {
                changed = true;
            }
        }
        changed
    }

    pub fn extensions(&self) -> Vec<ExtensionInfo> {
        self.registry
            .read()
            .list()
            .into_iter()
            .map(|e| ExtensionInfo {
                id: e.id,
                name: e.name,
                version: e.version,
                description: e.description,
                enabled: e.enabled,
                source: if e.source == Source::Builtin {
                    "builtin"
                } else {
                    "user"
                },
                permissions: e.permissions.into_iter().map(perm_name).collect(),
            })
            .collect()
    }

    pub fn set_enabled(&self, id: &str, on: bool) {
        self.registry.write().set_enabled(id, on);
        self.persist();
    }

    pub fn install(&self, src: &std::path::Path) -> Result<String, String> {
        let id = self
            .registry
            .write()
            .install_from_dir(src, &self.paths.extensions())
            .map_err(|e| e.to_string())?;
        self.persist();
        Ok(id)
    }

    pub fn remove(&self, id: &str) -> Result<(), String> {
        self.registry
            .write()
            .remove(id, &self.paths.extensions())
            .map_err(|e| e.to_string())?;
        self.persist();
        Ok(())
    }

    /// Scripts + styles to run in a page for the given phase (0 = start, 1 = end, 2 = idle).
    pub fn page_scripts(&self, url: &str, phase: u8) -> Vec<String> {
        let Ok(parsed) = url::Url::parse(url) else {
            return vec![];
        };
        let run_at = match phase {
            0 => RunAt::DocumentStart,
            1 => RunAt::DocumentEnd,
            _ => RunAt::DocumentIdle,
        };
        self.registry
            .read()
            .user_scripts_for(&parsed, run_at, true)
            .into_iter()
            .map(|s| s.to_eval_js())
            .collect()
    }

    /// Serve a file for the `athanor-ext` protocol. Returns `(bytes, mime, csp)`.
    pub fn serve(&self, path: &str) -> Result<(Vec<u8>, String, &'static str), String> {
        let path = path.trim_start_matches('/');
        let (ext, rel) = path.split_once('/').ok_or("bad path")?;
        let reg = self.registry.read();
        let (bytes, mime) = reg.resolve_asset(ext, rel).map_err(|e| e.to_string())?;
        let perms: Vec<Permission> = reg
            .list()
            .into_iter()
            .find(|e| e.id == ext)
            .map(|e| e.permissions)
            .unwrap_or_default();
        Ok((bytes, mime, athanor_ext::panel_csp_for(&perms)))
    }

    fn check(&self, ext: &str, perm: Permission) -> Result<(), String> {
        self.registry
            .read()
            .check(ext, perm)
            .map_err(|e| e.to_string())
    }

    fn storage_path(&self, ext: &str) -> Result<std::path::PathBuf, String> {
        if !ext
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | '_'))
            || ext.contains("..")
        {
            return Err("bad extension id".into());
        }
        Ok(self.paths.file("ext-storage").join(format!("{ext}.json")))
    }

    /// Permission-gated RPC used by panel iframes (see docs/EXTENSIONS.md).
    pub fn rpc(
        &self,
        browser: &Arc<Browser>,
        ext: &str,
        method: &str,
        params: Value,
    ) -> Result<Value, String> {
        match method {
            "tabs.list" => {
                self.check(ext, Permission::TabsRead)?;
                let snap = browser.snapshot();
                Ok(json!(snap
                    .workspace
                    .tabs
                    .iter()
                    .filter(|t| !t.archived)
                    .map(|t| json!({ "id": t.id, "url": t.url, "title": t.title, "pinned": t.pinned, "active": snap.workspace.active_tab.as_deref() == Some(&t.id) }))
                    .collect::<Vec<_>>()))
            }
            "tabs.open" => {
                self.check(ext, Permission::TabsWrite)?;
                let url = params
                    .get("url")
                    .and_then(Value::as_str)
                    .ok_or("url required")?;
                let id = browser.open_tab(OpenArgs {
                    url: Some(url.to_string()),
                    ..Default::default()
                });
                Ok(json!({ "id": id }))
            }
            "storage.get" | "storage.set" => {
                self.check(ext, Permission::Storage)?;
                let path = self.storage_path(ext)?;
                // Only a missing file means "empty"; a corrupt one must not be silently overwritten.
                let mut map: BTreeMap<String, Value> = store::load_or_default(&path)
                    .map_err(|e| format!("extension storage unreadable: {e}"))?;
                let key = params
                    .get("key")
                    .and_then(Value::as_str)
                    .ok_or("key required")?
                    .to_string();
                if method == "storage.get" {
                    return Ok(map.get(&key).cloned().unwrap_or(Value::Null));
                }
                let value = params.get("value").cloned().unwrap_or(Value::Null);
                if map.len() >= 512 && !map.contains_key(&key) {
                    return Err("storage full".into());
                }
                map.insert(key, value);
                if serde_json::to_vec(&map).map_or(true, |b| b.len() > 1024 * 1024) {
                    return Err("storage quota exceeded (1 MiB)".into());
                }
                store::save_atomic(&path, &map).map_err(|e| e.to_string())?;
                Ok(Value::Null)
            }
            "ui.toast" => {
                self.check(ext, Permission::ShellPanel)?;
                let msg = params
                    .get("message")
                    .and_then(Value::as_str)
                    .ok_or("message required")?;
                let level = params
                    .get("level")
                    .and_then(Value::as_str)
                    .unwrap_or("info");
                browser.toast(
                    if matches!(level, "success" | "error") {
                        level
                    } else {
                        "info"
                    },
                    msg.chars().take(300).collect::<String>(),
                );
                Ok(Value::Null)
            }
            "commands.register" => {
                self.check(ext, Permission::Commands)?;
                Ok(Value::Null)
            }
            other => Err(format!("unknown method {other}")),
        }
    }

    pub fn run_command(&self, browser: &Arc<Browser>, ext: &str, id: &str) -> Result<(), String> {
        self.check(ext, Permission::Commands)?;
        let known = self
            .registry
            .read()
            .commands()
            .into_iter()
            .any(|c| c.ext_id == ext && c.command.id == id);
        if !known {
            return Err("unknown command".into());
        }
        let _ = browser.app().emit(
            "athanor://extension-event",
            json!({ "ext": ext, "type": "command", "data": { "id": id } }),
        );
        Ok(())
    }
}
