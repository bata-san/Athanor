# Android engine adapter

Athanor keeps the React shell in Tauri's `main` WebView. Each ordinary page is a sibling
`android.webkit.WebView` created and owned by `AthanorEngine`, a Kotlin Tauri mobile plugin
in `app/src-tauri/gen/android/app/src/main/java/dev/athanor/browser/AthanorEngine.kt`.
The generated-project plugin uses `PluginHandle::run_mobile_plugin` for engine commands;
native callbacks carry serialized `EngineEvent` JSON into Rust, where `MobileEngine` sends
events to the same `Browser` controller used on desktop. The plugin is local to the generated
Android project so it does not add an independently versioned plugin crate.

## Layout and security

The shell reports `set_content_bounds` in CSS pixels. Kotlin positions tabs as siblings over
the shell, converting those coordinates with the shell WebView's display density and offset
within its native parent. The native tab WebViews have no Tauri capabilities and no JavaScript
bridge. Tauri commands remain available only to the shell's `main` WebView through
`capabilities/mobile.json`. Android system bars are edge-to-edge; the shell's viewport and
reported bounds follow its measured WebView viewport, and `adjustResize` lets the content
rectangle track the IME.

Web requests are classified from `isForMainFrame`, Fetch Metadata, `Accept`, and URL suffix
heuristics, then passed to the app `Filter` through JNI. Type ordinals are documented alongside
the bridge in `jni_bridge.rs`. Filter calls fail open; blocked notifications are limited to one
event per tab per 100 ms. Script injection calls `Filter::injections` at document start, visible
commit, and page finish (phases 0, 1, and 2). WebView's document-start feature is used for
per-tab init scripts when the installed Android System WebView supports it; phase-0 runtime
injections are also evaluated from `onPageStarted`.

The WebView enables JavaScript, DOM storage, safe browsing, and multiple-window requests;
disables file/content access, mixed content, and third-party cookies; and cancels every SSL
error. Only `http`, `https`, and carefully resolved `intent`, `mailto`, and `tel` links are
handled. Downloads use Android `DownloadManager`. Camera, microphone, and geolocation prompts
require both an in-app confirmation and Android runtime grants. Background tabs are paused
unless WebView media polling detects audible HTML media.

Hardware keyboard shortcuts from a focused tab use the same combo names as the desktop
adapter. Long-pressing a remote image offers “Send image to board” and forwards a
`contextAction` event to Rust.

## Build and run

Prerequisites: Android Studio/SDK with platform 36 or newer, Android build tools, NDK, JDK 17,
Rust targets `aarch64-linux-android` and optionally `x86_64-linux-android`, and the Tauri CLI.
From `app/`, use the normal Tauri Android commands:

```powershell
npx tauri android dev
npx tauri android build --debug --target aarch64 --apk
```

`tauri.android.conf.json` supplies the mobile `main` shell window. The APK contains the Rust
`athanor_lib` native library and the Kotlin plugin. If the frontend bundle is not ready, build
with a temporary CLI config overriding `build.beforeBuildCommand` to an empty command while
retaining `frontendDist: "../dist"`.

## Debugging

Debug builds enable `WebView.setWebContentsDebuggingEnabled`, so inspect tabs at
`chrome://inspect` from desktop Chrome. Android logs use the `AthanorEngine` tag; Rust JNI
errors are logged through the app logger. `openDevtools` is a successful no-op in release.
Use `adb logcat`, `adb shell dumpsys webviewupdate`, and the device's WebView provider version
when reproducing rendering or compatibility issues.

## Limitations and Chromium changes

Android System WebView is supplied by the device and updates independently of Athanor. This
adapter depends on the stable `android.webkit.WebView`, `WebViewClient`, and `WebChromeClient`
APIs; experimental WebView features are optional and guarded by support checks. Document-start
injection depends on AndroidX WebKit/WebView support. Favicon events are best-effort, audio
state is best-effort and only observes HTML audio/video elements, tab audio muting is implemented
in page JavaScript, and Android has no attached remote devtools window. APK/device validation
should be repeated against the Android System WebView versions Athanor supports.

When Chromium/WebView behavior changes, update this Android adapter and its feature checks;
the Rust `EngineBackend`/`Browser` contract and desktop adapter remain independent of those
Android-specific changes.
