//! Reference boards on disk: one JSON file per board + a content-addressed asset store.

use crate::browser::{now, Paths};
use athanor_core::{
    board::{AssetStore, Board, ImageSpec},
    store,
};
use base64::{engine::general_purpose::STANDARD, Engine as _};
use serde::Serialize;
use std::{fs, io::Read, time::UNIX_EPOCH};

const MAX_IMAGE_BYTES: u64 = 40 * 1024 * 1024;

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
            Some(BoardSummary { id: board.id, name: board.name, item_count: board.items.len(), updated_at })
        })
        .collect();
    out.sort_by_key(|b| std::cmp::Reverse(b.updated_at));
    out
}

pub fn get(paths: &Paths, id: &str) -> Result<Board, String> {
    let bytes = fs::read(path(paths, id)?).map_err(|e| e.to_string())?;
    serde_json::from_slice(&bytes).map_err(|e| e.to_string())
}

pub fn create(paths: &Paths, name: &str) -> Result<Board, String> {
    let board = Board::new(if name.trim().is_empty() { "Untitled board" } else { name.trim() });
    save(paths, &board)?;
    Ok(board)
}

pub fn save(paths: &Paths, board: &Board) -> Result<(), String> {
    let p = path(paths, &board.id)?;
    store::save_atomic(&p, board).map_err(|e| e.to_string())
}

pub fn delete(paths: &Paths, id: &str) -> Result<(), String> {
    let p = path(paths, id)?;
    match fs::remove_file(p) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(e.to_string()),
    }
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
    let mime = if mime.starts_with("image/") { mime } else { "application/octet-stream" };
    assets(paths).put(&bytes, mime).map_err(|e| e.to_string())
}

/// Download an image and add it to a board, centred at `(cx, cy)`.
pub fn add_from_url(paths: &Paths, board_id: &str, url: &str, cx: f64, cy: f64) -> Result<(), String> {
    if !(url.starts_with("http://") || url.starts_with("https://")) {
        return Err("only http(s) image URLs are supported".into());
    }
    let resp = ureq::get(url).timeout(std::time::Duration::from_secs(20)).call().map_err(|e| e.to_string())?;
    let mime = resp.content_type().to_string();
    if !mime.starts_with("image/") {
        return Err(format!("not an image ({mime})"));
    }
    let mut bytes = Vec::new();
    resp.into_reader().take(MAX_IMAGE_BYTES).read_to_end(&mut bytes).map_err(|e| e.to_string())?;
    let size = imagesize::blob_size(&bytes).map_err(|e| e.to_string())?;
    let hash = assets(paths).put(&bytes, &mime).map_err(|e| e.to_string())?;
    let mut board = get(paths, board_id)?;
    board.add_image(ImageSpec { source_url: Some(url.to_string()), ..ImageSpec::new(&hash, &mime, size.width as f64, size.height as f64) }, cx, cy);
    save(paths, &board)?;
    let _ = now();
    Ok(())
}

/// Id of the catch-all "Inbox" board, created on first use.
pub fn inbox_id(paths: &Paths) -> Result<String, String> {
    if let Some(b) = list(paths).into_iter().find(|b| b.name == "Inbox") {
        return Ok(b.id);
    }
    Ok(create(paths, "Inbox")?.id)
}

/// Add an already-stored asset to a board at the next free "drop" position.
pub fn add_asset(paths: &Paths, board_id: &str, hash: &str, mime: &str, w: f64, h: f64, source: Option<String>) -> Result<(), String> {
    let mut board = get(paths, board_id)?;
    let n = board.items.len() as f64;
    let (cx, cy) = ((n % 8.0) * 36.0, (n % 8.0) * 28.0);
    board.add_image(ImageSpec { source_url: source, ..ImageSpec::new(hash, mime, w, h) }, cx, cy);
    save(paths, &board)
}
