//! Automatic tab filing: decide which folder a tab belongs in from its URL and title.
//!
//! User rules win; otherwise a small built-in category table applies. Pure and allocation-light.

use serde::{Deserialize, Serialize};
use url::Url;

/// A user (or extension) supplied filing rule. All present conditions must match.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Rule {
    #[serde(default)]
    pub id: String,
    /// Target folder name (created on demand).
    pub folder: String,
    /// Host pattern: `example.com` (also subdomains) or `*.example.com` (subdomains only).
    #[serde(default)]
    pub host: Option<String>,
    /// Path must start with this (e.g. `/issues`).
    #[serde(default)]
    pub path_prefix: Option<String>,
    /// Case-insensitive substring of the title.
    #[serde(default)]
    pub title_contains: Option<String>,
    #[serde(default = "yes")]
    pub enabled: bool,
}

fn yes() -> bool {
    true
}

impl Rule {
    fn has_condition(&self) -> bool {
        self.host.is_some() || self.path_prefix.is_some() || self.title_contains.is_some()
    }

    fn matches(&self, host: &str, path: &str, title: &str) -> bool {
        if !self.enabled || !self.has_condition() {
            return false;
        }
        self.host.as_deref().is_none_or(|p| host_matches(host, p))
            && self.path_prefix.as_deref().is_none_or(|p| path.starts_with(p))
            && self
                .title_contains
                .as_deref()
                .is_none_or(|t| title.to_lowercase().contains(&t.to_lowercase()))
    }
}

/// `example.com` matches itself and any subdomain; `*.example.com` matches subdomains only.
pub fn host_matches(host: &str, pattern: &str) -> bool {
    let host = host.trim_end_matches('.').to_ascii_lowercase();
    let pattern = pattern.trim().to_ascii_lowercase();
    match pattern.strip_prefix("*.") {
        Some(base) => host.len() > base.len() && host.ends_with(base) && host.as_bytes()[host.len() - base.len() - 1] == b'.',
        None => host == pattern || (host.ends_with(&pattern) && host.as_bytes()[host.len() - pattern.len() - 1] == b'.'),
    }
}

const CATEGORIES: &[(&str, &[&str])] = &[
    (
        "Localhost",
        &["localhost", "127.0.0.1", "[::1]", "*.localhost", "*.local", "*.test"],
    ),
    (
        "Dev",
        &[
            "github.com", "gitlab.com", "bitbucket.org", "stackoverflow.com", "stackexchange.com", "docs.rs",
            "crates.io", "npmjs.com", "pypi.org", "developer.mozilla.org", "rust-lang.org", "tauri.app",
            "react.dev", "vercel.com", "netlify.com", "dev.to", "hub.docker.com", "learn.microsoft.com",
            "developer.android.com", "kotlinlang.org", "go.dev", "python.org", "nodejs.org", "typescriptlang.org",
            "tailwindcss.com", "ui.shadcn.com", "codepen.io", "jsfiddle.net", "developer.chrome.com", "web.dev",
        ],
    ),
    (
        "AI",
        &["chatgpt.com", "claude.ai", "gemini.google.com", "perplexity.ai", "huggingface.co", "openai.com", "anthropic.com"],
    ),
    (
        "Media",
        &["youtube.com", "youtu.be", "twitch.tv", "nicovideo.jp", "netflix.com", "spotify.com", "vimeo.com", "bilibili.com", "soundcloud.com"],
    ),
    (
        "Social",
        &["x.com", "twitter.com", "reddit.com", "facebook.com", "instagram.com", "bsky.app", "mastodon.social", "discord.com", "linkedin.com", "threads.net"],
    ),
    (
        "Shopping",
        &["amazon.com", "amazon.co.jp", "ebay.com", "rakuten.co.jp", "mercari.com", "aliexpress.com", "etsy.com"],
    ),
    (
        "Work",
        &["mail.google.com", "outlook.live.com", "outlook.office.com", "notion.so", "slack.com", "calendar.google.com", "docs.google.com", "drive.google.com", "figma.com", "trello.com", "linear.app", "atlassian.net"],
    ),
    (
        "News",
        &["nytimes.com", "bbc.com", "cnn.com", "news.ycombinator.com", "theverge.com", "techcrunch.com", "nikkei.com", "news.yahoo.co.jp"],
    ),
    (
        "Reference",
        &["wikipedia.org", "arxiv.org", "wikimedia.org", "britannica.com"],
    ),
    (
        "Inspiration",
        &["pixiv.net", "pinterest.com", "behance.net", "dribbble.com", "artstation.com", "unsplash.com"],
    ),
];

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Filer {
    pub rules: Vec<Rule>,
    /// Use the built-in category table after user rules.
    pub builtin: bool,
}

impl Default for Filer {
    fn default() -> Self {
        Self { rules: vec![], builtin: true }
    }
}

impl Filer {
    /// Folder name for a page, or `None` if nothing applies. Internal `athanor:` pages are never filed.
    pub fn suggest(&self, url: &str, title: &str) -> Option<String> {
        let parsed = Url::parse(url).ok()?;
        if !matches!(parsed.scheme(), "http" | "https") {
            return None;
        }
        let host = parsed.host_str()?;
        let path = parsed.path();
        if let Some(r) = self.rules.iter().find(|r| r.matches(host, path, title)) {
            return Some(r.folder.clone());
        }
        if !self.builtin {
            return None;
        }
        CATEGORIES
            .iter()
            .find(|(_, hosts)| hosts.iter().any(|p| host_matches(host, p)))
            .map(|(name, _)| (*name).to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn host_patterns() {
        assert!(host_matches("github.com", "github.com"));
        assert!(host_matches("gist.github.com", "github.com"));
        assert!(!host_matches("notgithub.com", "github.com"));
        assert!(host_matches("a.b.dev", "*.b.dev"));
        assert!(!host_matches("b.dev", "*.b.dev"));
        assert!(host_matches("GitHub.com.", "github.com"));
    }

    #[test]
    fn builtin_categories() {
        let f = Filer::default();
        assert_eq!(f.suggest("https://github.com/a/b", "").as_deref(), Some("Dev"));
        assert_eq!(f.suggest("http://localhost:5173/", "").as_deref(), Some("Localhost"));
        assert_eq!(f.suggest("https://my.app.test/", "").as_deref(), Some("Localhost"));
        assert_eq!(f.suggest("https://www.youtube.com/watch?v=1", "").as_deref(), Some("Media"));
        assert_eq!(f.suggest("https://example.org/", ""), None);
        assert_eq!(f.suggest("athanor://newtab", ""), None);
        assert_eq!(f.suggest("not a url", ""), None);
    }

    #[test]
    fn user_rules_win_and_can_disable_builtin() {
        let mut f = Filer::default();
        f.rules.push(Rule {
            id: "1".into(),
            folder: "Issues".into(),
            host: Some("github.com".into()),
            path_prefix: Some("/issues".into()),
            title_contains: None,
            enabled: true,
        });
        assert_eq!(f.suggest("https://github.com/issues", "").as_deref(), Some("Issues"));
        assert_eq!(f.suggest("https://github.com/rust-lang", "").as_deref(), Some("Dev"));
        f.builtin = false;
        assert_eq!(f.suggest("https://github.com/rust-lang", ""), None);
    }

    #[test]
    fn title_rule_and_empty_rule() {
        let f = Filer {
            builtin: false,
            rules: vec![
                Rule { id: "a".into(), folder: "Trip".into(), host: None, path_prefix: None, title_contains: Some("kyoto".into()), enabled: true },
                Rule { id: "b".into(), folder: "Bad".into(), host: None, path_prefix: None, title_contains: None, enabled: true },
            ],
        };
        assert_eq!(f.suggest("https://x.org/", "Best Kyoto Cafes").as_deref(), Some("Trip"));
        assert_eq!(f.suggest("https://x.org/", "other"), None, "a rule without conditions never matches");
    }
}
