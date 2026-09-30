//! Facade between the engine adapters and the content-blocking crate.
//!
//! Adapters (WebView2 on desktop, the Android plugin via JNI) only ever see this small surface, so the
//! blocking implementation can change without touching any engine code.

use athanor_adblock::{privacy, Blocker, Decision, PageContext, Request, ResourceType};
use base64::{engine::general_purpose::STANDARD, Engine as _};
use parking_lot::{Mutex, RwLock};
use serde::Serialize;
use std::{
    collections::{HashMap, HashSet},
    path::PathBuf,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
    time::{SystemTime, UNIX_EPOCH},
};

/// Supplies extra page scripts (extension userscripts) for a URL and phase (0 = start, 1 = end, 2 = idle).
pub type Injector = Arc<dyn Fn(&str, u8) -> Vec<String> + Send + Sync>;

/// Engine-independent request category (mapped by each adapter from its native request info).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Kind {
    Document,
    Subdocument,
    Stylesheet,
    Script,
    Image,
    Font,
    Media,
    Xhr,
    Fetch,
    WebSocket,
    Ping,
    Other,
}

impl From<Kind> for ResourceType {
    fn from(k: Kind) -> Self {
        match k {
            Kind::Document => ResourceType::Document,
            Kind::Subdocument => ResourceType::Subdocument,
            Kind::Stylesheet => ResourceType::Stylesheet,
            Kind::Script => ResourceType::Script,
            Kind::Image => ResourceType::Image,
            Kind::Font => ResourceType::Font,
            Kind::Media => ResourceType::Media,
            Kind::Xhr => ResourceType::Xhr,
            Kind::Fetch => ResourceType::Fetch,
            Kind::WebSocket => ResourceType::WebSocket,
            Kind::Ping => ResourceType::Ping,
            Kind::Other => ResourceType::Other,
        }
    }
}

/// What an adapter should do with a request.
#[derive(Debug, PartialEq, Eq)]
pub enum Verdict {
    Allow,
    /// Cancel / answer with an empty error response.
    Block,
    /// Answer with a neutered stand-in resource (keeps pages that expect the script/pixel working).
    Respond {
        mime: String,
        body: Vec<u8>,
    },
}

/// Detailed verdict used by adapters capable of changing a request URL. `Verdict` remains
/// unchanged for source compatibility with adapters which can only allow, block, or synthesize.
#[derive(Debug, PartialEq, Eq)]
pub enum DetailedVerdict {
    Allow,
    Block,
    Respond { mime: String, body: Vec<u8> },
    Rewrite { url: String },
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct AdblockList {
    pub id: String,
    pub name: String,
    pub enabled: bool,
    pub updated_at: Option<u64>,
    pub rule_count: u64,
    pub error: Option<String>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct AdblockStatus {
    pub enabled: bool,
    pub lists: Vec<AdblockList>,
    pub blocked_total: u64,
    pub updating: bool,
}

const STALE_AFTER_SECS: u64 = 3 * 24 * 3600;

fn now_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |d| d.as_secs())
}

pub struct Filter {
    blocker: Blocker,
    pub https_upgrade: AtomicBool,
    pub strip_tracking: AtomicBool,
    updating: AtomicBool,
    injector: RwLock<Option<Injector>>,
    /// https URL we upgraded to -> the http URL the user asked for (for fallback on failure).
    upgrades: Mutex<HashMap<String, String>>,
    no_upgrade: Mutex<HashSet<String>>,
}

impl Filter {
    pub fn new(data_dir: PathBuf) -> Self {
        Self {
            blocker: Blocker::new(data_dir),
            https_upgrade: AtomicBool::new(true),
            strip_tracking: AtomicBool::new(true),
            updating: AtomicBool::new(false),
            injector: RwLock::new(None),
            upgrades: Mutex::new(HashMap::new()),
            no_upgrade: Mutex::new(HashSet::new()),
        }
    }

    /// Load the compiled rules on a background thread, then refresh stale lists. `notify` fires after each step.
    pub fn start(self: &Arc<Self>, enabled: bool, notify: Arc<dyn Fn() + Send + Sync>) {
        let this = self.clone();
        std::thread::Builder::new()
            .name("adblock-init".into())
            .spawn(move || {
                let report = this.blocker.load();
                log::info!("adblock rules loaded from {report:?}");
                this.blocker.set_enabled(enabled);
                notify();
                let stale = this.blocker.lists().iter().any(|l| {
                    l.enabled
                        && l.updated_at
                            .is_none_or(|t| now_secs().saturating_sub(t) > STALE_AFTER_SECS)
                });
                if stale {
                    this.update_blocking();
                    notify();
                }
            })
            .ok();
    }

    /// Download all enabled lists (blocking) and rebuild the engine.
    pub fn update_blocking(&self) {
        if self.updating.swap(true, Ordering::AcqRel) {
            return;
        }
        for r in self.blocker.update_lists(false) {
            if let Some(e) = r.error {
                log::warn!("adblock list {}: {e}", r.id);
            }
        }
        self.updating.store(false, Ordering::Release);
    }

    pub fn is_updating(&self) -> bool {
        self.updating.load(Ordering::Acquire)
    }

    pub fn rebuild(&self) {
        self.blocker.rebuild();
    }

    /// Verdict for a request. Hot path.
    pub fn verdict(&self, url: &str, source: &str, kind: Kind) -> Verdict {
        match self.verdict_with_rewrite(url, source, kind) {
            DetailedVerdict::Allow | DetailedVerdict::Rewrite { .. } => Verdict::Allow,
            DetailedVerdict::Block => Verdict::Block,
            DetailedVerdict::Respond { mime, body } => Verdict::Respond { mime, body },
        }
    }

    /// Verdict that preserves `$removeparam` rewrites for native adapters that can issue a
    /// redirected request or return a 307 response.
    pub fn verdict_with_rewrite(&self, url: &str, source: &str, kind: Kind) -> DetailedVerdict {
        match self.blocker.check(&Request {
            url,
            source_url: source,
            resource_type: kind.into(),
        }) {
            Decision::Allow => DetailedVerdict::Allow,
            Decision::Rewrite(url) => DetailedVerdict::Rewrite { url },
            Decision::Block { .. } => DetailedVerdict::Block,
            Decision::Redirect { to } => data_url(&to)
                .map_or(DetailedVerdict::Block, |(mime, body)| {
                    DetailedVerdict::Respond { mime, body }
                }),
        }
    }

    /// Parse and cache top-level source information once when a navigation begins.
    pub fn page_context(&self, source_url: &str) -> PageContext {
        self.blocker.page_context(source_url)
    }

    /// Hot-path verdict using the current navigation's parsed source context.
    pub fn verdict_with_page_context(
        &self,
        url: &str,
        page: &PageContext,
        kind: Kind,
    ) -> DetailedVerdict {
        match self.blocker.check_with_page_context(
            &Request {
                url,
                source_url: page.source_url(),
                resource_type: kind.into(),
            },
            page,
        ) {
            Decision::Allow => DetailedVerdict::Allow,
            Decision::Rewrite(url) => DetailedVerdict::Rewrite { url },
            Decision::Block { .. } => DetailedVerdict::Block,
            Decision::Redirect { to } => data_url(&to)
                .map_or(DetailedVerdict::Block, |(mime, body)| {
                    DetailedVerdict::Respond { mime, body }
                }),
        }
    }

    /// Simple yes/no form for adapters that cannot synthesise responses (e.g. the JNI bridge).
    #[cfg_attr(not(mobile), allow(dead_code))]
    pub fn should_block(&self, url: &str, source: &str, kind: Kind) -> bool {
        self.verdict(url, source, kind) != Verdict::Allow
    }

    /// JS to run in the page as early as possible (cosmetic filters + scriptlets).
    pub fn cosmetic_js(&self, page_url: &str) -> Option<String> {
        let c = self.blocker.cosmetic(page_url);
        (!c.js.is_empty()).then_some(c.js)
    }

    /// Match observed DOM classes and IDs against URL-specific generic cosmetic rules.
    pub fn cosmetic_query(
        &self,
        page_url: &str,
        classes: &[String],
        ids: &[String],
        exceptions: &HashSet<String>,
    ) -> Vec<String> {
        self.blocker
            .cosmetic_query(page_url, classes, ids, exceptions)
    }

    pub fn set_injector(&self, injector: Injector) {
        *self.injector.write() = Some(injector);
    }

    /// Everything to evaluate in the page at `phase`: cosmetic filters (start/end) and extension scripts.
    #[cfg_attr(not(mobile), allow(dead_code))]
    pub fn injections(&self, page_url: &str, phase: u8) -> Vec<String> {
        let mut out = Vec::new();
        if phase <= 1 {
            out.extend(self.cosmetic_js(page_url));
        }
        if let Some(inj) = self.injector.read().as_ref() {
            out.extend(inj(page_url, phase));
        }
        out
    }

    /// Extension scripts only. The Windows adapter uses this at DOMContentLoaded and idle;
    /// adblock scriptlets/cosmetics use the document-created registration path.
    pub fn page_script_injections(&self, page_url: &str, phase: u8) -> Vec<String> {
        self.injector
            .read()
            .as_ref()
            .map_or_else(Vec::new, |injector| injector(page_url, phase))
    }

    /// If the main-frame navigation to `url` should be rewritten (tracking-parameter stripping, https upgrade).
    pub fn rewrite_navigation(&self, url: &str) -> Option<String> {
        if !self.blocker.enabled() {
            return None;
        }
        let mut cur = url.to_string();
        let mut changed = false;
        if let Some(rewritten) = self.blocker.rewrite_document_url(&cur) {
            if rewritten != cur {
                cur = rewritten;
                changed = true;
            }
        }
        if self.strip_tracking.load(Ordering::Relaxed) {
            if let Some(n) = privacy::strip_tracking_params(&cur) {
                cur = n;
                changed = true;
            }
        }
        if self.https_upgrade.load(Ordering::Relaxed) {
            if let Some(n) = privacy::upgrade_https(&cur) {
                let host = url::Url::parse(&n)
                    .ok()
                    .and_then(|u| u.host_str().map(str::to_string))
                    .unwrap_or_default();
                if !self.no_upgrade.lock().contains(&host) {
                    let mut up = self.upgrades.lock();
                    if up.len() > 256 {
                        up.clear();
                    }
                    up.insert(n.clone(), cur.clone());
                    cur = n;
                    changed = true;
                }
            }
        }
        if let Some(unwrapped) = privacy::unwrap_tracker_redirect(&cur) {
            if unwrapped != cur {
                cur = unwrapped;
                changed = true;
            }
        }
        changed.then_some(cur)
    }

    /// Called when a navigation to `url` failed. If we had upgraded it to https, returns the http URL to fall back to
    /// (and remembers not to upgrade that host again).
    pub fn upgrade_fallback(&self, url: &str) -> Option<String> {
        let from = self.upgrades.lock().remove(url)?;
        if let Some(host) = url::Url::parse(url)
            .ok()
            .and_then(|u| u.host_str().map(str::to_string))
        {
            self.no_upgrade.lock().insert(host);
        }
        Some(from)
    }

    // ---- management API used by commands ----

    pub fn status(&self) -> AdblockStatus {
        let stats = self.blocker.stats();
        AdblockStatus {
            enabled: self.blocker.enabled(),
            lists: self
                .blocker
                .lists()
                .into_iter()
                .map(|l| AdblockList {
                    id: l.id,
                    name: l.name,
                    enabled: l.enabled,
                    updated_at: l.updated_at,
                    rule_count: l.rule_count as u64,
                    error: l.error,
                })
                .collect(),
            blocked_total: stats.blocked_total,
            updating: self.is_updating(),
        }
    }

    pub fn set_enabled(&self, on: bool) {
        self.blocker.set_enabled(on);
    }

    /// Current master switch. Native adapters use this before allocating per-request state.
    pub fn enabled(&self) -> bool {
        self.blocker.enabled()
    }

    pub fn set_list_enabled(&self, id: &str, on: bool) {
        self.blocker.set_list_enabled(id, on);
    }

    pub fn site_disabled(&self, host: &str) -> bool {
        self.blocker.site_disabled(host)
    }

    pub fn set_site_disabled(&self, host: &str, disabled: bool) {
        self.blocker.set_site_disabled(host, disabled);
    }
}

/// Decode `data:<mime>[;base64],<payload>` into `(mime, bytes)`.
fn data_url(url: &str) -> Option<(String, Vec<u8>)> {
    let rest = url.strip_prefix("data:")?;
    let (meta, payload) = rest.split_once(',')?;
    let is_b64 = meta.ends_with(";base64");
    let mime = meta.trim_end_matches(";base64");
    let mime = if mime.is_empty() { "text/plain" } else { mime };
    let body = if is_b64 {
        STANDARD.decode(payload.trim()).ok()?
    } else {
        percent_encoding::percent_decode_str(payload).collect()
    };
    Some((mime.to_string(), body))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn filter() -> Filter {
        Filter::new(std::env::temp_dir().join(format!("athanor-filter-{}", athanor_core::new_id())))
    }

    fn filter_with_rules(rules: &str) -> Filter {
        let dir =
            std::env::temp_dir().join(format!("athanor-filter-rules-{}", athanor_core::new_id()));
        std::fs::create_dir_all(dir.join("lists")).expect("create fixture list directory");
        std::fs::write(dir.join("lists/easylist.txt"), rules).expect("write fixture rules");
        let filter = Filter::new(dir);
        filter.blocker.load();
        filter
    }

    #[test]
    fn data_urls() {
        assert_eq!(
            data_url("data:text/plain;base64,aGk="),
            Some(("text/plain".into(), b"hi".to_vec()))
        );
        assert_eq!(
            data_url("data:,a%20b"),
            Some(("text/plain".into(), b"a b".to_vec()))
        );
        assert_eq!(data_url("https://x"), None);
    }

    #[test]
    fn rewrite_strips_tracking_and_upgrades_with_fallback() {
        let f = filter();
        assert_eq!(
            f.rewrite_navigation("https://example.com/a?utm_source=x&id=1")
                .as_deref(),
            Some("https://example.com/a?id=1")
        );
        let up = f
            .rewrite_navigation("http://example.com/a")
            .expect("upgraded");
        assert_eq!(up, "https://example.com/a");
        // upgrade failed -> fall back to http and never upgrade this host again
        assert_eq!(
            f.upgrade_fallback(&up).as_deref(),
            Some("http://example.com/a")
        );
        assert_eq!(f.rewrite_navigation("http://example.com/b"), None);
        // local addresses are left alone
        assert_eq!(f.rewrite_navigation("http://localhost:3000/"), None);
    }

    #[test]
    fn rewrite_respects_flags_and_master_switch() {
        let f = filter();
        f.https_upgrade.store(false, Ordering::Relaxed);
        assert_eq!(f.rewrite_navigation("http://example.org/"), None);
        f.strip_tracking.store(false, Ordering::Relaxed);
        assert_eq!(f.rewrite_navigation("https://example.org/?fbclid=1"), None);
        f.strip_tracking.store(true, Ordering::Relaxed);
        f.set_enabled(false);
        assert_eq!(f.rewrite_navigation("https://example.org/?fbclid=1"), None);
    }

    #[test]
    fn unknown_hosts_are_allowed_by_the_fallback_rules() {
        let f = filter();
        assert_eq!(
            f.verdict(
                "https://example.com/app.js",
                "https://example.com/",
                Kind::Script
            ),
            Verdict::Allow
        );
    }

    #[test]
    fn adapter_exposes_subresource_and_navigation_removeparam_rewrites() {
        let filter = filter_with_rules(
            "||target.test^$script,removeparam=utm_source\n||site.test^$document,removeparam=campaign\n",
        );
        assert_eq!(
            filter.verdict_with_rewrite(
                "https://target.test/a.js?utm_source=x&keep=y",
                "https://site.test/",
                Kind::Script,
            ),
            DetailedVerdict::Rewrite {
                url: "https://target.test/a.js?keep=y".into()
            }
        );
        assert_eq!(
            filter.verdict(
                "https://target.test/a.js?utm_source=x&keep=y",
                "https://site.test/",
                Kind::Script
            ),
            Verdict::Allow
        );
        assert_eq!(
            filter
                .rewrite_navigation("https://site.test/?campaign=spring&keep=y")
                .as_deref(),
            Some("https://site.test/?keep=y")
        );
    }

    #[test]
    fn injections_include_registered_scripts() {
        let f = filter();
        f.set_injector(Arc::new(|url, phase| vec![format!("{url}#{phase}")]));
        assert_eq!(
            f.injections("https://a.test/", 2),
            vec!["https://a.test/#2".to_string()]
        );
    }
}
