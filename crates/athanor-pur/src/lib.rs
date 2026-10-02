//! Read embedded images and text notes from PureRef 2.x `.pur` boards.
//!
//! The parser supports 2.0 and 2.1 envelopes, affine transforms, nested groups,
//! embedded and locally linked images, and plain text extracted from HTML notes.
//! Cropped images are returned uncropped with a warning. Vector drawings are
//! skipped with a warning.
#![allow(unknown_lints, clippy::chunks_exact_to_as_chunks)]

use rusqlite::{types::ValueRef, Connection, OpenFlags, Row};
use std::collections::{HashMap, HashSet};
use std::fs::{self, OpenOptions};
use std::io::{self, Write};
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use thiserror::Error;

const SQLITE_MAGIC: &[u8; 16] = b"SQLite format 3\0";
const MAX_FILE_BYTES: usize = 512 * 1024 * 1024;
const MAX_ITEMS: i64 = 20_000;
const MAX_HEADER_STRING_BYTES: usize = 1024 * 1024;
const MAX_VARIANT_BYTES: usize = 1024 * 1024;
static NEXT_TEMP_ID: AtomicU64 = AtomicU64::new(0);

/// A parsed board in database z-order.
#[derive(Debug, Default)]
pub struct PurBoard {
    /// Images and text notes in ascending z-order, with item ID as the tie-breaker.
    pub items: Vec<PurItem>,
    /// Non-fatal conditions such as checksum mismatches, crops, or skipped content.
    pub warnings: Vec<String>,
}

/// An image or text note from a PureRef board.
#[derive(Debug, PartialEq)]
pub enum PurItem {
    /// An encoded image with its world-space placement and rendering flags.
    Image {
        data: Vec<u8>,
        mime: String,
        name: Option<String>,
        x: f64,
        y: f64,
        w: f64,
        h: f64,
        rotation: f64,
        opacity: f64,
        flip_x: bool,
        grayscale: bool,
        locked: bool,
        z: i64,
    },
    /// A note whose HTML markup has been removed while preserving line breaks.
    Text {
        text: String,
        x: f64,
        y: f64,
        size: f64,
        color: String,
        z: i64,
    },
}

/// Errors raised while reading a PureRef board.
#[derive(Debug, Error)]
pub enum PurError {
    /// The input is not a recognized PureRef 2.x envelope.
    #[error("not a PureRef 2 file: {0}")]
    NotPureRef(String),
    /// PureRef's unrelated binary 1.x format is not supported.
    #[error("PureRef 1.x files are not supported")]
    UnsupportedLegacy,
    /// The file resembles a supported envelope but contains invalid data.
    #[error("invalid PureRef file: {0}")]
    InvalidFormat(String),
    /// SQLite could not read the reconstructed database.
    #[error("could not read PureRef database: {0}")]
    Sqlite(#[from] rusqlite::Error),
    /// A temporary reconstructed database could not be created or read.
    #[error("could not prepare PureRef database: {0}")]
    Io(#[from] io::Error),
}

/// Parse a PureRef 2.0 or 2.1 `.pur` file from memory.
///
/// Files larger than 512 MiB and boards with more than 20,000 common item rows
/// are rejected. The header checksum is checked but a mismatch is reported as a
/// warning so structurally readable boards can still be recovered.
pub fn parse(bytes: &[u8]) -> Result<PurBoard, PurError> {
    if bytes.len() > MAX_FILE_BYTES {
        return Err(PurError::InvalidFormat(format!(
            "file exceeds the {} MiB size limit",
            MAX_FILE_BYTES / (1024 * 1024)
        )));
    }

    let envelope = Envelope::parse(bytes)?;
    let mut warnings = Vec::new();
    if !envelope.checksum_valid {
        warnings.push("PureRef header checksum does not match the file contents.".to_owned());
    }

    let database = reconstruct_database(bytes, &envelope);
    validate_database_header(&database)?;
    let temporary = TempDatabase::open(&database)?;
    read_board(temporary.connection()?, warnings)
}

struct Envelope {
    offset: usize,
    header_size: usize,
    checksum_valid: bool,
}

impl Envelope {
    fn parse(bytes: &[u8]) -> Result<Self, PurError> {
        let mut cursor = Cursor::new(bytes);
        let format_version = cursor
            .qstring("format version", 32)
            .map_err(|error| {
                if bytes.len() < 4
                    || u32::from_be_bytes([bytes[0], bytes[1], bytes[2], bytes[3]]) > 32
                {
                    PurError::NotPureRef("invalid format version field".to_owned())
                } else {
                    error
                }
            })?
            .ok_or_else(|| PurError::NotPureRef("null format version".to_owned()))?;
        match format_version.as_str() {
            "2.0" | "2.1" => {}
            version if version.starts_with("1.") => return Err(PurError::UnsupportedLegacy),
            version => {
                return Err(PurError::NotPureRef(format!(
                    "unsupported format version {version:?}"
                )))
            }
        }

        let _reserved = cursor.u32("reserved header word")?;
        let raw_offset = cursor.u64("database displacement offset")?;
        let offset = usize::try_from(raw_offset).map_err(|_| {
            PurError::InvalidFormat("database offset does not fit this platform".to_owned())
        })?;
        let _application_version =
            cursor.qstring("application version", MAX_HEADER_STRING_BYTES)?;
        let checksum = cursor
            .qstring("checksum", 128)?
            .ok_or_else(|| PurError::InvalidFormat("null checksum".to_owned()))?;
        let checksum_start = cursor.position();

        if format_version == "2.1" {
            cursor.skip_qbytearray("thumbnail")?;
        }

        let header_size = cursor.position();
        if offset < header_size {
            return Err(PurError::InvalidFormat(
                "database displacement offset precedes the end of the header".to_owned(),
            ));
        }
        let expected_length = offset.checked_add(header_size).ok_or_else(|| {
            PurError::InvalidFormat("database displacement length overflows".to_owned())
        })?;
        if expected_length != bytes.len() {
            return Err(PurError::InvalidFormat(format!(
                "invalid displacement: expected {expected_length} bytes, found {}",
                bytes.len()
            )));
        }

        let actual_checksum = md5_hex(&bytes[checksum_start..]);
        Ok(Self {
            offset,
            header_size,
            checksum_valid: checksum.eq_ignore_ascii_case(&actual_checksum),
        })
    }
}

fn reconstruct_database(bytes: &[u8], envelope: &Envelope) -> Vec<u8> {
    let mut database = Vec::with_capacity(envelope.offset);
    database.extend_from_slice(&bytes[envelope.offset..]);
    database.extend_from_slice(&bytes[envelope.header_size..envelope.offset]);
    database
}

fn md5_hex(data: &[u8]) -> String {
    const SHIFTS: [u32; 64] = [
        7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 5, 9, 14, 20, 5, 9, 14, 20, 5,
        9, 14, 20, 5, 9, 14, 20, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 6, 10,
        15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21,
    ];
    let mut state = [0x6745_2301u32, 0xefcd_ab89, 0x98ba_dcfe, 0x1032_5476];
    let mut chunks = data.chunks_exact(64);
    for chunk in &mut chunks {
        let mut block = [0u8; 64];
        block.copy_from_slice(chunk);
        md5_compress(&mut state, &block, &SHIFTS);
    }

    let remainder = chunks.remainder();
    let mut padding = [0u8; 128];
    padding[..remainder.len()].copy_from_slice(remainder);
    padding[remainder.len()] = 0x80;
    let padded_len = if remainder.len() < 56 { 64 } else { 128 };
    let bit_length = (data.len() as u64).wrapping_mul(8);
    padding[padded_len - 8..padded_len].copy_from_slice(&bit_length.to_le_bytes());
    for chunk in padding[..padded_len].chunks_exact(64) {
        let mut block = [0u8; 64];
        block.copy_from_slice(chunk);
        md5_compress(&mut state, &block, &SHIFTS);
    }

    let mut result = String::with_capacity(32);
    const HEX: &[u8; 16] = b"0123456789abcdef";
    for word in state {
        for byte in word.to_le_bytes() {
            result.push(char::from(HEX[usize::from(byte >> 4)]));
            result.push(char::from(HEX[usize::from(byte & 0x0f)]));
        }
    }
    result
}

fn md5_compress(state: &mut [u32; 4], block: &[u8; 64], shifts: &[u32; 64]) {
    let mut words = [0u32; 16];
    for (index, word) in words.iter_mut().enumerate() {
        let start = index * 4;
        *word = u32::from_le_bytes([
            block[start],
            block[start + 1],
            block[start + 2],
            block[start + 3],
        ]);
    }

    let mut a = state[0];
    let mut b = state[1];
    let mut c = state[2];
    let mut d = state[3];
    for (index, shift) in shifts.iter().copied().enumerate() {
        let (function, word_index) = match index {
            0..=15 => ((b & c) | (!b & d), index),
            16..=31 => ((d & b) | (!d & c), (5 * index + 1) % 16),
            32..=47 => (b ^ c ^ d, (3 * index + 5) % 16),
            _ => (c ^ (b | !d), (7 * index) % 16),
        };
        let constant = ((1u64 << 32) as f64 * ((index + 1) as f64).sin().abs()) as u32;
        let next = a
            .wrapping_add(function)
            .wrapping_add(constant)
            .wrapping_add(words[word_index])
            .rotate_left(shift)
            .wrapping_add(b);
        a = d;
        d = c;
        c = b;
        b = next;
    }
    state[0] = state[0].wrapping_add(a);
    state[1] = state[1].wrapping_add(b);
    state[2] = state[2].wrapping_add(c);
    state[3] = state[3].wrapping_add(d);
}

fn validate_database_header(database: &[u8]) -> Result<(), PurError> {
    if database.len() < 100 || !database.starts_with(SQLITE_MAGIC) {
        return Err(PurError::InvalidFormat(
            "reconstructed database has no SQLite header".to_owned(),
        ));
    }
    let raw_page_size = u16::from_be_bytes([database[16], database[17]]);
    let page_size = if raw_page_size == 1 {
        65_536
    } else {
        usize::from(raw_page_size)
    };
    if !(512..=65_536).contains(&page_size)
        || !page_size.is_power_of_two()
        || !database.len().is_multiple_of(page_size)
    {
        return Err(PurError::InvalidFormat(
            "reconstructed database has an invalid SQLite page size or length".to_owned(),
        ));
    }
    Ok(())
}

struct Cursor<'a> {
    bytes: &'a [u8],
    position: usize,
}

impl<'a> Cursor<'a> {
    fn new(bytes: &'a [u8]) -> Self {
        Self { bytes, position: 0 }
    }

    fn position(&self) -> usize {
        self.position
    }

    fn take(&mut self, length: usize, label: &str) -> Result<&'a [u8], PurError> {
        let end = self
            .position
            .checked_add(length)
            .ok_or_else(|| PurError::InvalidFormat(format!("{label} length overflows")))?;
        let slice = self
            .bytes
            .get(self.position..end)
            .ok_or_else(|| PurError::InvalidFormat(format!("truncated {label}")))?;
        self.position = end;
        Ok(slice)
    }

    fn u32(&mut self, label: &str) -> Result<u32, PurError> {
        let raw = self.take(4, label)?;
        Ok(u32::from_be_bytes([raw[0], raw[1], raw[2], raw[3]]))
    }

    fn u64(&mut self, label: &str) -> Result<u64, PurError> {
        let raw = self.take(8, label)?;
        Ok(u64::from_be_bytes([
            raw[0], raw[1], raw[2], raw[3], raw[4], raw[5], raw[6], raw[7],
        ]))
    }

    fn qstring(&mut self, label: &str, limit: usize) -> Result<Option<String>, PurError> {
        let length = self.u32(label)?;
        if length == u32::MAX {
            return Ok(None);
        }
        let length = usize::try_from(length)
            .map_err(|_| PurError::InvalidFormat(format!("invalid {label} length")))?;
        if length > limit {
            return Err(PurError::InvalidFormat(format!(
                "{label} exceeds its {limit}-byte limit"
            )));
        }
        if length % 2 != 0 {
            return Err(PurError::InvalidFormat(format!(
                "{label} has an odd UTF-16 byte length"
            )));
        }
        let raw = self.take(length, label)?;
        let words: Vec<u16> = raw
            .chunks_exact(2)
            .map(|pair| u16::from_be_bytes([pair[0], pair[1]]))
            .collect();
        String::from_utf16(&words)
            .map(Some)
            .map_err(|_| PurError::InvalidFormat(format!("{label} is invalid UTF-16")))
    }

    fn skip_qbytearray(&mut self, label: &str) -> Result<(), PurError> {
        let length = self.u32(label)?;
        if length == u32::MAX {
            return Ok(());
        }
        let length = usize::try_from(length)
            .map_err(|_| PurError::InvalidFormat(format!("invalid {label} length")))?;
        self.take(length, label)?;
        Ok(())
    }
}

struct TempPath(PathBuf);

impl Drop for TempPath {
    fn drop(&mut self) {
        let _ = fs::remove_file(&self.0);
    }
}

struct TempDatabase {
    _temp_path: TempPath,
    connection: Option<Connection>,
}

impl TempDatabase {
    fn open(database: &[u8]) -> Result<Self, PurError> {
        let (path, mut file) = create_temp_file()?;
        let temp_path = TempPath(path.clone());
        file.write_all(database)?;
        file.flush()?;
        drop(file);

        let connection = Connection::open_with_flags(&path, OpenFlags::SQLITE_OPEN_READ_ONLY)?;
        Ok(Self {
            _temp_path: temp_path,
            connection: Some(connection),
        })
    }

    fn connection(&self) -> Result<&Connection, PurError> {
        self.connection.as_ref().ok_or_else(|| {
            PurError::InvalidFormat("temporary database connection was closed".to_owned())
        })
    }
}

impl Drop for TempDatabase {
    fn drop(&mut self) {
        drop(self.connection.take());
    }
}

fn create_temp_file() -> Result<(PathBuf, fs::File), PurError> {
    let base = std::env::temp_dir();
    for _ in 0..100 {
        let id = NEXT_TEMP_ID.fetch_add(1, Ordering::Relaxed);
        let path = base.join(format!("athanor-pur-{}-{id}.sqlite", std::process::id()));
        match OpenOptions::new().write(true).create_new(true).open(&path) {
            Ok(file) => return Ok((path, file)),
            Err(error) if error.kind() == io::ErrorKind::AlreadyExists => continue,
            Err(error) => return Err(error.into()),
        }
    }
    Err(PurError::Io(io::Error::new(
        io::ErrorKind::AlreadyExists,
        "could not allocate a unique temporary database file",
    )))
}

#[derive(Clone, Copy, Debug)]
struct Affine {
    a: f64,
    b: f64,
    c: f64,
    d: f64,
    tx: f64,
    ty: f64,
}

impl Affine {
    const IDENTITY: Self = Self {
        a: 1.0,
        b: 0.0,
        c: 0.0,
        d: 1.0,
        tx: 0.0,
        ty: 0.0,
    };

    fn map(self, x: f64, y: f64) -> (f64, f64) {
        (
            self.a * x + self.c * y + self.tx,
            self.b * x + self.d * y + self.ty,
        )
    }

    /// Apply `before`, then `self`.
    fn compose(self, before: Self) -> Self {
        Self {
            a: self.a * before.a + self.c * before.b,
            b: self.b * before.a + self.d * before.b,
            c: self.a * before.c + self.c * before.d,
            d: self.b * before.c + self.d * before.d,
            tx: self.a * before.tx + self.c * before.ty + self.tx,
            ty: self.b * before.tx + self.d * before.ty + self.ty,
        }
    }

    fn is_finite(self) -> bool {
        [self.a, self.b, self.c, self.d, self.tx, self.ty]
            .into_iter()
            .all(f64::is_finite)
    }
}

#[derive(Clone)]
struct CommonItem {
    id: i64,
    parent: i64,
    name: Option<String>,
    transform: Affine,
    z: f64,
    opacity: f64,
    locked: bool,
}

struct ImageResource {
    data: Option<Vec<u8>>,
    source: Option<String>,
    format: Option<String>,
    width: f64,
    height: f64,
}

struct ImageInstance {
    image_id: i64,
    transform: Affine,
    bounds: Vec<(f64, f64)>,
    flags: i64,
}

struct Note {
    text: String,
    color: Option<String>,
    size: f64,
}

struct WorldState {
    transform: Affine,
    opacity: f64,
    locked: bool,
}

fn read_board(connection: &Connection, mut warnings: Vec<String>) -> Result<PurBoard, PurError> {
    let user_version: i64 = connection.query_row("PRAGMA user_version", [], |row| row.get(0))?;
    if user_version > 200_101 {
        return Err(PurError::InvalidFormat(format!(
            "database schema version {user_version} is newer than the supported 200101"
        )));
    }

    let item_count: i64 =
        connection.query_row("SELECT count(*) FROM items", [], |row| row.get(0))?;
    if item_count > MAX_ITEMS {
        return Err(PurError::InvalidFormat(format!(
            "board has {item_count} items; the limit is {MAX_ITEMS}"
        )));
    }

    let mut common = HashMap::with_capacity(item_count as usize);
    {
        let mut statement = connection.prepare(
            "SELECT id, parent, name, transform, z, opacity, locked FROM items ORDER BY id",
        )?;
        let mut rows = statement.query([])?;
        while let Some(row) = rows.next()? {
            let item = read_common_item(row)?;
            if common.insert(item.id, item).is_some() {
                return Err(PurError::InvalidFormat(
                    "items table contains duplicate item IDs".to_owned(),
                ));
            }
        }
    }

    let resources = read_images(connection)?;
    let image_instances = read_image_instances(connection)?;
    let notes = read_notes(connection)?;
    let groups = read_id_set(connection, "items_groups")?;
    let closed_groups = read_closed_groups(connection)?;
    let drawings = read_id_set(connection, "items_drawings")?;

    let drawing_count = drawings.len();
    if drawing_count > 0 {
        warnings.push(format!(
            "Skipped {drawing_count} vector drawing item(s); drawings are not supported."
        ));
    }

    let mut output = Vec::new();
    let mut missing_image_sources = HashSet::new();
    let mut cropped_items = 0usize;
    let mut unsupported_items = 0usize;

    let mut item_ids: Vec<i64> = common.keys().copied().collect();
    item_ids.sort_unstable();
    for id in item_ids {
        let item = common
            .get(&id)
            .ok_or_else(|| PurError::InvalidFormat("internal item lookup failed".to_owned()))?;
        if let Some(instance) = image_instances.get(&id) {
            let resource = resources.get(&instance.image_id).ok_or_else(|| {
                PurError::InvalidFormat(format!(
                    "image item {id} refers to missing image resource {}",
                    instance.image_id
                ))
            })?;
            let Some(data) = image_data(resource, &mut warnings, &mut missing_image_sources) else {
                continue;
            };
            let world = world_state(item, &common, &closed_groups, instance.transform)?;
            if is_cropped(instance, resource) {
                cropped_items += 1;
            }
            let determinant =
                world.transform.a * world.transform.d - world.transform.b * world.transform.c;
            let flip_x = determinant < 0.0;
            let mut rotation = world.transform.b.atan2(world.transform.a).to_degrees();
            if flip_x {
                rotation += 180.0;
            }
            rotation = normalize_degrees(rotation);
            let (x, y) = world
                .transform
                .map(resource.width / 2.0, resource.height / 2.0);
            let w = resource.width * world.transform.a.hypot(world.transform.b);
            let h = resource.height * world.transform.c.hypot(world.transform.d);
            if ![x, y, w, h, rotation, world.opacity]
                .into_iter()
                .all(f64::is_finite)
            {
                return Err(PurError::InvalidFormat(format!(
                    "image item {id} has a non-finite world transform"
                )));
            }
            output.push((
                item.z,
                id,
                PurItem::Image {
                    mime: sniff_mime(&data, resource.format.as_deref()),
                    data,
                    name: item.name.clone(),
                    x,
                    y,
                    w,
                    h,
                    rotation,
                    opacity: world.opacity,
                    flip_x,
                    grayscale: instance.flags & 0x2 != 0,
                    locked: world.locked,
                    z: item.z as i64,
                },
            ));
        } else if let Some(note) = notes.get(&id) {
            let world = world_state(item, &common, &closed_groups, Affine::IDENTITY)?;
            let (x, y) = world.transform.map(0.0, 0.0);
            let scale = world.transform.a.hypot(world.transform.b);
            let size = note.size * scale;
            if ![x, y, size].into_iter().all(f64::is_finite) {
                return Err(PurError::InvalidFormat(format!(
                    "text item {id} has a non-finite world transform"
                )));
            }
            let color = inline_color(&note.text)
                .or_else(|| note.color.as_deref().and_then(normalize_color))
                .unwrap_or_else(|| "#111111".to_owned());
            output.push((
                item.z,
                id,
                PurItem::Text {
                    text: strip_html(&note.text),
                    x,
                    y,
                    size,
                    color,
                    z: item.z as i64,
                },
            ));
        } else if groups.contains(&id) || drawings.contains(&id) {
            continue;
        } else {
            unsupported_items += 1;
        }
    }

    if cropped_items > 0 {
        warnings.push(format!(
            "{cropped_items} cropped image item(s) were returned uncropped."
        ));
    }
    if unsupported_items > 0 {
        warnings.push(format!(
            "Skipped {unsupported_items} item(s) with unsupported or missing subtype data."
        ));
    }
    output.sort_by(|left, right| {
        left.0
            .total_cmp(&right.0)
            .then_with(|| left.1.cmp(&right.1))
    });
    Ok(PurBoard {
        items: output.into_iter().map(|entry| entry.2).collect(),
        warnings,
    })
}

fn read_common_item(row: &Row<'_>) -> Result<CommonItem, PurError> {
    let id: i64 = row.get(0)?;
    let parent: i64 = row.get(1)?;
    let name: Option<String> = row.get(2)?;
    let transform = decode_transform(cell_bytes(row, 3, "items.transform")?.as_deref())?;
    let z: f64 = row.get(4)?;
    let opacity: f64 = row.get(5)?;
    let locked: i64 = row.get(6)?;
    if !z.is_finite() || !opacity.is_finite() {
        return Err(PurError::InvalidFormat(format!(
            "item {id} has a non-finite z or opacity value"
        )));
    }
    Ok(CommonItem {
        id,
        parent,
        name,
        transform,
        z,
        opacity,
        locked: locked != 0,
    })
}

fn read_images(connection: &Connection) -> Result<HashMap<i64, ImageResource>, PurError> {
    let mut images = HashMap::new();
    let mut statement = connection.prepare(
        "SELECT id, source_type, source, format, data, width, height FROM images ORDER BY id",
    )?;
    let mut rows = statement.query([])?;
    while let Some(row) = rows.next()? {
        let id: i64 = row.get(0)?;
        let _source_type: i64 = row.get(1)?;
        let source: Option<String> = row.get(2)?;
        let format: Option<String> = row.get(3)?;
        let data: Option<Vec<u8>> = row.get(4)?;
        let width: i64 = row.get(5)?;
        let height: i64 = row.get(6)?;
        if width <= 0 || height <= 0 {
            return Err(PurError::InvalidFormat(format!(
                "image resource {id} has invalid dimensions {width}x{height}"
            )));
        }
        images.insert(
            id,
            ImageResource {
                data,
                source,
                format,
                width: width as f64,
                height: height as f64,
            },
        );
    }
    Ok(images)
}

fn read_image_instances(connection: &Connection) -> Result<HashMap<i64, ImageInstance>, PurError> {
    let mut instances = HashMap::new();
    let mut statement = connection.prepare(
        "SELECT id, image, image_transform, image_bounds, flags FROM items_images ORDER BY id",
    )?;
    let mut rows = statement.query([])?;
    while let Some(row) = rows.next()? {
        let id: i64 = row.get(0)?;
        let image_id: i64 = row.get(1)?;
        let transform =
            decode_transform(cell_bytes(row, 2, "items_images.image_transform")?.as_deref())?;
        let bounds = decode_path(cell_bytes(row, 3, "items_images.image_bounds")?.as_deref())?;
        let flags: i64 = row.get(4)?;
        instances.insert(
            id,
            ImageInstance {
                image_id,
                transform,
                bounds,
                flags,
            },
        );
    }
    Ok(instances)
}

fn read_notes(connection: &Connection) -> Result<HashMap<i64, Note>, PurError> {
    let mut notes = HashMap::new();
    let mut statement = connection
        .prepare("SELECT id, text_color, fixed_size, text FROM items_notes ORDER BY id")?;
    let mut rows = statement.query([])?;
    while let Some(row) = rows.next()? {
        let id: i64 = row.get(0)?;
        let color: Option<String> = row.get(1)?;
        let fixed_size = cell_bytes(row, 2, "items_notes.fixed_size")?;
        let _fixed = decode_size(fixed_size.as_deref())?;
        let text: Option<String> = row.get(3)?;
        let text = text
            .ok_or_else(|| PurError::InvalidFormat(format!("text item {id} has no HTML text")))?;
        let size = html_font_size(&text).unwrap_or(22.0);
        notes.insert(id, Note { text, color, size });
    }
    Ok(notes)
}

fn read_id_set(connection: &Connection, table: &str) -> Result<HashSet<i64>, PurError> {
    let sql = match table {
        "items_groups" => "SELECT id FROM items_groups",
        "items_drawings" => "SELECT id FROM items_drawings",
        _ => {
            return Err(PurError::InvalidFormat(
                "internal table lookup failed".to_owned(),
            ))
        }
    };
    let mut ids = HashSet::new();
    let mut statement = connection.prepare(sql)?;
    let mut rows = statement.query([])?;
    while let Some(row) = rows.next()? {
        ids.insert(row.get(0)?);
    }
    Ok(ids)
}

fn read_closed_groups(connection: &Connection) -> Result<HashSet<i64>, PurError> {
    let mut closed = HashSet::new();
    let mut statement = connection.prepare("SELECT id, lock_mode FROM items_groups")?;
    let mut rows = statement.query([])?;
    while let Some(row) = rows.next()? {
        let id: i64 = row.get(0)?;
        let lock_mode: i64 = row.get(1)?;
        if lock_mode == 1 {
            closed.insert(id);
        }
    }
    Ok(closed)
}

fn cell_bytes(row: &Row<'_>, index: usize, label: &str) -> Result<Option<Vec<u8>>, PurError> {
    match row.get_ref(index)? {
        ValueRef::Null => Ok(None),
        ValueRef::Blob(bytes) => Ok(Some(bytes.to_vec())),
        ValueRef::Text(bytes) => {
            let text = std::str::from_utf8(bytes).map_err(|_| {
                PurError::InvalidFormat(format!("{label} contains invalid UTF-8 text"))
            })?;
            let mut output = Vec::with_capacity(text.len());
            for character in text.chars() {
                let byte = u8::try_from(u32::from(character)).map_err(|_| {
                    PurError::InvalidFormat(format!(
                        "{label} contains a character outside the serialized Latin-1 range"
                    ))
                })?;
                output.push(byte);
            }
            Ok(Some(output))
        }
        _ => Err(PurError::InvalidFormat(format!(
            "{label} is not stored as TEXT or BLOB"
        ))),
    }
}

fn decode_transform(raw: Option<&[u8]>) -> Result<Affine, PurError> {
    let raw = raw.ok_or_else(|| PurError::InvalidFormat("missing QTransform value".to_owned()))?;
    if raw.len() != 77 {
        return Err(PurError::InvalidFormat(format!(
            "QTransform value has {} bytes; expected 77",
            raw.len()
        )));
    }
    if u32::from_be_bytes([raw[0], raw[1], raw[2], raw[3]]) != 80 || raw[4] != 0 {
        return Err(PurError::InvalidFormat(
            "serialized value is not a non-null QTransform".to_owned(),
        ));
    }
    let mut values = [0.0f64; 9];
    for (index, value) in values.iter_mut().enumerate() {
        let start = 5 + index * 8;
        let mut array = [0u8; 8];
        array.copy_from_slice(&raw[start..start + 8]);
        *value = f64::from_be_bytes(array);
    }
    if values.iter().any(|value| !value.is_finite())
        || values[2].abs() > 1e-12
        || values[5].abs() > 1e-12
        || (values[8] - 1.0).abs() > 1e-12
    {
        return Err(PurError::InvalidFormat(
            "QTransform is non-finite or uses unsupported perspective terms".to_owned(),
        ));
    }
    Ok(Affine {
        a: values[0],
        b: values[1],
        c: values[3],
        d: values[4],
        tx: values[6],
        ty: values[7],
    })
}

fn decode_size(raw: Option<&[u8]>) -> Result<(f64, f64), PurError> {
    let raw = raw.ok_or_else(|| PurError::InvalidFormat("missing QSizeF value".to_owned()))?;
    if raw.len() != 21 || u32::from_be_bytes([raw[0], raw[1], raw[2], raw[3]]) != 22 || raw[4] != 0
    {
        return Err(PurError::InvalidFormat(
            "serialized note size is not a QSizeF".to_owned(),
        ));
    }
    let width = f64::from_be_bytes(
        raw[5..13]
            .try_into()
            .map_err(|_| PurError::InvalidFormat("truncated QSizeF width".to_owned()))?,
    );
    let height = f64::from_be_bytes(
        raw[13..21]
            .try_into()
            .map_err(|_| PurError::InvalidFormat("truncated QSizeF height".to_owned()))?,
    );
    Ok((width, height))
}

fn decode_path(raw: Option<&[u8]>) -> Result<Vec<(f64, f64)>, PurError> {
    let raw =
        raw.ok_or_else(|| PurError::InvalidFormat("missing QPainterPath value".to_owned()))?;
    if raw.len() < 9 || u32::from_be_bytes([raw[0], raw[1], raw[2], raw[3]]) != 1024 || raw[4] != 0
    {
        return Err(PurError::InvalidFormat(
            "serialized image bounds are not a registered QPainterPath".to_owned(),
        ));
    }
    let name_len = u32::from_be_bytes([raw[5], raw[6], raw[7], raw[8]]) as usize;
    if name_len > MAX_VARIANT_BYTES || name_len > raw.len().saturating_sub(9) {
        return Err(PurError::InvalidFormat(
            "QPainterPath type name has an invalid length".to_owned(),
        ));
    }
    let name_end = 9 + name_len;
    if &raw[9..name_end] != b"QPainterPath\0" {
        return Err(PurError::InvalidFormat(
            "serialized image bounds have an unknown registered type".to_owned(),
        ));
    }
    let payload = &raw[name_end..];
    if payload.len() < 4 {
        return Err(PurError::InvalidFormat(
            "truncated QPainterPath element count".to_owned(),
        ));
    }
    let count = u32::from_be_bytes([payload[0], payload[1], payload[2], payload[3]]) as usize;
    if count > (payload.len().saturating_sub(4)) / 20 {
        return Err(PurError::InvalidFormat(
            "QPainterPath element count exceeds its payload".to_owned(),
        ));
    }
    let records_end = 4 + count * 20;
    let expected_len = records_end + if count > 0 { 8 } else { 0 };
    if payload.len() != expected_len {
        return Err(PurError::InvalidFormat(
            "QPainterPath payload has an invalid length".to_owned(),
        ));
    }
    let mut points = Vec::with_capacity(count);
    for index in 0..count {
        let offset = 4 + index * 20;
        let element_type = u32::from_be_bytes([
            payload[offset],
            payload[offset + 1],
            payload[offset + 2],
            payload[offset + 3],
        ]);
        if element_type > 3 {
            return Err(PurError::InvalidFormat(
                "QPainterPath has an unknown element type".to_owned(),
            ));
        }
        let x = f64::from_be_bytes(payload[offset + 4..offset + 12].try_into().map_err(|_| {
            PurError::InvalidFormat("truncated QPainterPath x coordinate".to_owned())
        })?);
        let y = f64::from_be_bytes(payload[offset + 12..offset + 20].try_into().map_err(|_| {
            PurError::InvalidFormat("truncated QPainterPath y coordinate".to_owned())
        })?);
        if !x.is_finite() || !y.is_finite() {
            return Err(PurError::InvalidFormat(
                "QPainterPath contains a non-finite coordinate".to_owned(),
            ));
        }
        points.push((x, y));
    }
    Ok(points)
}

fn world_state(
    item: &CommonItem,
    common: &HashMap<i64, CommonItem>,
    closed_groups: &HashSet<i64>,
    local: Affine,
) -> Result<WorldState, PurError> {
    let mut transform = local;
    let mut opacity = 1.0;
    let mut locked = false;
    let mut current = Some(item);
    let mut visited = HashSet::new();
    while let Some(node) = current {
        if !visited.insert(node.id) {
            return Err(PurError::InvalidFormat(format!(
                "item hierarchy contains a cycle at item {}",
                node.id
            )));
        }
        transform = node.transform.compose(transform);
        opacity *= node.opacity;
        locked |= node.locked || closed_groups.contains(&node.id);
        if node.parent == -1 {
            current = None;
        } else {
            current = Some(common.get(&node.parent).ok_or_else(|| {
                PurError::InvalidFormat(format!(
                    "item {} refers to missing parent {}",
                    node.id, node.parent
                ))
            })?);
        }
    }
    if !transform.is_finite() || !opacity.is_finite() {
        return Err(PurError::InvalidFormat(format!(
            "item {} has a non-finite world transform or opacity",
            item.id
        )));
    }
    Ok(WorldState {
        transform,
        opacity,
        locked,
    })
}

fn is_cropped(instance: &ImageInstance, resource: &ImageResource) -> bool {
    if instance.bounds.is_empty() {
        return true;
    }
    let corners = [
        instance.transform.map(0.0, 0.0),
        instance.transform.map(resource.width, 0.0),
        instance.transform.map(0.0, resource.height),
        instance.transform.map(resource.width, resource.height),
    ];
    let (min_x, max_x, min_y, max_y) = bounds_of(&corners);
    let (clip_min_x, clip_max_x, clip_min_y, clip_max_y) = bounds_of(&instance.bounds);
    let tolerance = 1e-6f64.max(max_x.abs().max(max_y.abs()) * 1e-9);
    (min_x - clip_min_x).abs() > tolerance
        || (max_x - clip_max_x).abs() > tolerance
        || (min_y - clip_min_y).abs() > tolerance
        || (max_y - clip_max_y).abs() > tolerance
}

fn bounds_of(points: &[(f64, f64)]) -> (f64, f64, f64, f64) {
    let mut min_x = f64::INFINITY;
    let mut max_x = f64::NEG_INFINITY;
    let mut min_y = f64::INFINITY;
    let mut max_y = f64::NEG_INFINITY;
    for &(x, y) in points {
        min_x = min_x.min(x);
        max_x = max_x.max(x);
        min_y = min_y.min(y);
        max_y = max_y.max(y);
    }
    (min_x, max_x, min_y, max_y)
}

fn image_data(
    resource: &ImageResource,
    warnings: &mut Vec<String>,
    missing_sources: &mut HashSet<String>,
) -> Option<Vec<u8>> {
    if let Some(data) = &resource.data {
        return Some(data.clone());
    }
    let Some(source) = &resource.source else {
        warnings.push("Skipped a linked image with no source path.".to_owned());
        return None;
    };
    if !missing_sources.insert(source.clone()) {
        return None;
    }
    match fs::read(source) {
        Ok(data) => Some(data),
        Err(error) => {
            warnings.push(format!("Skipped linked image at {source:?}: {error}"));
            None
        }
    }
}

fn sniff_mime(data: &[u8], format: Option<&str>) -> String {
    if data.starts_with(b"\x89PNG\r\n\x1a\n") {
        "image/png".to_owned()
    } else if data.starts_with(b"\xff\xd8\xff") {
        "image/jpeg".to_owned()
    } else if data.starts_with(b"GIF87a") || data.starts_with(b"GIF89a") {
        "image/gif".to_owned()
    } else if data.starts_with(b"BM") {
        "image/bmp".to_owned()
    } else if data.len() >= 12 && &data[..4] == b"RIFF" && &data[8..12] == b"WEBP" {
        "image/webp".to_owned()
    } else if data.starts_with(b"II*\0") || data.starts_with(b"MM\0*") {
        "image/tiff".to_owned()
    } else if data.len() >= 12 && &data[4..8] == b"ftyp" {
        "image/avif".to_owned()
    } else if data
        .iter()
        .copied()
        .take(128)
        .collect::<Vec<_>>()
        .windows(4)
        .any(|window| window.eq_ignore_ascii_case(b"<svg"))
    {
        "image/svg+xml".to_owned()
    } else {
        let extension = format
            .unwrap_or_default()
            .trim_start_matches('.')
            .to_ascii_lowercase();
        match extension.as_str() {
            "png" => "image/png".to_owned(),
            "jpg" | "jpeg" => "image/jpeg".to_owned(),
            "gif" => "image/gif".to_owned(),
            "webp" => "image/webp".to_owned(),
            "bmp" => "image/bmp".to_owned(),
            "tif" | "tiff" => "image/tiff".to_owned(),
            "svg" => "image/svg+xml".to_owned(),
            _ => "application/octet-stream".to_owned(),
        }
    }
}

fn normalize_degrees(degrees: f64) -> f64 {
    let normalized = degrees.rem_euclid(360.0);
    if normalized > 180.0 {
        normalized - 360.0
    } else {
        normalized
    }
}

fn normalize_color(color: &str) -> Option<String> {
    let value = color.trim();
    let hex = value.strip_prefix('#')?;
    if hex.len() == 8 && hex.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        return Some(format!("#{}", &hex[2..]).to_ascii_lowercase());
    }
    if hex.len() == 6 && hex.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        return Some(value.to_ascii_lowercase());
    }
    None
}

fn inline_color(html: &str) -> Option<String> {
    let lower = html.to_ascii_lowercase();
    let mut start = 0;
    while let Some(relative) = lower[start..].find("color") {
        let index = start + relative;
        let before = lower[..index].trim_end();
        if before.ends_with("background-") {
            start = index + 5;
            continue;
        }
        let tail = lower[index + 5..].trim_start();
        let Some(value) = tail.strip_prefix(':') else {
            start = index + 5;
            continue;
        };
        let value = value.trim_start();
        if value.starts_with('#') {
            let length = value
                .as_bytes()
                .iter()
                .take_while(|byte| byte.is_ascii_hexdigit() || **byte == b'#')
                .count();
            if let Some(color) = normalize_color(&value[..length]) {
                return Some(color);
            }
        }
        start = index + 5;
        if start >= lower.len() {
            break;
        }
    }
    None
}

fn html_font_size(html: &str) -> Option<f64> {
    let lower = html.to_ascii_lowercase();
    let value = lower.split_once("font-size:")?.1.trim_start();
    let number: String = value
        .chars()
        .take_while(|character| character.is_ascii_digit() || matches!(character, '.' | '+' | '-'))
        .collect();
    let size = number.parse::<f64>().ok()?;
    (size.is_finite() && size > 0.0).then_some(size)
}

fn strip_html(html: &str) -> String {
    let chars: Vec<char> = html.chars().collect();
    let mut output = String::new();
    let mut index = 0;
    let mut hidden_tag: Option<String> = None;
    while index < chars.len() {
        if chars[index] == '<' {
            if index + 3 < chars.len()
                && chars[index + 1] == '!'
                && chars[index + 2] == '-'
                && chars[index + 3] == '-'
            {
                index += 4;
                while index + 2 < chars.len()
                    && !(chars[index] == '-' && chars[index + 1] == '-' && chars[index + 2] == '>')
                {
                    index += 1;
                }
                index = (index + 3).min(chars.len());
                continue;
            }
            let mut end = index + 1;
            while end < chars.len() && chars[end] != '>' {
                end += 1;
            }
            if end < chars.len() {
                let raw_tag: String = chars[index + 1..end].iter().collect();
                let tag = raw_tag
                    .trim()
                    .trim_start_matches('/')
                    .split(|character: char| character.is_whitespace() || character == '/')
                    .next()
                    .unwrap_or_default()
                    .to_ascii_lowercase();
                let closing = raw_tag.trim_start().starts_with('/');
                if matches!(tag.as_str(), "script" | "style") {
                    if closing {
                        hidden_tag = None;
                    } else {
                        hidden_tag = Some(tag);
                    }
                } else if hidden_tag.is_none()
                    && (tag == "br"
                        || (closing
                            && matches!(
                                tag.as_str(),
                                "p" | "div" | "li" | "tr" | "h1" | "h2" | "h3" | "h4"
                            )))
                {
                    append_newline(&mut output);
                }
                index = end + 1;
                continue;
            }
        }
        if hidden_tag.is_some() {
            index += 1;
            continue;
        }
        if chars[index] == '&' {
            if let Some((entity, consumed)) = read_entity(&chars[index..]) {
                output.push(entity);
                index += consumed;
                continue;
            }
        }
        output.push(chars[index]);
        index += 1;
    }
    output.trim_matches('\n').to_owned()
}

fn append_newline(output: &mut String) {
    if !output.is_empty() && !output.ends_with('\n') {
        output.push('\n');
    }
}

fn read_entity(chars: &[char]) -> Option<(char, usize)> {
    let end = chars
        .iter()
        .take(16)
        .position(|character| *character == ';')?;
    let entity: String = chars[1..end].iter().collect();
    let value = if let Some(hex) = entity
        .strip_prefix("#x")
        .or_else(|| entity.strip_prefix("#X"))
    {
        u32::from_str_radix(hex, 16).ok().and_then(char::from_u32)
    } else if let Some(decimal) = entity.strip_prefix('#') {
        decimal.parse::<u32>().ok().and_then(char::from_u32)
    } else {
        match entity.as_str() {
            "amp" => Some('&'),
            "lt" => Some('<'),
            "gt" => Some('>'),
            "quot" => Some('"'),
            "apos" => Some('\''),
            "nbsp" => Some('\u{00a0}'),
            "ndash" => Some('–'),
            "mdash" => Some('—'),
            "hellip" => Some('…'),
            _ => None,
        }
    }?;
    Some((value, end + 1))
}

#[cfg(test)]
mod tests {
    use super::md5_hex;
    use super::{parse, PurError, PurItem};
    use rusqlite::{params, Connection};
    use std::path::Path;

    const SCHEMA: &str = "CREATE TABLE images (id INTEGER PRIMARY KEY,source_type INTEGER,origin TEXT,source TEXT,format TEXT,checksum TEXT,data BLOB,width INTEGER,height INTEGER);\
CREATE TABLE metadata (id INTEGER PRIMARY KEY,scene_rect TEXT,application_version TEXT,view_transform TEXT,thumbnail BLOB,horizontal_scroll INTEGER,vertical_scroll INTEGER,last_save_path TEXT,last_load_path TEXT,last_load_checksum TEXT,saved INTEGER);\
CREATE TABLE items (parent INTEGER,id INTEGER PRIMARY KEY,name TEXT,transform BLOB,sort_order BLOB,z REAL,opacity REAL,locked INTEGER,comment INTEGER);\
CREATE TABLE items_images (image INTEGER,playback_speed REAL,id INTEGER PRIMARY KEY,playback_state INTEGER,image_transform BLOB,image_bounds BLOB,playback_frame INTEGER,flags INTEGER);\
CREATE TABLE items_drawings (id INTEGER PRIMARY KEY,strokes BLOB);\
CREATE TABLE items_notes (text_color TEXT,id INTEGER PRIMARY KEY,fixed_size TEXT,background_color TEXT,text TEXT,style INTEGER);\
CREATE TABLE items_groups (id INTEGER PRIMARY KEY,background_color TEXT,lock_mode INTEGER);";

    const PNG: &[u8] = &[
        0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44,
        0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00, 0x1f,
        0x15, 0xc4, 0x89, 0x00, 0x00, 0x00, 0x0b, 0x49, 0x44, 0x41, 0x54, 0x78, 0xda, 0x63, 0x60,
        0x00, 0x02, 0x00, 0x00, 0x05, 0x00, 0x01, 0xa5, 0xf6, 0x45, 0x40, 0x00, 0x00, 0x00, 0x00,
        0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
    ];

    #[derive(Clone, Copy)]
    struct TestItem {
        id: i64,
        parent: i64,
        x: f64,
        y: f64,
        scale_x: f64,
        scale_y: f64,
        rotation: f64,
        z: f64,
        opacity: f64,
        locked: bool,
    }

    impl TestItem {
        fn root(id: i64) -> Self {
            Self {
                id,
                parent: -1,
                x: 0.0,
                y: 0.0,
                scale_x: 1.0,
                scale_y: 1.0,
                rotation: 0.0,
                z: id as f64,
                opacity: 1.0,
                locked: false,
            }
        }
    }

    fn db() -> Connection {
        let connection = Connection::open_in_memory().expect("in-memory SQLite");
        connection
            .execute_batch(
                "PRAGMA page_size=4096; PRAGMA auto_vacuum=FULL; PRAGMA application_id=940753918; PRAGMA user_version=200101;",
            )
            .expect("set SQLite metadata");
        connection
            .execute_batch(SCHEMA)
            .expect("create PureRef schema");
        connection
    }

    fn add_common(connection: &Connection, item: TestItem, name: Option<&str>) {
        connection
            .execute(
                "INSERT INTO items (parent,id,name,transform,sort_order,z,opacity,locked) VALUES (?1,?2,?3,?4,?5,?6,?7,?8)",
                params![
                    item.parent,
                    item.id,
                    name,
                    latin1_text(&transform(item.x, item.y, item.scale_x, item.scale_y, item.rotation)),
                    latin1_text(&rational(item.id + 1)),
                    item.z,
                    item.opacity,
                    i64::from(item.locked),
                ],
            )
            .expect("insert common item");
    }

    fn add_image(connection: &Connection, item: TestItem, name: Option<&str>, flags: i64) {
        add_common(connection, item, name);
        connection
            .execute(
                "INSERT INTO images (id,source_type,origin,source,format,checksum,data,width,height) VALUES (0,1,'tiny.png','tiny.png','PNG','',?1,1,1)",
                params![PNG],
            )
            .expect("insert image resource");
        connection
            .execute(
                "INSERT INTO items_images (id,image,playback_speed,playback_state,image_transform,image_bounds,playback_frame,flags) VALUES (?1,0,1.0,0,?2,?3,0,?4)",
                params![
                    item.id,
                    latin1_text(&transform(-0.5, -0.5, 1.0, 1.0, 0.0)),
                    latin1_text(&painter_path(&[(0, -0.5, -0.5), (1, 0.5, -0.5), (1, 0.5, 0.5), (1, -0.5, 0.5), (1, -0.5, -0.5)])),
                    flags
                ],
            )
            .expect("insert image instance");
    }

    fn build_file(format_version: &str, fill: impl FnOnce(&Connection)) -> Vec<u8> {
        let connection = db();
        fill(&connection);
        connection
            .execute(
                "INSERT INTO metadata (id,application_version,view_transform,thumbnail,saved) VALUES (0,'2.1.3',?1,?2,1)",
                params![
                    latin1_text(&transform(0.0, 0.0, 1.0, 1.0, 0.0)),
                    Vec::<u8>::new()
                ],
            )
            .expect("insert metadata");
        let database = connection
            .serialize(rusqlite::DatabaseName::Main)
            .expect("serialize test database");
        wrap(&database, format_version, &[])
    }

    fn wrap(database: &[u8], version: &str, thumbnail: &[u8]) -> Vec<u8> {
        let mut prefix = Vec::new();
        qstring(&mut prefix, version);
        prefix.extend_from_slice(&0u32.to_be_bytes());
        prefix.extend_from_slice(&(database.len() as u64).to_be_bytes());
        qstring(&mut prefix, "2.1.3");

        let mut checksum_placeholder = Vec::new();
        qstring(&mut checksum_placeholder, &"0".repeat(32));
        let preview = if version == "2.1" {
            let mut encoded = Vec::new();
            encoded.extend_from_slice(&(thumbnail.len() as u32).to_be_bytes());
            encoded.extend_from_slice(thumbnail);
            encoded
        } else {
            Vec::new()
        };
        let header_size = prefix.len() + checksum_placeholder.len() + preview.len();
        assert!(header_size <= database.len());

        let mut tail = preview;
        tail.extend_from_slice(&database[header_size..]);
        tail.extend_from_slice(&database[..header_size]);
        let checksum = md5_hex(&tail);

        let mut output = prefix;
        qstring(&mut output, &checksum);
        output.extend_from_slice(&tail);
        output
    }

    fn qstring(output: &mut Vec<u8>, value: &str) {
        let encoded: Vec<u16> = value.encode_utf16().collect();
        output.extend_from_slice(&((encoded.len() * 2) as u32).to_be_bytes());
        for word in encoded {
            output.extend_from_slice(&word.to_be_bytes());
        }
    }

    fn variant(type_id: u32, name: Option<&str>, payload: &[u8]) -> Vec<u8> {
        let mut result = Vec::new();
        result.extend_from_slice(&type_id.to_be_bytes());
        result.push(0);
        if let Some(name) = name {
            let bytes = format!("{name}\0").into_bytes();
            result.extend_from_slice(&(bytes.len() as u32).to_be_bytes());
            result.extend_from_slice(&bytes);
        }
        result.extend_from_slice(payload);
        result
    }

    fn transform(x: f64, y: f64, scale_x: f64, scale_y: f64, rotation: f64) -> Vec<u8> {
        let radians = rotation.to_radians();
        let cosine = radians.cos();
        let sine = radians.sin();
        let values = [
            scale_x * cosine,
            scale_x * sine,
            0.0,
            -scale_y * sine,
            scale_y * cosine,
            0.0,
            x,
            y,
            1.0,
        ];
        let payload: Vec<u8> = values
            .iter()
            .flat_map(|value| value.to_be_bytes())
            .collect();
        variant(80, None, &payload)
    }

    fn rational(value: i64) -> Vec<u8> {
        let mut payload = Vec::new();
        encode_big_integer(&mut payload, value);
        encode_big_integer(&mut payload, 1);
        variant(1024, Some("BigRational"), &payload)
    }

    fn encode_big_integer(payload: &mut Vec<u8>, value: i64) {
        let sign = if value == 0 {
            0u32
        } else if value < 0 {
            u32::MAX
        } else {
            1
        };
        let magnitude = value.unsigned_abs();
        let blocks = if magnitude == 0 { 0u64 } else { 1u64 };
        payload.extend_from_slice(&sign.to_be_bytes());
        payload.extend_from_slice(&blocks.to_be_bytes());
        if blocks > 0 {
            payload.extend_from_slice(&(magnitude as u32).to_be_bytes());
        }
    }

    fn painter_path(elements: &[(u32, f64, f64)]) -> Vec<u8> {
        let mut payload = Vec::new();
        payload.extend_from_slice(&(elements.len() as u32).to_be_bytes());
        for (kind, x, y) in elements {
            payload.extend_from_slice(&kind.to_be_bytes());
            payload.extend_from_slice(&x.to_be_bytes());
            payload.extend_from_slice(&y.to_be_bytes());
        }
        if !elements.is_empty() {
            payload.extend_from_slice(&0i32.to_be_bytes());
            payload.extend_from_slice(&0i32.to_be_bytes());
        }
        variant(1024, Some("QPainterPath"), &payload)
    }

    fn latin1_text(bytes: &[u8]) -> String {
        bytes.iter().map(|byte| char::from(*byte)).collect()
    }

    #[test]
    fn parses_plain_image() {
        let bytes = build_file("2.1", |connection| {
            add_image(connection, TestItem::root(0), Some("one"), 1);
        });
        let board = parse(&bytes).expect("parse plain image");
        assert_eq!(board.items.len(), 1);
        match &board.items[0] {
            PurItem::Image {
                data,
                mime,
                x,
                y,
                w,
                h,
                name,
                ..
            } => {
                assert_eq!(data, PNG);
                assert_eq!(mime, "image/png");
                assert_eq!(name.as_deref(), Some("one"));
                assert_eq!((*x, *y, *w, *h), (0.0, 0.0, 1.0, 1.0));
            }
            PurItem::Text { .. } => panic!("expected image"),
        }
    }

    #[test]
    fn parses_20_envelope_without_thumbnail() {
        let bytes = build_file("2.0", |connection| {
            add_image(connection, TestItem::root(0), None, 1);
        });
        let board = parse(&bytes).expect("parse 2.0 envelope");
        assert_eq!(board.items.len(), 1);
    }

    #[test]
    fn parses_rotated_scaled_image() {
        let mut item = TestItem::root(0);
        item.x = 10.0;
        item.y = 20.0;
        item.scale_x = 2.0;
        item.scale_y = 3.0;
        item.rotation = 90.0;
        let bytes = build_file("2.1", |connection| add_image(connection, item, None, 3));
        let board = parse(&bytes).expect("parse transformed image");
        match &board.items[0] {
            PurItem::Image {
                x,
                y,
                w,
                h,
                rotation,
                grayscale,
                ..
            } => {
                assert!((*x - 10.0).abs() < 1e-10);
                assert!((*y - 20.0).abs() < 1e-10);
                assert!((*w - 2.0).abs() < 1e-10);
                assert!((*h - 3.0).abs() < 1e-10);
                assert!((*rotation - 90.0).abs() < 1e-10);
                assert!(*grayscale);
            }
            PurItem::Text { .. } => panic!("expected image"),
        }
    }

    #[test]
    fn flattens_nested_group_transforms() {
        let bytes = build_file("2.1", |connection| {
            let mut group = TestItem::root(10);
            group.x = 10.0;
            group.y = 5.0;
            add_common(connection, group, Some("outer"));
            connection
                .execute(
                    "INSERT INTO items_groups (id,background_color,lock_mode) VALUES (10,NULL,1)",
                    [],
                )
                .expect("insert group");
            let mut nested = TestItem::root(11);
            nested.parent = 10;
            nested.x = 2.0;
            nested.y = 3.0;
            add_common(connection, nested, Some("nested"));
            connection
                .execute(
                    "INSERT INTO items_groups (id,background_color,lock_mode) VALUES (11,NULL,1)",
                    [],
                )
                .expect("insert nested group");
            let mut image = TestItem::root(0);
            image.parent = 11;
            image.x = 1.0;
            image.y = -1.0;
            add_image(connection, image, None, 1);
        });
        let board = parse(&bytes).expect("parse nested groups");
        match &board.items[0] {
            PurItem::Image { x, y, locked, .. } => {
                assert_eq!((*x, *y), (13.0, 7.0));
                assert!(*locked);
            }
            PurItem::Text { .. } => panic!("expected image"),
        }
    }

    #[test]
    fn strips_note_html_and_preserves_breaks() {
        let bytes = build_file("2.1", |connection| {
            let item = TestItem::root(4);
            add_common(connection, item, Some("note"));
            let fixed_size = variant(22, None, &[0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
            connection
                .execute(
                    "INSERT INTO items_notes (id,text_color,fixed_size,background_color,text,style) VALUES (4,NULL,?1,'','<html><body><p style=\"font-size:18px;color:#abcdef\">Hello &amp; <b>PureRef</b><br>Second line</p></body></html>',0)",
                    params![latin1_text(&fixed_size)],
                )
                .expect("insert note");
        });
        let board = parse(&bytes).expect("parse note");
        match &board.items[0] {
            PurItem::Text {
                text, size, color, ..
            } => {
                assert_eq!(text, "Hello & PureRef\nSecond line");
                assert_eq!(*size, 18.0);
                assert_eq!(color, "#abcdef");
            }
            PurItem::Image { .. } => panic!("expected note"),
        }
    }

    #[test]
    fn missing_link_warns_and_skips_image() {
        let bytes = build_file("2.1", |connection| {
            add_common(connection, TestItem::root(0), None);
            connection
                .execute(
                    "INSERT INTO images (id,source_type,origin,source,format,checksum,data,width,height) VALUES (0,2,'gone.png','Z:/certainly-missing-athanor-pur.png','png',NULL,NULL,1,1)",
                    [],
                )
                .expect("insert linked resource");
            connection
                .execute(
                    "INSERT INTO items_images (id,image,playback_speed,playback_state,image_transform,image_bounds,playback_frame,flags) VALUES (0,0,1.0,0,?1,?2,0,1)",
                    params![
                        latin1_text(&transform(-0.5, -0.5, 1.0, 1.0, 0.0)),
                        latin1_text(&painter_path(&[(0, -0.5, -0.5), (1, 0.5, -0.5), (1, 0.5, 0.5), (1, -0.5, 0.5), (1, -0.5, -0.5)])),
                    ],
                )
                .expect("insert image instance");
        });
        let board = parse(&bytes).expect("parse missing link");
        assert!(board.items.is_empty());
        assert!(board
            .warnings
            .iter()
            .any(|warning| warning.contains("Skipped linked image")));
    }

    #[test]
    fn bad_checksum_warns_but_loads() {
        let bytes = build_file("2.1", |connection| {
            add_image(connection, TestItem::root(0), None, 1);
        });
        let mut damaged = bytes;
        damaged[40] ^= 1;
        let board = parse(&damaged).expect("bad checksum remains recoverable");
        assert_eq!(board.items.len(), 1);
        assert!(board
            .warnings
            .iter()
            .any(|warning| warning.contains("checksum")));
    }

    #[test]
    fn rejects_garbage() {
        assert!(matches!(
            parse(b"not a pur file"),
            Err(PurError::NotPureRef(_))
        ));
    }

    #[test]
    fn rejects_truncated_file_without_panicking() {
        let truncated = [0, 0, 0, 6, 0, 50];
        let result = std::panic::catch_unwind(|| parse(&truncated));
        assert!(result.is_ok());
        assert!(result.expect("no panic").is_err());
    }

    #[test]
    fn rejects_legacy_1_x_envelope_clearly() {
        let mut bytes = Vec::new();
        qstring(&mut bytes, "1.10");
        assert!(matches!(parse(&bytes), Err(PurError::UnsupportedLegacy)));
        assert_eq!(
            PurError::UnsupportedLegacy.to_string(),
            "PureRef 1.x files are not supported"
        );
    }

    #[test]
    fn md5_matches_rfc_vectors() {
        assert_eq!(md5_hex(b""), "d41d8cd98f00b204e9800998ecf8427e");
        assert_eq!(md5_hex(b"abc"), "900150983cd24fb0d6963f7d28e17f72");
    }

    #[test]
    #[ignore = "requires ATHANOR_PUR_SAMPLE to point at a real PureRef sample"]
    fn parses_real_sample() {
        let Some(path) = std::env::var_os("ATHANOR_PUR_SAMPLE") else {
            return;
        };
        let bytes = std::fs::read(Path::new(&path)).expect("read sample file");
        let board = parse(&bytes).expect("parse real PureRef sample");
        let image_count = board
            .items
            .iter()
            .filter(|item| matches!(item, PurItem::Image { .. }))
            .count();
        let note_count = board.items.len() - image_count;
        println!(
            "Parsed {} item(s): {image_count} image(s), {note_count} note(s). Warnings: {:#?}",
            board.items.len(),
            board.warnings
        );
        for (index, item) in board.items.iter().enumerate() {
            match item {
                PurItem::Image {
                    mime,
                    name,
                    x,
                    y,
                    w,
                    h,
                    rotation,
                    opacity,
                    flip_x,
                    grayscale,
                    locked,
                    z,
                    ..
                } => println!(
                    "{index}: Image name={name:?} mime={mime} x={x} y={y} w={w} h={h} rotation={rotation} opacity={opacity} flip_x={flip_x} grayscale={grayscale} locked={locked} z={z}"
                ),
                PurItem::Text {
                    text,
                    x,
                    y,
                    size,
                    color,
                    z,
                } => println!(
                    "{index}: Text text={text:?} x={x} y={y} size={size} color={color} z={z}"
                ),
            }
        }
    }
}
