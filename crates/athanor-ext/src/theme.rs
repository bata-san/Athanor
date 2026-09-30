//! Theme tokens and CSS generation.

use crate::ValidationErrors;
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

const TOKENS: &[&str] = &[
    "background",
    "foreground",
    "card",
    "cardForeground",
    "popover",
    "popoverForeground",
    "primary",
    "primaryForeground",
    "secondary",
    "secondaryForeground",
    "muted",
    "mutedForeground",
    "accent",
    "accentForeground",
    "destructive",
    "border",
    "input",
    "ring",
    "sidebar",
    "sidebarForeground",
    "sidebarAccent",
    "sidebarAccentForeground",
    "sidebarBorder",
    "tabActive",
    "tabHover",
    "spaceAccent",
];

/// Font family declarations for the shell.
#[derive(Clone, Debug, Default, Serialize, Deserialize)]
pub struct ThemeFonts {
    #[serde(default)]
    pub ui: Option<String>,
    #[serde(default)]
    pub mono: Option<String>,
}

/// Layout options understood by the shell.
#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ThemeUi {
    #[serde(default)]
    pub sidebar_side: Option<String>,
    #[serde(default)]
    pub density: Option<String>,
    #[serde(default)]
    pub tab_height: Option<u16>,
    #[serde(default)]
    pub sidebar_width: Option<u16>,
    #[serde(default)]
    pub blur: Option<u16>,
    #[serde(default)]
    pub show_favicons: Option<bool>,
}

/// A partial or fully resolved visual theme.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Theme {
    pub id: String,
    pub name: String,
    pub dark: bool,
    pub colors: BTreeMap<String, String>,
    #[serde(default)]
    pub radius: Option<String>,
    #[serde(default)]
    pub fonts: ThemeFonts,
    #[serde(default)]
    pub ui: ThemeUi,
    #[serde(default)]
    pub css: String,
}

impl Theme {
    /// Validate required colors and CSS interpolation safety.
    pub fn validate(&self) -> Result<(), ValidationErrors> {
        let mut errors = Vec::new();
        for required in ["background", "foreground", "primary"] {
            if self
                .colors
                .get(required)
                .is_none_or(|s| s.trim().is_empty())
            {
                errors.push(format!("missing color {required}"));
            }
        }
        for (key, value) in &self.colors {
            if !TOKENS.contains(&key.as_str()) {
                errors.push(format!("unknown color token: {key}"));
            }
            if unsafe_value(value) {
                errors.push(format!("unsafe color {key}"));
            }
        }
        for (label, value) in [
            ("radius", self.radius.as_deref()),
            ("font.ui", self.fonts.ui.as_deref()),
            ("font.mono", self.fonts.mono.as_deref()),
        ] {
            if value.is_some_and(unsafe_value) {
                errors.push(format!("unsafe {label}"));
            }
        }
        if self.css.to_ascii_lowercase().contains("@import")
            || self.css.to_ascii_lowercase().contains("</style")
        {
            errors.push("raw css may not contain @import or </style".into());
        }
        if self
            .ui
            .sidebar_side
            .as_deref()
            .is_some_and(|s| !matches!(s, "left" | "right"))
        {
            errors.push("sidebarSide must be left or right".into());
        }
        if self
            .ui
            .density
            .as_deref()
            .is_some_and(|s| !matches!(s, "compact" | "comfortable"))
        {
            errors.push("density must be compact or comfortable".into());
        }
        if errors.is_empty() {
            Ok(())
        } else {
            Err(ValidationErrors(errors))
        }
    }

    /// Fill missing tokens and options from the built-in theme of the same darkness.
    pub fn merge_over_base(&self) -> Self {
        let mut merged = base_theme(self.dark);
        merged.id = self.id.clone();
        merged.name = self.name.clone();
        merged.colors.extend(self.colors.clone());
        if self.radius.is_some() {
            merged.radius = self.radius.clone();
        }
        if self.fonts.ui.is_some() {
            merged.fonts.ui = self.fonts.ui.clone();
        }
        if self.fonts.mono.is_some() {
            merged.fonts.mono = self.fonts.mono.clone();
        }
        if self.ui.sidebar_side.is_some() {
            merged.ui.sidebar_side = self.ui.sidebar_side.clone();
        }
        if self.ui.density.is_some() {
            merged.ui.density = self.ui.density.clone();
        }
        if self.ui.tab_height.is_some() {
            merged.ui.tab_height = self.ui.tab_height;
        }
        if self.ui.sidebar_width.is_some() {
            merged.ui.sidebar_width = self.ui.sidebar_width;
        }
        if self.ui.blur.is_some() {
            merged.ui.blur = self.ui.blur;
        }
        if self.ui.show_favicons.is_some() {
            merged.ui.show_favicons = self.ui.show_favicons;
        }
        merged.css = self.css.clone();
        merged
    }

    /// Render the resolved theme as shell CSS variables followed by custom CSS.
    pub fn to_css(&self) -> String {
        let theme = self.merge_over_base();
        let mut css = String::from(":root{\n");
        for token in TOKENS {
            if let Some(value) = theme.colors.get(*token) {
                let name = if matches!(*token, "tabActive" | "tabHover" | "spaceAccent") {
                    format!("ath-{}", kebab(token))
                } else {
                    kebab(token)
                };
                css.push_str(&format!("  --{name}: {value};\n"));
            }
        }
        css.push_str(&format!("  --radius: {};\n  --font-ui: {};\n  --font-mono: {};\n  --ath-sidebar-side: {};\n  --ath-density: {};\n  --ath-tab-height: {}px;\n  --ath-sidebar-width: {}px;\n  --ath-blur: {}px;\n  --ath-show-favicons: {};\n  color-scheme: {};\n}}\n", theme.radius.as_deref().unwrap_or("0.6rem"), theme.fonts.ui.as_deref().unwrap_or("system-ui, sans-serif"), theme.fonts.mono.as_deref().unwrap_or("ui-monospace, monospace"), theme.ui.sidebar_side.as_deref().unwrap_or("left"), theme.ui.density.as_deref().unwrap_or("comfortable"), theme.ui.tab_height.unwrap_or(34), theme.ui.sidebar_width.unwrap_or(260), theme.ui.blur.unwrap_or(0), theme.ui.show_favicons.unwrap_or(true), if theme.dark { "dark" } else { "light" }));
        css.push_str(&theme.css);
        css
    }
}

fn unsafe_value(s: &str) -> bool {
    let lower = s.to_ascii_lowercase();
    s.trim().is_empty()
        || s.contains([';', '{', '}', '\n', '\r'])
        || ["url(", "@import", "expression(", "/*", "*/", "</style"]
            .iter()
            .any(|bad| lower.contains(bad))
}
fn kebab(s: &str) -> String {
    let mut out = String::new();
    for ch in s.chars() {
        if ch.is_ascii_uppercase() {
            out.push('-');
            out.push(ch.to_ascii_lowercase());
        } else {
            out.push(ch);
        }
    }
    out
}

/// Built-in baseline for partial themes.
pub fn base_theme(dark: bool) -> Theme {
    serde_json::from_str(if dark {
        include_str!("../themes/monolith.json")
    } else {
        include_str!("../themes/chalk.json")
    })
    .expect("bundled base theme JSON")
}

/// All bundled themes, in stable order. The first dark and first light entries are the defaults.
pub fn builtin_themes() -> Vec<Theme> {
    [
        include_str!("../themes/monolith.json"),
        include_str!("../themes/chalk.json"),
        include_str!("../themes/ember.json"),
        include_str!("../themes/paper.json"),
        include_str!("../themes/midnight.json"),
        include_str!("../themes/terminal.json"),
        include_str!("../themes/mist.json"),
    ]
    .into_iter()
    .map(|s| serde_json::from_str(s).expect("bundled theme JSON"))
    .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    fn luminance(hex: &str) -> f64 {
        let n = u32::from_str_radix(hex.trim_start_matches('#'), 16).unwrap();
        let channels = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
        channels
            .into_iter()
            .enumerate()
            .map(|(i, c)| {
                let v = c as f64 / 255.0;
                let linear = if v <= 0.04045 {
                    v / 12.92
                } else {
                    ((v + 0.055) / 1.055).powf(2.4)
                };
                linear * [0.2126, 0.7152, 0.0722][i]
            })
            .sum()
    }
    #[test]
    fn builtin_contrast_and_validation() {
        for t in builtin_themes() {
            t.validate().unwrap();
            for (fg, bg) in [
                ("foreground", "background"),
                ("primaryForeground", "primary"),
                ("mutedForeground", "background"),
            ] {
                let a = luminance(&t.colors[fg]);
                let b = luminance(&t.colors[bg]);
                assert!(
                    (a.max(b) + 0.05) / (a.min(b) + 0.05) >= 4.5,
                    "{} {fg}/{bg}",
                    t.id
                );
            }
        }
    }
    #[test]
    fn fallback_and_injection() {
        let mut t = base_theme(true);
        t.colors
            .retain(|k, _| ["background", "foreground", "primary"].contains(&k.as_str()));
        assert!(t.to_css().contains("--sidebar-accent:"));
        t.colors
            .insert("foreground".into(), "red; color:blue".into());
        t.css = "@import 'x'".into();
        assert_eq!(t.validate().unwrap_err().0.len(), 2);
    }
}
