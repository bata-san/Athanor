//! Loaded extensions and host-facing contribution queries.

use crate::{
    builtin_themes, safe_path, Command, ExtensionId, FilterList, Manifest, MatchPattern, Panel,
    Permission, RunAt, Theme, HOST_VERSION,
};
use athanor_core::filing::Rule;
use serde::{Deserialize, Serialize};
use std::{
    collections::{BTreeMap, HashMap},
    fs,
    path::{Path, PathBuf},
    sync::RwLock,
};
use url::Url;

/// Where an extension was installed from.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub enum Source {
    Builtin,
    User,
}
/// A validated extension directory.
#[derive(Clone, Debug)]
pub struct Extension {
    pub manifest: Manifest,
    pub root: PathBuf,
    pub source: Source,
}
/// A warning or failure while scanning an extension directory.
#[derive(Clone, Debug)]
pub struct LoadIssue {
    pub path: PathBuf,
    pub message: String,
}
/// Extension operation failure.
#[derive(Debug, thiserror::Error)]
pub enum ExtensionError {
    /// An extension, path, or install request is invalid.
    #[error("{0}")]
    Invalid(String),
    /// Filesystem operation failed.
    #[error(transparent)]
    Io(#[from] std::io::Error),
}
/// Result for extension operations.
pub type Result<T> = std::result::Result<T, ExtensionError>;
/// Permission check failure.
#[derive(Clone, Debug, thiserror::Error)]
#[error("extension {id} lacks permission {permission:?}")]
pub struct PermissionDenied {
    pub id: String,
    pub permission: Permission,
}
/// Persistable enabled flags. Unknown IDs are retained for later scans.
#[derive(Clone, Debug, Default, Serialize, Deserialize, PartialEq, Eq)]
pub struct RegistryState {
    pub enabled: BTreeMap<String, bool>,
}
/// Summary counts for an extension.
#[derive(Clone, Debug, Default)]
pub struct ContributionCounts {
    pub themes: usize,
    pub shell_css: usize,
    pub user_scripts: usize,
    pub panels: usize,
    pub commands: usize,
    pub filter_lists: usize,
    pub tab_rules: usize,
}
/// Summary for settings UI.
#[derive(Clone, Debug)]
pub struct ExtensionInfo {
    pub id: String,
    pub name: String,
    pub version: String,
    pub description: String,
    pub enabled: bool,
    pub source: Source,
    pub permissions: Vec<Permission>,
    pub counts: ContributionCounts,
}
/// Materialized page assets for host injection.
#[derive(Clone, Debug)]
pub struct InjectedScript {
    pub ext_id: String,
    pub script_id: String,
    pub js: String,
    pub css: String,
}
impl InjectedScript {
    /// Return JavaScript that injects CSS and then runs the contributed script.
    pub fn to_eval_js(&self) -> String {
        let css = serde_json::to_string(&self.css).unwrap_or_else(|_| "\"\"".into());
        format!("(()=>{{const s=document.createElement('style');s.textContent={css};(document.head||document.documentElement).appendChild(s);\n{}\n}})();", self.js)
    }
}
/// Panel metadata for the shell.
#[derive(Clone, Debug)]
pub struct PanelInfo {
    pub ext_id: String,
    pub panel: Panel,
}
/// Palette command metadata.
#[derive(Clone, Debug)]
pub struct CommandInfo {
    pub ext_id: String,
    pub command: Command,
}
/// Filter list metadata with a resolved local file or remote URL.
#[derive(Clone, Debug)]
pub struct FilterListContribution {
    pub ext_id: String,
    pub list: FilterList,
    pub local_file: Option<PathBuf>,
}
/// Theme metadata for settings UI.
#[derive(Clone, Debug)]
pub struct ThemeInfo {
    pub id: String,
    pub name: String,
    pub dark: bool,
    pub ext_id: Option<String>,
}

/// Mutable registry. Share behind a caller-owned lock if writes are concurrent; read queries are `&self`.
#[derive(Default)]
pub struct Registry {
    extensions: BTreeMap<String, Extension>,
    state: RegistryState,
    cache: RwLock<HashMap<PathBuf, String>>,
}

impl Registry {
    /// Create an empty registry; built-in themes are always available.
    pub fn new() -> Self {
        Self::default()
    }

    /// Scan direct child directories, skip bad extensions, and report every issue.
    pub fn load_dir(&mut self, dir: &Path, source: Source) -> Vec<LoadIssue> {
        let mut issues = Vec::new();
        let Ok(entries) = fs::read_dir(dir) else {
            return vec![LoadIssue {
                path: dir.into(),
                message: "cannot read extension directory".into(),
            }];
        };
        let mut paths: Vec<_> = entries.filter_map(|e| e.ok().map(|e| e.path())).collect();
        paths.sort();
        for root in paths {
            if !root.is_dir() {
                continue;
            }
            let path = root.join("athanor-extension.json");
            if !path.exists() {
                continue;
            }
            match fs::read_to_string(&path)
                .map_err(|e| e.to_string())
                .and_then(|s| Manifest::parse(&s).map_err(|e| e.to_string()))
            {
                Ok((manifest, warnings)) => {
                    for warning in warnings {
                        issues.push(LoadIssue {
                            path: path.clone(),
                            message: warning,
                        });
                    }
                    if let Err(e) = manifest.validate(&root, HOST_VERSION) {
                        issues.push(LoadIssue {
                            path,
                            message: e.to_string(),
                        });
                        continue;
                    }
                    if self.extensions.contains_key(&manifest.id) {
                        issues.push(LoadIssue {
                            path,
                            message: format!("duplicate extension id: {}", manifest.id),
                        });
                        continue;
                    }
                    self.state
                        .enabled
                        .entry(manifest.id.clone())
                        .or_insert(true);
                    self.extensions.insert(
                        manifest.id.clone(),
                        Extension {
                            manifest,
                            root,
                            source,
                        },
                    );
                }
                Err(message) => issues.push(LoadIssue { path, message }),
            }
        }
        issues
    }

    /// Validate and copy a directory as a user extension (32 MiB, at most 1024 files, no symlinks).
    pub fn install_from_dir(&mut self, src: &Path, install_root: &Path) -> Result<ExtensionId> {
        let raw = fs::read_to_string(src.join("athanor-extension.json"))?;
        let (manifest, _) =
            Manifest::parse(&raw).map_err(|e| ExtensionError::Invalid(e.to_string()))?;
        manifest
            .validate(src, HOST_VERSION)
            .map_err(|e| ExtensionError::Invalid(e.to_string()))?;
        if self.extensions.contains_key(&manifest.id) {
            return Err(ExtensionError::Invalid("duplicate extension id".into()));
        }
        let target = install_root.join(&manifest.id);
        if target.exists() {
            return Err(ExtensionError::Invalid(
                "install target already exists".into(),
            ));
        }
        let mut files = Vec::new();
        let mut bytes = 0_u64;
        collect_files(src, src, &mut files, &mut bytes)?;
        fs::create_dir_all(&target)?;
        let copied = (|| -> Result<()> {
            for (from, rel) in files {
                let to = target.join(rel);
                if let Some(parent) = to.parent() {
                    fs::create_dir_all(parent)?;
                }
                fs::copy(from, to)?;
            }
            Ok(())
        })();
        if let Err(e) = copied {
            let _ = fs::remove_dir_all(&target);
            return Err(e);
        }
        let id = manifest.id.clone();
        self.state.enabled.insert(id.clone(), true);
        self.extensions.insert(
            id.clone(),
            Extension {
                manifest,
                root: target,
                source: Source::User,
            },
        );
        Ok(id)
    }

    /// Remove a user extension installed directly under `install_root`.
    pub fn remove(&mut self, id: &str, install_root: &Path) -> Result<()> {
        let ext = self
            .extensions
            .get(id)
            .ok_or_else(|| ExtensionError::Invalid("unknown extension".into()))?;
        if ext.source != Source::User {
            return Err(ExtensionError::Invalid(
                "cannot remove built-in extension".into(),
            ));
        }
        let expected = install_root.join(id).canonicalize()?;
        if expected != ext.root.canonicalize()? {
            return Err(ExtensionError::Invalid(
                "extension is outside install root".into(),
            ));
        }
        fs::remove_dir_all(expected)?;
        self.extensions.remove(id);
        self.state.enabled.remove(id);
        if let Ok(mut cache) = self.cache.write() {
            cache.clear();
        }
        Ok(())
    }

    /// Enable or disable a loaded extension.
    pub fn set_enabled(&mut self, id: &str, on: bool) {
        if self.extensions.contains_key(id) {
            self.state.enabled.insert(id.into(), on);
        }
    }
    /// Whether a loaded extension is enabled.
    pub fn enabled(&self, id: &str) -> bool {
        self.extensions.contains_key(id) && self.state.enabled.get(id).copied().unwrap_or(true)
    }
    /// Capture persistable enabled state.
    pub fn state(&self) -> RegistryState {
        self.state.clone()
    }
    /// Restore enabled state; unknown IDs are kept for extensions loaded later.
    pub fn restore_state(&mut self, state: RegistryState) {
        self.state = state;
    }
    /// List all loaded extensions, enabled or disabled.
    pub fn list(&self) -> Vec<ExtensionInfo> {
        self.extensions
            .values()
            .map(|e| {
                let c = &e.manifest.contributes;
                ExtensionInfo {
                    id: e.manifest.id.clone(),
                    name: e.manifest.name.clone(),
                    version: e.manifest.version.clone(),
                    description: e.manifest.description.clone(),
                    enabled: self.enabled(&e.manifest.id),
                    source: e.source,
                    permissions: e.manifest.permissions.clone(),
                    counts: ContributionCounts {
                        themes: c.themes.len(),
                        shell_css: c.shell_css.len(),
                        user_scripts: c.user_scripts.len(),
                        panels: c.panels.len(),
                        commands: c.commands.len(),
                        filter_lists: c.filter_lists.len(),
                        tab_rules: c.tab_rules.len(),
                    },
                }
            })
            .collect()
    }
    fn active(&self) -> Vec<&Extension> {
        let mut v: Vec<_> = self
            .extensions
            .values()
            .filter(|e| self.enabled(&e.manifest.id))
            .collect();
        v.sort_by_key(|e| (e.source == Source::User, &e.manifest.id));
        v
    }
    fn read_cached(&self, path: &Path) -> Option<String> {
        if let Ok(cache) = self.cache.read() {
            if let Some(s) = cache.get(path) {
                return Some(s.clone());
            }
        }
        let s = fs::read_to_string(path).ok()?;
        if let Ok(mut cache) = self.cache.write() {
            cache.insert(path.into(), s.clone());
        }
        Some(s)
    }

    /// Read matching script and CSS assets for one injection phase.
    pub fn user_scripts_for(
        &self,
        url: &Url,
        run_at: RunAt,
        is_top_frame: bool,
    ) -> Vec<InjectedScript> {
        let mut out = Vec::new();
        for e in self.active() {
            for script in &e.manifest.contributes.user_scripts {
                if script.run_at != run_at || !is_top_frame && !script.all_frames {
                    continue;
                }
                let matches = script
                    .matches
                    .iter()
                    .any(|p| MatchPattern::parse(p).is_ok_and(|p| p.matches(url)));
                let excluded = script
                    .exclude_matches
                    .iter()
                    .any(|p| MatchPattern::parse(p).is_ok_and(|p| p.matches(url)));
                if !matches || excluded {
                    continue;
                }
                let read = |files: &[String]| -> Option<String> {
                    files
                        .iter()
                        .map(|f| {
                            safe_path(&e.root, f)
                                .ok()
                                .and_then(|p| self.read_cached(&p))
                        })
                        .collect::<Option<Vec<_>>>()
                        .map(|v| v.join("\n"))
                };
                if let (Some(js), Some(css)) = (read(&script.js), read(&script.css)) {
                    out.push(InjectedScript {
                        ext_id: e.manifest.id.clone(),
                        script_id: script.id.clone(),
                        js,
                        css,
                    });
                }
            }
        }
        out
    }
    /// Concatenate enabled shell CSS in built-in, then user, then ID order.
    pub fn shell_css(&self) -> String {
        let mut out = String::new();
        for e in self.active() {
            for f in &e.manifest.contributes.shell_css {
                if let Ok(path) = safe_path(&e.root, f) {
                    if let Some(css) = self.read_cached(&path) {
                        out.push_str(&format!("/* ext:{} */\n{css}\n", e.manifest.id));
                    }
                }
            }
        }
        out
    }
    /// Enabled sidebar panels.
    pub fn panels(&self) -> Vec<PanelInfo> {
        self.active()
            .into_iter()
            .flat_map(|e| {
                e.manifest
                    .contributes
                    .panels
                    .iter()
                    .cloned()
                    .map(|panel| PanelInfo {
                        ext_id: e.manifest.id.clone(),
                        panel,
                    })
                    .collect::<Vec<_>>()
            })
            .collect()
    }
    /// Enabled palette commands.
    pub fn commands(&self) -> Vec<CommandInfo> {
        self.active()
            .into_iter()
            .flat_map(|e| {
                e.manifest
                    .contributes
                    .commands
                    .iter()
                    .cloned()
                    .map(|command| CommandInfo {
                        ext_id: e.manifest.id.clone(),
                        command,
                    })
                    .collect::<Vec<_>>()
            })
            .collect()
    }
    /// Enabled local and remote filter lists.
    pub fn filter_lists(&self) -> Vec<FilterListContribution> {
        self.active()
            .into_iter()
            .flat_map(|e| {
                e.manifest
                    .contributes
                    .filter_lists
                    .iter()
                    .cloned()
                    .map(|list| FilterListContribution {
                        ext_id: e.manifest.id.clone(),
                        local_file: list.file.as_ref().and_then(|f| safe_path(&e.root, f).ok()),
                        list,
                    })
                    .collect::<Vec<_>>()
            })
            .collect()
    }
    /// Enabled filing rules, using `athanor_core::filing::Rule`.
    pub fn tab_rules(&self) -> Vec<Rule> {
        self.active()
            .into_iter()
            .flat_map(|e| e.manifest.contributes.tab_rules.clone())
            .collect()
    }
    /// Bundled themes plus enabled extension themes.
    pub fn themes(&self) -> Vec<ThemeInfo> {
        let mut out: Vec<_> = builtin_themes()
            .into_iter()
            .map(|t| ThemeInfo {
                id: t.id,
                name: t.name,
                dark: t.dark,
                ext_id: None,
            })
            .collect();
        for e in self.active() {
            for t in &e.manifest.contributes.themes {
                if let Some(theme) = self.theme(&t.id) {
                    out.push(ThemeInfo {
                        id: t.id.clone(),
                        name: t.name.clone(),
                        dark: theme.dark,
                        ext_id: Some(e.manifest.id.clone()),
                    });
                }
            }
        }
        out
    }
    /// Resolve a bundled or enabled extension theme by ID.
    pub fn theme(&self, id: &str) -> Option<Theme> {
        for e in self.active() {
            for t in &e.manifest.contributes.themes {
                if t.id == id {
                    let path = safe_path(&e.root, &t.file).ok()?;
                    let theme: Theme = serde_json::from_str(&self.read_cached(&path)?).ok()?;
                    theme.validate().ok()?;
                    return Some(theme.merge_over_base());
                }
            }
        }
        builtin_themes()
            .into_iter()
            .find(|t| t.id == id)
            .map(|t| t.merge_over_base())
    }
    /// Read an asset only if it is inside a loaded, enabled extension root.
    pub fn resolve_asset(&self, ext_id: &str, rel: &str) -> Result<(Vec<u8>, String)> {
        let e = self
            .extensions
            .get(ext_id)
            .filter(|_| self.enabled(ext_id))
            .ok_or_else(|| ExtensionError::Invalid("unknown or disabled extension".into()))?;
        let path = safe_path(&e.root, rel).map_err(ExtensionError::Invalid)?;
        let mime = match path
            .extension()
            .and_then(|s| s.to_str())
            .unwrap_or("")
            .to_ascii_lowercase()
            .as_str()
        {
            "html" => "text/html",
            "js" | "mjs" => "text/javascript",
            "css" => "text/css",
            "json" => "application/json",
            "png" => "image/png",
            "jpg" | "jpeg" => "image/jpeg",
            "gif" => "image/gif",
            "svg" => "image/svg+xml",
            "webp" => "image/webp",
            "woff2" => "font/woff2",
            "woff" => "font/woff",
            "txt" => "text/plain",
            _ => "application/octet-stream",
        };
        Ok((fs::read(path)?, mime.into()))
    }
    /// Check a runtime bridge capability against an enabled extension.
    pub fn check(
        &self,
        ext_id: &str,
        perm: Permission,
    ) -> std::result::Result<(), PermissionDenied> {
        if self.enabled(ext_id)
            && self
                .extensions
                .get(ext_id)
                .is_some_and(|e| e.manifest.permissions.contains(&perm))
        {
            Ok(())
        } else {
            Err(PermissionDenied {
                id: ext_id.into(),
                permission: perm,
            })
        }
    }
}

fn collect_files(
    root: &Path,
    dir: &Path,
    files: &mut Vec<(PathBuf, PathBuf)>,
    bytes: &mut u64,
) -> Result<()> {
    for entry in fs::read_dir(dir)? {
        let entry = entry?;
        let meta = fs::symlink_metadata(entry.path())?;
        if meta.file_type().is_symlink() {
            return Err(ExtensionError::Invalid("symlink in install source".into()));
        }
        if meta.is_dir() {
            collect_files(root, &entry.path(), files, bytes)?;
        } else if meta.is_file() {
            *bytes += meta.len();
            files.push((
                entry.path(),
                entry
                    .path()
                    .strip_prefix(root)
                    .map_err(|e| ExtensionError::Invalid(e.to_string()))?
                    .into(),
            ));
            if files.len() > 1024 || *bytes > 32 * 1024 * 1024 {
                return Err(ExtensionError::Invalid(
                    "install exceeds 1024 files or 32 MiB".into(),
                ));
            }
        } else {
            return Err(ExtensionError::Invalid("unsupported file type".into()));
        }
    }
    Ok(())
}

/// Strict CSP for a panel without network permission.
pub fn panel_csp() -> &'static str {
    "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'none'; base-uri 'none'; form-action 'none'"
}
/// Strict panel CSP adjusted for a granted network permission.
pub fn panel_csp_for(permissions: &[Permission]) -> &'static str {
    if permissions.contains(&Permission::Network) {
        "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src https:; base-uri 'none'; form-action 'none'"
    } else {
        panel_csp()
    }
}
