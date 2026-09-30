//! Chrome-style URL match patterns for page contributions.

use url::Url;

/// A parsed URL match pattern. `*` schemes match HTTP and HTTPS only.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct MatchPattern {
    scheme: String,
    host: String,
    path: String,
    all_urls: bool,
}

impl MatchPattern {
    /// Parse `<all_urls>` or `scheme://host/path` with Chrome-style wildcards.
    pub fn parse(input: &str) -> Result<Self, String> {
        if input == "<all_urls>" {
            return Ok(Self {
                scheme: String::new(),
                host: String::new(),
                path: String::new(),
                all_urls: true,
            });
        }
        let (scheme, rest) = input.split_once("://").ok_or("missing ://")?;
        if !matches!(scheme, "http" | "https" | "*") {
            return Err("scheme must be http, https, or *".into());
        }
        let (host, path) = rest.split_once('/').ok_or("missing path")?;
        if host.is_empty() || host.contains([':', '\\', '/', '?', '#']) {
            return Err("invalid host".into());
        }
        let bare = host.strip_prefix("*.").unwrap_or(host);
        if bare != "*"
            && (bare.is_empty()
                || bare.contains('*')
                || bare.split('.').any(|part| {
                    part.is_empty() || !part.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-')
                }))
        {
            return Err("invalid host wildcard or label".into());
        }
        if path.contains(['#', '\\', '\n', '\r']) {
            return Err("invalid path".into());
        }
        Ok(Self {
            scheme: scheme.into(),
            host: host.to_ascii_lowercase(),
            path: format!("/{path}"),
            all_urls: false,
        })
    }

    /// Whether this pattern matches a URL. Fragments are ignored; query strings are part of the path glob.
    pub fn matches(&self, url: &Url) -> bool {
        if self.all_urls {
            return matches!(url.scheme(), "http" | "https" | "file" | "ftp");
        }
        if (self.scheme != "*" && self.scheme != url.scheme())
            || (self.scheme == "*" && !matches!(url.scheme(), "http" | "https"))
        {
            return false;
        }
        let Some(host) = url.host_str() else {
            return false;
        };
        let host = host.to_ascii_lowercase();
        let host_match = if self.host == "*" {
            true
        } else if let Some(suffix) = self.host.strip_prefix("*.") {
            host == suffix || host.ends_with(&format!(".{suffix}"))
        } else {
            host == self.host
        };
        if !host_match {
            return false;
        }
        let mut path = url.path().to_owned();
        if let Some(query) = url.query() {
            path.push('?');
            path.push_str(query);
        }
        glob_matches(&self.path, &path)
    }
}

fn glob_matches(pattern: &str, text: &str) -> bool {
    let (mut p, mut t, mut star, mut after_star) = (0, 0, None, 0);
    let pbytes = pattern.as_bytes();
    let tbytes = text.as_bytes();
    while t < tbytes.len() {
        if p < pbytes.len() && pbytes[p] == tbytes[t] {
            p += 1;
            t += 1;
        } else if p < pbytes.len() && pbytes[p] == b'*' {
            star = Some(p);
            p += 1;
            after_star = t;
        } else if let Some(s) = star {
            p = s + 1;
            after_star += 1;
            t = after_star;
        } else {
            return false;
        }
    }
    pbytes[p..].iter().all(|b| *b == b'*')
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn patterns() {
        let cases = [
            (
                "*://*.example.com/path/*",
                "https://a.example.com/path/x",
                true,
            ),
            ("*://*.example.com/path/*", "http://example.com/path/", true),
            (
                "*://*.example.com/path/*",
                "https://badexample.com/path/x",
                false,
            ),
            ("https://example.com/a*b", "https://example.com/axxb", true),
            ("http://*/x", "https://example.com/x", false),
            ("<all_urls>", "file:///hello", true),
            ("<all_urls>", "about:blank", false),
        ];
        for (p, u, expected) in cases {
            assert_eq!(
                MatchPattern::parse(p)
                    .unwrap()
                    .matches(&Url::parse(u).unwrap()),
                expected,
                "{p} {u}"
            );
        }
        for bad in [
            "",
            "ftp://x/*",
            "https://x",
            "https:///*",
            "https://foo*bar/*",
            "https://x:99/*",
            "https://x/a\\b",
            "*://x/#a",
        ] {
            assert!(MatchPattern::parse(bad).is_err(), "{bad}");
        }
    }
}
