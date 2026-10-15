fn main() {
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("macos") {
        build_macos_adapter();
    }
    tauri_build::build()
}

fn build_macos_adapter() {
    use std::{env, path::PathBuf, process::Command};
    println!("cargo:rerun-if-changed=src/macos.m");
    println!("cargo:rerun-if-env-changed=MACOSX_DEPLOYMENT_TARGET");
    let out = PathBuf::from(env::var_os("OUT_DIR").expect("OUT_DIR"));
    let target = env::var("TARGET").expect("TARGET");
    let arch = if target.starts_with("aarch64") {
        "arm64"
    } else {
        "x86_64"
    };
    let minimum = env::var("MACOSX_DEPLOYMENT_TARGET").unwrap_or_else(|_| "14.0".into());
    let status = Command::new("xcrun")
        .args([
            "--sdk",
            "macosx",
            "clang",
            "-c",
            "-fobjc-arc",
            "-fblocks",
            "-arch",
            arch,
        ])
        .arg(format!("-mmacosx-version-min={minimum}"))
        .args(["src/macos.m", "-o"])
        .arg(out.join("macos.o"))
        .status()
        .expect("Xcode Command Line Tools are required");
    assert!(
        status.success(),
        "failed to compile the macOS WebKit adapter"
    );
    let status = Command::new("xcrun")
        .args(["ar", "crs"])
        .arg(out.join("libathanor_macos.a"))
        .arg(out.join("macos.o"))
        .status()
        .expect("Xcode ar is required");
    assert!(
        status.success(),
        "failed to archive the macOS WebKit adapter"
    );
    println!("cargo:rustc-link-search=native={}", out.display());
    println!("cargo:rustc-link-lib=static=athanor_macos");
    println!("cargo:rustc-link-lib=framework=WebKit");
    println!("cargo:rustc-link-lib=framework=AppKit");
}
