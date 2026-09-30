//! Extension manifest data and validation.

use crate::{MatchPattern, Theme};
use athanor_core::filing::Rule;
use serde::{Deserialize, Serialize};
use std::{
    collections::HashSet,
    fs,
    path::{Component, Path, PathBuf},
};

/// An extension's stable identifier.
pub type ExtensionId = String;

/// A capability granted to an extension.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Hash, Serialize, Deserialize)]
pub enum Permission {
    #[serde(rename = "pages.inject")]
    PagesInject,
    #[serde(rename = "shell.style")]
    ShellStyle,
    #[serde(rename = "shell.panel")]
    ShellPanel,
    #[serde(rename = "commands")]
    Commands,
    #[serde(rename = "filters")]
    Filters,
    #[serde(rename = "tabs.read")]
    TabsRead,
    #[serde(rename = "tabs.write")]
    TabsWrite,
    #[serde(rename = "storage")]
    Storage,
    #[serde(rename = "clipboard")]
    Clipboard,
    #[serde(rename = "network")]
    Network,
}

/// Script injection timing.
#[derive(Clone, Copy, Debug, Default, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RunAt {
    DocumentStart,
    DocumentEnd,
    #[default]
    DocumentIdle,
}

/// A theme file contributed by an extension.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct ThemeContribution {
    pub id: String,
    pub name: String,
    pub file: String,
}
/// A page script and style contribution.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UserScript {
    pub id: String,
    pub matches: Vec<String>,
    #[serde(default)]
    pub exclude_matches: Vec<String>,
    #[serde(default)]
    pub js: Vec<String>,
    #[serde(default)]
    pub css: Vec<String>,
    #[serde(default)]
    pub run_at: RunAt,
    #[serde(default)]
    pub all_frames: bool,
}
/// A sandboxed sidebar panel.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Panel {
    pub id: String,
    pub title: String,
    pub icon: String,
    pub entry: String,
    pub location: String,
}
/// A command advertised to the palette.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Command {
    pub id: String,
    pub title: String,
    #[serde(default)]
    pub keybinding: Option<String>,
}
/// A local or remote filter list.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct FilterList {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub file: Option<String>,
    #[serde(default)]
    pub url: Option<String>,
}

/// Declarative changes supplied by an extension.
#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Contributions {
    #[serde(default)]
    pub themes: Vec<ThemeContribution>,
    #[serde(default)]
    pub shell_css: Vec<String>,
    #[serde(default)]
    pub user_scripts: Vec<UserScript>,
    #[serde(default)]
    pub panels: Vec<Panel>,
    #[serde(default)]
    pub commands: Vec<Command>,
    #[serde(default)]
    pub filter_lists: Vec<FilterList>,
    #[serde(default)]
    pub tab_rules: Vec<Rule>,
}

/// The parsed `athanor-extension.json` document.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Manifest {
    pub id: String,
    pub name: String,
    pub version: String,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub author: String,
    pub athanor: String,
    #[serde(default)]
    pub permissions: Vec<Permission>,
    #[serde(default)]
    pub contributes: Contributions,
}

/// All independent validation failures found in a manifest.
#[derive(Clone, Debug)]
pub struct ValidationErrors(pub Vec<String>);
impl std::fmt::Display for ValidationErrors {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "manifest validation failed: {}", self.0.join("; "))
    }
}
impl std::error::Error for ValidationErrors {}

impl Manifest {
    /// Parse a manifest and report unknown top-level keys as warnings.
    pub fn parse(input: &str) -> Result<(Self, Vec<String>), serde_json::Error> {
        let value: serde_json::Value = serde_json::from_str(input)?;
        let warnings = value
            .as_object()
            .map(|obj| {
                obj.keys()
                    .filter(|k| {
                        ![
                            "id",
                            "name",
                            "version",
                            "description",
                            "author",
                            "athanor",
                            "permissions",
                            "contributes",
                        ]
                        .contains(&k.as_str())
                    })
                    .map(|k| format!("unknown top-level key: {k}"))
                    .collect()
            })
            .unwrap_or_default();
        Ok((serde_json::from_value(value)?, warnings))
    }

    /// Validate identity, host compatibility, permissions, patterns, themes and local files.
    pub fn validate(&self, root: &Path, host_version: &str) -> Result<(), ValidationErrors> {
        let mut errors = Vec::new();
        if !valid_id(&self.id) {
            errors.push(
                "id must use lowercase a-z, 0-9, dot, underscore or hyphen and contain a dot"
                    .into(),
            );
        }
        if self.name.trim().is_empty() {
            errors.push("name is empty".into());
        }
        if semver::Version::parse(&self.version).is_err() {
            errors.push(format!("invalid semver version: {}", self.version));
        }
        match (
            semver::VersionReq::parse(&self.athanor),
            semver::Version::parse(host_version),
        ) {
            (Ok(req), Ok(host)) if !req.matches(&host) => {
                errors.push(format!("host {host} does not satisfy {}", self.athanor))
            }
            (Err(_), _) => errors.push(format!(
                "invalid athanor version requirement: {}",
                self.athanor
            )),
            (_, Err(_)) => errors.push(format!("invalid host version: {host_version}")),
            _ => (),
        }
        let c = &self.contributes;
        for (present, permission, label) in [
            (!c.shell_css.is_empty(), Permission::ShellStyle, "shellCss"),
            (
                !c.user_scripts.is_empty(),
                Permission::PagesInject,
                "userScripts",
            ),
            (!c.panels.is_empty(), Permission::ShellPanel, "panels"),
            (!c.commands.is_empty(), Permission::Commands, "commands"),
            (
                !c.filter_lists.is_empty(),
                Permission::Filters,
                "filterLists",
            ),
            (!c.tab_rules.is_empty(), Permission::TabsWrite, "tabRules"),
        ] {
            if present && !self.permissions.contains(&permission) {
                errors.push(format!("{label} requires {permission:?}"));
            }
        }
        let mut ids = HashSet::new();
        for t in &c.themes {
            if !ids.insert((&t.id, "theme")) {
                errors.push(format!("duplicate theme id: {}", t.id));
            }
            check_file(root, &t.file, &mut errors);
            if let Ok(text) = fs::read_to_string(root.join(&t.file)) {
                match serde_json::from_str::<Theme>(&text) {
                    Ok(theme) => {
                        if theme.id != t.id {
                            errors.push(format!("theme {} id differs from file", t.id));
                        }
                        if let Err(e) = theme.validate() {
                            errors.extend(e.0);
                        }
                    }
                    Err(e) => errors.push(format!("theme {}: {e}", t.id)),
                }
            }
        }
        for file in &c.shell_css {
            check_file(root, file, &mut errors);
        }
        for script in &c.user_scripts {
            if !ids.insert((&script.id, "script")) {
                errors.push(format!("duplicate script id: {}", script.id));
            }
            if script.matches.is_empty() {
                errors.push(format!("script {} has no matches", script.id));
            }
            for p in script.matches.iter().chain(&script.exclude_matches) {
                if let Err(e) = MatchPattern::parse(p) {
                    errors.push(format!("script {} pattern {p}: {e}", script.id));
                }
            }
            for file in script.js.iter().chain(&script.css) {
                check_file(root, file, &mut errors);
            }
        }
        for p in &c.panels {
            if p.location != "sidebar" {
                errors.push(format!("panel {} location must be sidebar", p.id));
            }
            check_file(root, &p.entry, &mut errors);
        }
        for list in &c.filter_lists {
            match (&list.file, &list.url) {
                (Some(file), None) => check_file(root, file, &mut errors),
                (None, Some(url)) if url::Url::parse(url).is_ok_and(|u| u.scheme() == "https") => {}
                _ => errors.push(format!(
                    "filter list {} needs exactly one local file or HTTPS url",
                    list.id
                )),
            }
        }
        if errors.is_empty() {
            Ok(())
        } else {
            Err(ValidationErrors(errors))
        }
    }
}

fn valid_id(id: &str) -> bool {
    id.contains('.')
        && !id.starts_with('.')
        && !id.ends_with('.')
        && id.bytes().all(|b| {
            b.is_ascii_lowercase() || b.is_ascii_digit() || matches!(b, b'.' | b'_' | b'-')
        })
}

/// Resolve an extension-relative path while rejecting traversal and symlink escapes.
pub(crate) fn safe_path(root: &Path, rel: &str) -> Result<PathBuf, String> {
    if rel.is_empty() || rel.contains(['\\', '\0', ':', '%']) || rel.starts_with('/') {
        return Err(format!("unsafe path: {rel}"));
    }
    let path = Path::new(rel);
    if !path.components().all(|c| matches!(c, Component::Normal(_))) {
        return Err(format!("unsafe path: {rel}"));
    }
    let base = root.canonicalize().map_err(|e| e.to_string())?;
    let resolved = root.join(path).canonicalize().map_err(|e| e.to_string())?;
    if !resolved.starts_with(base) || !resolved.is_file() {
        return Err(format!("path escapes extension or is not a file: {rel}"));
    }
    Ok(resolved)
}

fn check_file(root: &Path, rel: &str, errors: &mut Vec<String>) {
    if let Err(e) = safe_path(root, rel) {
        errors.push(e);
    }
}
