//! Read-only look at what would be importable on this machine: `cargo run -p athanor-import --example probe`.
use athanor_import::{count_folders, count_links, detect, read_bookmarks, read_history};

fn main() {
    for browser in detect() {
        println!("{} ({})", browser.name, browser.id);
        for profile in &browser.profiles {
            let bookmarks = read_bookmarks(browser.engine, profile)
                .map(|t| format!("{} links in {} folders", count_links(&t), count_folders(&t)))
                .unwrap_or_else(|e| format!("error: {e}"));
            let history = read_history(browser.engine, profile, 20_000)
                .map(|h| format!("{} entries", h.len()))
                .unwrap_or_else(|e| format!("error: {e}"));
            println!(
                "  {} [{}]: bookmarks {bookmarks}; history {history}",
                profile.name, profile.id
            );
        }
    }
}
