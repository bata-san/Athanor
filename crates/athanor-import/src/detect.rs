use crate::{DetectedBrowser, Engine, Profile};
use serde_json::Value;
use std::fs;
use std::path::{Path, PathBuf};

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Roots {
    pub local_app_data: Option<PathBuf>,
    pub app_data: Option<PathBuf>,
}

impl Roots {
    pub fn from_env() -> Self {
        Self {
            local_app_data: std::env::var_os("LOCALAPPDATA").map(PathBuf::from),
            app_data: std::env::var_os("APPDATA").map(PathBuf::from),
        }
    }
}

pub fn detect() -> Vec<DetectedBrowser> {
    detect_in(&Roots::from_env())
}

pub fn detect_in(roots: &Roots) -> Vec<DetectedBrowser> {
    let mut browsers = Vec::new();
    if let Some(local) = roots.local_app_data.as_deref() {
        for (id, name, relative) in [
            ("chrome", "Google Chrome", "Google/Chrome/User Data"),
            ("edge", "Microsoft Edge", "Microsoft/Edge/User Data"),
            ("brave", "Brave", "BraveSoftware/Brave-Browser/User Data"),
            ("vivaldi", "Vivaldi", "Vivaldi/User Data"),
        ] {
            let directory = local.join(relative);
            if let Some(browser) = chromium_browser(id, name, &directory) {
                browsers.push(browser);
            }
        }
    }
    if let Some(app_data) = roots.app_data.as_deref() {
        for (id, name, folder) in [
            ("opera", "Opera", "Opera Stable"),
            ("opera-gx", "Opera GX", "Opera GX Stable"),
        ] {
            if let Some(browser) =
                opera_browser(id, name, &app_data.join("Opera Software").join(folder))
            {
                browsers.push(browser);
            }
        }
    }
    if let Some(local) = roots.local_app_data.as_deref() {
        if let Some(browser) = chromium_browser(
            "chromium",
            "Chromium",
            &local.join("Chromium").join("User Data"),
        ) {
            browsers.push(browser);
        }
    }
    if let Some(app_data) = roots.app_data.as_deref() {
        if let Some(browser) = firefox_browser(&app_data.join("Mozilla").join("Firefox")) {
            browsers.push(browser);
        }
    }
    browsers
}

fn chromium_browser(id: &str, name: &str, directory: &Path) -> Option<DetectedBrowser> {
    if !directory.is_dir() {
        return None;
    }
    let profile_names = read_local_state_names(&directory.join("Local State"));
    let mut dirs: Vec<(bool, u32, String, PathBuf)> = fs::read_dir(directory)
        .ok()?
        .filter_map(std::result::Result::ok)
        .filter_map(|entry| {
            let entry_path = entry.path();
            if !entry_path.is_dir() {
                return None;
            }
            let dir_name = entry.file_name().into_string().ok()?;
            let (is_default, number) = chromium_profile_order(&dir_name)?;
            Some((is_default, number, dir_name, entry_path))
        })
        .collect();
    dirs.sort_by(|a, b| {
        b.0.cmp(&a.0)
            .then_with(|| a.1.cmp(&b.1))
            .then_with(|| a.2.cmp(&b.2))
    });

    let profiles = dirs
        .into_iter()
        .filter_map(|(_, _, profile_id, dir)| {
            let has_bookmarks = dir.join("Bookmarks").is_file();
            let has_history = dir.join("History").is_file();
            (has_bookmarks || has_history).then(|| Profile {
                name: profile_names
                    .get(&profile_id)
                    .filter(|name| !name.trim().is_empty())
                    .cloned()
                    .unwrap_or_else(|| profile_id.clone()),
                id: profile_id,
                dir,
                has_bookmarks,
                has_history,
            })
        })
        .collect::<Vec<_>>();

    (!profiles.is_empty()).then(|| DetectedBrowser {
        id: id.to_owned(),
        name: name.to_owned(),
        engine: Engine::Chromium,
        profiles,
    })
}

fn chromium_profile_order(name: &str) -> Option<(bool, u32)> {
    if name == "Default" {
        return Some((true, 0));
    }
    let number = name.strip_prefix("Profile ")?.parse().ok()?;
    Some((false, number))
}

fn read_local_state_names(path: &Path) -> std::collections::HashMap<String, String> {
    let Ok(data) = fs::read(path) else {
        return Default::default();
    };
    let Ok(value) = serde_json::from_slice::<Value>(&data) else {
        return Default::default();
    };
    let Some(profiles) = value
        .get("profile")
        .and_then(|value| value.get("info_cache"))
        .and_then(Value::as_object)
    else {
        return Default::default();
    };
    profiles
        .iter()
        .filter_map(|(id, info)| {
            info.get("name")
                .and_then(Value::as_str)
                .map(|name| (id.clone(), name.to_owned()))
        })
        .collect()
}

fn opera_browser(id: &str, name: &str, directory: &Path) -> Option<DetectedBrowser> {
    if !directory.is_dir() {
        return None;
    }
    let has_bookmarks = directory.join("Bookmarks").is_file();
    let has_history = directory.join("History").is_file();
    (has_bookmarks || has_history).then(|| DetectedBrowser {
        id: id.to_owned(),
        name: name.to_owned(),
        engine: Engine::Chromium,
        profiles: vec![Profile {
            id: "Default".to_owned(),
            name: "Default".to_owned(),
            dir: directory.to_path_buf(),
            has_bookmarks,
            has_history,
        }],
    })
}

fn firefox_browser(directory: &Path) -> Option<DetectedBrowser> {
    if !directory.is_dir() {
        return None;
    }
    let profiles_ini = fs::read_to_string(directory.join("profiles.ini")).ok()?;
    let entries = parse_profiles_ini(
        profiles_ini
            .strip_prefix('\u{feff}')
            .unwrap_or(&profiles_ini),
    );
    let profiles = entries
        .into_iter()
        .filter_map(|(name, profile_path, is_relative)| {
            let dir = if is_relative {
                directory.join(profile_path)
            } else {
                profile_path
            };
            let places = dir.join("places.sqlite");
            if !places.is_file() {
                return None;
            }
            let id = dir
                .file_name()
                .and_then(|name| name.to_str())
                .unwrap_or_default()
                .to_owned();
            if id.is_empty() {
                return None;
            }
            Some(Profile {
                id: id.clone(),
                name: if name.trim().is_empty() { id } else { name },
                dir,
                has_bookmarks: true,
                has_history: true,
            })
        })
        .collect::<Vec<_>>();
    (!profiles.is_empty()).then(|| DetectedBrowser {
        id: "firefox".to_owned(),
        name: "Firefox".to_owned(),
        engine: Engine::Firefox,
        profiles,
    })
}

fn parse_profiles_ini(text: &str) -> Vec<(String, PathBuf, bool)> {
    #[derive(Default)]
    struct Entry {
        name: Option<String>,
        path: Option<PathBuf>,
        is_relative: bool,
    }

    let mut entries: Vec<Entry> = Vec::new();
    let mut current: Option<usize> = None;
    for line in text.lines() {
        let line = line.trim();
        if line.is_empty() || line.starts_with(';') || line.starts_with('#') {
            continue;
        }
        if line.starts_with('[') && line.ends_with(']') {
            let section = &line[1..line.len() - 1];
            current = if section.strip_prefix("Profile").is_some_and(|suffix| {
                !suffix.is_empty() && suffix.chars().all(|c| c.is_ascii_digit())
            }) {
                entries.push(Entry::default());
                Some(entries.len() - 1)
            } else {
                None
            };
            continue;
        }
        let Some(index) = current else {
            continue;
        };
        let Some((key, value)) = line.split_once('=') else {
            continue;
        };
        let entry = &mut entries[index];
        match key.trim().to_ascii_lowercase().as_str() {
            "name" => entry.name = Some(value.trim().to_owned()),
            "path" => entry.path = Some(PathBuf::from(value.trim())),
            "isrelative" => {
                entry.is_relative =
                    matches!(value.trim().to_ascii_lowercase().as_str(), "1" | "true")
            }
            _ => {}
        }
    }
    entries
        .into_iter()
        .filter_map(|entry| {
            Some((
                entry.name.unwrap_or_default(),
                entry.path?,
                entry.is_relative,
            ))
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::{detect_in, Roots};
    use crate::{Engine, Profile};
    use std::fs;
    use std::path::{Path, PathBuf};

    fn touch(path: &Path) {
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(path, b"fixture").unwrap();
    }

    fn profile(root: &Path, path: &str) -> PathBuf {
        root.join(path)
    }

    #[test]
    fn detects_browsers_in_stable_order_with_profile_names_and_capabilities() {
        let temp = tempfile::tempdir().unwrap();
        let local = temp.path().join("local");
        let app = temp.path().join("roaming");
        let roots = Roots {
            local_app_data: Some(local.clone()),
            app_data: Some(app.clone()),
        };

        let chromium_dirs = [
            "Google/Chrome/User Data",
            "Microsoft/Edge/User Data",
            "BraveSoftware/Brave-Browser/User Data",
            "Vivaldi/User Data",
            "Chromium/User Data",
        ];
        for base in chromium_dirs {
            let user_data = local.join(base);
            fs::create_dir_all(&user_data).unwrap();
            fs::write(
                user_data.join("Local State"),
                r#"{"profile":{"info_cache":{"Default":{"name":"Personal"},"Profile 2":{"name":"Work"}}}}"#,
            )
            .unwrap();
            touch(&user_data.join("Profile 10").join("History"));
            touch(&user_data.join("Profile 2").join("Bookmarks"));
            touch(&user_data.join("Default").join("History"));
            touch(&user_data.join("Profile nonsense").join("Bookmarks"));
            fs::create_dir_all(user_data.join("Profile 3")).unwrap();
        }
        touch(&profile(&app, "Opera Software/Opera Stable/Bookmarks"));
        touch(&profile(&app, "Opera Software/Opera GX Stable/History"));
        let firefox = app.join("Mozilla/Firefox");
        fs::create_dir_all(firefox.join("Profiles/default-release")).unwrap();
        fs::create_dir_all(firefox.join("Profiles/ignored")).unwrap();
        let external = temp.path().join("external-profile");
        fs::create_dir_all(&external).unwrap();
        touch(&external.join("places.sqlite"));
        fs::write(
            firefox.join("profiles.ini"),
            format!(
                "[Profile0]\nName=Everyday\nIsRelative=1\nPath=Profiles/default-release\n\n[Profile1]\nName=Missing\nIsRelative=1\nPath=Profiles/absent\n\n[Profile2]\nName=External\nIsRelative=0\nPath={}\n\n[InstallABC]\nDefault=Profiles/ignored\n",
                external.display()
            ),
        )
        .unwrap();
        touch(&firefox.join("Profiles/default-release/places.sqlite"));

        let found = detect_in(&roots);
        assert_eq!(
            found
                .iter()
                .map(|browser| browser.id.as_str())
                .collect::<Vec<_>>(),
            ["chrome", "edge", "brave", "vivaldi", "opera", "opera-gx", "chromium", "firefox"]
        );
        assert_eq!(found[0].engine, Engine::Chromium);
        assert_eq!(
            found[0].profiles,
            vec![
                Profile {
                    id: "Default".to_owned(),
                    name: "Personal".to_owned(),
                    dir: local.join("Google/Chrome/User Data/Default"),
                    has_bookmarks: false,
                    has_history: true,
                },
                Profile {
                    id: "Profile 2".to_owned(),
                    name: "Work".to_owned(),
                    dir: local.join("Google/Chrome/User Data/Profile 2"),
                    has_bookmarks: true,
                    has_history: false,
                },
                Profile {
                    id: "Profile 10".to_owned(),
                    name: "Profile 10".to_owned(),
                    dir: local.join("Google/Chrome/User Data/Profile 10"),
                    has_bookmarks: false,
                    has_history: true,
                },
            ]
        );
        assert_eq!(found[4].profiles[0].id, "Default");
        assert!(found[4].profiles[0].has_bookmarks);
        assert!(found[5].profiles[0].has_history);
        assert_eq!(found[7].engine, Engine::Firefox);
        assert_eq!(found[7].profiles[0].id, "default-release");
        assert_eq!(found[7].profiles[0].name, "Everyday");
        assert_eq!(found[7].profiles[1].id, "external-profile");
        assert_eq!(found[7].profiles[1].name, "External");
    }

    #[test]
    fn omits_missing_roots_and_browsers_without_usable_profiles() {
        assert!(detect_in(&Roots::default()).is_empty());
        let temp = tempfile::tempdir().unwrap();
        let local = temp.path().join("local");
        let app = temp.path().join("app");
        fs::create_dir_all(local.join("Google/Chrome/User Data/Profile 1")).unwrap();
        fs::create_dir_all(app.join("Opera Software/Opera Stable")).unwrap();
        fs::create_dir_all(app.join("Mozilla/Firefox")).unwrap();
        fs::write(
            app.join("Mozilla/Firefox/profiles.ini"),
            "[Profile0]\nPath=empty\nIsRelative=1\n",
        )
        .unwrap();
        assert!(detect_in(&Roots {
            local_app_data: Some(local),
            app_data: Some(app),
        })
        .is_empty());
    }
}
