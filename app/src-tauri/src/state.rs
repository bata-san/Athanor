//! Shared data types that cross the IPC boundary (see `docs/IPC.md`) and app-level settings.

use athanor_core::{
    filing::Rule,
    layout::{DividerInfo, Rect},
    Id, Workspace,
};
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
    /// The page failed to load and Athanor's error page is showing.
    pub failed: bool,
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
    /// Where new tabs open: a web address, or `athanor://newtab` for Athanor's own start page.
    pub homepage: String,
    /// Built-in YouTube ad handling (needs the blocker on).
    pub youtube_ad_skip: bool,
    /// Tell pages that encrypted media (DRM) is unavailable.
    pub block_drm: bool,
    /// Set once the first-run welcome has been completed or skipped.
    pub onboarded: bool,
    /// Use IBM Plex Sans JP as the default font of web pages (Windows; applies from the next start).
    pub web_font: bool,
    /// Look for updates at start-up and download them in the background.
    pub auto_update: bool,
    /// Page zoom remembered per site (host without `www.`); 1.0 is not stored.
    pub site_zoom: std::collections::HashMap<String, f64>,
    /// Remembered answers to permission prompts: `"https://host|camera"` -> allowed.
    pub site_permissions: std::collections::HashMap<String, bool>,
    /// Interface size in percent (100-200): text, controls and menus scale together.
    pub ui_scale: u32,
    /// Cut animations down to fades, whatever the system says.
    pub reduce_motion: bool,
    /// Stronger text and border contrast, whatever the system says.
    pub high_contrast: bool,
    /// Interface language: `system` (follow Windows), `en` or `ja`.
    pub language: String,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            search_engine: "https://www.google.com/search?q={q}".into(),
            archive_after_hours: 12,
            https_upgrade: true,
            strip_tracking: true,
            auto_file: false,
            restore_session: true,
            sidebar_side: "left".into(),
            sidebar_compact: false,
            sidebar_width: 236,
            theme: "chalk".into(),
            adblock_enabled: true,
            homepage: "https://www.google.com/".into(),
            youtube_ad_skip: true,
            block_drm: false,
            onboarded: false,
            web_font: true,
            auto_update: true,
            site_zoom: Default::default(),
            site_permissions: Default::default(),
            ui_scale: 100,
            reduce_motion: false,
            high_contrast: false,
            language: "system".into(),
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
    pub homepage: Option<String>,
    pub youtube_ad_skip: Option<bool>,
    pub block_drm: Option<bool>,
    pub onboarded: Option<bool>,
    pub web_font: Option<bool>,
    pub auto_update: Option<bool>,
    pub ui_scale: Option<u32>,
    pub reduce_motion: Option<bool>,
    pub high_contrast: Option<bool>,
    pub language: Option<String>,
}

impl Settings {
    pub fn apply(&mut self, p: SettingsPatch) {
        macro_rules! set {
            ($($f:ident),*) => { $( if let Some(v) = p.$f { self.$f = v; } )* };
        }
        set!(
            search_engine,
            archive_after_hours,
            https_upgrade,
            strip_tracking,
            auto_file,
            restore_session,
            sidebar_side,
            sidebar_compact,
            sidebar_width,
            theme,
            adblock_enabled,
            homepage,
            youtube_ad_skip,
            block_drm,
            onboarded,
            web_font,
            auto_update,
            ui_scale,
            reduce_motion,
            high_contrast,
            language
        );
        self.sanitize();
    }

    /// Bring every field back into its valid range (also used for settings read from disk).
    pub fn sanitize(&mut self) {
        // Accept old settings.json files, but automatic filing is no longer a behavior.
        self.auto_file = false;
        if !self.search_engine.contains("{q}") {
            self.search_engine = Settings::default().search_engine;
        }
        if self.sidebar_side != "left" && self.sidebar_side != "right" {
            self.sidebar_side = "left".into();
        }
        if !matches!(self.language.as_str(), "system" | "en" | "ja") {
            self.language = "system".into();
        }
        self.sidebar_width = self.sidebar_width.clamp(180, 520);
        self.ui_scale = (self.ui_scale.clamp(100, 200) + 2) / 5 * 5; // steps of 5 %
        self.site_zoom.retain(|host, factor| {
            !host.is_empty() && factor.is_finite() && (*factor - 1.0).abs() >= 0.01
        });
        for factor in self.site_zoom.values_mut() {
            *factor = factor.clamp(0.25, 5.0);
        }
        if self.site_permissions.len() > 2000 {
            let mut keys: Vec<_> = self.site_permissions.keys().cloned().collect();
            keys.sort();
            for key in keys.into_iter().skip(2000) {
                self.site_permissions.remove(&key);
            }
        }
        if self.site_zoom.len() > 500 {
            let mut hosts: Vec<_> = self.site_zoom.keys().cloned().collect();
            hosts.sort();
            for host in hosts.into_iter().skip(500) {
                self.site_zoom.remove(&host);
            }
        }
        if self.theme.trim().is_empty() {
            self.theme = Settings::default().theme;
        }
        let home = self.homepage.trim();
        let valid = home == "athanor://newtab"
            || home.starts_with("https://")
            || home.starts_with("http://");
        self.homepage = if valid {
            home.to_string()
        } else {
            Settings::default().homepage
        };
    }

    /// The address a new tab opens at.
    pub fn new_tab_url(&self) -> String {
        self.homepage.clone()
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
        s.apply(SettingsPatch {
            sidebar_width: Some(9999),
            search_engine: Some("https://x.test/?q=".into()),
            theme: Some("paper".into()),
            ..Default::default()
        });
        assert_eq!(s.sidebar_width, 520);
        assert_eq!(
            s.search_engine,
            Settings::default().search_engine,
            "template without {{q}} is rejected"
        );
        assert_eq!(s.theme, "paper");
    }

    #[test]
    fn sanitize_repairs_hand_edited_settings() {
        let mut s: Settings = serde_json::from_str(
            r#"{"searchEngine":"","sidebarWidth":0,"sidebarSide":"middle","theme":" "}"#,
        )
        .unwrap();
        s.sanitize();
        assert_eq!(s.search_engine, Settings::default().search_engine);
        assert_eq!(s.sidebar_width, 180);
        assert_eq!(s.sidebar_side, "left");
        assert_eq!(s.theme, "chalk");
        assert_eq!(s.homepage, "https://www.google.com/");
    }

    #[test]
    fn google_is_the_default_search_and_start_page() {
        let s = Settings::default();
        assert!(s.search_engine.starts_with("https://www.google.com/search"));
        assert_eq!(s.new_tab_url(), "https://www.google.com/");
        assert!(!s.onboarded && s.youtube_ad_skip && !s.block_drm);
        assert!(s.web_font && s.auto_update);
        assert_eq!(s.ui_scale, 100);
        assert!(!s.reduce_motion && !s.high_contrast);
    }

    #[test]
    fn language_follows_the_system_unless_chosen() {
        let mut s = Settings::default();
        assert_eq!(s.language, "system");
        s.apply(SettingsPatch { language: Some("ja".into()), ..Default::default() });
        assert_eq!(s.language, "ja");
        s.apply(SettingsPatch { language: Some("fr".into()), ..Default::default() });
        assert_eq!(s.language, "system", "unknown languages fall back to the system choice");
    }

    #[test]
    fn homepage_must_be_a_web_address_or_the_start_page() {
        let mut s = Settings::default();
        s.apply(SettingsPatch {
            homepage: Some("javascript:alert(1)".into()),
            ..Default::default()
        });
        assert_eq!(s.homepage, "https://www.google.com/");
        s.apply(SettingsPatch {
            homepage: Some("athanor://newtab".into()),
            ..Default::default()
        });
        assert_eq!(s.homepage, "athanor://newtab");
    }

    #[test]
    fn settings_tolerate_missing_fields() {
        let s: Settings = serde_json::from_str(r#"{"theme":"midnight"}"#).unwrap();
        assert_eq!(s.theme, "midnight");
        assert!(s.https_upgrade);
    }

    #[test]
    fn legacy_auto_file_setting_cannot_enable_background_filing() {
        let mut settings: Settings = serde_json::from_str(r#"{"autoFile":true}"#).unwrap();
        settings.sanitize();
        assert!(!settings.auto_file);
        settings.apply(SettingsPatch {
            auto_file: Some(true),
            ..Default::default()
        });
        assert!(!settings.auto_file);
    }
}
