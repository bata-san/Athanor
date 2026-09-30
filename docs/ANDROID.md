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
bridge (`addJavascriptInterface` is never used); their only page-to-host channel is the
adblock-owned `athanorShield` WebMessageListener described below. Tauri commands remain available
only to the shell's `main` WebView through `capabilities/mobile.json`. Android system bars are
edge-to-edge; the shell's viewport and reported bounds follow its measured WebView viewport, and
`adjustResize` lets the content rectangle track the IME.

Web requests are classified from `isForMainFrame`, Fetch Metadata, `Accept`, and URL suffix
heuristics, then passed to the app `Filter` through JNI. Type ordinals are documented alongside
the bridge in `jni_bridge.rs`. Filter calls fail open; blocked notifications are limited to one
event per tab per 100 ms. Script injection calls `Filter::injections` at document start, visible
commit, and page finish (phases 0, 1, and 2). WebView's document-start feature is used for
per-tab init scripts when the installed Android System WebView supports it; phase-0 runtime
injections are also evaluated from `onPageStarted`.

## On-demand cosmetic filtering

`AthanorEngine` also installs the shared `cosmetic-bridge.js` collector in every frame of every tab
WebView, so generic class/ID hide rules are fetched from the compiled engine on demand instead of
being written into every stylesheet. When `WebViewFeature.WEB_MESSAGE_LISTENER` and
`WebViewFeature.DOCUMENT_START_SCRIPT` are both supported, `configureWebView` calls
`installCosmeticBridge` before any URL is loaded:

* the script source is fetched once per process from Rust through the `cosmeticBridgeScript()`
  external method and cached in the plugin;
* `WebViewCompat.addDocumentStartJavaScript` runs it at document start in every frame;
* `WebViewCompat.addWebMessageListener(webView, "athanorShield", …)` injects the transport object
  the collector posts its JSON strings to, and hands us the
  `WebViewCompat.WebMessageListener` callback.

The callback keeps the same bounds and protocol as the Windows host: string messages only, 128 KiB
inbound cap, `cosmeticQuery(pageUrl, rawJson)` into `Filter::cosmetic_query_reply` (the same
validator the WebView2 adapter uses), and `replyProxy.postMessage(response)` only when the call
returns non-null. Every step is feature-checked and wrapped in `runCatching`; on an older Android
System WebView, or on any error, nothing happens and the page simply loads without cosmetics.
`addJavascriptInterface` is not used.

Two platform limitations are worth knowing:

* androidx.webkit's `allowedOriginRules` has no way to say "every http(s) origin" — the only
  wildcard it accepts is the bare `*`, and a wildcard *hostname* is rejected outright. Both
  registrations therefore use `*`, and HTTP(S)-only is enforced natively: the callback drops any
  frame whose `sourceOrigin` is not http(s), and `Filter::cosmetic_query_reply` drops any non-web
  page URL.
* The listener reports only `sourceOrigin` for subframes, not the full subframe URL, so subframe
  cosmetics are matched against the frame's origin (no path or query). Main-frame queries use the
  WebView's current URL.

The native bridge lives in `jni_bridge.rs` (`Java_dev_athanor_browser_AthanorEngine_cosmeticBridgeScript`
and `Java_dev_athanor_browser_AthanorEngine_cosmeticQuery`, both `cfg(target_os = "android")` and
panic-contained with `catch_unwind`). See [ADBLOCK.md](ADBLOCK.md) for the message protocol.

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
injection and the on-demand cosmetic message listener depend on AndroidX WebKit/WebView support
(`DOCUMENT_START_SCRIPT` and `WEB_MESSAGE_LISTENER`). Favicon events are best-effort, audio
state is best-effort and only observes HTML audio/video elements, tab audio muting is implemented
in page JavaScript, and Android has no attached remote devtools window. APK/device validation
should be repeated against the Android System WebView versions Athanor supports, including a
device where the on-demand cosmetic bridge is unsupported so the fail-open path is exercised.

When Chromium/WebView behavior changes, update this Android adapter and its feature checks;
the Rust `EngineBackend`/`Browser` contract and desktop adapter remain independent of those
Android-specific changes.

## Building on Windows without Developer Mode

`tauri android build` symlinks the compiled `libathanor_lib.so` into the Gradle project, which needs Windows
Developer Mode (or the "create symbolic links" privilege). If you do not want to change that setting, let the CLI
compile Rust (it stops at the symlink step), then copy the library and run Gradle yourself:

```powershell
cd app
npx tauri android build --target aarch64 --apk          # compiles Rust; fails at the symlink step
Copy-Item ..\target\aarch64-linux-android\release\libathanor_lib.so `
  src-tauri\gen\android\app\src\main\jniLibs\arm64-v8a\ -Force
cd src-tauri\gen\android
.\gradlew.bat :app:assembleArm64Release -x :app:rustBuildArm64Release
```

The result is an *unsigned* APK. Sign it (for sideloading/testing you can use the debug key):

```powershell
$bt = "$env:LOCALAPPDATA\Android\Sdk\build-tools\36.0.0"
& "$bt\zipalign.exe" -p -f 4 app\build\outputs\apk\arm64\release\app-arm64-release-unsigned.apk aligned.apk
& "$bt\apksigner.bat" sign --ks "$env:USERPROFILE\.android\debug.keystore" --ks-pass pass:android `
  --key-pass pass:android --ks-key-alias androiddebugkey --out Athanor.apk aligned.apk
```

## Testing on an emulator

An x86_64 `google_apis` image works (Windows Hypervisor Platform is enough). Build with `--target x86_64`, install
the debug APK, and use `e2e/shield/check-android.cjs` (see `e2e/README.md`). First run: the filter lists are
downloaded in the background, so generic cosmetic rules only apply once that finishes.
