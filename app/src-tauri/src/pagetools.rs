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
    fn find_script_embeds_escaped_arguments() {
        let script = find_script("start", "he said \"hi\"\n", true);
        assert!(script.contains("Athanor find-in-page"));
        assert!(script.contains(r#""q":"he said \"hi\"\n""#));
        assert!(script.contains(r#""cs":true"#));
    }
}
