use crate::*;
use std::{
    fs,
    path::{Path, PathBuf},
    sync::atomic::{AtomicUsize, Ordering},
};

static NEXT: AtomicUsize = AtomicUsize::new(0);
struct Temp(PathBuf);
impl Temp {
    fn new() -> Self {
        let path = std::env::temp_dir().join(format!(
            "athanor-ext-test-{}-{}",
            std::process::id(),
            NEXT.fetch_add(1, Ordering::Relaxed)
        ));
        fs::create_dir_all(&path).unwrap();
        Self(path)
    }
}
impl Drop for Temp {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}
fn make(root: &Path, id: &str, extra: serde_json::Value) -> PathBuf {
    let dir = root.join(id);
    fs::create_dir_all(&dir).unwrap();
    let mut value = serde_json::json!({"id":id,"name":"Example","version":"1.0.0","athanor":">=0.1","permissions":[],"contributes":{}});
    for (k, v) in extra.as_object().unwrap() {
        value[k] = v.clone();
    }
    fs::write(
        dir.join("athanor-extension.json"),
        serde_json::to_vec(&value).unwrap(),
    )
    .unwrap();
    dir
}

#[test]
fn examples_are_valid() {
    let mut registry = Registry::new();
    let dir = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../extensions/examples");
    let issues = registry.load_dir(&dir, Source::Builtin);
    assert!(issues.is_empty(), "{issues:?}");
    assert_eq!(registry.list().len(), 3);
    assert!(registry.theme("ember-accent").is_some());
    let scripts = registry.user_scripts_for(
        &url::Url::parse("https://github.com/rust-lang/rust").unwrap(),
        RunAt::DocumentIdle,
        true,
    );
    assert_eq!(scripts.len(), 1);
    assert!(scripts[0].to_eval_js().contains("createElement('style')"));
    assert!(registry
        .user_scripts_for(
            &url::Url::parse("https://github.com/login").unwrap(),
            RunAt::DocumentIdle,
            true
        )
        .is_empty());
    assert!(registry
        .user_scripts_for(
            &url::Url::parse("https://github.com/rust-lang/rust").unwrap(),
            RunAt::DocumentIdle,
            false
        )
        .is_empty());
}

#[test]
fn validation_collects_errors_and_warns_unknown() {
    let temp = Temp::new();
    let dir = make(
        &temp.0,
        "bad",
        serde_json::json!({"id":"Bad!","version":"banana","athanor":">=999","unknownFuture":true,"contributes":{"shellCss":["missing.css"],"userScripts":[{"id":"x","matches":["bad"],"js":["missing.js"]}],"panels":[{"id":"p","title":"P","icon":"x","entry":"missing.html","location":"popup"}],"filterLists":[{"id":"r","name":"R","url":"http://example.com"}]}}),
    );
    let input = fs::read_to_string(dir.join("athanor-extension.json")).unwrap();
    let (manifest, warnings) = Manifest::parse(&input).unwrap();
    assert_eq!(warnings.len(), 1);
    let errors = manifest.validate(&dir, HOST_VERSION).unwrap_err();
    assert!(errors.0.len() >= 10, "{errors}");
    assert!(errors.to_string().contains("shellCss requires"));
}

#[test]
fn permissions_state_order_and_disabled() {
    let temp = Temp::new();
    let builtin = temp.0.join("builtin");
    let user = temp.0.join("user");
    let a = make(
        &builtin,
        "z.builtin",
        serde_json::json!({"permissions":["shell.style","commands"],"contributes":{"shellCss":["a.css"],"commands":[{"id":"c","title":"C"}]}}),
    );
    let b = make(
        &user,
        "a.user",
        serde_json::json!({"permissions":["shell.style"],"contributes":{"shellCss":["b.css"]}}),
    );
    fs::write(a.join("a.css"), "a{}").unwrap();
    fs::write(b.join("b.css"), "b{}").unwrap();
    let mut r = Registry::new();
    assert!(r.load_dir(&builtin, Source::Builtin).is_empty());
    assert!(r.load_dir(&user, Source::User).is_empty());
    let css = r.shell_css();
    assert!(css.find("z.builtin").unwrap() < css.find("a.user").unwrap());
    assert!(r.check("z.builtin", Permission::Commands).is_ok());
    assert!(r.check("a.user", Permission::Commands).is_err());
    r.set_enabled("z.builtin", false);
    assert_eq!(r.commands().len(), 0);
    assert!(!r.shell_css().contains("z.builtin"));
    assert!(r.check("z.builtin", Permission::Commands).is_err());
    let json = serde_json::to_string(&r.state()).unwrap();
    let mut restored = Registry::new();
    restored.restore_state(serde_json::from_str(&json).unwrap());
    restored.load_dir(&builtin, Source::Builtin);
    assert!(!restored.enabled("z.builtin"));
    assert_eq!(r.load_dir(&builtin, Source::Builtin).len(), 1);
}

#[test]
fn install_remove_and_asset_guard() {
    let temp = Temp::new();
    let srcs = temp.0.join("sources");
    let installed = temp.0.join("installed");
    let src = make(
        &srcs,
        "dev.test.ext",
        serde_json::json!({"permissions":["shell.panel"],"contributes":{"panels":[{"id":"p","title":"P","icon":"x","entry":"panel.html","location":"sidebar"}]}}),
    );
    fs::write(src.join("panel.html"), "<h1>Hi</h1>").unwrap();
    let mut r = Registry::new();
    let id = r.install_from_dir(&src, &installed).unwrap();
    assert_eq!(id, "dev.test.ext");
    assert_eq!(r.resolve_asset(&id, "panel.html").unwrap().1, "text/html");
    for bad in [
        "../x",
        "..\\..\\x",
        "%2e%2e/x",
        "/etc/passwd",
        "C:\\x",
        "\\\\server\\share",
        "a\0b",
    ] {
        assert!(r.resolve_asset(&id, bad).is_err(), "{bad:?}");
    }
    r.remove(&id, &installed).unwrap();
    assert!(r.list().is_empty());
    let huge = make(&srcs, "dev.test.huge", serde_json::json!({}));
    let f = fs::File::create(huge.join("huge.bin")).unwrap();
    f.set_len(32 * 1024 * 1024 + 1).unwrap();
    assert!(r.install_from_dir(&huge, &installed).is_err());
    let many = make(&srcs, "dev.test.many", serde_json::json!({}));
    for i in 0..1024 {
        fs::write(many.join(format!("{i}.txt")), "x").unwrap();
    }
    assert!(r.install_from_dir(&many, &installed).is_err());
}

#[cfg(windows)]
#[test]
fn install_refuses_symlink_when_available() {
    let temp = Temp::new();
    let srcs = temp.0.join("sources");
    let src = make(&srcs, "dev.test.link", serde_json::json!({}));
    fs::write(src.join("real.txt"), "ok").unwrap();
    if std::os::windows::fs::symlink_file(src.join("real.txt"), src.join("link.txt")).is_ok() {
        assert!(Registry::new()
            .install_from_dir(&src, &temp.0.join("installed"))
            .is_err());
    }
}

#[cfg(windows)]
#[test]
fn asset_refuses_symlink_escape_when_available() {
    let temp = Temp::new();
    let outside = temp.0.join("outside.txt");
    fs::write(&outside, "secret").unwrap();
    let extensions = temp.0.join("extensions");
    let dir = make(&extensions, "dev.test.asset", serde_json::json!({}));
    let link = dir.join("escape.txt");
    if std::os::windows::fs::symlink_file(&outside, &link).is_ok() {
        let mut registry = Registry::new();
        assert!(registry.load_dir(&extensions, Source::User).is_empty());
        assert!(registry
            .resolve_asset("dev.test.asset", "escape.txt")
            .is_err());
    }
}
