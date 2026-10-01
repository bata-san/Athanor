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

/// Oldest entries are dropped once `cap` is exceeded. A file written before `cap` existed
/// deserialises with the default; see [`History::sanitized`] for the bounds a loaded `cap`
/// must be clamped to.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(default)]
pub struct History {
    entries: Vec<Entry>,
    cap: usize,
}

impl Default for History {
    fn default() -> Self {
        Self {
            entries: vec![],
            cap: 3000,
        }
    }
}

impl History {
    /// Clamp a freshly loaded history into sane bounds. Callers should run this right after
    /// deserialising: `cap` comes from a file, and `0` would make [`Self::record`] evict the
    /// entry it just pushed while an enormous cap would grow the file without limit.
    pub fn sanitized(mut self) -> Self {
        self.cap = self.cap.clamp(100, 100_000);
        self
    }

    /// Record a visit. Only http(s) pages are kept; the fragment is ignored for identity.
    /// A revisit of a known page counts as a visit; callers that already counted one
    /// elsewhere should use [`Self::bump`] instead of calling this twice.
    pub fn record(&mut self, url: &str, title: &str, now: Millis) {
        if !(url.starts_with("http://") || url.starts_with("https://")) {
            return;
        }
        let key = url.split('#').next().unwrap_or(url);
        if let Some(e) = self.entries.iter_mut().find(|e| e.url == key) {
            e.visits = e.visits.saturating_add(1);
            e.last = now;
            if !title.is_empty() {
                e.title = title.to_string();
            }
            return;
        }
        self.entries.push(Entry {
            url: key.to_string(),
            title: title.to_string(),
            visits: 1,
            last: now,
        });
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

    /// Merge visits imported from another browser: `(url, title, visits, last_visit)`. Known pages gain the
    /// visits and keep the newest timestamp; unknown ones are added. The cap is raised to `ceiling` first (an
    /// import is far larger than day-to-day browsing), then the least useful entries are dropped to fit.
    /// Returns how many entries were added or updated.
    pub fn import(
        &mut self,
        items: impl IntoIterator<Item = (String, String, u32, Millis)>,
        ceiling: usize,
    ) -> usize {
        self.cap = self.cap.max(ceiling.clamp(100, 100_000));
        let mut index: std::collections::HashMap<String, usize> = self
            .entries
            .iter()
            .enumerate()
            .map(|(i, e)| (e.url.clone(), i))
            .collect();
        let mut changed = 0;
        for (url, title, visits, last) in items {
            if !(url.starts_with("http://") || url.starts_with("https://")) {
                continue;
            }
            let key = url.split('#').next().unwrap_or(&url).to_string();
            match index.get(&key) {
                Some(&i) => {
                    let e = &mut self.entries[i];
                    e.visits = e.visits.saturating_add(visits.max(1));
                    e.last = e.last.max(last);
                    if e.title.is_empty() && !title.is_empty() {
                        e.title = title;
                    }
                }
                None => {
                    index.insert(key.clone(), self.entries.len());
                    self.entries.push(Entry {
                        url: key,
                        title,
                        visits: visits.max(1),
                        last,
                    });
                }
            }
            changed += 1;
        }
        if self.entries.len() > self.cap {
            self.entries
                .sort_by_key(|e| std::cmp::Reverse((e.visits.min(5), e.last)));
            self.entries.truncate(self.cap);
        }
        changed
    }

    /// Count a visit on an existing entry only. For callers that already called
    /// [`Self::record`] for the same page load (and so already counted it) use this; a fresh
    /// [`Self::record`] counts on its own.
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
                if !terms
                    .iter()
                    .all(|t| url.contains(t.as_str()) || title.contains(t.as_str()))
                {
                    return None;
                }
                let host_prefix = url
                    .split("://")
                    .nth(1)
                    .unwrap_or(&url)
                    .trim_start_matches("www.");
                let prefix = terms.iter().any(|t| host_prefix.starts_with(t.as_str()));
                let age_days = now.saturating_sub(e.last) as f64 / 86_400_000.0;
                let score = f64::from(e.visits).ln_1p() * 2.0
                    + if prefix { 3.0 } else { 0.0 }
                    + 2.0 / (1.0 + age_days);
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
    #[test]
    fn import_merges_raises_the_cap_and_trims_by_usefulness() {
        let mut h = History::default();
        h.record("https://a.test/", "A", 10);
        let added = h.import(
            vec![
                ("https://a.test/".into(), "".into(), 4, 99),
                ("https://b.test/#frag".into(), "B".into(), 2, 50),
                ("ftp://x".into(), "x".into(), 1, 1),
            ],
            5_000,
        );
        assert_eq!(added, 2);
        assert_eq!(h.len(), 2);
        let hits = h.search("a.test", 5, 100);
        assert_eq!(hits[0].visits, 5);
        assert_eq!(hits[0].last, 99);
        let mut small = History::default().sanitized();
        let many: Vec<_> = (0..4_000)
            .map(|i| (format!("https://h{i}.test/"), String::new(), 1, i as u64))
            .collect();
        small.import(many, 3_500);
        assert_eq!(small.len(), 3_500, "trimmed to the raised cap, newest kept");
    }

    use super::*;

    #[test]
    fn records_dedupes_and_ignores_internal() {
        let mut h = History::default();
        h.record("https://a.test/x#frag", "A", 1);
        h.record("https://a.test/x#other", "A2", 2);
        h.record("athanor://newtab", "", 3);
        assert_eq!(h.len(), 1);
        // The revisit counted itself; `bump` is for callers that already recorded the visit.
        assert_eq!(h.search("a2", 5, 10)[0].visits, 2);
        h.bump("https://a.test/x");
        assert_eq!(h.search("a2", 5, 10)[0].visits, 3);
        assert_eq!(h.search("a2", 5, 10)[0].last, 2, "the last visit wins");
    }

    #[test]
    fn a_file_without_cap_loads_and_sanitized_clamps_it() {
        let h: History = serde_json::from_str(
            r#"{"entries":[{"url":"https://a.test/","title":"A","visits":1,"last":5}]}"#,
        )
        .unwrap();
        assert_eq!(h.len(), 1);
        assert_eq!(h.cap, 3000, "a missing cap falls back to the default");
        for (raw, want) in [
            (r#"{"entries":[],"cap":0}"#, 100),
            (r#"{"entries":[],"cap":7}"#, 100),
            (r#"{"entries":[],"cap":100}"#, 100),
            (r#"{"entries":[],"cap":4321}"#, 4321),
            (r#"{"entries":[],"cap":100000}"#, 100_000),
            (r#"{"entries":[],"cap":99999999}"#, 100_000),
        ] {
            let h = serde_json::from_str::<History>(raw).unwrap().sanitized();
            assert_eq!(h.cap, want, "{raw}");
        }
    }

    #[test]
    fn a_sanitized_cap_never_evicts_the_entry_it_just_recorded() {
        let mut h = serde_json::from_str::<History>(r#"{"entries":[],"cap":0}"#)
            .unwrap()
            .sanitized();
        for i in 0..3u64 {
            h.record(&format!("https://e{i}.test/"), "", i);
        }
        assert_eq!(h.len(), 3, "a cap of 0 would drop every entry it stored");
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
        // Built directly, so `sanitized`'s lower bound does not apply - this is the eviction
        // rule itself, not the file-format guard.
        let mut h = History {
            entries: vec![],
            cap: 3,
        };
        for i in 0..5u64 {
            h.record(&format!("https://e{i}.test/"), "", i);
        }
        assert_eq!(h.len(), 3);
    }
}
