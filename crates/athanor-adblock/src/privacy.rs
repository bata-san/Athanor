//! Small, network-independent privacy URL transformations.

use std::net::IpAddr;
use url::Url;

/// Remove known tracking query parameters, preserving every other raw parameter and its order.
pub fn strip_tracking_params(input: &str) -> Option<String> {
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
    if host == "localhost"
        || host.ends_with(".localhost")
        || host.ends_with(".local")
        || host.ends_with(".test")
        || host.parse::<IpAddr>().is_ok()
    {
        return None;
    }
    Some(input.replacen("http:", "https:", 1))
}

#[cfg(test)]
mod tests {
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
}
