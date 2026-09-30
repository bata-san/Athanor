//! Tiny JSON persistence with atomic replace. Enough for session/settings; no DB dependency.

use serde::{de::DeserializeOwned, Serialize};
use std::{fs, io, path::Path};

#[derive(Debug, thiserror::Error)]
pub enum StoreError {
    #[error("io: {0}")]
    Io(#[from] io::Error),
    #[error("json: {0}")]
    Json(#[from] serde_json::Error),
}

/// Load `path` as JSON, returning `T::default()` if the file does not exist.
///
/// The file is moved aside to `<path>.corrupt` *only* when it was read successfully but could
/// not be deserialised into `T` - that is, the bytes are genuinely unusable and the caller
/// gets [`StoreError::Json`] to report. A read that fails for any other reason (permissions,
/// a directory in the way, ...) is returned as [`StoreError::Io`] and the file is left exactly
/// where it is, so a transient IO problem never destroys a recoverable session.
pub fn load_or_default<T: DeserializeOwned + Default>(path: &Path) -> Result<T, StoreError> {
    match fs::read(path) {
        Ok(bytes) => match serde_json::from_slice(&bytes) {
            Ok(v) => Ok(v),
            Err(e) => {
                let mut bad = path.as_os_str().to_owned();
                bad.push(".corrupt");
                let _ = fs::rename(path, bad);
                Err(e.into())
            }
        },
        Err(e) if e.kind() == io::ErrorKind::NotFound => Ok(T::default()),
        Err(e) => Err(e.into()),
    }
}

/// Write JSON to a temp file next to `path`, then rename over it.
pub fn save_atomic<T: Serialize>(path: &Path, value: &T) -> Result<(), StoreError> {
    if let Some(dir) = path.parent() {
        fs::create_dir_all(dir)?;
    }
    let mut tmp = path.as_os_str().to_owned();
    tmp.push(".tmp");
    fs::write(&tmp, serde_json::to_vec_pretty(value)?)?;
    fs::rename(&tmp, path)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde::Deserialize;

    #[derive(Serialize, Deserialize, Default, PartialEq, Debug)]
    struct S {
        a: u32,
    }

    #[test]
    fn roundtrip_and_missing() {
        let dir = std::env::temp_dir().join(format!("athanor-store-{}", crate::new_id()));
        let p = dir.join("s.json");
        assert_eq!(load_or_default::<S>(&p).unwrap(), S::default());
        save_atomic(&p, &S { a: 7 }).unwrap();
        assert_eq!(load_or_default::<S>(&p).unwrap(), S { a: 7 });
        fs::write(&p, b"{not json").unwrap();
        assert!(load_or_default::<S>(&p).is_err());
        assert!(dir.join("s.json.corrupt").exists());
        let _ = fs::remove_dir_all(dir);
    }

    /// The quarantine is for unreadable *content* only: a path that cannot even be read is
    /// reported as-is and nothing is renamed away.
    #[test]
    fn an_io_error_is_reported_without_quarantining() {
        let dir = std::env::temp_dir().join(format!("athanor-store-{}", crate::new_id()));
        fs::create_dir_all(&dir).unwrap();
        // A directory where a file is expected: readable path, unreadable content.
        let p = dir.join("s.json");
        fs::create_dir(&p).unwrap();
        match load_or_default::<S>(&p) {
            Err(StoreError::Io(_)) => {}
            other => panic!("expected an io error, got {other:?}"),
        }
        assert!(p.exists(), "the file must not be moved aside");
        assert!(!dir.join("s.json.corrupt").exists(), "and nothing is left behind either");
        let _ = fs::remove_dir_all(dir);
    }
}
