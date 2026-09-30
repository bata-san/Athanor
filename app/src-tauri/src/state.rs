//! Shared data types that cross the IPC boundary (see `docs/IPC.md`) and app-level settings.

use athanor_core::{filing::Rule, layout::{DividerInfo, Rect}, Id, Workspace};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Clone, Debug, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TabRuntime {
    pub loading: bool,
    pub can_go_back: bool,
    pub can_go_forward: bool,
    pub blocked: u32,
    pub audible: bool,
    pub secure: bool,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct Settings {
    pub search_engine: String,
    pub archive_after_hours: u32,
    pub https_upgrade: bool,
    pub strip_tracking: bool,
    pub auto_file: bool,
    pub restore_session: bool,
    pub sidebar_side: String,
    pub sidebar_compact: bool,
    pub sidebar_width: u32,
    pub theme: String,
    pub adblock_enabled: bool,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            search_engine: "https://duckduckgo.com/?q={q}".into(),
            archive_after_hours: 12,
            https_upgrade: true,
            strip_tracking: true,
            auto_file: true,
            restore_session: true,
            sidebar_side: "left".into(),
            sidebar_compact: false,
            sidebar_width: 260,
            theme: "monolith".into(),
            adblock_enabled: true,
        }
    }
}

/// Partial settings as sent by `set_settings`.
#[derive(Clone, Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SettingsPatch {
    pub search_engine: Option<String>,
    pub archive_after_hours: Option<u32>,
    pub https_upgrade: Option<bool>,
    pub strip_tracking: Option<bool>,
    pub auto_file: Option<bool>,
    pub restore_session: Option<bool>,
    pub sidebar_side: Option<String>,
    pub sidebar_compact: Option<bool>,
    pub sidebar_width: Option<u32>,
    pub theme: Option<String>,
    pub adblock_enabled: Option<bool>,
}

impl Settings {
    pub fn apply(&mut self, p: SettingsPatch) {
        macro_rules! set {
            ($($f:ident),*) => { $( if let Some(v) = p.$f { self.$f = v; } )* };
        }
        set!(
            search_engine, archive_after_hours, https_upgrade, strip_tracking, auto_file, restore_session,
            sidebar_side, sidebar_compact, sidebar_width, theme, adblock_enabled
        );
        self.sanitize();
    }

    /// Bring every field back into its valid range (also used for settings read from disk).
    pub fn sanitize(&mut self) {
        if !self.search_engine.contains("{q}") {
            self.search_engine = Settings::default().search_engine;
        }
        if self.sidebar_side != "left" && self.sidebar_side != "right" {
            self.sidebar_side = "left".into();
        }
        self.sidebar_width = self.sidebar_width.clamp(180, 520);
        if self.theme.trim().is_empty() {
            self.theme = Settings::default().theme;
        }
    }
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    pub workspace: Workspace,
    pub runtime: HashMap<Id, TabRuntime>,
    pub settings: Settings,
    pub filing_rules: Vec<Rule>,
    pub platform: &'static str,
    pub version: &'static str,
    pub blocked_total: u64,
}

#[derive(Clone, Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Pane {
    pub tab: Id,
    pub rect: Rect,
}

#[derive(Clone, Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SplitRects {
    pub panes: Vec<Pane>,
    pub dividers: Vec<DividerInfo>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Suggestion {
    pub kind: &'static str,
    pub title: String,
    pub subtitle: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tab: Option<Id>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub icon: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub command: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DevServer {
    pub port: u16,
    pub url: String,
    pub title: Option<String>,
}

pub fn platform() -> &'static str {
    if cfg!(target_os = "android") {
        "android"
    } else if cfg!(target_os = "ios") {
        "ios"
    } else if cfg!(target_os = "windows") {
        "windows"
    } else if cfg!(target_os = "macos") {
        "macos"
    } else {
        "linux"
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn patch_applies_and_validates() {
        let mut s = Settings::default();
        s.apply(SettingsPatch { sidebar_width: Some(9999), search_engine: Some("https://x.test/?q=".into()), theme: Some("paper".into()), ..Default::default() });
        assert_eq!(s.sidebar_width, 520);
        assert_eq!(s.search_engine, Settings::default().search_engine, "template without {{q}} is rejected");
        assert_eq!(s.theme, "paper");
    }

    #[test]
    fn sanitize_repairs_hand_edited_settings() {
        let mut s: Settings = serde_json::from_str(r#"{"searchEngine":"","sidebarWidth":0,"sidebarSide":"middle","theme":" "}"#).unwrap();
        s.sanitize();
        assert_eq!(s.search_engine, Settings::default().search_engine);
        assert_eq!(s.sidebar_width, 180);
        assert_eq!(s.sidebar_side, "left");
        assert_eq!(s.theme, "monolith");
    }

    #[test]
    fn settings_tolerate_missing_fields() {
        let s: Settings = serde_json::from_str(r#"{"theme":"midnight"}"#).unwrap();
        assert_eq!(s.theme, "midnight");
        assert!(s.https_upgrade);
    }
}
