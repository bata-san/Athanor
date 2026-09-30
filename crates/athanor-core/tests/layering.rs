//! Architecture guard: the engine-agnostic crates must never (transitively) depend on a UI toolkit,
//! a webview wrapper or a platform binding. This is what keeps Chromium / WebView upgrades confined to
//! the platform adapters in `app/src-tauri` and the Android plugin.

use serde_json::Value;
use std::{collections::HashSet, process::Command};

const PURE_CRATES: &[&str] = &["athanor-core", "athanor-adblock", "athanor-ext"];

/// UI toolkits, webview wrappers and platform app frameworks. (OS-level binding crates such as
/// `windows-sys` are fine: they are pulled in transitively by std-adjacent crates like sockets/TLS.)
const FORBIDDEN: &[&str] = &[
    "tauri",
    "tauri-runtime",
    "tauri-runtime-wry",
    "tauri-plugin",
    "wry",
    "tao",
    "webview2-com",
    "webview2-com-sys",
    "jni",
    "android-activity",
    "objc2",
    "gtk",
    "webkit2gtk",
];

#[test]
fn engine_agnostic_crates_have_no_platform_dependencies() {
    let cargo = std::env::var("CARGO").unwrap_or_else(|_| "cargo".into());
    let out = Command::new(cargo)
        .args(["metadata", "--format-version", "1", "--locked"])
        .current_dir(env!("CARGO_MANIFEST_DIR"))
        .output()
        .expect("run cargo metadata");
    assert!(
        out.status.success(),
        "cargo metadata failed: {}",
        String::from_utf8_lossy(&out.stderr)
    );
    let meta: Value = serde_json::from_slice(&out.stdout).expect("metadata json");

    let nodes = meta["resolve"]["nodes"].as_array().expect("resolve nodes");
    let name_of = |id: &str| -> String {
        meta["packages"]
            .as_array()
            .unwrap()
            .iter()
            .find(|p| p["id"] == id)
            .map(|p| p["name"].as_str().unwrap().to_string())
            .unwrap_or_default()
    };

    for root in PURE_CRATES {
        let Some(start) = meta["packages"]
            .as_array()
            .unwrap()
            .iter()
            .find(|p| p["name"] == *root)
        else {
            continue; // crate not present in this checkout
        };
        let mut stack = vec![start["id"].as_str().unwrap().to_string()];
        let mut seen = HashSet::new();
        while let Some(id) = stack.pop() {
            if !seen.insert(id.clone()) {
                continue;
            }
            let node = nodes.iter().find(|n| n["id"] == id.as_str()).expect("node");
            for dep in node["deps"].as_array().unwrap() {
                // only normal (runtime) edges count; dev/build tooling may use anything
                let normal = dep["dep_kinds"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .any(|k| k["kind"].is_null());
                if normal {
                    stack.push(dep["pkg"].as_str().unwrap().to_string());
                }
            }
        }
        for id in &seen {
            let name = name_of(id);
            assert!(
                !FORBIDDEN.contains(&name.as_str()),
                "`{root}` must not depend on `{name}` (layering violation)"
            );
        }
    }
}
