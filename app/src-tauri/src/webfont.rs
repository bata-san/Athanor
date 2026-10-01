//! IBM Plex Sans JP as the default font of web pages (Windows).
//!
//! Chromium picks a page's default font from the profile's preferences and can only use fonts the OS knows. So at
//! start-up, before the first WebView2 is created, Athanor
//!  1. unpacks the bundled IBM Plex Sans JP (SIL OFL, `fonts/OFL.txt`) next to its data and registers it with
//!     Windows for this session only (`AddFontResourceEx`; removed again on exit), and
//!  2. points the WebView2 profile's default fonts (standard and sans-serif, common and Japanese scripts) at it.
//!
//! Pages that name their own font are untouched; only the browser defaults change. The `webFont` setting turns it off.

use std::path::{Path, PathBuf};
use std::sync::Mutex;

use serde_json::{json, Value};
use windows::core::PCWSTR;
use windows::Win32::Foundation::{LPARAM, WPARAM};
use windows::Win32::Graphics::Gdi::{
    AddFontResourceExW, RemoveFontResourceExW, FONT_RESOURCE_CHARACTERISTICS,
};
use windows::Win32::UI::WindowsAndMessaging::{PostMessageW, HWND_BROADCAST, WM_FONTCHANGE};

pub const FAMILY: &str = "IBM Plex Sans JP";

const REGULAR: &[u8] = include_bytes!("../fonts/IBMPlexSansJP-Regular.ttf.gz");
const BOLD: &[u8] = include_bytes!("../fonts/IBMPlexSansJP-Bold.ttf.gz");

/// Fonts registered in this process, so they can be released on exit.
static REGISTERED: Mutex<Vec<PathBuf>> = Mutex::new(Vec::new());

/// Whether the settings file asks for the web font (default on).
pub fn enabled_in(settings_file: &Path) -> bool {
    std::fs::read(settings_file)
        .ok()
        .and_then(|bytes| serde_json::from_slice::<Value>(&bytes).ok())
        .and_then(|value| value.get("webFont").and_then(Value::as_bool))
        .unwrap_or(true)
}

/// Install (or remove) the web font. `local_data` is the app's local data dir; the WebView2 profile lives in
/// `<local_data>/EBWebView`. Never fails the start-up: problems only cost the font.
pub fn prepare(local_data: &Path, enabled: bool) {
    if enabled {
        if let Err(error) = install(&local_data.join("fonts")) {
            log::warn!("web font not installed: {error}");
            return;
        }
    }
    // The software-rendering browser keeps its profile one level deeper (WebView2 appends `EBWebView`).
    for folder in ["EBWebView", "EBWebView-software/EBWebView"] {
        let prefs = local_data.join(folder).join("Default").join("Preferences");
        if let Err(error) = write_preferences(&prefs, enabled) {
            log::warn!("web font preferences not written: {error}");
        }
    }
}

/// Release the session fonts (called when the app exits).
pub fn release() {
    let paths = std::mem::take(&mut *REGISTERED.lock().unwrap_or_else(|e| e.into_inner()));
    if paths.is_empty() {
        return;
    }
    for path in &paths {
        let wide = wide(path);
        // SAFETY: `wide` is a NUL-terminated UTF-16 path that lives across the call.
        unsafe {
            let _ = RemoveFontResourceExW(PCWSTR(wide.as_ptr()), 0, None);
        }
    }
    broadcast();
}

fn install(dir: &Path) -> Result<(), String> {
    std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    for (name, packed) in [
        ("IBMPlexSansJP-Regular.ttf", REGULAR),
        ("IBMPlexSansJP-Bold.ttf", BOLD),
    ] {
        let target = dir.join(name);
        let ttf = unpack(packed)?;
        // Rewrite only when the file is missing or differs (a previous run may have left it).
        let current = std::fs::metadata(&target).map(|m| m.len()).ok();
        if current != Some(ttf.len() as u64) {
            std::fs::write(&target, &ttf).map_err(|e| e.to_string())?;
        }
        let wide = wide(&target);
        // SAFETY: `wide` is a NUL-terminated UTF-16 path that lives across the call.
        let added = unsafe {
            AddFontResourceExW(
                PCWSTR(wide.as_ptr()),
                FONT_RESOURCE_CHARACTERISTICS(0),
                None,
            )
        };
        if added == 0 {
            return Err(format!("Windows refused {name}"));
        }
        REGISTERED
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .push(target);
    }
    broadcast();
    Ok(())
}

fn unpack(packed: &[u8]) -> Result<Vec<u8>, String> {
    use std::io::Read;
    let mut out = Vec::with_capacity(packed.len() * 2);
    flate2::read::GzDecoder::new(packed)
        .read_to_end(&mut out)
        .map_err(|e| e.to_string())?;
    Ok(out)
}

fn broadcast() {
    // SAFETY: a plain broadcast of WM_FONTCHANGE; no pointers are passed.
    unsafe {
        let _ = PostMessageW(Some(HWND_BROADCAST), WM_FONTCHANGE, WPARAM(0), LPARAM(0));
    }
}

fn wide(path: &Path) -> Vec<u16> {
    use std::os::windows::ffi::OsStrExt;
    path.as_os_str()
        .encode_wide()
        .chain(std::iter::once(0))
        .collect()
}

/// Merge our font choices into the WebView2 profile's `Preferences`, or take them out again.
fn write_preferences(path: &Path, enabled: bool) -> Result<(), String> {
    let mut root: Value = std::fs::read(path)
        .ok()
        .and_then(|b| serde_json::from_slice(&b).ok())
        .unwrap_or_else(|| json!({}));
    if !root.is_object() {
        root = json!({});
    }
    let before = root.clone();
    for family in ["standard", "sansserif"] {
        for script in ["Zyyy", "Jpan"] {
            set_font(&mut root, family, script, enabled);
        }
    }
    if root == before && path.exists() {
        return Ok(());
    }
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    std::fs::write(path, serde_json::to_vec(&root).map_err(|e| e.to_string())?)
        .map_err(|e| e.to_string())
}

/// `webkit.webprefs.fonts.<family>.<script> = FAMILY` when enabled; removed again only if it is still ours.
fn set_font(root: &mut Value, family: &str, script: &str, enabled: bool) {
    let mut node = &mut *root;
    for key in ["webkit", "webprefs", "fonts", family] {
        if !node.is_object() {
            *node = json!({});
        }
        let Some(object) = node.as_object_mut() else {
            return;
        };
        node = object.entry(key).or_insert_with(|| json!({}));
    }
    let Some(scripts) = node.as_object_mut() else {
        return;
    };
    if enabled {
        scripts.insert(script.to_owned(), Value::String(FAMILY.to_owned()));
    } else if scripts.get(script).and_then(Value::as_str) == Some(FAMILY) {
        scripts.remove(script);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn preferences_are_merged_and_cleaned() {
        let dir = std::env::temp_dir().join(format!("athanor-webfont-test-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let prefs = dir.join("Default").join("Preferences");
        std::fs::create_dir_all(prefs.parent().unwrap()).unwrap();
        std::fs::write(&prefs, r#"{"profile":{"name":"x"},"webkit":{"webprefs":{"fonts":{"standard":{"Zyyy":"Other","Hang":"Gulim"}}}}}"#).unwrap();

        write_preferences(&prefs, true).unwrap();
        let on: Value = serde_json::from_slice(&std::fs::read(&prefs).unwrap()).unwrap();
        assert_eq!(on["profile"]["name"], "x", "unrelated keys stay");
        assert_eq!(
            on["webkit"]["webprefs"]["fonts"]["standard"]["Zyyy"],
            FAMILY
        );
        assert_eq!(
            on["webkit"]["webprefs"]["fonts"]["standard"]["Jpan"],
            FAMILY
        );
        assert_eq!(
            on["webkit"]["webprefs"]["fonts"]["standard"]["Hang"],
            "Gulim"
        );
        assert_eq!(
            on["webkit"]["webprefs"]["fonts"]["sansserif"]["Zyyy"],
            FAMILY
        );

        write_preferences(&prefs, false).unwrap();
        let off: Value = serde_json::from_slice(&std::fs::read(&prefs).unwrap()).unwrap();
        assert!(
            off["webkit"]["webprefs"]["fonts"]["standard"]
                .get("Jpan")
                .is_none(),
            "ours are removed"
        );
        assert_eq!(
            off["webkit"]["webprefs"]["fonts"]["standard"]["Hang"], "Gulim",
            "foreign values stay"
        );
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn bundled_fonts_unpack_to_truetype() {
        for packed in [REGULAR, BOLD] {
            let ttf = unpack(packed).unwrap();
            assert_eq!(&ttf[..4], &[0, 1, 0, 0], "TrueType header");
        }
    }

    #[test]
    fn web_font_defaults_on() {
        let missing = std::env::temp_dir().join("athanor-no-such-settings.json");
        assert!(enabled_in(&missing));
    }
}
