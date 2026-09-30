//! Downloads the real default lists and reports what the engine does with them.
//! Run: `cargo run --release -p athanor-adblock --example live_check`

use athanor_adblock::{Blocker, Decision, Request, ResourceType};
use std::time::Instant;

fn main() {
    let dir = std::env::temp_dir().join("athanor-adblock-live");
    let _ = std::fs::remove_dir_all(&dir);
    let blocker = Blocker::new(&dir);

    let t = Instant::now();
    let reports = blocker.update_lists(true);
    println!("update_lists: {:?}", t.elapsed());
    for r in &reports {
        println!("  {:<18} changed={:<5} error={:?}", r.id, r.changed, r.error);
    }

    let fresh = Blocker::new(&dir);
    let t = Instant::now();
    let how = fresh.load();
    println!("load (cold start from disk): {:?} via {how:?}", t.elapsed());
    let size = std::fs::metadata(dir.join("engine.dat")).map(|m| m.len()).unwrap_or(0);
    println!("compiled cache: {:.1} MiB", size as f64 / 1_048_576.0);
    let total: usize = fresh.lists().iter().map(|l| l.rule_count).sum();
    println!("rule lines loaded: {total}");

    let page = "https://www.example-news.com/article";
    let cases = [
        ("https://securepubads.g.doubleclick.net/tag/js/gpt.js", ResourceType::Script, true),
        ("https://www.google-analytics.com/analytics.js", ResourceType::Script, true),
        ("https://connect.facebook.net/en_US/fbevents.js", ResourceType::Script, true),
        ("https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js", ResourceType::Script, true),
        ("https://cdn.example-news.com/app.js", ResourceType::Script, false),
        ("https://fonts.gstatic.com/s/roboto/v30/x.woff2", ResourceType::Font, false),
    ];
    let mut ok = true;
    for (url, kind, expect_block) in cases {
        let d = fresh.check(&Request { url, source_url: page, resource_type: kind });
        let blocked = !matches!(d, Decision::Allow | Decision::Rewrite(_));
        if blocked != expect_block {
            ok = false;
        }
        println!("  {:<7} expect={:<5} {url}", if blocked { "BLOCK" } else { "allow" }, expect_block);
    }

    let n = 200_000u32;
    let t = Instant::now();
    let mut blocked = 0u32;
    for i in 0..n {
        let url = if i % 4 == 0 { "https://securepubads.g.doubleclick.net/tag/js/gpt.js" } else { "https://cdn.example-news.com/assets/app.js" };
        if !matches!(fresh.check(&Request { url, source_url: page, resource_type: ResourceType::Script }), Decision::Allow) {
            blocked += 1;
        }
    }
    println!("check(): {:.0} ns/request over {n} requests ({blocked} blocked)", t.elapsed().as_nanos() as f64 / f64::from(n));

    let t = Instant::now();
    let c = fresh.cosmetic("https://www.youtube.com/");
    println!("cosmetic(youtube): {:?}, css {} bytes, js {} bytes", t.elapsed(), c.css.len(), c.js.len());
    let t = Instant::now();
    let c = fresh.cosmetic(page);
    println!("cosmetic(generic page): {:?}, css {} bytes", t.elapsed(), c.css.len());

    println!("{}", if ok { "RESULT: ok" } else { "RESULT: unexpected verdicts" });
}
