//! Lightweight visit history used for omnibox suggestions. Bounded, JSON-persisted by the caller.

use crate::Millis;
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Entry {
    pub url: String,
    pub title: String,
    pub visits: u32,
    pub last: Millis,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct History {
    entries: Vec<Entry>,
    cap: usize,
}

impl Default for History {
    fn default() -> Self {
        Self { entries: vec![], cap: 3000 }
    }
}

impl History {
    /// Record a visit. Only http(s) pages are kept; the fragment is ignored for identity.
    pub fn record(&mut self, url: &str, title: &str, now: Millis) {
        if !(url.starts_with("http://") || url.starts_with("https://")) {
            return;
        }
        let key = url.split('#').next().unwrap_or(url);
        if let Some(e) = self.entries.iter_mut().find(|e| e.url == key) {
            e.last = now;
            if !title.is_empty() {
                e.title = title.to_string();
            }
            return;
        }
        self.entries.push(Entry { url: key.to_string(), title: title.to_string(), visits: 1, last: now });
        if self.entries.len() > self.cap {
            // drop the stalest, least visited entry
            if let Some(i) = self
                .entries
                .iter()
                .enumerate()
                .min_by_key(|(_, e)| (e.visits.min(5), e.last))
                .map(|(i, _)| i)
            {
                self.entries.swap_remove(i);
            }
        }
    }

    /// Count a repeat visit (call when a page finishes loading again).
    pub fn bump(&mut self, url: &str) {
        let key = url.split('#').next().unwrap_or(url);
        if let Some(e) = self.entries.iter_mut().find(|e| e.url == key) {
            e.visits = e.visits.saturating_add(1);
        }
    }

    pub fn set_title(&mut self, url: &str, title: &str) {
        let key = url.split('#').next().unwrap_or(url);
        if let Some(e) = self.entries.iter_mut().find(|e| e.url == key) {
            e.title = title.to_string();
        }
    }

    /// Entries whose url/title contain every whitespace-separated term, best first.
    pub fn search(&self, query: &str, limit: usize, now: Millis) -> Vec<&Entry> {
        let terms: Vec<String> = query.split_whitespace().map(str::to_lowercase).collect();
        if terms.is_empty() {
            return vec![];
        }
        let mut scored: Vec<(f64, &Entry)> = self
            .entries
            .iter()
            .filter_map(|e| {
                let url = e.url.to_lowercase();
                let title = e.title.to_lowercase();
                if !terms.iter().all(|t| url.contains(t.as_str()) || title.contains(t.as_str())) {
                    return None;
                }
                let host_prefix = url.split("://").nth(1).unwrap_or(&url).trim_start_matches("www.");
                let prefix = terms.iter().any(|t| host_prefix.starts_with(t.as_str()));
                let age_days = now.saturating_sub(e.last) as f64 / 86_400_000.0;
                let score = f64::from(e.visits).ln_1p() * 2.0 + if prefix { 3.0 } else { 0.0 } + 2.0 / (1.0 + age_days);
                Some((score, e))
            })
            .collect();
        scored.sort_by(|a, b| b.0.total_cmp(&a.0));
        scored.into_iter().take(limit).map(|(_, e)| e).collect()
    }

    pub fn clear(&mut self) {
        self.entries.clear();
    }

    pub fn len(&self) -> usize {
        self.entries.len()
    }

    pub fn is_empty(&self) -> bool {
        self.entries.is_empty()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn records_dedupes_and_ignores_internal() {
        let mut h = History::default();
        h.record("https://a.test/x#frag", "A", 1);
        h.record("https://a.test/x#other", "A2", 2);
        h.record("athanor://newtab", "", 3);
        assert_eq!(h.len(), 1);
        h.bump("https://a.test/x");
        assert_eq!(h.search("a2", 5, 10)[0].visits, 2);
    }

    #[test]
    fn search_requires_all_terms_and_prefers_frequent() {
        let mut h = History::default();
        h.record("https://docs.rs/serde", "serde - Rust", 1);
        h.record("https://docs.rs/tokio", "tokio - Rust", 1);
        for _ in 0..5 {
            h.bump("https://docs.rs/tokio");
        }
        let r = h.search("rust docs", 5, 2);
        assert_eq!(r.len(), 2);
        assert_eq!(r[0].url, "https://docs.rs/tokio");
        assert!(h.search("nothing here", 5, 2).is_empty());
        assert!(h.search("   ", 5, 2).is_empty());
    }

    #[test]
    fn cap_evicts_stale_low_visit_entries() {
        let mut h = History { entries: vec![], cap: 3 };
        for i in 0..5u64 {
            h.record(&format!("https://e{i}.test/"), "", i);
        }
        assert_eq!(h.len(), 3);
    }
}
