//! Athanor's own "this page could not be opened" page, shown instead of the WebView2/Edge one.

/// What went wrong, in words a person can act on. `status` is WebView2's `COREWEBVIEW2_WEB_ERROR_STATUS`.
pub fn describe(status: i32) -> (&'static str, &'static str) {
    match status {
        1..=5 => (
            "The connection is not private",
            "The site's security certificate could not be trusted, so Athanor did not open it.",
        ),
        6 | 12 => (
            "Can’t reach this site",
            "The server refused the connection or could not be found. Check the address, then try again.",
        ),
        7 => ("This site took too long to respond", "The server did not answer in time."),
        8 => ("The site sent an invalid response", "The server replied in a way Athanor could not read."),
        9 | 10 => ("The connection was interrupted", "The connection closed before the page finished loading."),
        11 => ("You are offline", "Check your network connection. The page reloads by itself when you are back online."),
        13 => ("Can’t find this site", "The address could not be found. Check it for typing mistakes."),
        15 => ("Too many redirects", "The site keeps sending Athanor from one page to another."),
        17 | 18 => ("Sign-in is required", "The site or your network asked for credentials that were not accepted."),
        _ => (
            "Can’t open this page",
            "The site may be down, or your connection may be offline. Try again in a moment.",
        ),
    }
}

fn html_escape(text: &str) -> String {
    text.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
}

/// The page, as one self-contained HTML string. "Try again" (and coming back online) reloads `url`.
pub fn render(url: &str, status: i32) -> String {
    let (headline, detail) = describe(status);
    let host = url::Url::parse(url)
        .ok()
        .and_then(|u| u.host_str().map(str::to_owned))
        .unwrap_or_else(|| url.to_owned());
    let script_url = serde_json::to_string(url)
        .unwrap_or_else(|_| "\"\"".into())
        .replace('<', "\\u003c");
    format!(
        r#"<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>{headline}</title>
<style>
:root{{color-scheme:light dark;--bg:#fafafa;--fg:#171717;--mute:#737373;--line:#e5e5e5;--btn:#171717;--btnfg:#fafafa}}
@media (prefers-color-scheme:dark){{:root{{--bg:#141414;--fg:#f5f5f5;--mute:#a3a3a3;--line:#2a2a2a;--btn:#f5f5f5;--btnfg:#141414}}}}
*{{box-sizing:border-box}}html,body{{height:100%;margin:0}}
body{{display:grid;place-items:center;background:var(--bg);color:var(--fg);font:15px/1.55 "IBM Plex Sans JP","IBM Plex Sans","Segoe UI",system-ui,sans-serif}}
main{{width:min(30rem,calc(100vw - 3rem));text-align:left}}
svg{{width:34px;height:34px;color:var(--mute)}}
h1{{margin:18px 0 6px;font-size:21px;font-weight:600;letter-spacing:-.01em}}
p{{margin:0 0 8px;color:var(--mute)}}
.host{{display:inline-block;margin:14px 0 22px;padding:3px 9px;border:1px solid var(--line);border-radius:7px;color:var(--fg);font:12.5px "IBM Plex Mono",ui-monospace,Consolas,monospace;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}}
button{{font:inherit;font-weight:500;padding:7px 16px;border:0;border-radius:8px;background:var(--btn);color:var(--btnfg);cursor:pointer}}
button:active{{transform:scale(.97)}}
small{{display:block;margin-top:26px;color:var(--mute);font:11px "IBM Plex Mono",ui-monospace,Consolas,monospace;opacity:.7}}
</style>
<main>
<svg viewBox="0 0 528 528" aria-hidden="true"><g fill="currentColor" stroke="currentColor" stroke-width="140" stroke-linejoin="round"><path d="M70 70H260L70 260Z"/><path d="M268 267H458V457Z"/></g><circle cx="71" cy="448" r="71" fill="currentColor"/></svg>
<h1>{headline}</h1>
<p>{detail}</p>
<span class="host">{host}</span>
<div><button id="retry" autofocus>Try again</button></div>
{code}
</main>
<script>
const target={script_url};
document.getElementById("retry").addEventListener("click",()=>location.replace(target));
addEventListener("online",()=>location.replace(target));
</script></html>"#,
        headline = html_escape(headline),
        detail = html_escape(detail),
        host = html_escape(&host),
        code = if status > 0 {
            format!("<small>Error {status}</small>")
        } else {
            String::new()
        },
        script_url = script_url,
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_page_names_the_site_and_offers_a_retry() {
        let page = render("https://nope.invalid/path?q=1", 13);
        assert!(page.contains("Can’t find this site"));
        assert!(page.contains("nope.invalid"));
        assert!(page.contains("Try again"));
        assert!(page.contains(r#"const target="https://nope.invalid/path?q=1""#));
    }

    #[test]
    fn markup_in_the_address_cannot_break_out() {
        let page = render("https://x.test/</script><script>alert(1)</script>", 6);
        assert!(
            !page.contains("</script><script>alert"),
            "script end tag is escaped"
        );
        assert!(page.contains("\\u003c/script>"));
    }

    #[test]
    fn certificate_problems_do_not_offer_a_way_through() {
        let (headline, _) = describe(2);
        assert!(headline.contains("not private"));
        assert!(!render("https://expired.test/", 2)
            .to_lowercase()
            .contains("proceed"));
    }
}
