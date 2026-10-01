//! What pages are told about the browser. WebView2 reports itself as Microsoft Edge (`Edg/` in the user agent,
//! "Microsoft Edge" in the client-hint brands); Athanor presents itself as plain Chromium plus its own name.

use serde_json::json;

/// The user agent with the Edge token removed (`... Safari/537.36 Edg/139.0.0.0` -> `... Safari/537.36`).
pub fn clean_user_agent(ua: &str) -> String {
    ua.split(' ')
        .filter(|part| {
            !part.starts_with("Edg/") && !part.starts_with("EdgA/") && !part.starts_with("EdgiOS/")
        })
        .collect::<Vec<_>>()
        .join(" ")
}

/// The major version in `Chrome/139.0.6943.54`, and the full version.
fn chrome_version(ua: &str) -> Option<(String, String)> {
    let full = ua.split("Chrome/").nth(1)?.split(' ').next()?;
    let major = full.split('.').next()?;
    (!major.is_empty() && major.chars().all(|c| c.is_ascii_digit()))
        .then(|| (major.to_owned(), full.to_owned()))
}

/// Parameters for the DevTools call `Emulation.setUserAgentOverride` that replaces the Edge identity: the user agent
/// string and the `Sec-CH-UA*` brands (Chromium + Athanor). `None` when the user agent has no Chrome version to build on.
pub fn user_agent_override(default_ua: &str, app_version: &str) -> Option<String> {
    let (major, full) = chrome_version(default_ua)?;
    let brands = json!([
        { "brand": "Chromium", "version": major },
        { "brand": "Athanor", "version": app_version.split('.').next().unwrap_or("0") },
        { "brand": "Not.A/Brand", "version": "99" },
    ]);
    let full_list = json!([
        { "brand": "Chromium", "version": full },
        { "brand": "Athanor", "version": app_version },
        { "brand": "Not.A/Brand", "version": "99.0.0.0" },
    ]);
    Some(
        json!({
            "userAgent": clean_user_agent(default_ua),
            "userAgentMetadata": {
                "brands": brands,
                "fullVersionList": full_list,
                "fullVersion": full,
                "platform": "Windows",
                "platformVersion": "10.0.0",
                "architecture": "x86",
                "bitness": "64",
                "model": "",
                "mobile": false,
                "wow64": false,
            },
        })
        .to_string(),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    const EDGE: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36 Edg/139.0.0.0";

    #[test]
    fn the_edge_token_is_removed_and_nothing_else() {
        let clean = clean_user_agent(EDGE);
        assert_eq!(clean, "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36");
        assert!(!clean.contains("Edg"));
    }

    #[test]
    fn brands_are_chromium_and_athanor() {
        let params: serde_json::Value =
            serde_json::from_str(&user_agent_override(EDGE, "0.1.2").unwrap()).unwrap();
        let brands = params["userAgentMetadata"]["brands"].to_string();
        assert!(
            brands.contains("Chromium") && brands.contains("Athanor") && !brands.contains("Edge")
        );
        assert_eq!(params["userAgentMetadata"]["fullVersion"], "139.0.0.0");
        assert!(!params["userAgent"].as_str().unwrap().contains("Edg/"));
    }

    #[test]
    fn an_unrecognised_user_agent_is_left_alone() {
        assert!(user_agent_override("SomethingElse/1.0", "0.1.2").is_none());
    }
}
