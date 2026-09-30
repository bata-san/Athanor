//! Synchronous content blocking for native browser adapters.
//!
//! `Blocker` is cheaply cloned. Checks take a short read lock to clone an immutable engine,
//! then run without holding that lock. Rebuilds and downloads are serialized. State lives in
//! `adblock-config.json`, raw lists in `lists/<id>.txt`, and a versioned, list-set-hashed engine
//! in `engine.dat`. `load` never downloads and uses embedded fallback rules when necessary.
//! Generic cosmetic selectors are capped at 10,000 and emitted in groups of at most 200.
//! `Fetch` maps to adblock-rust's XHR request type.

pub mod privacy;

use adblock::{lists::ParseOptions, Engine, FilterSet};
use parking_lot::{Mutex, RwLock};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    collections::{HashMap, HashSet},
    fs,
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, AtomicU64, Ordering},
        Arc,
    },
    time::{Duration, SystemTime, UNIX_EPOCH},
};

const VERSION: u32 = 2;
const FALLBACK: &str = include_str!("fallback.txt");

/// Native resource category.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ResourceType {
    /// Top-level page.
    Document,
    /// Child frame.
    Subdocument,
    /// CSS.
    Stylesheet,
    /// JavaScript.
    Script,
    /// Image.
    Image,
    /// Font.
    Font,
    /// Audio/video.
    Media,
    /// XMLHttpRequest.
    Xhr,
    /// Fetch API request.
    Fetch,
    /// WebSocket.
    WebSocket,
    /// Beacon or ping.
    Ping,
    /// Any other kind.
    Other,
}
impl ResourceType {
    /// Parse a Chrome-style or lowercase enum name; unknown names map to `Other`.
    pub fn parse(s: &str) -> Self {
        match s.to_ascii_lowercase().as_str() {
            "document" | "main_frame" => Self::Document,
            "subdocument" | "sub_frame" => Self::Subdocument,
            "stylesheet" => Self::Stylesheet,
            "script" => Self::Script,
            "image" => Self::Image,
            "font" => Self::Font,
            "media" => Self::Media,
            "xhr" | "xmlhttprequest" => Self::Xhr,
            "fetch" => Self::Fetch,
            "websocket" => Self::WebSocket,
            "ping" => Self::Ping,
            _ => Self::Other,
        }
    }
    fn engine_name(self) -> &'static str {
        match self {
            Self::Document => "document",
            Self::Subdocument => "subdocument",
            Self::Stylesheet => "stylesheet",
            Self::Script => "script",
            Self::Image => "image",
            Self::Font => "font",
            Self::Media => "media",
            Self::Xhr | Self::Fetch => "xmlhttprequest",
            Self::WebSocket => "websocket",
            Self::Ping => "ping",
            Self::Other => "other",
        }
    }
}

/// One network request and its top-level page.
pub struct Request<'a> {
    /// Requested URL.
    pub url: &'a str,
    /// Top-level page URL, possibly empty.
    pub source_url: &'a str,
    /// Resource category.
    pub resource_type: ResourceType,
}
/// Network decision.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Decision {
    /// Continue normally.
    Allow,
    /// Cancel the request; the matching rule is included when available.
    Block { rule: Option<String> },
    /// Serve a neutered data URL.
    Redirect { to: String },
    /// Continue at a rewritten URL.
    Rewrite(String),
}
/// Kind of list source.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ListKind {
    /// Ordinary network and cosmetic rules.
    Network,
    /// Nuisance rules.
    Annoyances,
    /// Regional rules.
    Regional,
    /// Scriptlet and redirect definitions.
    Resources,
}
/// Curated downloadable source.
#[derive(Debug, Clone)]
pub struct ListSource {
    /// Stable ID used in storage.
    pub id: String,
    /// Display name.
    pub name: String,
    /// Public HTTPS URL.
    pub url: String,
    /// Source kind.
    pub kind: ListKind,
    /// Initial enable state.
    pub default_enabled: bool,
}
/// Brave-class default sources; nuisance and Japanese lists start disabled.
pub fn default_lists() -> Vec<ListSource> {
    let rows = [
        ("easylist", "EasyList", "https://easylist.to/easylist/easylist.txt", ListKind::Network, true),
        ("easyprivacy", "EasyPrivacy", "https://easylist.to/easylist/easyprivacy.txt", ListKind::Network, true),
        ("ubo-filters", "uBlock filters", "https://ublockorigin.github.io/uAssets/filters/filters.txt", ListKind::Network, true),
        ("ubo-badware", "uBlock badware", "https://ublockorigin.github.io/uAssets/filters/badware.txt", ListKind::Network, true),
        ("ubo-privacy", "uBlock privacy", "https://ublockorigin.github.io/uAssets/filters/privacy.txt", ListKind::Network, true),
        ("ubo-quick-fixes", "uBlock quick fixes", "https://ublockorigin.github.io/uAssets/filters/quick-fixes.txt", ListKind::Network, true),
        ("ubo-unbreak", "uBlock unbreak", "https://ublockorigin.github.io/uAssets/filters/unbreak.txt", ListKind::Network, true),
        ("peter-lowe", "Peter Lowe's ad servers", "https://pgl.yoyo.org/adservers/serverlist.php?hostformat=adblockplus&mimetype=plaintext", ListKind::Network, true),
        ("brave-unbreak", "Brave unbreak", "https://raw.githubusercontent.com/brave/adblock-lists/master/brave-unbreak.txt", ListKind::Network, true),
        ("brave-specific", "Brave specific", "https://raw.githubusercontent.com/brave/adblock-lists/master/brave-lists/brave-specific.txt", ListKind::Network, true),
        ("brave-social", "Brave social", "https://raw.githubusercontent.com/brave/adblock-lists/master/brave-lists/brave-social.txt", ListKind::Network, true),
        ("urlhaus", "URLhaus malicious URLs", "https://malware-filter.gitlab.io/malware-filter/urlhaus-filter-ag-online.txt", ListKind::Network, true),
        ("easylist-cookie", "EasyList Cookie", "https://secure.fanboy.co.nz/fanboy-cookiemonster.txt", ListKind::Annoyances, false),
        ("adguard-japanese", "AdGuard Japanese", "https://raw.githubusercontent.com/AdguardTeam/FiltersRegistry/master/filters/filter_7_Japanese/filter.txt", ListKind::Regional, false),
        ("brave-resources", "Brave resources", "https://raw.githubusercontent.com/brave/adblock-resources/master/dist/resources.json", ListKind::Resources, true),
    ];
    rows.into_iter()
        .map(|(id, name, url, kind, default_enabled)| ListSource {
            id: id.into(),
            name: name.into(),
            url: url.into(),
            kind,
            default_enabled,
        })
        .collect()
}
/// CSS and immediately evaluable JavaScript.
#[derive(Debug, Clone, Default)]
pub struct Cosmetic {
    /// Ready-to-inject stylesheet.
    pub css: String,
    /// Self-contained injection IIFE.
    pub js: String,
}
/// Blocking counter snapshot.
#[derive(Debug, Clone, Default)]
pub struct Stats {
    /// Blocked requests since construction.
    pub blocked_total: u64,
    /// Counts by requested host.
    pub blocked_by_host: HashMap<String, u64>,
    /// Non-comment lines loaded by list.
    pub rules_loaded: HashMap<String, usize>,
}
/// Current source state.
#[derive(Debug, Clone)]
pub struct ListState {
    /// Stable ID.
    pub id: String,
    /// Display name.
    pub name: String,
    /// Current configured enable state.
    pub enabled: bool,
    /// Last successful download, Unix seconds.
    pub updated_at: Option<u64>,
    /// Non-comment line count.
    pub rule_count: usize,
    /// Last update error.
    pub error: Option<String>,
}
/// Startup load path.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LoadReport {
    /// Valid compiled cache.
    CompiledCache,
    /// Raw files were compiled.
    RawLists,
    /// Embedded rules were compiled.
    Fallback,
}
/// One download result.
#[derive(Debug, Clone)]
pub struct UpdateReport {
    /// Source ID.
    pub id: String,
    /// Whether a new body was stored.
    pub changed: bool,
    /// Failure text, if any.
    pub error: Option<String>,
}
/// Downloaded body and HTTP validators.
pub struct FetchResponse {
    /// HTTP status, normally 200 or 304.
    pub status: u16,
    /// Body for a 200 response.
    pub body: String,
    /// ETag header.
    pub etag: Option<String>,
    /// Last-Modified header.
    pub last_modified: Option<String>,
}
/// Injectable blocking downloader.
pub trait Fetcher: Send + Sync {
    /// GET a source, optionally sending validators.
    fn fetch(
        &self,
        url: &str,
        etag: Option<&str>,
        last_modified: Option<&str>,
    ) -> Result<FetchResponse, String>;
}
struct HttpFetcher;
impl Fetcher for HttpFetcher {
    fn fetch(
        &self,
        url: &str,
        etag: Option<&str>,
        last_modified: Option<&str>,
    ) -> Result<FetchResponse, String> {
        let agent: ureq::Agent = ureq::Agent::config_builder()
            .timeout_global(Some(Duration::from_secs(20)))
            .build()
            .into();
        let mut req = agent.get(url);
        if let Some(v) = etag {
            req = req.header("If-None-Match", v);
        }
        if let Some(v) = last_modified {
            req = req.header("If-Modified-Since", v);
        }
        let mut response = req.call().map_err(|e| e.to_string())?;
        let status = response.status().as_u16();
        let header = |name| {
            response
                .headers()
                .get(name)
                .and_then(|v| v.to_str().ok())
                .map(str::to_owned)
        };
        let (etag, last_modified) = (header("etag"), header("last-modified"));
        let body = if status == 304 {
            String::new()
        } else {
            response
                .body_mut()
                .with_config()
                .limit(32 * 1024 * 1024)
                .read_to_string()
                .map_err(|e| e.to_string())?
        };
        Ok(FetchResponse {
            status,
            body,
            etag,
            last_modified,
        })
    }
}

#[derive(Default, Serialize, Deserialize)]
struct Config {
    enabled: Option<bool>,
    lists: HashMap<String, bool>,
    disabled_sites: HashSet<String>,
    metadata: HashMap<String, Metadata>,
}
#[derive(Default, Serialize, Deserialize)]
struct Metadata {
    updated_at: Option<u64>,
    etag: Option<String>,
    last_modified: Option<String>,
    error: Option<String>,
}
#[derive(Serialize, Deserialize)]
struct CacheHeader {
    version: u32,
    hash: String,
    generic_selectors: Vec<String>,
    rule_counts: HashMap<String, usize>,
}
struct Compiled {
    engine: Engine,
    generic_selectors: Vec<String>,
    rule_counts: HashMap<String, usize>,
}
struct Inner {
    dir: PathBuf,
    compiled: RwLock<Arc<Compiled>>,
    config: RwLock<Config>,
    enabled: AtomicBool,
    blocked: AtomicU64,
    by_host: Mutex<HashMap<String, u64>>,
    build_lock: Mutex<()>,
    fetcher: Arc<dyn Fetcher>,
}

/// Thread-safe, cheaply cloneable blocker.
#[derive(Clone)]
pub struct Blocker {
    inner: Arc<Inner>,
}
impl Blocker {
    /// Construct without disk or network access.
    pub fn new(data_dir: impl Into<PathBuf>) -> Self {
        Self::with_fetcher(data_dir, Arc::new(HttpFetcher))
    }
    /// Construct with an injected downloader.
    pub fn with_fetcher(data_dir: impl Into<PathBuf>, fetcher: Arc<dyn Fetcher>) -> Self {
        let engine = Engine::new_with_list_text(FALLBACK);
        Self {
            inner: Arc::new(Inner {
                dir: data_dir.into(),
                compiled: RwLock::new(Arc::new(Compiled {
                    engine,
                    generic_selectors: generic_selectors(FALLBACK),
                    rule_counts: HashMap::new(),
                })),
                config: RwLock::new(Config::default()),
                enabled: AtomicBool::new(true),
                blocked: AtomicU64::new(0),
                by_host: Mutex::new(HashMap::new()),
                build_lock: Mutex::new(()),
                fetcher,
            }),
        }
    }
    /// Load a valid compiled cache or rebuild from raw files or fallback.
    pub fn load(&self) -> LoadReport {
        let _guard = self.inner.build_lock.lock();
        let config: Config = fs::read(self.inner.dir.join("adblock-config.json"))
            .ok()
            .and_then(|b| serde_json::from_slice(&b).ok())
            .unwrap_or_default();
        self.inner
            .enabled
            .store(config.enabled.unwrap_or(true), Ordering::Relaxed);
        *self.inner.config.write() = config;
        let (hash, raw, any) = self.collect_raw();
        if let Ok(bytes) = fs::read(self.inner.dir.join("engine.dat")) {
            if let Some(compiled) = decode_cache(&bytes, &hash, &raw) {
                *self.inner.compiled.write() = Arc::new(compiled);
                return LoadReport::CompiledCache;
            }
        }
        self.build_and_store(&hash, &raw);
        if any {
            LoadReport::RawLists
        } else {
            LoadReport::Fallback
        }
    }
    /// Download enabled sources with conditional GET and per-source error isolation.
    pub fn update_lists(&self, force: bool) -> Vec<UpdateReport> {
        let _guard = self.inner.build_lock.lock();
        let mut reports = Vec::new();
        for source in default_lists() {
            if !self.list_is_enabled(&source.id, source.default_enabled) {
                continue;
            }
            let (etag, modified) = {
                let config = self.inner.config.read();
                let meta = config.metadata.get(&source.id);
                (
                    if force {
                        None
                    } else {
                        meta.and_then(|m| m.etag.clone())
                    },
                    if force {
                        None
                    } else {
                        meta.and_then(|m| m.last_modified.clone())
                    },
                )
            };
            let result =
                self.inner
                    .fetcher
                    .fetch(&source.url, etag.as_deref(), modified.as_deref());
            let mut changed = false;
            let mut error = None;
            match result {
                Ok(response) if response.status == 304 => {
                    if !self.raw_path(&source.id).exists() {
                        error = Some("304 without cached body".into());
                    }
                }
                Ok(response) if response.status == 200 => {
                    if response.body.trim().is_empty() {
                        error = Some("empty list".into());
                    } else if source.kind == ListKind::Resources
                        && parse_resources(&response.body).is_err()
                    {
                        error = Some("invalid resource JSON".into());
                    } else if let Err(e) =
                        atomic_write(&self.raw_path(&source.id), response.body.as_bytes())
                    {
                        error = Some(e.to_string());
                    } else {
                        changed = true;
                        let mut config = self.inner.config.write();
                        let meta = config.metadata.entry(source.id.clone()).or_default();
                        meta.updated_at = Some(now());
                        meta.etag = response.etag;
                        meta.last_modified = response.last_modified;
                    }
                }
                Ok(response) => error = Some(format!("HTTP {}", response.status)),
                Err(e) => error = Some(e),
            }
            self.inner
                .config
                .write()
                .metadata
                .entry(source.id.clone())
                .or_default()
                .error = error.clone();
            reports.push(UpdateReport {
                id: source.id,
                changed,
                error,
            });
        }
        self.persist_config();
        let (hash, raw, _) = self.collect_raw();
        self.build_and_store(&hash, &raw);
        reports
    }
    /// Check one network request.
    pub fn check(&self, req: &Request<'_>) -> Decision {
        if !self.enabled() || self.site_disabled(req.source_url) {
            return Decision::Allow;
        }
        let parsed = match adblock::request::Request::new(
            req.url,
            req.source_url,
            req.resource_type.engine_name(),
            "get",
        ) {
            Ok(v) => v,
            Err(_) => return Decision::Allow,
        };
        let compiled = self.inner.compiled.read().clone();
        let result = compiled.engine.check_network_request(&parsed);
        if result.should_block() {
            self.inner.blocked.fetch_add(1, Ordering::Relaxed);
            *self
                .inner
                .by_host
                .lock()
                .entry(parsed.hostname)
                .or_default() += 1;
            if let Some(to) = result.redirect {
                return Decision::Redirect { to };
            }
            return Decision::Block {
                rule: result.filter.and_then(|f| f.raw_line),
            };
        }
        if let Some(rewrite) = result.rewritten_url {
            return Decision::Rewrite(rewrite);
        }
        Decision::Allow
    }
    /// Return CSS and a safe-to-evaluate injection snippet for a page.
    pub fn cosmetic(&self, page_url: &str) -> Cosmetic {
        if !self.enabled() || self.site_disabled(page_url) {
            return Cosmetic::default();
        }
        let compiled = self.inner.compiled.read().clone();
        let specific = compiled.engine.url_cosmetic_resources(page_url);
        let mut css = if specific.generichide {
            String::new()
        } else {
            selector_css(
                &compiled
                    .generic_selectors
                    .iter()
                    .filter(|s| !specific.exceptions.contains(*s))
                    .cloned()
                    .collect::<Vec<_>>(),
            )
        };
        let mut selectors: Vec<_> = specific
            .hide_selectors
            .iter()
            .filter(|s| valid_selector(s))
            .cloned()
            .collect();
        selectors.sort();
        css.push_str(&selector_css(&selectors));
        for action in &specific.procedural_actions {
            if let Ok(parsed) = serde_json::from_str::<
                adblock::cosmetic_filter_cache::ProceduralOrActionFilter,
            >(action)
            {
                if let Some((selector, style)) = parsed.as_css() {
                    if valid_selector(&selector) {
                        css.push_str(&selector);
                        css.push('{');
                        css.push_str(&style);
                        css.push_str("}\n");
                    }
                }
            }
        }
        let css_json = serde_json::to_string(&css).unwrap_or_else(|_| "\"\"".into());
        let js = format!("(()=>{{const css={css_json};if(css){{const s=document.createElement('style');s.textContent=css;(document.head||document.documentElement).appendChild(s);}}{} }})();", specific.injected_script);
        Cosmetic { css, js }
    }
    /// Snapshot the block counters and loaded line counts.
    pub fn stats(&self) -> Stats {
        Stats {
            blocked_total: self.inner.blocked.load(Ordering::Relaxed),
            blocked_by_host: self.inner.by_host.lock().clone(),
            rules_loaded: self.inner.compiled.read().rule_counts.clone(),
        }
    }
    /// Set and persist the global switch.
    pub fn set_enabled(&self, on: bool) {
        self.inner.enabled.store(on, Ordering::Relaxed);
        self.inner.config.write().enabled = Some(on);
        self.persist_config();
    }
    /// Return the global switch.
    pub fn enabled(&self) -> bool {
        self.inner.enabled.load(Ordering::Relaxed)
    }
    /// Configure a list; call `rebuild` for the change to take effect.
    pub fn set_list_enabled(&self, id: &str, on: bool) {
        if default_lists().iter().any(|s| s.id == id) {
            self.inner.config.write().lists.insert(id.into(), on);
            self.persist_config();
        }
    }
    /// Recompile currently enabled cached sources.
    pub fn rebuild(&self) {
        let _guard = self.inner.build_lock.lock();
        let (hash, raw, _) = self.collect_raw();
        self.build_and_store(&hash, &raw);
    }
    /// Set and persist a registrable-site exception.
    pub fn set_site_disabled(&self, host: &str, disabled: bool) {
        if let Some(domain) = site_key(host) {
            let mut config = self.inner.config.write();
            if disabled {
                config.disabled_sites.insert(domain);
            } else {
                config.disabled_sites.remove(&domain);
            }
            drop(config);
            self.persist_config();
        }
    }
    /// Check a host or page URL against the site exception set.
    pub fn site_disabled(&self, host: &str) -> bool {
        site_key(host).is_some_and(|k| self.inner.config.read().disabled_sites.contains(&k))
    }
    /// Describe the curated sources and their current state.
    pub fn lists(&self) -> Vec<ListState> {
        default_lists()
            .into_iter()
            .map(|s| {
                let config = self.inner.config.read();
                let meta = config.metadata.get(&s.id);
                ListState {
                    id: s.id.clone(),
                    name: s.name,
                    enabled: *config.lists.get(&s.id).unwrap_or(&s.default_enabled),
                    updated_at: meta.and_then(|m| m.updated_at),
                    rule_count: *self
                        .inner
                        .compiled
                        .read()
                        .rule_counts
                        .get(&s.id)
                        .unwrap_or(&0),
                    error: meta.and_then(|m| m.error.clone()),
                }
            })
            .collect()
    }
    fn list_is_enabled(&self, id: &str, default: bool) -> bool {
        *self.inner.config.read().lists.get(id).unwrap_or(&default)
    }
    fn raw_path(&self, id: &str) -> PathBuf {
        self.inner.dir.join("lists").join(format!("{id}.txt"))
    }
    fn collect_raw(&self) -> (String, Vec<(ListSource, String)>, bool) {
        let mut hasher = Sha256::new();
        hasher.update(VERSION.to_le_bytes());
        let mut lists = Vec::new();
        for source in default_lists() {
            if !self.list_is_enabled(&source.id, source.default_enabled) {
                continue;
            }
            hasher.update(source.id.as_bytes());
            if let Ok(raw) = fs::read_to_string(self.raw_path(&source.id)) {
                hasher.update(raw.as_bytes());
                lists.push((source, raw));
            }
        }
        let any = lists.iter().any(|(s, _)| s.kind != ListKind::Resources);
        if !any {
            hasher.update(FALLBACK.as_bytes());
        }
        (hex::encode(hasher.finalize()), lists, any)
    }
    fn build_and_store(&self, hash: &str, raw: &[(ListSource, String)]) {
        let compiled = compile(raw);
        let header = CacheHeader {
            version: VERSION,
            hash: hash.into(),
            generic_selectors: compiled.generic_selectors.clone(),
            rule_counts: compiled.rule_counts.clone(),
        };
        if let Ok(mut bytes) = serde_json::to_vec(&header) {
            bytes.push(b'\n');
            bytes.extend(compiled.engine.serialize());
            let _ = atomic_write(&self.inner.dir.join("engine.dat"), &bytes);
        }
        *self.inner.compiled.write() = Arc::new(compiled);
    }
    fn persist_config(&self) {
        if let Ok(data) = serde_json::to_vec_pretty(&*self.inner.config.read()) {
            let _ = atomic_write(&self.inner.dir.join("adblock-config.json"), &data);
        }
    }
}
fn compile(raw: &[(ListSource, String)]) -> Compiled {
    let mut set = FilterSet::new(true);
    let mut css_text = String::new();
    let mut counts = HashMap::new();
    let mut any = false;
    let mut resources = Vec::new();
    for (source, text) in raw {
        if source.kind == ListKind::Resources {
            if let Ok(r) = parse_resources(text) {
                resources.extend(r);
            }
            continue;
        }
        any = true;
        counts.insert(
            source.id.clone(),
            text.lines()
                .filter(|l| {
                    let l = l.trim();
                    !l.is_empty() && !l.starts_with('!') && !l.starts_with('[')
                })
                .count(),
        );
        css_text.push_str(text);
        css_text.push('\n');
        let permissions = if source.id.starts_with("brave-") {
            adblock::resources::PermissionMask::from_bits(0b10)
        } else if source.id.starts_with("ubo-") {
            adblock::resources::PermissionMask::from_bits(0b01)
        } else {
            Default::default()
        };
        set.add_filter_list(
            text.clone(),
            ParseOptions {
                permissions,
                ..ParseOptions::default()
            },
        );
    }
    if !any {
        css_text.push_str(FALLBACK);
        set.add_filter_list(FALLBACK.into(), ParseOptions::default());
    }
    let mut engine = Engine::new_with_filter_set(set);
    engine.use_resources(resources);
    Compiled {
        engine,
        generic_selectors: generic_selectors(&css_text),
        rule_counts: counts,
    }
}
fn parse_resources(text: &str) -> Result<Vec<adblock::resources::Resource>, serde_json::Error> {
    serde_json::from_str(text)
}
fn decode_cache(bytes: &[u8], hash: &str, raw: &[(ListSource, String)]) -> Option<Compiled> {
    let index = bytes.iter().position(|b| *b == b'\n')?;
    let header: CacheHeader = serde_json::from_slice(&bytes[..index]).ok()?;
    if header.version != VERSION || header.hash != hash {
        return None;
    }
    let mut engine = Engine::default();
    engine.deserialize(&bytes[index + 1..]).ok()?;
    let resources = raw
        .iter()
        .filter(|(s, _)| s.kind == ListKind::Resources)
        .filter_map(|(_, s)| parse_resources(s).ok())
        .flatten()
        .collect::<Vec<_>>();
    engine.use_resources(resources);
    Some(Compiled {
        engine,
        generic_selectors: header.generic_selectors,
        rule_counts: header.rule_counts,
    })
}
fn valid_selector(s: &str) -> bool {
    let s = s.trim();
    !s.is_empty()
        && s.len() <= 512
        && !s.contains(['\n', '\r', '{', '}', ';'])
        && !s.contains(":has-text(")
        && !s.contains(":xpath(")
        && !s.contains(":matches-css(")
        && !s.contains(":style(")
        && !s.contains(":remove(")
        && !s.contains("+js(")
        && !s.contains("##")
}
fn generic_selectors(text: &str) -> Vec<String> {
    let mut selectors = Vec::new();
    let mut seen = HashSet::new();
    for line in text.lines() {
        if let Some(s) = line.strip_prefix("##") {
            let s = s.trim();
            if valid_selector(s) && seen.insert(s) {
                selectors.push(s.to_owned());
                if selectors.len() == 10_000 {
                    break;
                }
            }
        }
    }
    selectors
}
fn selector_css(selectors: &[String]) -> String {
    let mut css = String::new();
    for group in selectors.chunks(200) {
        css.push_str(&group.join(","));
        css.push_str("{display:none!important}\n");
    }
    css
}
fn site_key(input: &str) -> Option<String> {
    let url = if input.contains("://") {
        input.to_owned()
    } else {
        format!("https://{input}/")
    };
    adblock::url_parser::parse_url(&url)
        .map(|u| u.domain().to_ascii_lowercase())
        .filter(|s| !s.is_empty())
}
fn now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}
fn atomic_write(path: &Path, bytes: &[u8]) -> std::io::Result<()> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let temp = path.with_extension(format!("tmp-{}", std::process::id()));
    fs::write(&temp, bytes)?;
    replace_file(&temp, path)
}
#[cfg(not(windows))]
fn replace_file(temp: &Path, path: &Path) -> std::io::Result<()> {
    fs::rename(temp, path)
}
#[cfg(windows)]
fn replace_file(temp: &Path, path: &Path) -> std::io::Result<()> {
    use std::os::windows::ffi::OsStrExt;
    #[link(name = "Kernel32")]
    unsafe extern "system" {
        fn MoveFileExW(existing: *const u16, new: *const u16, flags: u32) -> i32;
    }
    let from: Vec<u16> = temp.as_os_str().encode_wide().chain(Some(0)).collect();
    let to: Vec<u16> = path.as_os_str().encode_wide().chain(Some(0)).collect();
    // MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH.
    if unsafe { MoveFileExW(from.as_ptr(), to.as_ptr(), 0x9) } == 0 {
        Err(std::io::Error::last_os_error())
    } else {
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering as AtomicOrdering};

    static NEXT: AtomicUsize = AtomicUsize::new(0);
    fn temp() -> PathBuf {
        std::env::temp_dir().join(format!(
            "athanor-adblock-test-{}-{}",
            std::process::id(),
            NEXT.fetch_add(1, AtomicOrdering::Relaxed)
        ))
    }
    fn fixture(text: &str) -> Blocker {
        let dir = temp();
        atomic_write(&dir.join("lists/easylist.txt"), text.as_bytes()).unwrap();
        let blocker = Blocker::new(dir);
        blocker.load();
        blocker
    }
    fn request<'a>(url: &'a str, source: &'a str) -> Request<'a> {
        Request {
            url,
            source_url: source,
            resource_type: ResourceType::Script,
        }
    }
    #[test]
    fn network_rules_and_stats() {
        let blocker = fixture("||ads.example^$script,third-party\n@@||ads.example/ok.js$script\n||hard.example^$important\n@@||hard.example^\n||first.example^$script\n");
        assert!(matches!(
            blocker.check(&request("https://ads.example/a.js", "https://site.test/")),
            Decision::Block { .. }
        ));
        assert_eq!(
            blocker.check(&request("https://ads.example/a.js", "https://ads.example/")),
            Decision::Allow
        );
        assert_eq!(
            blocker.check(&request("https://ads.example/ok.js", "https://site.test/")),
            Decision::Allow
        );
        assert!(matches!(
            blocker.check(&request("https://hard.example/a.js", "https://site.test/")),
            Decision::Block { .. }
        ));
        assert!(matches!(
            blocker.check(&request(
                "https://first.example/a.js",
                "https://first.example/"
            )),
            Decision::Block { .. }
        ));
        assert_eq!(blocker.stats().blocked_total, 3);
        assert_eq!(ResourceType::parse("main_frame"), ResourceType::Document);
        assert_eq!(ResourceType::parse("xmlhttprequest"), ResourceType::Xhr);
    }
    #[test]
    fn cosmetic_and_generichide() {
        let blocker = fixture("##.generic-ad\nexample.com##.local-ad\nexample.com##.styled:style(color: red)\n@@||example.com^$generichide\n##div:has-text(ad)\n");
        let normal = blocker.cosmetic("https://elsewhere.test/");
        assert!(normal.css.contains(".generic-ad"));
        assert!(!normal.css.contains(":has-text"));
        assert!(normal.js.contains("document.createElement('style')"));
        let exception = blocker.cosmetic("https://example.com/");
        assert!(!exception.css.contains(".generic-ad"));
        assert!(exception.css.contains(".local-ad"));
        assert!(exception.css.contains(".styled{color: red}"));
    }
    #[test]
    fn persistence_cache_and_disable() {
        let blocker = fixture("||ads.example^\n");
        assert_eq!(blocker.load(), LoadReport::CompiledCache);
        blocker.set_site_disabled("www.example.org", true);
        assert_eq!(
            blocker.check(&request(
                "https://ads.example/x",
                "https://sub.example.org/"
            )),
            Decision::Allow
        );
        assert!(matches!(
            blocker.check(&request("https://ads.example/x", "https://another.test/")),
            Decision::Block { .. }
        ));
        blocker.set_enabled(false);
        blocker.set_list_enabled("easylist", false);
        blocker.rebuild();
        assert_eq!(
            blocker.check(&request("https://ads.example/x", "https://site.test/")),
            Decision::Allow
        );
        let second = Blocker::new(blocker.inner.dir.clone());
        assert_eq!(second.load(), LoadReport::CompiledCache);
        assert!(!second.enabled());
        assert!(second.site_disabled("https://sub.example.org/"));
        assert!(
            !second
                .lists()
                .into_iter()
                .find(|l| l.id == "easylist")
                .unwrap()
                .enabled
        );
        fs::write(second.inner.dir.join("engine.dat"), b"corrupt").unwrap();
        assert_eq!(second.load(), LoadReport::Fallback);
        let cache = fs::read(second.inner.dir.join("engine.dat")).unwrap();
        let index = cache.iter().position(|b| *b == b'\n').unwrap();
        fs::write(second.inner.dir.join("engine.dat"), &cache[..index + 1]).unwrap();
        assert_eq!(second.load(), LoadReport::Fallback);
    }
    #[test]
    fn list_disable_then_rebuild() {
        let blocker = fixture("||ads.example^\n");
        let req = request("https://ads.example/x", "https://site.test/");
        assert!(matches!(blocker.check(&req), Decision::Block { .. }));
        blocker.set_list_enabled("easylist", false);
        assert!(matches!(blocker.check(&req), Decision::Block { .. }));
        blocker.rebuild();
        assert_eq!(blocker.check(&req), Decision::Allow);
    }
    #[test]
    fn removeparam_rewrite() {
        let blocker = fixture("||site.test^$script,removeparam=utm_source\n");
        let decision = blocker.check(&request(
            "https://site.test/a?utm_source=x&keep=y",
            "https://site.test/",
        ));
        assert_eq!(
            decision,
            Decision::Rewrite("https://site.test/a?keep=y".into())
        );
    }
    struct FakeFetcher;
    impl Fetcher for FakeFetcher {
        fn fetch(
            &self,
            url: &str,
            etag: Option<&str>,
            _: Option<&str>,
        ) -> Result<FetchResponse, String> {
            if url.contains("easylist.txt") {
                if etag == Some("v1") {
                    return Ok(FetchResponse {
                        status: 304,
                        body: String::new(),
                        etag: None,
                        last_modified: None,
                    });
                }
                return Ok(FetchResponse {
                    status: 200,
                    body: "||fake.example^".into(),
                    etag: Some("v1".into()),
                    last_modified: None,
                });
            }
            Err("offline fake".into())
        }
    }
    #[test]
    fn fake_update_and_conditional_get() {
        let blocker = Blocker::with_fetcher(temp(), Arc::new(FakeFetcher));
        let first = blocker.update_lists(false);
        assert!(first.iter().any(|r| r.id == "easylist" && r.changed));
        assert!(first.iter().any(|r| r.error.is_some()));
        assert!(matches!(
            blocker.check(&request("https://fake.example/x", "https://site.test/")),
            Decision::Block { .. }
        ));
        let second = blocker.update_lists(false);
        assert!(second
            .iter()
            .any(|r| r.id == "easylist" && !r.changed && r.error.is_none()));
    }
    #[test]
    fn redirect_resource() {
        use base64::{engine::general_purpose::STANDARD, Engine as _};
        let blocker = fixture("||redirect.example^$script,redirect=noop.js\n");
        let resources = serde_json::json!([{"name":"noop.js","aliases":[],"kind":{"mime":"application/javascript"},"content":STANDARD.encode("void 0;"),"dependencies":[]}]);
        atomic_write(
            &blocker.raw_path("brave-resources"),
            resources.to_string().as_bytes(),
        )
        .unwrap();
        blocker.rebuild();
        assert!(matches!(
            blocker.check(&request(
                "https://redirect.example/a.js",
                "https://site.test/"
            )),
            Decision::Redirect { .. }
        ));
    }
    /// Live source smoke test; runs only when explicitly selected.
    #[test]
    #[ignore]
    fn live_lists() {
        let blocker = Blocker::new(temp());
        let reports = blocker.update_lists(true);
        assert!(reports.iter().all(|r| r.error.is_none()), "{reports:?}");
    }
    /// Criterion-free build/check microbenchmark over previously cached EasyList and EasyPrivacy.
    #[test]
    #[ignore]
    fn micro_benchmark() {
        let dir = std::env::var_os("ATHANOR_ADBLOCK_BENCH_DIR")
            .map(PathBuf::from)
            .unwrap_or_else(temp);
        let easy = fs::read_to_string(dir.join("lists/easylist.txt"));
        let privacy = fs::read_to_string(dir.join("lists/easyprivacy.txt"));
        let (easy, privacy, source) = match (easy, privacy) {
            (Ok(e), Ok(p)) => (e, p, "EasyList + EasyPrivacy cache"),
            _ => (
                "||ads.example^\n##.advertisement\n".into(),
                "||tracker.example^\n".into(),
                "inline fallback",
            ),
        };
        let start = std::time::Instant::now();
        let mut set = FilterSet::new(false);
        set.add_filter_list(easy, ParseOptions::default());
        set.add_filter_list(privacy, ParseOptions::default());
        let engine = Engine::new_with_filter_set(set);
        let build = start.elapsed();
        let size = engine.serialize().len();
        let req = adblock::request::Request::new(
            "https://ads.example.test/banner.js",
            "https://site.example/",
            "script",
            "get",
        )
        .unwrap();
        let start = std::time::Instant::now();
        for _ in 0..100_000 {
            std::hint::black_box(engine.check_network_request(&req));
        }
        println!(
            "source={source} build_ms={} serialized_bytes={} ns_per_check={}",
            build.as_millis(),
            size,
            start.elapsed().as_nanos() / 100_000
        );
    }
}
