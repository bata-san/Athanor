//! Omnibox input resolution and URL helpers.

use percent_encoding::{utf8_percent_encode, NON_ALPHANUMERIC};
use url::Url;

pub const NEW_TAB_URL: &str = "athanor://newtab";

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Resolved {
    /// Navigate directly to this URL.
    Url(String),
    /// Treated as a search; carries the final search URL.
    Search(String),
}

impl Resolved {
    pub fn into_url(self) -> String {
        match self {
            Resolved::Url(u) | Resolved::Search(u) => u,
        }
    }
}

/// Turn whatever the user typed into a URL. `search` is a template containing `{q}`.
pub fn resolve_input(input: &str, search: &str) -> Resolved {
    let s = input.trim();
    if s.is_empty() {
        return Resolved::Url(NEW_TAB_URL.into());
    }
    let lower = s.to_ascii_lowercase();
    // Script / data URLs typed into the omnibox are never navigated to; they become searches.
    let blocked = lower.starts_with("javascript:") || lower.starts_with("data:") || lower.starts_with("vbscript:");
    if !blocked {
        if lower.starts_with("athanor://") || lower.starts_with("about:") {
            return Resolved::Url(s.to_string());
        }
        if let Ok(u) = Url::parse(s) {
            if matches!(u.scheme(), "http" | "https" | "file" | "ftp") && u.has_host() || u.scheme() == "file" {
                return Resolved::Url(u.to_string());
            }
        }
        if !s.contains(char::is_whitespace) && looks_like_host(s) {
            let scheme = if is_local_host(host_of(s)) { "http" } else { "https" };
            if let Ok(u) = Url::parse(&format!("{scheme}://{s}")) {
                return Resolved::Url(u.to_string());
            }
        }
    }
    Resolved::Search(search.replace("{q}", &utf8_percent_encode(s, NON_ALPHANUMERIC).to_string()))
}

fn host_of(s: &str) -> &str {
    let s = s.split(['/', '?', '#']).next().unwrap_or(s);
    if s.starts_with('[') {
        return s.split(']').next().map(|h| &s[..h.len() + 1]).unwrap_or(s);
    }
    s.rsplit_once(':').filter(|(_, p)| p.chars().all(|c| c.is_ascii_digit())).map_or(s, |(h, _)| h)
}

fn looks_like_host(s: &str) -> bool {
    let host = host_of(s);
    if host.is_empty() {
        return false;
    }
    if host.eq_ignore_ascii_case("localhost") || host.starts_with('[') {
        return true;
    }
    // dotted, no empty labels, last label alphabetic (TLD) or an IPv4 literal
    let labels: Vec<&str> = host.split('.').collect();
    if labels.len() < 2 || labels.iter().any(|l| l.is_empty()) {
        return false;
    }
    let valid = |l: &&str| l.chars().all(|c| c.is_alphanumeric() || c == '-');
    labels.iter().all(valid)
        && (host.parse::<std::net::Ipv4Addr>().is_ok() || labels.last().is_some_and(|t| t.len() >= 2 && t.chars().all(|c| c.is_alphabetic())))
}

/// Hosts that should default to plain http and never be filtered/upgraded.
pub fn is_local_host(host: &str) -> bool {
    let h = host.trim_matches(['[', ']']).to_ascii_lowercase();
    h == "localhost"
        || h.ends_with(".localhost")
        || h.ends_with(".local")
        || h.ends_with(".test")
        || h.parse::<std::net::IpAddr>().is_ok_and(|ip| match ip {
            std::net::IpAddr::V4(v4) => v4.is_loopback() || v4.is_private() || v4.is_link_local() || v4.is_unspecified(),
            std::net::IpAddr::V6(v6) => v6.is_loopback() || v6.is_unspecified(),
        })
}

/// Host part for display in tabs / omnibox, without `www.`.
pub fn display_host(url: &str) -> String {
    Url::parse(url)
        .ok()
        .and_then(|u| u.host_str().map(|h| h.trim_start_matches("www.").to_string()))
        .unwrap_or_else(|| url.to_string())
}

pub fn is_internal(url: &str) -> bool {
    url.starts_with("athanor://")
}

pub fn is_secure(url: &str) -> bool {
    url.starts_with("https://") || url.starts_with("athanor://")
}

#[cfg(test)]
mod tests {
    use super::*;

    const S: &str = "https://duckduckgo.com/?q={q}";

    fn r(i: &str) -> Resolved {
        resolve_input(i, S)
    }

    #[test]
    fn urls_hosts_and_searches() {
        assert_eq!(r("https://example.com/a b"), Resolved::Url("https://example.com/a%20b".into()));
        assert_eq!(r("example.com"), Resolved::Url("https://example.com/".into()));
        assert_eq!(r("sub.example.co.jp/path?x=1"), Resolved::Url("https://sub.example.co.jp/path?x=1".into()));
        assert_eq!(r("localhost:5173"), Resolved::Url("http://localhost:5173/".into()));
        assert_eq!(r("192.168.0.1:8080/x"), Resolved::Url("http://192.168.0.1:8080/x".into()));
        assert_eq!(r("athanor://settings"), Resolved::Url("athanor://settings".into()));
        assert_eq!(r(""), Resolved::Url(NEW_TAB_URL.into()));
        assert_eq!(r("rust lifetimes"), Resolved::Search("https://duckduckgo.com/?q=rust%20lifetimes".into()));
        assert_eq!(r("hello"), Resolved::Search("https://duckduckgo.com/?q=hello".into()));
        assert_eq!(r("file.txt is here"), Resolved::Search("https://duckduckgo.com/?q=file%2Etxt%20is%20here".into()));
    }

    #[test]
    fn dangerous_schemes_become_searches() {
        assert!(matches!(r("javascript:alert(1)"), Resolved::Search(_)));
        assert!(matches!(r("data:text/html,<b>x"), Resolved::Search(_)));
    }

    #[test]
    fn local_hosts() {
        assert!(is_local_host("localhost"));
        assert!(is_local_host("[::1]"));
        assert!(is_local_host("10.0.0.5"));
        assert!(is_local_host("app.test"));
        assert!(!is_local_host("example.com"));
        assert!(!is_local_host("8.8.8.8"));
    }

    #[test]
    fn display() {
        assert_eq!(display_host("https://www.example.com/x"), "example.com");
        assert!(is_secure("https://a.b"));
        assert!(!is_secure("http://a.b"));
    }
}
