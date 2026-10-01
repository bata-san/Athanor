use crate::{ImportError, Result};
use rusqlite::{Connection, OpenFlags};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};

static NEXT_TEMP_ID: AtomicU64 = AtomicU64::new(0);

pub(crate) struct Snapshot {
    pub(crate) connection: Connection,
    _temp_dir: Option<TempDir>,
}

struct TempDir(PathBuf);

impl Drop for TempDir {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

pub(crate) fn open_snapshot(source: &Path) -> Result<Snapshot> {
    match copy_database(source) {
        Ok((copy, temp_dir)) => {
            let connection = Connection::open_with_flags(&copy, OpenFlags::SQLITE_OPEN_READ_ONLY)?;
            Ok(Snapshot {
                connection,
                _temp_dir: Some(temp_dir),
            })
        }
        Err(_) => Ok(Snapshot {
            connection: open_immutable(source)?,
            _temp_dir: None,
        }),
    }
}

pub(crate) fn open_immutable(source: &Path) -> Result<Connection> {
    Ok(Connection::open_with_flags(
        immutable_uri(source),
        OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_URI,
    )?)
}

fn copy_database(source: &Path) -> Result<(PathBuf, TempDir)> {
    let temp_dir = create_temp_dir()?;
    let name = source
        .file_name()
        .ok_or_else(|| ImportError::Other("database path has no file name".to_owned()))?;
    let copied_database = temp_dir.0.join(name);
    fs::copy(source, &copied_database)?;

    for suffix in ["-wal", "-journal"] {
        let sidecar = appended_path(source, suffix);
        if sidecar.try_exists()? {
            fs::copy(&sidecar, appended_path(&copied_database, suffix))?;
        }
    }

    Ok((copied_database, temp_dir))
}

fn create_temp_dir() -> Result<TempDir> {
    let base = std::env::temp_dir();
    for _ in 0..100 {
        let id = NEXT_TEMP_ID.fetch_add(1, Ordering::Relaxed);
        let path = base.join(format!("athanor-import-{}-{id}", std::process::id()));
        match fs::create_dir(&path) {
            Ok(()) => return Ok(TempDir(path)),
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(error) => return Err(error.into()),
        }
    }
    Err(ImportError::Other(
        "could not allocate a temporary database directory".to_owned(),
    ))
}

fn appended_path(path: &Path, suffix: &str) -> PathBuf {
    let mut value = path.as_os_str().to_os_string();
    value.push(suffix);
    PathBuf::from(value)
}

fn immutable_uri(path: &Path) -> String {
    let normalized = path.to_string_lossy().replace('\\', "/");
    let prefix = if normalized.starts_with("//") {
        "file:"
    } else if normalized.starts_with('/') {
        "file://"
    } else if has_windows_drive(&normalized) {
        "file:///"
    } else {
        "file:"
    };
    let path = percent_encode_path(&normalized);
    format!("{prefix}{path}?mode=ro&immutable=1")
}

fn has_windows_drive(path: &str) -> bool {
    path.as_bytes().get(1) == Some(&b':')
}

fn percent_encode_path(path: &str) -> String {
    let mut encoded = String::with_capacity(path.len());
    for byte in path.bytes() {
        if byte.is_ascii_alphanumeric() || b"/-._~:".contains(&byte) {
            encoded.push(byte as char);
        } else {
            encoded.push('%');
            encoded.push_str(&format!("{byte:02X}"));
        }
    }
    encoded
}

#[cfg(test)]
mod tests {
    use super::immutable_uri;
    use std::path::Path;

    #[test]
    fn immutable_uri_quotes_uri_special_characters() {
        assert_eq!(
            immutable_uri(Path::new("C:\\Users\\A B\\places#1.sqlite")),
            "file:///C:/Users/A%20B/places%231.sqlite?mode=ro&immutable=1"
        );
    }
}
