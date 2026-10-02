//! Do the default lists block CAPTCHA widgets? `cargo run --release -p athanor-adblock --example captcha_check`
use athanor_adblock::{Blocker, Decision, Request, ResourceType};

fn main() {
    let dir = std::env::temp_dir().join("athanor-adblock-live");
    let blocker = Blocker::new(&dir);
    blocker.update_lists(false);
    let b = Blocker::new(&dir);
    b.load();
    let page = "https://www.example-shop.com/login";
    for (url, kind) in [
        (
            "https://www.google.com/recaptcha/api.js",
            ResourceType::Script,
        ),
        (
            "https://www.google.com/recaptcha/enterprise.js",
            ResourceType::Script,
        ),
        (
            "https://www.google.com/recaptcha/api2/anchor?ar=1&k=x",
            ResourceType::Subdocument,
        ),
        (
            "https://www.gstatic.com/recaptcha/releases/x/recaptcha__en.js",
            ResourceType::Script,
        ),
        (
            "https://www.recaptcha.net/recaptcha/api.js",
            ResourceType::Script,
        ),
        ("https://hcaptcha.com/1/api.js", ResourceType::Script),
        (
            "https://challenges.cloudflare.com/turnstile/v0/api.js",
            ResourceType::Script,
        ),
    ] {
        let d = b.check(&Request {
            url,
            source_url: page,
            resource_type: kind,
        });
        println!(
            "{:<6} {url}",
            if matches!(d, Decision::Allow | Decision::Rewrite(_)) {
                "allow"
            } else {
                "BLOCK"
            }
        );
    }
}
