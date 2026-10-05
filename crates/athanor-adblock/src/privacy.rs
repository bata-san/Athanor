//! Small, network-independent privacy URL transformations.

use std::net::IpAddr;
use url::Url;

/// Signed asset URLs and identity/challenge flows must retain their original query and request context.
pub fn is_sensitive_navigation(input: &str) -> bool {
    let Ok(url) = Url::parse(input) else {
        return false;
    };
    url.path().contains("/cdn-cgi/")
        || url.query_pairs().any(|(key, _)| {
            let key = key.to_ascii_lowercase();
            key.starts_with("x-amz-")
                || key.starts_with("x-goog-")
                || key.starts_with("__cf_chl")
                || matches!(
                    key.as_str(),
                    "signature"
                        | "sig"
                        | "policy"
                        | "key-pair-id"
                        | "oauth_token"
                        | "code"
                        | "state"
                        | "samlrequest"
                        | "samlresponse"
                )
        })
}

/// Remove known tracking query parameters, preserving every other raw parameter and its order.
pub fn strip_tracking_params(input: &str) -> Option<String> {
    if is_sensitive_navigation(input) {
        return None;
    }
    let (before_fragment, fragment) = input
        .split_once('#')
        .map_or((input, ""), |(a, _)| (a, &input[a.len()..]));
    let (base, query) = before_fragment.split_once('?')?;
    let mut kept = Vec::new();
    let mut changed = false;
    for pair in query.split('&') {
        let key = pair
            .split_once('=')
            .map_or(pair, |(key, _)| key)
            .to_ascii_lowercase();
        if key.starts_with("utm_")
            || matches!(
                key.as_str(),
                "fbclid"
                    | "gclid"
                    | "dclid"
                    | "msclkid"
                    | "mc_eid"
                    | "igshid"
                    | "yclid"
                    | "twclid"
                    | "_hsenc"
                    | "_hsmi"
                    | "vero_id"
                    | "ref_src"
                    | "gbraid"
                    | "wbraid"
                    | "srsltid"
            )
        {
            changed = true;
        } else {
            kept.push(pair);
        }
    }
    changed.then(|| {
        format!(
            "{base}{}{fragment}",
            if kept.is_empty() {
                String::new()
            } else {
                format!("?{}", kept.join("&"))
            }
        )
    })
}

/// Upgrade a public hostname's HTTP URL to HTTPS; local and IP hosts are excluded.
pub fn upgrade_https(input: &str) -> Option<String> {
    let parsed = Url::parse(input).ok()?;
    if parsed.scheme() != "http" {
        return None;
    }
    let host = parsed
        .host_str()?
        .trim_matches(['[', ']'])
        .to_ascii_lowercase();
    // An explicit port other than 80 means a specific service (dev server, router UI, ...) that almost
    // never speaks TLS on that port; upgrading would just break it.
    if parsed.port().is_some_and(|p| p != 80) {
        return None;
    }
    if host == "localhost"
        || host.ends_with(".localhost")
        || host.ends_with(".local")
        || host.ends_with(".test")
        || host.parse::<IpAddr>().is_ok()
    {
        return None;
    }
    // `Url` drops the default port, so an explicit `:80` does not turn into `https://host:80`.
    let mut upgraded = parsed;
    upgraded.set_scheme("https").ok()?;
    Some(upgraded.to_string())
}

/// Unwrap a small allowlisted set of well-known tracker redirect endpoints.
/// Targets are accepted only as absolute HTTP(S) URLs.
pub fn unwrap_tracker_redirect(input: &str) -> Option<String> {
    let parsed = Url::parse(input).ok()?;
    let host = parsed.host_str()?.to_ascii_lowercase();
    const REDIRECTS: &[(&str, bool, &str, &[&str])] = &[
        ("l.facebook.com", false, "/l.php", &["u"]),
        ("google.com", true, "/url", &["q", "url"]),
        ("out.reddit.com", false, "", &["url"]),
    ];
    if let Some((_, _, _, parameters)) =
        REDIRECTS.iter().find(|(rule_host, subdomains, path, _)| {
            let host_matches =
                host == *rule_host || (*subdomains && host.ends_with(&format!(".{rule_host}")));
            host_matches && (path.is_empty() || parsed.path() == *path)
        })
    {
        let target = parsed.query_pairs().find_map(|(key, value)| {
            parameters
                .contains(&key.as_ref())
                .then(|| value.into_owned())
        })?;
        return safe_redirect_target(&target);
    }
    if host == "href.li" {
        if let Some(target) = parsed.path().strip_prefix("/https://") {
            return safe_redirect_target(&format!("https://{target}"));
        }
        if let Some(target) = parsed.query().filter(|query| query.starts_with("https://")) {
            return safe_redirect_target(target);
        }
    }
    None
}

fn safe_redirect_target(target: &str) -> Option<String> {
    let url = Url::parse(target).ok()?;
    matches!(url.scheme(), "http" | "https").then(|| url.into())
}

#[cfg(test)]
mod tests {
    #[test]
    fn explicit_ports_are_never_upgraded() {
        assert_eq!(upgrade_https("http://example.com:8099/app"), None);
        assert_eq!(
            upgrade_https("http://example.com:80/app").as_deref(),
            Some("https://example.com/app")
        );
        assert_eq!(
            upgrade_https("http://example.com/app").as_deref(),
            Some("https://example.com/app")
        );
    }

    use super::*;
    #[test]
    fn tracking() {
        assert_eq!(
            strip_tracking_params("https://x.test/?a=1&utm_source=z&b=2#f").as_deref(),
            Some("https://x.test/?a=1&b=2#f")
        );
        assert_eq!(strip_tracking_params("https://x.test/?a=1"), None);
    }
    #[test]
    fn upgrade() {
        assert_eq!(
            upgrade_https("http://example.com/x").as_deref(),
            Some("https://example.com/x")
        );
        assert!(upgrade_https("http://127.0.0.1/x").is_none());
        assert!(upgrade_https("http://foo.local/x").is_none());
    }
    #[test]
    fn unwraps_only_allowlisted_tracker_redirects() {
        assert_eq!(
            unwrap_tracker_redirect(
                "https://l.facebook.com/l.php?u=https%3A%2F%2Fexample.com%2Fa%3Fx%3D1"
            )
            .as_deref(),
            Some("https://example.com/a?x=1")
        );
        assert_eq!(
            unwrap_tracker_redirect("https://www.google.com/url?q=https%3A%2F%2Fexample.net%2F")
                .as_deref(),
            Some("https://example.net/")
        );
        assert_eq!(
            unwrap_tracker_redirect("https://out.reddit.com/?url=https%3A%2F%2Fexample.org%2F")
                .as_deref(),
            Some("https://example.org/")
        );
        assert_eq!(
            unwrap_tracker_redirect("https://href.li/?https://example.org/path").as_deref(),
            Some("https://example.org/path")
        );
        assert_eq!(
            unwrap_tracker_redirect("https://l.facebook.com/l.php?u=javascript%3Aalert(1)"),
            None
        );
        assert_eq!(
            unwrap_tracker_redirect("https://example.com/url?q=https%3A%2F%2Fsafe.test/"),
            None
        );
    }
}
