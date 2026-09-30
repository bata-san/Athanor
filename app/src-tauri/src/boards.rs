//! Reference boards on disk: one JSON file per board + a content-addressed asset store.

use crate::browser::Paths;
use athanor_core::{
    board::{AssetStore, Board, ImageSpec},
    store,
};
use base64::{engine::general_purpose::STANDARD, Engine as _};
use parking_lot::Mutex;
use serde::Serialize;
use std::{
    collections::HashSet,
    fs,
    io::{self, Read},
    net::{IpAddr, Ipv4Addr, Ipv6Addr, SocketAddr, ToSocketAddrs},
    time::UNIX_EPOCH,
};

const MAX_IMAGE_BYTES: u64 = 40 * 1024 * 1024;

/// Serialises every read-modify-write of a board file (context-menu adds race with UI saves).
static BOARD_LOCK: Mutex<()> = Mutex::new(());

/// True for addresses a web page must never make the browser process fetch from: loopback, private,
/// link-local (cloud metadata), CGNAT, multicast, unspecified, documentation and IPv6 equivalents.
pub fn is_public_ip(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(v4) => is_public_v4(v4),
        IpAddr::V6(v6) => is_public_v6(v6),
    }
}

fn is_public_v4(ip: Ipv4Addr) -> bool {
    let [a, b, ..] = ip.octets();
    !(ip.is_private()
        || ip.is_loopback()
        || ip.is_link_local()
        || ip.is_unspecified()
        || ip.is_broadcast()
        || ip.is_multicast()
        || ip.is_documentation()
        || a == 0
        || (a == 100 && (64..=127).contains(&b))
        || (a == 192 && b == 0)
        || (a == 198 && (b == 18 || b == 19))
        || a >= 240)
}

fn is_public_v6(ip: Ipv6Addr) -> bool {
    if let Some(v4) = ip.to_ipv4_mapped() {
        return is_public_v4(v4);
    }
    let seg = ip.segments();
    !(ip.is_loopback()
        || ip.is_unspecified()
        || ip.is_multicast()
        || (seg[0] & 0xfe00) == 0xfc00 // unique local fc00::/7
        || (seg[0] & 0xffc0) == 0xfe80 // link-local fe80::/10
        || (seg[0] == 0x2001 && seg[1] == 0x0db8)) // documentation
}

/// Resolver handed to `ureq` so the check happens on the addresses actually connected to
/// (defeats DNS rebinding and redirects to internal hosts).
struct PublicOnly;

impl ureq::Resolver for PublicOnly {
    fn resolve(&self, netloc: &str) -> io::Result<Vec<SocketAddr>> {
        let addrs: Vec<SocketAddr> = netloc
            .to_socket_addrs()?
            .filter(|a| is_public_ip(a.ip()))
            .collect();
        if addrs.is_empty() {
            Err(io::Error::new(
                io::ErrorKind::PermissionDenied,
                "refusing to fetch from a local or private address",
            ))
        } else {
            Ok(addrs)
        }
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BoardSummary {
    pub id: String,
    pub name: String,
    pub item_count: usize,
    pub updated_at: u64,
}

fn valid_id(id: &str) -> bool {
    !id.is_empty() && id.len() <= 64 && id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-')
}

fn path(paths: &Paths, id: &str) -> Result<std::path::PathBuf, String> {
    if !valid_id(id) {
        return Err("invalid board id".into());
    }
    Ok(paths.boards().join(format!("{id}.json")))
}

pub fn list(paths: &Paths) -> Vec<BoardSummary> {
    let mut out: Vec<BoardSummary> = fs::read_dir(paths.boards())
        .into_iter()
        .flatten()
        .flatten()
        .filter(|e| e.path().extension().is_some_and(|x| x == "json"))
        .filter_map(|e| {
            let board: Board = serde_json::from_slice(&fs::read(e.path()).ok()?).ok()?;
            let updated_at = e
                .metadata()
                .ok()?
                .modified()
                .ok()?
                .duration_since(UNIX_EPOCH)
                .ok()
                .map_or(0, |d| d.as_millis() as u64);
            Some(BoardSummary {
                id: board.id,
                name: board.name,
                item_count: board.items.len(),
                updated_at,
            })
        })
        .collect();
    out.sort_by_key(|b| std::cmp::Reverse(b.updated_at));
    out
}

pub fn get(paths: &Paths, id: &str) -> Result<Board, String> {
    get_unlocked(paths, id)
}

fn get_unlocked(paths: &Paths, id: &str) -> Result<Board, String> {
    let bytes = fs::read(path(paths, id)?).map_err(|e| e.to_string())?;
    serde_json::from_slice(&bytes).map_err(|e| e.to_string())
}

pub fn create(paths: &Paths, name: &str) -> Result<Board, String> {
    let board = Board::new(if name.trim().is_empty() {
        "Untitled board"
    } else {
        name.trim()
    });
    save(paths, &board)?;
    Ok(board)
}

pub fn save(paths: &Paths, board: &Board) -> Result<(), String> {
    let _guard = BOARD_LOCK.lock();
    save_unlocked(paths, board)
}

fn save_unlocked(paths: &Paths, board: &Board) -> Result<(), String> {
    let p = path(paths, &board.id)?;
    store::save_atomic(&p, board).map_err(|e| e.to_string())
}

pub fn delete(paths: &Paths, id: &str) -> Result<(), String> {
    let _guard = BOARD_LOCK.lock();
    let p = path(paths, id)?;
    let doomed = get_unlocked(paths, id).ok();
    match fs::remove_file(p) {
        Ok(()) => {}
        Err(e) if e.kind() == io::ErrorKind::NotFound => {}
        Err(e) => return Err(e.to_string()),
    }
    // Assets are content-addressed and shared: drop only those no remaining board references.
    if let Some(board) = doomed {
        let keep: HashSet<String> = list(paths)
            .into_iter()
            .filter_map(|s| get_unlocked(paths, &s.id).ok())
            .flat_map(|b| {
                b.assets()
                    .into_iter()
                    .map(str::to_string)
                    .collect::<Vec<_>>()
            })
            .collect();
        let store = assets(paths);
        for hash in board.assets() {
            if !keep.contains(hash) {
                let _ = store.remove(hash);
            }
        }
    }
    Ok(())
}

pub fn assets(paths: &Paths) -> AssetStore {
    AssetStore::new(paths.assets())
}

pub fn put_asset(paths: &Paths, data_base64: &str, mime: &str) -> Result<String, String> {
    let payload = data_base64.split_once(',').map_or(data_base64, |(_, b)| b);
    let bytes = STANDARD.decode(payload.trim()).map_err(|e| e.to_string())?;
    if bytes.len() as u64 > MAX_IMAGE_BYTES {
        return Err("image too large".into());
    }
    let mime = if mime.starts_with("image/") {
        mime
    } else {
        "application/octet-stream"
    };
    assets(paths).put(&bytes, mime).map_err(|e| e.to_string())
}

/// Download an image and add it to a board, centred at `(cx, cy)`.
///
/// The URL is attacker-influenced (it is the `src` of an image on a page the user right-clicked), so the
/// connection is restricted to public addresses, redirects are re-checked, and oversize bodies are rejected.
pub fn add_from_url(
    paths: &Paths,
    board_id: &str,
    url: &str,
    cx: f64,
    cy: f64,
) -> Result<(), String> {
    if !(url.starts_with("http://") || url.starts_with("https://")) {
        return Err("only http(s) image URLs are supported".into());
    }
    let agent = ureq::AgentBuilder::new()
        .resolver(PublicOnly)
        .redirects(3)
        .timeout(std::time::Duration::from_secs(20))
        .build();
    let resp = agent.get(url).call().map_err(|e| e.to_string())?;
    let mime = resp.content_type().to_string();
    if !mime.starts_with("image/") {
        return Err(format!("not an image ({mime})"));
    }
    if resp
        .header("content-length")
        .and_then(|v| v.parse::<u64>().ok())
        .is_some_and(|n| n > MAX_IMAGE_BYTES)
    {
        return Err("image too large".into());
    }
    let mut bytes = Vec::new();
    resp.into_reader()
        .take(MAX_IMAGE_BYTES + 1)
        .read_to_end(&mut bytes)
        .map_err(|e| e.to_string())?;
    if bytes.len() as u64 > MAX_IMAGE_BYTES {
        return Err("image too large".into());
    }
    let size = imagesize::blob_size(&bytes).map_err(|e| e.to_string())?;
    let hash = assets(paths)
        .put(&bytes, &mime)
        .map_err(|e| e.to_string())?;
    let _guard = BOARD_LOCK.lock();
    let mut board = get_unlocked(paths, board_id)?;
    board.add_image(
        ImageSpec {
            source_url: Some(url.to_string()),
            ..ImageSpec::new(&hash, &mime, size.width as f64, size.height as f64)
        },
        cx,
        cy,
    );
    save_unlocked(paths, &board)
}

/// Id of the catch-all "Inbox" board, created on first use.
pub fn inbox_id(paths: &Paths) -> Result<String, String> {
    if let Some(b) = list(paths).into_iter().find(|b| b.name == "Inbox") {
        return Ok(b.id);
    }
    Ok(create(paths, "Inbox")?.id)
}

/// Add an already-stored asset to a board at the next free "drop" position.
pub fn add_asset(
    paths: &Paths,
    board_id: &str,
    hash: &str,
    mime: &str,
    w: f64,
    h: f64,
    source: Option<String>,
) -> Result<(), String> {
    let _guard = BOARD_LOCK.lock();
    let mut board = get_unlocked(paths, board_id)?;
    let n = board.items.len() as f64;
    let (cx, cy) = ((n % 8.0) * 36.0, (n % 8.0) * 28.0);
    board.add_image(
        ImageSpec {
            source_url: source,
            ..ImageSpec::new(hash, mime, w, h)
        },
        cx,
        cy,
    );
    save_unlocked(paths, &board)
}

#[cfg(test)]
mod tests {
    use super::*;
    use ureq::Resolver as _;

    fn ip(s: &str) -> IpAddr {
        s.parse().unwrap()
    }

    #[test]
    fn internal_addresses_are_not_public() {
        for bad in [
            "127.0.0.1",
            "10.1.2.3",
            "172.16.0.1",
            "192.168.1.1",
            "169.254.169.254",
            "0.0.0.0",
            "100.64.0.1",
            "224.0.0.1",
            "255.255.255.255",
            "192.0.2.1",
            "::1",
            "::",
            "fe80::1",
            "fc00::1",
            "fd12:3456::1",
            "::ffff:127.0.0.1",
            "::ffff:10.0.0.1",
            "ff02::1",
            "2001:db8::1",
        ] {
            assert!(!is_public_ip(ip(bad)), "{bad} must be rejected");
        }
        for good in [
            "8.8.8.8",
            "1.1.1.1",
            "93.184.216.34",
            "2606:4700:4700::1111",
            "::ffff:8.8.8.8",
        ] {
            assert!(is_public_ip(ip(good)), "{good} must be allowed");
        }
    }

    #[test]
    fn resolver_refuses_loopback_and_literal_ip_tricks() {
        let r = PublicOnly;
        assert!(r.resolve("127.0.0.1:80").is_err());
        assert!(r.resolve("localhost:80").is_err());
        assert!(r.resolve("[::1]:80").is_err());
        // decimal form is normalised by the URL parser before it ever gets here
        assert_eq!(
            url::Url::parse("http://2130706433/").unwrap().host_str(),
            Some("127.0.0.1")
        );
    }

    #[test]
    fn non_http_and_internal_urls_fail_fast_without_network() {
        let dir = std::env::temp_dir().join(format!("athanor-boards-{}", athanor_core::new_id()));
        let paths = Paths { root: dir };
        let b = create(&paths, "t").unwrap();
        assert!(add_from_url(&paths, &b.id, "file:///etc/passwd", 0.0, 0.0).is_err());
        assert!(add_from_url(&paths, &b.id, "http://127.0.0.1:1/x.png", 0.0, 0.0).is_err());
        assert!(add_from_url(
            &paths,
            &b.id,
            "http://169.254.169.254/latest/meta-data/",
            0.0,
            0.0
        )
        .is_err());
        let _ = fs::remove_dir_all(&paths.root);
    }

    #[test]
    fn delete_drops_only_unreferenced_assets() {
        let dir = std::env::temp_dir().join(format!("athanor-boards-{}", athanor_core::new_id()));
        let paths = Paths { root: dir };
        let shared = assets(&paths).put(b"shared-bytes", "image/png").unwrap();
        let only_a = assets(&paths).put(b"only-in-a", "image/png").unwrap();
        let mut a = create(&paths, "a").unwrap();
        let mut b = create(&paths, "b").unwrap();
        a.add_image(ImageSpec::new(&shared, "image/png", 10.0, 10.0), 0.0, 0.0);
        a.add_image(ImageSpec::new(&only_a, "image/png", 10.0, 10.0), 0.0, 0.0);
        b.add_image(ImageSpec::new(&shared, "image/png", 10.0, 10.0), 0.0, 0.0);
        save(&paths, &a).unwrap();
        save(&paths, &b).unwrap();
        delete(&paths, &a.id).unwrap();
        assert!(assets(&paths).get(&shared).is_ok(), "still used by board b");
        assert!(assets(&paths).get(&only_a).is_err(), "no longer referenced");
        let _ = fs::remove_dir_all(&paths.root);
    }
}
