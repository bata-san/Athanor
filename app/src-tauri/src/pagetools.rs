//! Page-level tools that do not depend on the engine: zoom steps, per-site zoom keys, the find-in-page script.

use serde_json::json;

/// The zoom ladder (the same steps Chromium browsers use).
pub const ZOOM_STEPS: [f64; 17] = [
    0.25, 0.33, 0.5, 0.67, 0.75, 0.8, 0.9, 1.0, 1.1, 1.25, 1.5, 1.75, 2.0, 2.5, 3.0, 4.0, 5.0,
];

/// Next zoom factor on the ladder from `current`; `dir` > 0 zooms in, < 0 out, 0 resets.
pub fn zoom_step(current: f64, dir: i32) -> f64 {
    if dir == 0 {
        return 1.0;
    }
    if dir > 0 {
        ZOOM_STEPS
            .iter()
            .copied()
            .find(|s| *s > current + 0.005)
            .unwrap_or(ZOOM_STEPS[ZOOM_STEPS.len() - 1])
    } else {
        ZOOM_STEPS
            .iter()
            .rev()
            .copied()
            .find(|s| *s < current - 0.005)
            .unwrap_or(ZOOM_STEPS[0])
    }
}

/// Zoom is remembered per host; Athanor's own pages and non-web URLs have none.
pub fn zoom_key(url: &str) -> Option<String> {
    let parsed = url::Url::parse(url).ok()?;
    if !matches!(parsed.scheme(), "http" | "https") {
        return None;
    }
    parsed
        .host_str()
        .map(|h| h.trim_start_matches("www.").to_ascii_lowercase())
}

/// `Network.getCookies` result -> params for `Network.setCookies` (only the fields a new view needs). `None` when empty.
pub fn cookie_params(getcookies_json: &str) -> Option<String> {
    let value: serde_json::Value = serde_json::from_str(getcookies_json).ok()?;
    let cookies: Vec<serde_json::Value> = value
        .get("cookies")?
        .as_array()?
        .iter()
        .filter_map(|c| {
            let mut out = serde_json::Map::new();
            for key in [
                "name", "value", "domain", "path", "secure", "httpOnly", "sameSite", "priority",
            ] {
                if let Some(v) = c.get(key) {
                    out.insert(key.to_owned(), v.clone());
                }
            }
            let session = c.get("session").and_then(|v| v.as_bool()).unwrap_or(false);
            if !session {
                if let Some(exp) = c
                    .get("expires")
                    .filter(|v| v.as_f64().is_some_and(|e| e > 0.0))
                {
                    out.insert("expires".into(), exp.clone());
                }
            }
            (out.contains_key("name") && out.contains_key("domain"))
                .then_some(serde_json::Value::Object(out))
        })
        .collect();
    (!cookies.is_empty()).then(|| json!({ "cookies": cookies }).to_string())
}

/// `scheme://host[:port]` of a permission request's page, lower-cased; the whole text when it is not a URL.
pub fn permission_host(origin: &str) -> String {
    match url::Url::parse(origin) {
        Ok(u) => {
            let host = u.host_str().unwrap_or(origin).trim_start_matches("www.");
            match u.port() {
                Some(port) => format!("{host}:{port}"),
                None => host.to_owned(),
            }
        }
        Err(_) => origin.to_owned(),
    }
}

/// Key under which the answer to a permission prompt is remembered.
pub fn permission_key(origin: &str, kind: &str) -> String {
    let origin = url::Url::parse(origin)
        .ok()
        .map(|u| u.origin().ascii_serialization())
        .unwrap_or_else(|| origin.to_owned());
    format!("{}|{}", origin.to_ascii_lowercase(), kind)
}

/// The script that runs one find-in-page action (`start`, `next`, `prev`, `clear`) in the page.
pub fn find_script(action: &str, query: &str, match_case: bool) -> String {
    let args = json!({ "action": action, "q": query, "cs": match_case });
    format!("({})({})", include_str!("../assets/find.js"), args)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn zoom_walks_the_ladder_and_stops_at_the_ends() {
        assert_eq!(zoom_step(1.0, 1), 1.1);
        assert_eq!(zoom_step(1.0, -1), 0.9);
        assert_eq!(
            zoom_step(1.37, 1),
            1.5,
            "off-ladder values snap to the next step"
        );
        assert_eq!(zoom_step(1.37, -1), 1.25);
        assert_eq!(zoom_step(5.0, 1), 5.0);
        assert_eq!(zoom_step(0.25, -1), 0.25);
        assert_eq!(zoom_step(3.0, 0), 1.0);
    }

    #[test]
    fn zoom_is_keyed_by_host_without_www() {
        assert_eq!(
            zoom_key("https://www.Example.com/a?b=1").as_deref(),
            Some("example.com")
        );
        assert_eq!(
            zoom_key("http://localhost:8080/").as_deref(),
            Some("localhost")
        );
        assert_eq!(zoom_key("athanor://settings"), None);
        assert_eq!(zoom_key("about:blank"), None);
    }

    #[test]
    fn permission_answers_are_keyed_by_origin_and_kind() {
        assert_eq!(
            permission_key("https://Meet.example.com/room/1?x=2", "camera"),
            "https://meet.example.com|camera"
        );
        assert_eq!(permission_host("https://www.example.com/a"), "example.com");
        assert_eq!(permission_host("http://localhost:8080/"), "localhost:8080");
        assert_ne!(
            permission_key("https://a.test/", "camera"),
            permission_key("https://a.test/", "microphone")
        );
    }

    #[test]
    fn cookies_are_carried_over_without_the_extras() {
        let got = r#"{"cookies":[{"name":"sid","value":"abc","domain":".example.com","path":"/","expires":1900000000,"size":6,"httpOnly":true,"secure":true,"session":false,"sameSite":"Lax","priority":"Medium","sourcePort":443},{"name":"tmp","value":"1","domain":"example.com","path":"/","expires":-1,"session":true}]}"#;
        let params: serde_json::Value = serde_json::from_str(&cookie_params(got).unwrap()).unwrap();
        let list = params["cookies"].as_array().unwrap();
        assert_eq!(list.len(), 2);
        assert_eq!(list[0]["expires"], 1900000000);
        assert!(list[0].get("size").is_none() && list[0].get("sourcePort").is_none());
        assert!(
            list[1].get("expires").is_none(),
            "session cookies stay session cookies"
        );
        assert!(cookie_params(r#"{"cookies":[]}"#).is_none());
        assert!(cookie_params("not json").is_none());
    }

    #[test]
    fn find_script_embeds_escaped_arguments() {
        let script = find_script("start", "he said \"hi\"\n", true);
        assert!(script.contains("Athanor find-in-page"));
        assert!(script.contains(r#""q":"he said \"hi\"\n""#));
        assert!(script.contains(r#""cs":true"#));
    }
}
