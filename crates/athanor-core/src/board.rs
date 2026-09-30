//! Reference boards (PureRef-style): a freeform canvas of images and notes, plus a
//! content-addressed asset store so boards stay small JSON files.

use crate::{new_id, Id};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{collections::HashSet, fs, io, path::{Path, PathBuf}};

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum ItemKind {
    #[serde(rename_all = "camelCase")]
    Image {
        /// sha256 hex of the stored bytes (see [`AssetStore`]).
        asset: String,
        mime: String,
        #[serde(default)]
        source_url: Option<String>,
    },
    #[serde(rename_all = "camelCase")]
    Text { text: String, size: f64, color: String },
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Item {
    pub id: Id,
    #[serde(flatten)]
    pub kind: ItemKind,
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
    /// Degrees, clockwise.
    #[serde(default)]
    pub rotation: f64,
    #[serde(default = "one")]
    pub opacity: f64,
    #[serde(default)]
    pub flip_x: bool,
    #[serde(default)]
    pub grayscale: bool,
    #[serde(default)]
    pub locked: bool,
    #[serde(default)]
    pub z: i32,
}

fn one() -> f64 {
    1.0
}

/// Canvas pan/zoom. Missing fields fall back to [`View::default`] (`zoom: 1.0`), so a board
/// written before the zoom was stored still opens.
#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct View {
    pub x: f64,
    pub y: f64,
    pub zoom: f64,
}

impl Default for View {
    fn default() -> Self {
        Self { x: 0.0, y: 0.0, zoom: 1.0 }
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Board {
    pub id: Id,
    pub name: String,
    #[serde(default)]
    pub items: Vec<Item>,
    #[serde(default)]
    pub view: View,
    #[serde(default = "default_bg")]
    pub background: String,
    #[serde(default)]
    pub always_on_top: bool,
}

fn default_bg() -> String {
    "#1e1e1e".into()
}

/// An image already stored in the [`AssetStore`], with its natural size.
pub struct ImageSpec<'a> {
    pub asset: &'a str,
    pub mime: &'a str,
    pub source_url: Option<String>,
    pub width: f64,
    pub height: f64,
}

impl<'a> ImageSpec<'a> {
    pub fn new(asset: &'a str, mime: &'a str, width: f64, height: f64) -> Self {
        Self { asset, mime, source_url: None, width, height }
    }
}

/// Longest edge of a freshly added image, in board units.
const DEFAULT_MAX_EDGE: f64 = 400.0;

impl Board {
    pub fn new(name: &str) -> Self {
        Self { id: new_id(), name: name.into(), items: vec![], view: View::default(), background: default_bg(), always_on_top: false }
    }

    /// One above the topmost item. Saturates: a board whose z already reached `i32::MAX`
    /// (hand-edited or long-lived) must not panic on the next insert.
    fn next_z(&self) -> i32 {
        self.items.iter().map(|i| i.z).max().map_or(0, |z| z.saturating_add(1))
    }

    /// Add an image centred on `(cx, cy)` (board coordinates), scaled so its longest edge is at most 400.
    pub fn add_image(&mut self, img: ImageSpec, cx: f64, cy: f64) -> Id {
        let ImageSpec { asset, mime, source_url, width: nat_w, height: nat_h } = img;
        let (nat_w, nat_h) = (nat_w.max(1.0), nat_h.max(1.0));
        let scale = (DEFAULT_MAX_EDGE / nat_w.max(nat_h)).min(1.0);
        let (w, h) = (nat_w * scale, nat_h * scale);
        let item = Item {
            id: new_id(),
            kind: ItemKind::Image { asset: asset.into(), mime: mime.into(), source_url },
            x: cx - w / 2.0,
            y: cy - h / 2.0,
            w,
            h,
            rotation: 0.0,
            opacity: 1.0,
            flip_x: false,
            grayscale: false,
            locked: false,
            z: self.next_z(),
        };
        let id = item.id.clone();
        self.items.push(item);
        id
    }

    pub fn add_text(&mut self, text: &str, cx: f64, cy: f64) -> Id {
        let (w, h) = (240.0, 60.0);
        let item = Item {
            id: new_id(),
            kind: ItemKind::Text { text: text.into(), size: 24.0, color: "#ffffff".into() },
            x: cx - w / 2.0,
            y: cy - h / 2.0,
            w,
            h,
            rotation: 0.0,
            opacity: 1.0,
            flip_x: false,
            grayscale: false,
            locked: false,
            z: self.next_z(),
        };
        let id = item.id.clone();
        self.items.push(item);
        id
    }

    pub fn remove(&mut self, id: &str) -> bool {
        let n = self.items.len();
        self.items.retain(|i| i.id != id);
        n != self.items.len()
    }

    pub fn bring_to_front(&mut self, id: &str) {
        let z = self.next_z();
        if let Some(i) = self.items.iter_mut().find(|i| i.id == id) {
            i.z = z;
        }
    }

    pub fn send_to_back(&mut self, id: &str) {
        let z = self.items.iter().map(|i| i.z).min().map_or(0, |z| z.saturating_sub(1));
        if let Some(i) = self.items.iter_mut().find(|i| i.id == id) {
            i.z = z;
        }
    }

    /// Axis-aligned bounds of all items (ignores rotation), as `(x, y, w, h)`.
    pub fn bounds(&self) -> Option<(f64, f64, f64, f64)> {
        let mut it = self.items.iter();
        let first = it.next()?;
        let (mut x0, mut y0, mut x1, mut y1) = (first.x, first.y, first.x + first.w, first.y + first.h);
        for i in it {
            x0 = x0.min(i.x);
            y0 = y0.min(i.y);
            x1 = x1.max(i.x + i.w);
            y1 = y1.max(i.y + i.h);
        }
        Some((x0, y0, x1 - x0, y1 - y0))
    }

    /// Set the view so everything fits inside a viewport of `vw` x `vh` with `pad` margin.
    pub fn fit_view(&mut self, vw: f64, vh: f64, pad: f64) {
        let Some((x, y, w, h)) = self.bounds() else {
            self.view = View::default();
            return;
        };
        let zoom = ((vw - 2.0 * pad) / w.max(1.0)).min((vh - 2.0 * pad) / h.max(1.0)).clamp(0.02, 8.0);
        self.view = View { zoom, x: vw / 2.0 - (x + w / 2.0) * zoom, y: vh / 2.0 - (y + h / 2.0) * zoom };
    }

    /// Shelf-pack all unlocked items into rows aiming at a roughly 16:10 overall shape.
    pub fn arrange(&mut self, gap: f64) {
        let mut idx: Vec<usize> = (0..self.items.len()).filter(|&i| !self.items[i].locked).collect();
        if idx.is_empty() {
            return;
        }
        idx.sort_by(|&a, &b| self.items[b].h.total_cmp(&self.items[a].h));
        let area: f64 = idx.iter().map(|&i| (self.items[i].w + gap) * (self.items[i].h + gap)).sum();
        let row_w = (area * 1.6).sqrt().max(self.items[idx[0]].w);
        let (mut x, mut y, mut row_h) = (0.0, 0.0, 0.0f64);
        for &i in &idx {
            let it = &mut self.items[i];
            if x > 0.0 && x + it.w > row_w {
                x = 0.0;
                y += row_h + gap;
                row_h = 0.0;
            }
            it.x = x;
            it.y = y;
            it.rotation = 0.0;
            x += it.w + gap;
            row_h = row_h.max(it.h);
        }
    }

    /// Asset hashes referenced by this board.
    pub fn assets(&self) -> Vec<&str> {
        self.items
            .iter()
            .filter_map(|i| match &i.kind {
                ItemKind::Image { asset, .. } => Some(asset.as_str()),
                _ => None,
            })
            .collect()
    }
}

/// Content-addressed file store: `<root>/<hash>` holds the bytes, `<root>/<hash>.mime` its type.
pub struct AssetStore {
    root: PathBuf,
}

impl AssetStore {
    pub fn new(root: impl Into<PathBuf>) -> Self {
        Self { root: root.into() }
    }

    pub fn put(&self, bytes: &[u8], mime: &str) -> io::Result<String> {
        let hash: String = Sha256::digest(bytes).iter().map(|b| format!("{b:02x}")).collect();
        fs::create_dir_all(&self.root)?;
        let path = self.root.join(&hash);
        if !path.exists() {
            fs::write(&path, bytes)?;
            fs::write(self.root.join(format!("{hash}.mime")), mime)?;
        }
        Ok(hash)
    }

    fn valid(hash: &str) -> bool {
        hash.len() == 64 && hash.bytes().all(|b| b.is_ascii_hexdigit())
    }

    /// Returns `(bytes, mime)`. Rejects anything that is not a 64-char hex hash (no path traversal).
    pub fn get(&self, hash: &str) -> io::Result<(Vec<u8>, String)> {
        if !Self::valid(hash) {
            return Err(io::Error::new(io::ErrorKind::InvalidInput, "bad asset hash"));
        }
        let bytes = fs::read(self.root.join(hash))?;
        let mime = fs::read_to_string(self.root.join(format!("{hash}.mime"))).unwrap_or_else(|_| "application/octet-stream".into());
        Ok((bytes, mime))
    }

    /// Delete the asset and its `.mime` sidecar. A hash that is not stored is not an error;
    /// a hash that is not 64 hex chars is rejected like in [`Self::get`].
    pub fn remove(&self, hash: &str) -> io::Result<()> {
        if !Self::valid(hash) {
            return Err(io::Error::new(io::ErrorKind::InvalidInput, "bad asset hash"));
        }
        remove_file_if_exists(&self.root.join(hash))?;
        remove_file_if_exists(&self.root.join(format!("{hash}.mime")))
    }

    /// Delete every stored asset whose hash is not in `keep` and return how many were removed.
    ///
    /// Only files named with 64 hex chars count as assets (plus their `.mime` sidecar), so
    /// anything else living in the store directory is left alone. A store that was never
    /// written to holds nothing to collect.
    pub fn gc(&self, keep: &HashSet<String>) -> io::Result<usize> {
        let entries = match fs::read_dir(&self.root) {
            Ok(entries) => entries,
            Err(e) if e.kind() == io::ErrorKind::NotFound => return Ok(0),
            Err(e) => return Err(e),
        };
        let mut removed = 0;
        for entry in entries {
            let entry = entry?;
            if !entry.file_type()?.is_file() {
                continue;
            }
            let Some(name) = entry.file_name().to_str().map(str::to_string) else { continue };
            if !Self::valid(&name) || keep.contains(&name) {
                continue;
            }
            remove_file_if_exists(&entry.path())?;
            remove_file_if_exists(&self.root.join(format!("{name}.mime")))?;
            removed += 1;
        }
        Ok(removed)
    }

    pub fn root(&self) -> &Path {
        &self.root
    }
}

/// `fs::remove_file` that treats "already gone" as success, so deleting is idempotent.
fn remove_file_if_exists(path: &Path) -> io::Result<()> {
    match fs::remove_file(path) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(e),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn add_image_scales_and_centres() {
        let mut b = Board::new("t");
        b.add_image(ImageSpec::new("h", "image/png", 800.0, 400.0), 0.0, 0.0);
        let i = &b.items[0];
        assert_eq!((i.w, i.h), (400.0, 200.0));
        assert_eq!((i.x, i.y), (-200.0, -100.0));
        b.add_image(ImageSpec::new("h2", "image/png", 100.0, 50.0), 0.0, 0.0);
        assert_eq!(b.items[1].w, 100.0, "small images are not upscaled");
        assert!(b.items[1].z > b.items[0].z);
    }

    #[test]
    fn z_order_and_remove() {
        let mut b = Board::new("t");
        let a = b.add_text("a", 0.0, 0.0);
        let c = b.add_text("c", 0.0, 0.0);
        b.bring_to_front(&a);
        assert!(b.items[0].z > b.items[1].z);
        b.send_to_back(&a);
        assert!(b.items[0].z < b.items[1].z);
        assert!(b.remove(&c));
        assert!(!b.remove(&c));
    }

    #[test]
    fn arrange_has_no_overlap_and_skips_locked() {
        let mut b = Board::new("t");
        for _ in 0..7 {
            b.add_image(ImageSpec::new("h", "image/png", 300.0, 200.0), 0.0, 0.0);
        }
        b.items[0].locked = true;
        let (lx, ly) = (b.items[0].x, b.items[0].y);
        b.arrange(10.0);
        assert_eq!((b.items[0].x, b.items[0].y), (lx, ly));
        let moved: Vec<&Item> = b.items.iter().filter(|i| !i.locked).collect();
        for (n, a) in moved.iter().enumerate() {
            for c in &moved[n + 1..] {
                let overlap = a.x < c.x + c.w && c.x < a.x + a.w && a.y < c.y + c.h && c.y < a.y + a.h;
                assert!(!overlap, "items overlap after arrange");
            }
        }
    }

    #[test]
    fn fit_view_centres_content() {
        let mut b = Board::new("t");
        b.add_image(ImageSpec::new("h", "image/png", 400.0, 400.0), 1000.0, 1000.0);
        b.fit_view(800.0, 600.0, 50.0);
        let (x, y, w, h) = b.bounds().unwrap();
        let cx = (x + w / 2.0) * b.view.zoom + b.view.x;
        let cy = (y + h / 2.0) * b.view.zoom + b.view.y;
        assert!((cx - 400.0).abs() < 1e-6 && (cy - 300.0).abs() < 1e-6);
    }

    #[test]
    fn serde_roundtrip_camel_case() {
        let mut b = Board::new("t");
        b.add_image(ImageSpec { source_url: Some("https://x".into()), ..ImageSpec::new("abc", "image/png", 10.0, 10.0) }, 0.0, 0.0);
        let json = serde_json::to_string(&b).unwrap();
        assert!(json.contains("\"flipX\"") && json.contains("\"sourceUrl\"") && json.contains("\"kind\":\"image\""));
        assert_eq!(serde_json::from_str::<Board>(&json).unwrap(), b);
    }

    #[test]
    fn asset_store_dedupes_and_rejects_traversal() {
        let dir = std::env::temp_dir().join(format!("athanor-assets-{}", new_id()));
        let s = AssetStore::new(&dir);
        let h1 = s.put(b"bytes", "image/png").unwrap();
        let h2 = s.put(b"bytes", "image/png").unwrap();
        assert_eq!(h1, h2);
        assert_eq!(s.get(&h1).unwrap(), (b"bytes".to_vec(), "image/png".to_string()));
        assert!(s.get("../secret").is_err());
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn asset_store_remove_drops_bytes_and_mime() {
        let dir = std::env::temp_dir().join(format!("athanor-assets-{}", new_id()));
        let s = AssetStore::new(&dir);
        let h = s.put(b"bytes", "image/png").unwrap();
        s.remove(&h).unwrap();
        assert!(!dir.join(&h).exists() && !dir.join(format!("{h}.mime")).exists());
        assert!(s.get(&h).is_err());
        s.remove(&h).expect("removing an asset twice is not an error");
        assert!(s.remove("../secret").is_err(), "the hash is still validated");
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn asset_store_gc_keeps_referenced_assets_only() {
        let dir = std::env::temp_dir().join(format!("athanor-assets-{}", new_id()));
        let s = AssetStore::new(&dir);
        let keep = s.put(b"keep", "image/png").unwrap();
        let doomed = s.put(b"drop", "image/png").unwrap();
        let other = s.put(b"other", "image/webp").unwrap();
        // Not an asset: a stray file in the store directory must survive.
        let stray = dir.join("notes.txt");
        fs::write(&stray, b"mine").unwrap();
        let keep_set: HashSet<String> = [keep.clone(), other.clone()].into_iter().collect();
        assert_eq!(s.gc(&keep_set).unwrap(), 1);
        assert!(dir.join(&keep).exists() && dir.join(&other).exists());
        assert!(dir.join(format!("{keep}.mime")).exists());
        assert!(!dir.join(&doomed).exists() && !dir.join(format!("{doomed}.mime")).exists());
        assert!(stray.exists(), "gc only touches 64-char hex names");
        assert_eq!(s.gc(&keep_set).unwrap(), 0, "a second pass finds nothing left");
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn asset_store_gc_on_an_empty_store_is_a_no_op() {
        let dir = std::env::temp_dir().join(format!("athanor-assets-{}", new_id()));
        assert_eq!(AssetStore::new(&dir).gc(&HashSet::new()).unwrap(), 0);
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn view_defaults_to_unit_zoom_when_the_field_is_missing() {
        let b: Board = serde_json::from_str(r#"{"id":"b","name":"old","view":{"x":10.0,"y":20.0}}"#).unwrap();
        assert_eq!(b.view, View { x: 10.0, y: 20.0, zoom: 1.0 });
        let b: Board = serde_json::from_str(r#"{"id":"b","name":"no view at all"}"#).unwrap();
        assert_eq!(b.view, View::default());
        assert!(b.items.is_empty() && b.background == "#1e1e1e");
    }

    #[test]
    fn z_order_saturates_instead_of_overflowing() {
        let mut b = Board::new("t");
        let a = b.add_text("a", 0.0, 0.0);
        b.add_text("c", 0.0, 0.0);
        b.items[0].z = i32::MAX;
        b.bring_to_front(&a);
        assert_eq!(b.items[0].z, i32::MAX, "clamped, not wrapped");
        b.add_text("d", 0.0, 0.0);
        assert_eq!(b.items[2].z, i32::MAX, "a new item still gets the top z");
        b.add_image(ImageSpec::new("h", "image/png", 10.0, 10.0), 0.0, 0.0);
        assert_eq!(b.items[3].z, i32::MAX);

        b.items[0].z = i32::MIN;
        b.send_to_back(&a);
        assert_eq!(b.items[0].z, i32::MIN, "clamped, not wrapped");
        assert_eq!(b.items[2].z, i32::MAX, "the rest of the stack is untouched");
    }
}
