package dev.athanor.browser

import android.Manifest
import android.app.Activity
import android.app.DownloadManager
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.graphics.Canvas
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.os.Handler
import android.os.Looper
import android.view.KeyEvent
import android.view.View
import android.view.ViewGroup
import android.webkit.CookieManager
import android.webkit.DownloadListener
import android.webkit.GeolocationPermissions
import android.webkit.JsPromptResult
import android.webkit.JsResult
import android.webkit.RenderProcessGoneDetail
import android.webkit.SslErrorHandler
import android.webkit.URLUtil
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.webkit.PermissionRequest
import android.widget.EditText
import android.widget.FrameLayout
import android.widget.Toast
import android.util.Base64
import android.util.Log
import androidx.activity.ComponentActivity
import androidx.activity.result.ActivityResultLauncher
import androidx.activity.result.contract.ActivityResultContracts
import androidx.annotation.Keep
import androidx.appcompat.app.AlertDialog
import androidx.core.content.ContextCompat
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.Plugin
import org.json.JSONArray
import org.json.JSONObject
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.util.Locale
import java.util.concurrent.ConcurrentHashMap
import kotlin.math.roundToInt

private const val TAG = "AthanorEngine"
private const val KIND_DOCUMENT = 0
private const val KIND_SUBDOCUMENT = 1
private const val KIND_STYLESHEET = 2
private const val KIND_SCRIPT = 3
private const val KIND_IMAGE = 4
private const val KIND_FONT = 5
private const val KIND_MEDIA = 6
private const val KIND_XHR = 7
private const val KIND_FETCH = 8
private const val KIND_WEBSOCKET = 9
private const val KIND_PING = 10
private const val KIND_OTHER = 11

/** CSS pixels from getBoundingClientRect() to physical pixels. */
internal object EngineGeometry {
    fun cssToPx(value: Double, density: Float): Int = (value * density).roundToInt()
}

/** Stable request-kind ordinals mirrored by jni_bridge.rs::kind_from_int. */
internal object RequestKindClassifier {
    fun classify(url: String, mainFrame: Boolean, headers: Map<String, String>): Int {
        if (mainFrame) return KIND_DOCUMENT
        val normalized = headers.entries.associate { it.key.lowercase(Locale.ROOT) to it.value.lowercase(Locale.ROOT) }
        val destination = normalized["sec-fetch-dest"].orEmpty()
        val mode = normalized["sec-fetch-mode"].orEmpty()
        val accept = normalized["accept"].orEmpty()
        if (mode == "websocket" || url.startsWith("ws:", true) || url.startsWith("wss:", true)) return KIND_WEBSOCKET
        val path = runCatching { java.net.URI(url).path.orEmpty().lowercase(Locale.ROOT) }.getOrDefault("")
        if (destination == "document" || destination == "iframe" || destination == "frame") return KIND_SUBDOCUMENT
        if (destination == "script" || path.endsWith(".js") || path.endsWith(".mjs") || accept.contains("javascript")) return KIND_SCRIPT
        if (destination == "style" || path.endsWith(".css") || accept.contains("text/css")) return KIND_STYLESHEET
        if (destination == "image" || accept.contains("image/") || hasSuffix(path, ".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".ico", ".avif")) return KIND_IMAGE
        if (destination == "font" || hasSuffix(path, ".woff", ".woff2", ".ttf", ".otf", ".eot")) return KIND_FONT
        if (destination == "audio" || destination == "video" || accept.contains("audio/") || accept.contains("video/") || hasSuffix(path, ".mp3", ".mp4", ".webm", ".m4a", ".ogg", ".wav")) return KIND_MEDIA
        if (destination == "ping" || destination == "beacon" || normalized.containsKey("ping-from") || normalized.containsKey("ping-to")) return KIND_PING
        if (destination == "empty" && (accept.contains("application/json") || accept.contains("text/plain"))) return KIND_FETCH
        if (destination.isBlank() && (accept.contains("application/json") || accept.contains("text/xml"))) return KIND_XHR
        return KIND_OTHER
    }

    private fun hasSuffix(path: String, vararg suffixes: String) = suffixes.any(path::endsWith)
}

@InvokeArg
internal class CreateTabArgs {
    lateinit var id: String
    lateinit var url: String
    var x: Double = 0.0
    var y: Double = 0.0
    var w: Double = 1.0
    var h: Double = 1.0
    var visible: Boolean = true
    var userAgent: String? = null
    var initScripts: ArrayList<String>? = null
}

@InvokeArg
internal class TabArgs { lateinit var id: String }

@InvokeArg
internal class NavigateArgs { lateinit var id: String; lateinit var url: String }

@InvokeArg
internal class BoundsArgs {
    lateinit var id: String
    var x: Double = 0.0
    var y: Double = 0.0
    var w: Double = 1.0
    var h: Double = 1.0
}

@InvokeArg
internal class VisibilityArgs { lateinit var id: String; var visible: Boolean = true }

@InvokeArg
internal class ScriptArgs { lateinit var id: String; lateinit var script: String }

@InvokeArg
internal class ZoomArgs { lateinit var id: String; var factor: Double = 1.0 }

@InvokeArg
internal class MutedArgs { lateinit var id: String; var muted: Boolean = false }

private data class TabRecord(
    val id: String,
    val webView: WebView,
    var x: Double,
    var y: Double,
    var w: Double,
    var h: Double,
    @Volatile var currentUrl: String,
    val initScripts: List<String>,
    val docStartScriptsEnabled: Boolean,
    var zoom: Float = 1f,
    var visible: Boolean = false,
    var audible: Boolean = false,
    var muted: Boolean = false,
    var lastProgress: Int = -1,
)

private data class PendingRuntimePermission(
    val permissions: Array<String>,
    val completed: (Boolean) -> Unit,
)

private class EngineKeyEventState {
    val consumedKeys = mutableSetOf<Int>()
}

@Keep
@TauriPlugin
class AthanorEngine(private val activity: Activity) : Plugin(activity) {
    private val tabs = ConcurrentHashMap<String, TabRecord>()
    private val handler = Handler(Looper.getMainLooper())
    private var shellWebView: WebView? = null
    private var host: ViewGroup? = null
    private var overlay: FrameLayout? = null
    private var activeTab: String? = null
    private var fileChooserCallback: ValueCallback<Array<Uri>>? = null
    private var customView: View? = null
    private var customViewCallback: WebChromeClient.CustomViewCallback? = null
    private var systemBarsWereVisible: Boolean = true
    private var pendingRuntime: PendingRuntimePermission? = null
    private val runtimeQueue = ArrayDeque<PendingRuntimePermission>()
    private var permissionInFlight = false

    private val filePickerLauncher: ActivityResultLauncher<Intent>? =
        (activity as? ComponentActivity)?.registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
            val callback = fileChooserCallback
            fileChooserCallback = null
            if (callback != null) {
                val values = if (result.resultCode == Activity.RESULT_OK) result.data?.let(::urisFromResult) else null
                callback.onReceiveValue(values?.toTypedArray())
            }
        }

    private val permissionLauncher: ActivityResultLauncher<Array<String>>? =
        (activity as? ComponentActivity)?.registerForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) { grants ->
            val pending = pendingRuntime
            pendingRuntime = null
            permissionInFlight = false
            pending?.completed(runtimePermissionGranted(pending.permissions, grants))
            launchNextRuntimePermission()
        }

    private val layoutListener = View.OnLayoutChangeListener { _, _, _, _, _, _, _, _, _ -> relayoutTabs() }
    private val globalLayoutListener = android.view.ViewTreeObserver.OnGlobalLayoutListener { relayoutTabs() }

    private val audioCheck = object : Runnable {
        override fun run() {
            tabs.values.toList().forEach { record ->
                if (record.visible || record.audible) {
                    record.webView.evaluateJavascript(
                        "(function(){return Array.from(document.querySelectorAll('audio,video')).some(function(e){return !e.paused&&!e.muted&&e.volume>0})})()",
                    ) { raw ->
                        val audible = raw == "true"
                        if (audible != record.audible) {
                            record.audible = audible
                            emitEvent(JSONObject().put("type", "audioChanged").put("tab", record.id).put("audible", audible))
                            if (!record.visible) {
                                if (audible) record.webView.onResume() else record.webView.onPause()
                            }
                        }
                    }
                }
            }
            handler.postDelayed(this, 2500)
        }
    }

    private inner class TabWebView(private val tabId: String) : WebView(activity) {
        private val keyState = EngineKeyEventState()

        override fun dispatchKeyEvent(event: KeyEvent): Boolean {
            if (event.action == KeyEvent.ACTION_DOWN) {
                if (event.keyCode in keyState.consumedKeys) return true
                val combo = shortcutCombo(event) ?: return super.dispatchKeyEvent(event)
                keyState.consumedKeys.add(event.keyCode)
                if (event.repeatCount == 0) {
                    emitEvent(JSONObject().put("type", "shortcut").put("tab", tabId).put("combo", combo))
                }
                return true
            }
            if (event.action == KeyEvent.ACTION_UP && keyState.consumedKeys.remove(event.keyCode)) return true
            return super.dispatchKeyEvent(event)
        }
    }

    companion object {
        @Volatile private var loadedPlugin: AthanorEngine? = null

        init {
            try {
                System.loadLibrary("athanor_lib")
            } catch (error: UnsatisfiedLinkError) {
                Log.e(TAG, "Could not load the Athanor Rust library", error)
                throw error
            }
        }

        @JvmStatic fun dispatchSystemBack(): Boolean {
            val plugin = loadedPlugin ?: return false
            val tab = plugin.activeTab ?: return false
            plugin.emitEvent(JSONObject().put("type", "shortcut").put("tab", tab).put("combo", "Back"))
            return true
        }
    }

    private external fun nativeShouldBlock(tab: String, url: String, source: String, kind: Int): Boolean
    private external fun nativeInjections(pageUrl: String, phase: Int): String
    private external fun nativeRewriteNavigation(url: String): String?
    private external fun nativeOnEvent(eventJson: String)

    override fun load(webView: WebView) {
        shellWebView = webView
        loadedPlugin = this
        WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG)
        val parent = webView.parent as? ViewGroup
        if (parent == null) {
            Log.e(TAG, "Tauri shell WebView has no ViewGroup parent; native tabs cannot be placed")
            return
        }
        host = parent
        val tabOverlay = FrameLayout(activity).apply {
            clipChildren = true
            clipToPadding = true
            isClickable = false
            isFocusable = false
        }
        parent.addView(tabOverlay, ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
        overlay = tabOverlay
        parent.addOnLayoutChangeListener(layoutListener)
        parent.viewTreeObserver.addOnGlobalLayoutListener(globalLayoutListener)

        handler.postDelayed(audioCheck, 2500)
    }

    override fun onPause(activity: androidx.appcompat.app.AppCompatActivity) {
        tabs.values.forEach { if (!it.audible) it.webView.onPause() }
        super.onPause(activity)
    }

    override fun onStop(activity: androidx.appcompat.app.AppCompatActivity) {
        // `pauseTimers` is process-wide but only reachable through an instance.
        tabs.values.firstOrNull()?.webView?.pauseTimers()
        super.onStop(activity)
    }

    override fun onResume(activity: androidx.appcompat.app.AppCompatActivity) {
        tabs.values.firstOrNull()?.webView?.resumeTimers()
        tabs.values.forEach { record -> if (record.visible || record.audible) record.webView.onResume() }
        super.onResume(activity)
    }

    override fun onDestroy(activity: androidx.appcompat.app.AppCompatActivity) {
        destroyAll()
        super.onDestroy(activity)
    }

    @Command
    fun createTab(invoke: Invoke) {
        runCommand(invoke) {
            val args = invoke.parseArgs(CreateTabArgs::class.java)
            check(!tabs.containsKey(args.id)) { "Tab already exists: ${args.id}" }
            val view = TabWebView(args.id)
            val scripts = args.initScripts.orEmpty().toList()
            val documentStartEnabled = configureWebView(view, args.id, args.userAgent, scripts)
            val record = TabRecord(args.id, view, args.x, args.y, args.w, args.h, args.url, scripts, documentStartEnabled)
            tabs[args.id] = record
            overlay?.addView(view, FrameLayout.LayoutParams(1, 1))
            applyBounds(record)
            setTabVisibility(record, args.visible)
            val destination = rewrite(args.url) ?: args.url
            record.currentUrl = destination
            view.loadUrl(destination)
        }
    }

    @Command fun closeTab(invoke: Invoke) = runCommand(invoke) {
        val args = invoke.parseArgs(TabArgs::class.java)
        val record = tabs.remove(args.id) ?: return@runCommand
        record.webView.stopLoading()
        record.webView.onPause()
        (record.webView.parent as? ViewGroup)?.removeView(record.webView)
        record.webView.removeAllViews()
        record.webView.destroy()
        if (activeTab == args.id) activeTab = tabs.values.lastOrNull { it.visible }?.id
    }

    @Command fun navigate(invoke: Invoke) = runCommand(invoke) {
        val args = invoke.parseArgs(NavigateArgs::class.java)
        val record = tab(args.id)
        val destination = rewrite(args.url) ?: args.url
        record.currentUrl = destination
        record.webView.loadUrl(destination)
    }

    @Command fun goBack(invoke: Invoke) = runCommand(invoke) {
        val record = tab(invoke.parseArgs(TabArgs::class.java).id)
        if (record.webView.canGoBack()) record.webView.goBack()
    }

    @Command fun goForward(invoke: Invoke) = runCommand(invoke) {
        val record = tab(invoke.parseArgs(TabArgs::class.java).id)
        if (record.webView.canGoForward()) record.webView.goForward()
    }

    @Command fun reload(invoke: Invoke) = runCommand(invoke) { tab(invoke.parseArgs(TabArgs::class.java).id).webView.reload() }
    @Command fun stop(invoke: Invoke) = runCommand(invoke) { tab(invoke.parseArgs(TabArgs::class.java).id).webView.stopLoading() }

    @Command fun setBounds(invoke: Invoke) = runCommand(invoke) {
        val args = invoke.parseArgs(BoundsArgs::class.java)
        val record = tab(args.id)
        record.x = args.x; record.y = args.y; record.w = args.w; record.h = args.h
        applyBounds(record)
    }

    @Command fun setVisible(invoke: Invoke) = runCommand(invoke) {
        val args = invoke.parseArgs(VisibilityArgs::class.java)
        setTabVisibility(tab(args.id), args.visible)
    }

    @Command fun focus(invoke: Invoke) = runCommand(invoke) {
        val record = tab(invoke.parseArgs(TabArgs::class.java).id)
        activeTab = record.id
        setTabVisibility(record, true)
        record.webView.requestFocus()
    }

    @Command fun eval(invoke: Invoke) = runCommand(invoke) {
        val args = invoke.parseArgs(ScriptArgs::class.java)
        tab(args.id).webView.evaluateJavascript(args.script, null)
    }

    @Command fun setZoom(invoke: Invoke) = runCommand(invoke) {
        val args = invoke.parseArgs(ZoomArgs::class.java)
        val record = tab(args.id)
        val newZoom = args.factor.toFloat().coerceIn(0.25f, 5f)
        record.webView.zoomBy(newZoom / record.zoom)
        record.zoom = newZoom
    }

    @Command fun setMuted(invoke: Invoke) = runCommand(invoke) {
        val args = invoke.parseArgs(MutedArgs::class.java)
        val record = tab(args.id)
        record.muted = args.muted
        record.webView.evaluateJavascript(muteScript(args.muted), null)
    }

    @Command fun openDevtools(invoke: Invoke) = runCommand(invoke) {
        tab(invoke.parseArgs(TabArgs::class.java).id)
        // Remote inspection is available from chrome://inspect in debug builds.
    }

    @Command fun discard(invoke: Invoke) = closeTab(invoke)

    @Command fun capturePng(invoke: Invoke) {
        try {
            val record = tab(invoke.parseArgs(TabArgs::class.java).id)
            val view = record.webView
            check(view.width > 0 && view.height > 0) { "Page has no visible area to capture" }
            val bitmap = Bitmap.createBitmap(view.width, view.height, Bitmap.Config.ARGB_8888)
            try {
                view.draw(Canvas(bitmap))
                val bytes = ByteArrayOutputStream().use { out -> bitmap.compress(Bitmap.CompressFormat.PNG, 100, out); out.toByteArray() }
                invoke.resolveObject(Base64.encodeToString(bytes, Base64.NO_WRAP))
            } finally {
                bitmap.recycle()
            }
        } catch (error: Throwable) {
            Log.e(TAG, "Page capture failed", error)
            invoke.reject(error.message ?: "Android WebView capture failed")
        }
    }

    private fun runCommand(invoke: Invoke, body: () -> Unit) {
        try {
            body()
            invoke.resolve()
        } catch (error: Throwable) {
            Log.e(TAG, "Engine command failed", error)
            invoke.reject(error.message ?: "Android WebView command failed")
        }
    }

    private fun tab(id: String): TabRecord = tabs[id] ?: error("Unknown tab: $id")

    private fun configureWebView(view: WebView, tabId: String, userAgent: String?, initScripts: List<String>): Boolean {
        view.setBackgroundColor(android.graphics.Color.WHITE)
        view.isFocusable = true
        view.isFocusableInTouchMode = true
        view.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            setSupportMultipleWindows(true)
            javaScriptCanOpenWindowsAutomatically = true
            allowFileAccess = false
            allowContentAccess = false
            mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
            setSupportZoom(true)
            builtInZoomControls = true
            displayZoomControls = false
            mediaPlaybackRequiresUserGesture = true
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) safeBrowsingEnabled = true
            // Keep Android System WebView's mobile Chrome UA, which includes the actual
            // provider Chromium version and avoids advertising the embedded `; wv` token.
            val mobileChromeUa = userAgent ?: userAgentString.replace("; wv", "").replace("Version/4.0 ", "")
            userAgentString = mobileChromeUa
        }
        CookieManager.getInstance().setAcceptThirdPartyCookies(view, false)
        var documentStartEnabled = WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT)
        if (documentStartEnabled) initScripts.forEach { script ->
            runCatching { WebViewCompat.addDocumentStartJavaScript(view, script, setOf("*")) }
                .onFailure { documentStartEnabled = false; Log.w(TAG, "Document-start script registration unavailable", it) }
        }
        view.webViewClient = engineWebViewClient(tabId)
        view.webChromeClient = engineChromeClient(tabId)
        view.setDownloadListener(downloadListener(tabId))
        view.setOnLongClickListener { pressed ->
            val result = (pressed as? WebView)?.hitTestResult ?: return@setOnLongClickListener false
            val imageUrl = result.extra ?: return@setOnLongClickListener false
            if ((result.type != WebView.HitTestResult.IMAGE_TYPE && result.type != WebView.HitTestResult.SRC_IMAGE_ANCHOR_TYPE) ||
                (!imageUrl.startsWith("http://", true) && !imageUrl.startsWith("https://", true))) {
                return@setOnLongClickListener false
            }
            AlertDialog.Builder(activity)
                .setItems(arrayOf("Send image to board")) { _, _ ->
                    emitEvent(JSONObject().put("type", "contextAction").put("tab", tabId)
                        .put("action", "send-image-to-board").put("data", imageUrl))
                }
                .show()
            true
        }
        return documentStartEnabled
    }

    private fun shortcutCombo(event: KeyEvent): String? {
        val ctrl = event.isCtrlPressed
        val shift = event.isShiftPressed
        val alt = event.isAltPressed
        if (ctrl) return when (event.keyCode) {
            KeyEvent.KEYCODE_T -> if (shift) "Ctrl+Shift+T" else "Ctrl+T"
            KeyEvent.KEYCODE_W -> if (shift) "Ctrl+Shift+W" else "Ctrl+W"
            KeyEvent.KEYCODE_TAB -> if (shift) "Ctrl+Shift+Tab" else "Ctrl+Tab"
            KeyEvent.KEYCODE_L -> "Ctrl+L"
            KeyEvent.KEYCODE_K -> "Ctrl+K"
            KeyEvent.KEYCODE_R -> "Ctrl+R"
            KeyEvent.KEYCODE_B -> "Ctrl+B"
            KeyEvent.KEYCODE_BACKSLASH -> "Ctrl+\\"
            in KeyEvent.KEYCODE_1..KeyEvent.KEYCODE_9 -> "Ctrl+${event.keyCode - KeyEvent.KEYCODE_1 + 1}"
            else -> null
        }
        if (alt && event.keyCode == KeyEvent.KEYCODE_DPAD_LEFT) return "Alt+Left"
        if (alt && event.keyCode == KeyEvent.KEYCODE_DPAD_RIGHT) return "Alt+Right"
        return when (event.keyCode) {
            KeyEvent.KEYCODE_F5 -> "F5"
            KeyEvent.KEYCODE_F12 -> "F12"
            else -> null
        }
    }

    private fun engineWebViewClient(tabId: String) = object : WebViewClient() {
        override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
            if (!request.isForMainFrame) return false
            val url = request.url.toString()
            val scheme = request.url.scheme?.lowercase(Locale.ROOT).orEmpty()
            if (scheme == "javascript") return true
            if (scheme == "http" || scheme == "https") {
                val rewritten = rewrite(url)
                if (rewritten != null && rewritten != url) {
                    tabs[tabId]?.currentUrl = rewritten
                    view.loadUrl(rewritten)
                    return true
                }
                return false
            }
            if (scheme == "intent") {
                openIntentUrl(url)
                return true
            }
            if (scheme == "mailto" || scheme == "tel") {
                openExternal(Intent(Intent.ACTION_VIEW, request.url))
                return true
            }
            return true
        }

        override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? {
            val url = request.url.toString()
            val scheme = request.url.scheme?.lowercase(Locale.ROOT)
            if (scheme != "http" && scheme != "https" && scheme != "ws" && scheme != "wss") return null
            val kind = RequestKindClassifier.classify(url, request.isForMainFrame, request.requestHeaders)
            val source = tabs[tabId]?.currentUrl.orEmpty()
            val blocked = runCatching { nativeShouldBlock(tabId, url, source, kind) }.getOrDefault(false)
            if (!blocked) return null
            return WebResourceResponse(
                "text/plain", "UTF-8", 403, "Blocked by Athanor", mapOf("Cache-Control" to "no-store"),
                ByteArrayInputStream(ByteArray(0)),
            )
        }

        override fun onPageStarted(view: WebView, url: String, favicon: Bitmap?) {
            super.onPageStarted(view, url, favicon)
            tabs[tabId]?.let {
                it.currentUrl = url
                it.lastProgress = -1
                if (!it.docStartScriptsEnabled) it.initScripts.forEach { script -> view.evaluateJavascript(script, null) }
            }
            emitEvent(JSONObject().put("type", "navigationStarted").put("tab", tabId).put("url", url))
            emitEvent(JSONObject().put("type", "loadingChanged").put("tab", tabId).put("loading", true))
            evaluateInjections(view, url, 0)
            tabs[tabId]?.let { view.evaluateJavascript(muteScript(it.muted), null) }
            emitHistory(tabId, view)
        }

        override fun onPageCommitVisible(view: WebView, url: String) {
            super.onPageCommitVisible(view, url)
            tabs[tabId]?.currentUrl = url
            evaluateInjections(view, url, 1)
            emitUrl(tabId, url)
            emitHistory(tabId, view)
        }

        override fun onPageFinished(view: WebView, url: String) {
            super.onPageFinished(view, url)
            tabs[tabId]?.currentUrl = url
            evaluateInjections(view, url, 2)
            emitUrl(tabId, url)
            emitEvent(JSONObject().put("type", "loadingChanged").put("tab", tabId).put("loading", false))
            emitHistory(tabId, view)
        }

        override fun doUpdateVisitedHistory(view: WebView, url: String, isReload: Boolean) {
            super.doUpdateVisitedHistory(view, url, isReload)
            tabs[tabId]?.currentUrl = url
            emitUrl(tabId, url)
            emitHistory(tabId, view)
        }

        override fun onReceivedError(view: WebView, request: WebResourceRequest, error: WebResourceError) {
            super.onReceivedError(view, request, error)
            if (request.isForMainFrame) {
                emitEvent(JSONObject().put("type", "loadingChanged").put("tab", tabId).put("loading", false))
                showErrorPage(view, "This page could not be loaded.")
            }
        }

        override fun onReceivedSslError(view: WebView, handler: SslErrorHandler, error: android.net.http.SslError) {
            handler.cancel()
            emitEvent(JSONObject().put("type", "loadingChanged").put("tab", tabId).put("loading", false))
            showErrorPage(view, "The secure connection could not be verified.")
        }

        override fun onRenderProcessGone(view: WebView, detail: RenderProcessGoneDetail): Boolean {
            Log.e(TAG, "Renderer exited for tab $tabId; crashed=${detail.didCrash()}")
            emitEvent(JSONObject().put("type", "loadingChanged").put("tab", tabId).put("loading", false))
            showErrorPage(view, "The page renderer stopped unexpectedly.")
            return true
        }
    }

    private fun engineChromeClient(tabId: String) = object : WebChromeClient() {
        override fun onReceivedTitle(view: WebView, title: String?) {
            if (title != null) emitEvent(JSONObject().put("type", "titleChanged").put("tab", tabId).put("title", title))
        }

        override fun onReceivedIcon(view: WebView, icon: Bitmap?) {
            if (icon == null) return
            runCatching {
                val bytes = ByteArrayOutputStream().use { out -> icon.compress(Bitmap.CompressFormat.PNG, 100, out); out.toByteArray() }
                val dataUrl = "data:image/png;base64," + Base64.encodeToString(bytes, Base64.NO_WRAP)
                emitEvent(JSONObject().put("type", "faviconChanged").put("tab", tabId).put("url", dataUrl))
            }
        }

        override fun onReceivedTouchIconUrl(view: WebView, url: String, precomposed: Boolean) {
            emitEvent(JSONObject().put("type", "faviconChanged").put("tab", tabId).put("url", url))
        }

        override fun onProgressChanged(view: WebView, newProgress: Int) {
            super.onProgressChanged(view, newProgress)
            val record = tabs[tabId] ?: return
            if (newProgress == 100) {
                if (record.lastProgress != 100) emitEvent(JSONObject().put("type", "loadingChanged").put("tab", tabId).put("loading", false))
                record.lastProgress = 100
            } else if (record.lastProgress == -1 && newProgress > 0) {
                emitEvent(JSONObject().put("type", "loadingChanged").put("tab", tabId).put("loading", true))
                record.lastProgress = newProgress
            } else {
                record.lastProgress = newProgress
            }
        }

        override fun onCreateWindow(view: WebView, isDialog: Boolean, isUserGesture: Boolean, resultMsg: android.os.Message): Boolean {
            val proxy = WebView(activity)
            proxy.settings.javaScriptEnabled = false
            proxy.webViewClient = object : WebViewClient() {
                override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                    emitEvent(JSONObject().put("type", "newTabRequested").put("from", tabId).put("url", request.url.toString()))
                    view.post { view.destroy() }
                    return true
                }
            }
            val transport = resultMsg.obj as? WebView.WebViewTransport ?: run { proxy.destroy(); return false }
            transport.webView = proxy
            resultMsg.sendToTarget()
            return true
        }

        override fun onCloseWindow(window: WebView) {
            window.stopLoading()
            window.destroy()
        }

        override fun onJsAlert(view: WebView, url: String, message: String, result: JsResult): Boolean {
            AlertDialog.Builder(activity).setMessage(message).setPositiveButton(android.R.string.ok) { _, _ -> result.confirm() }
                .setOnCancelListener { result.cancel() }.show()
            return true
        }

        override fun onJsConfirm(view: WebView, url: String, message: String, result: JsResult): Boolean {
            AlertDialog.Builder(activity).setMessage(message)
                .setPositiveButton(android.R.string.ok) { _, _ -> result.confirm() }
                .setNegativeButton(android.R.string.cancel) { _, _ -> result.cancel() }
                .setOnCancelListener { result.cancel() }.show()
            return true
        }

        override fun onJsPrompt(view: WebView, url: String, message: String, defaultValue: String, result: JsPromptResult): Boolean {
            val input = EditText(activity).apply { setText(defaultValue) }
            AlertDialog.Builder(activity).setMessage(message).setView(input)
                .setPositiveButton(android.R.string.ok) { _, _ -> result.confirm(input.text.toString()) }
                .setNegativeButton(android.R.string.cancel) { _, _ -> result.cancel() }
                .setOnCancelListener { result.cancel() }.show()
            return true
        }

        override fun onShowFileChooser(view: WebView, callback: ValueCallback<Array<Uri>>, params: FileChooserParams): Boolean {
            fileChooserCallback?.onReceiveValue(null)
            val launcher = filePickerLauncher ?: run { callback.onReceiveValue(null); return true }
            fileChooserCallback = callback
            val accept = params.acceptTypes.firstOrNull { it.isNotBlank() && it.contains("/") } ?: "*/*"
            val intent = Intent(Intent.ACTION_OPEN_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE).setType(accept)
                .putExtra(Intent.EXTRA_ALLOW_MULTIPLE, params.mode == FileChooserParams.MODE_OPEN_MULTIPLE)
            runCatching { launcher.launch(intent) }.onFailure {
                fileChooserCallback = null
                callback.onReceiveValue(null)
                Log.w(TAG, "File picker could not be opened", it)
            }
            return true
        }

        override fun onPermissionRequest(request: PermissionRequest) {
            val record = tabs[tabId]
            val requested = request.resources.toSet()
            val runtime = buildList {
                if (PermissionRequest.RESOURCE_VIDEO_CAPTURE in requested) add(Manifest.permission.CAMERA)
                if (PermissionRequest.RESOURCE_AUDIO_CAPTURE in requested) add(Manifest.permission.RECORD_AUDIO)
            }.toTypedArray()
            if (record == null || runtime.isEmpty() || requested.any { it != PermissionRequest.RESOURCE_VIDEO_CAPTURE && it != PermissionRequest.RESOURCE_AUDIO_CAPTURE }) {
                request.deny(); return
            }
            confirmWebPermission("Allow this site to use your camera or microphone?", runtime) { granted ->
                if (!granted || tabs[tabId] !== record) request.deny()
                else request.grant(request.resources)
            }
        }

        override fun onGeolocationPermissionsShowPrompt(origin: String, callback: GeolocationPermissions.Callback) {
            confirmWebPermission("Allow this site to access your location?", arrayOf(Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION)) { granted ->
                callback.invoke(origin, granted, false)
            }
        }

        override fun onShowCustomView(view: View, callback: CustomViewCallback) {
            if (customView != null) { callback.onCustomViewHidden(); return }
            val decor = activity.window.decorView as? ViewGroup ?: run { callback.onCustomViewHidden(); return }
            customView = view
            customViewCallback = callback
            val insets = WindowInsetsControllerCompat(activity.window, decor)
            systemBarsWereVisible = ViewCompat.getRootWindowInsets(decor)?.isVisible(WindowInsetsCompat.Type.systemBars()) ?: true
            insets.systemBarsBehavior = WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
            insets.hide(WindowInsetsCompat.Type.systemBars())
            decor.addView(view, ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
        }

        override fun onHideCustomView() { hideCustomView() }
    }

    private fun downloadListener(tabId: String) = DownloadListener { url, userAgent, contentDisposition, mimeType, _ ->
        if (!url.startsWith("https://", true) && !url.startsWith("http://", true)) return@DownloadListener
        runCatching {
            val request = DownloadManager.Request(Uri.parse(url))
                .setMimeType(mimeType)
                .setTitle(URLUtil.guessFileName(url, contentDisposition, mimeType))
                .setDescription("Downloading from Athanor")
                .setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED)
                .setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, URLUtil.guessFileName(url, contentDisposition, mimeType))
            if (!userAgent.isNullOrBlank()) request.addRequestHeader("User-Agent", userAgent)
            CookieManager.getInstance().getCookie(url)?.let { request.addRequestHeader("Cookie", it) }
            val manager = activity.getSystemService(Context.DOWNLOAD_SERVICE) as DownloadManager
            manager.enqueue(request)
            Toast.makeText(activity, "Download started", Toast.LENGTH_SHORT).show()
        }.onFailure { Log.w(TAG, "Download failed for tab $tabId", it) }
    }

    private fun rewrite(url: String): String? = runCatching { nativeRewriteNavigation(url) }.getOrNull()

    private fun evaluateInjections(view: WebView, pageUrl: String, phase: Int) {
        val scripts = runCatching { JSONArray(nativeInjections(pageUrl, phase)) }.getOrNull() ?: return
        for (index in 0 until scripts.length()) {
            val script = scripts.optString(index)
            if (script.isNotBlank()) view.evaluateJavascript(script, null)
        }
    }

    private fun muteScript(muted: Boolean) = """
        (function(m){
          window.__athanorMuted=m;
          var apply=function(e){if(e instanceof HTMLMediaElement)e.muted=window.__athanorMuted};
          var scan=function(){document.querySelectorAll('audio,video').forEach(apply)};
          scan();
          if(!window.__athanorMuteObserver){
            window.__athanorMuteObserver=new MutationObserver(function(ms){
              ms.forEach(function(x){x.addedNodes.forEach(function(n){apply(n);if(n.querySelectorAll)n.querySelectorAll('audio,video').forEach(apply)})})
            });
          }
          var observe=function(){if(document.documentElement)window.__athanorMuteObserver.observe(document.documentElement,{childList:true,subtree:true})};
          if(document.documentElement)observe();else document.addEventListener('DOMContentLoaded',observe,{once:true});
        })($muted)
    """.trimIndent()

    private fun emitUrl(tabId: String, url: String) = emitEvent(JSONObject().put("type", "urlChanged").put("tab", tabId).put("url", url))

    private fun emitHistory(tabId: String, view: WebView) = emitEvent(
        JSONObject().put("type", "historyChanged").put("tab", tabId).put("canGoBack", view.canGoBack()).put("canGoForward", view.canGoForward()),
    )

    private fun emitEvent(event: JSONObject) {
        runCatching { nativeOnEvent(event.toString()) }.onFailure { Log.w(TAG, "Could not forward engine event", it) }
    }

    private fun setTabVisibility(record: TabRecord, visible: Boolean) {
        record.visible = visible
        record.webView.visibility = if (visible) View.VISIBLE else View.GONE
        if (visible) record.webView.onResume() else if (!record.audible) record.webView.onPause()
        applyBounds(record)
    }

    private fun applyBounds(record: TabRecord) {
        val shell = shellWebView ?: return
        val tabOverlay = overlay ?: return
        val shellAt = IntArray(2); shell.getLocationOnScreen(shellAt)
        val hostAt = IntArray(2); tabOverlay.getLocationOnScreen(hostAt)
        val density = shell.resources.displayMetrics.density
        val left = shellAt[0] - hostAt[0] + EngineGeometry.cssToPx(record.x, density)
        val top = shellAt[1] - hostAt[1] + EngineGeometry.cssToPx(record.y, density)
        val width = EngineGeometry.cssToPx(record.w.coerceAtLeast(1.0), density).coerceAtLeast(1)
        val height = EngineGeometry.cssToPx(record.h.coerceAtLeast(1.0), density).coerceAtLeast(1)
        val params = FrameLayout.LayoutParams(width, height).apply { leftMargin = left; topMargin = top }
        record.webView.layoutParams = params
    }

    private fun relayoutTabs() { tabs.values.forEach(::applyBounds) }

    private fun confirmWebPermission(message: String, permissions: Array<String>, completed: (Boolean) -> Unit) {
        AlertDialog.Builder(activity).setTitle("Site permission")
            .setMessage(message)
            .setPositiveButton("Continue") { _, _ -> requestRuntimePermission(permissions, completed) }
            .setNegativeButton(android.R.string.cancel) { _, _ -> completed(false) }
            .setOnCancelListener { completed(false) }
            .show()
    }

    private fun requestRuntimePermission(permissions: Array<String>, completed: (Boolean) -> Unit) {
        val missing = permissions.distinct().filter { ContextCompat.checkSelfPermission(activity, it) != PackageManager.PERMISSION_GRANTED }
        if (missing.isEmpty()) { completed(true); return }
        runtimeQueue.addLast(PendingRuntimePermission(missing.toTypedArray(), completed))
        launchNextRuntimePermission()
    }

    private fun runtimePermissionGranted(requested: Array<String>, result: Map<String, Boolean>): Boolean {
        fun granted(permission: String) = result[permission] == true ||
            ContextCompat.checkSelfPermission(activity, permission) == PackageManager.PERMISSION_GRANTED
        val isLocation = requested.any { it == Manifest.permission.ACCESS_FINE_LOCATION || it == Manifest.permission.ACCESS_COARSE_LOCATION }
        return if (isLocation) granted(Manifest.permission.ACCESS_FINE_LOCATION) || granted(Manifest.permission.ACCESS_COARSE_LOCATION)
        else requested.all(::granted)
    }

    private fun launchNextRuntimePermission() {
        if (permissionInFlight || runtimeQueue.isEmpty()) return
        val launcher = permissionLauncher ?: return
        val pending = runtimeQueue.removeFirst()
        pendingRuntime = pending
        permissionInFlight = true
        runCatching { launcher.launch(pending.permissions) }.onFailure {
            permissionInFlight = false
            pendingRuntime = null
            pending.completed(false)
            Log.w(TAG, "Runtime permission request failed", it)
            launchNextRuntimePermission()
        }
    }

    private fun hideCustomView() {
        val view = customView ?: return
        (view.parent as? ViewGroup)?.removeView(view)
        customView = null
        customViewCallback?.onCustomViewHidden()
        customViewCallback = null
        val decor = activity.window.decorView
        val insets = WindowInsetsControllerCompat(activity.window, decor)
        if (systemBarsWereVisible) insets.show(WindowInsetsCompat.Type.systemBars())
        else insets.hide(WindowInsetsCompat.Type.systemBars())
    }

    private fun openIntentUrl(url: String) {
        runCatching {
            val parsed = Intent.parseUri(url, Intent.URI_INTENT_SCHEME).apply {
                component = null
                selector = null
                addCategory(Intent.CATEGORY_BROWSABLE)
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            }
            val resolved = activity.packageManager.resolveActivity(parsed, PackageManager.MATCH_DEFAULT_ONLY)
            if (resolved != null) activity.startActivity(parsed) else {
                val fallback = parsed.getStringExtra("browser_fallback_url")
                if (fallback?.startsWith("https://", true) == true || fallback?.startsWith("http://", true) == true) openExternal(Intent(Intent.ACTION_VIEW, Uri.parse(fallback)))
            }
        }.onFailure { Log.w(TAG, "Rejected external intent URL", it) }
    }

    private fun openExternal(intent: Intent) {
        runCatching {
            intent.addCategory(Intent.CATEGORY_BROWSABLE)
            intent.component = null
            intent.selector = null
            if (activity.packageManager.resolveActivity(intent, PackageManager.MATCH_DEFAULT_ONLY) != null) activity.startActivity(intent)
        }.onFailure { Log.w(TAG, "No external application for ${intent.data}", it) }
    }

    private fun showErrorPage(view: WebView, message: String) {
        val safe = message.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
        view.loadDataWithBaseURL("about:blank", "<!doctype html><meta name='viewport' content='width=device-width'><title>Athanor</title><main style='font:16px sans-serif;padding:2rem'><h2>Athanor</h2><p>$safe</p></main>", "text/html", "UTF-8", null)
    }

    private fun destroyAll() {
        handler.removeCallbacks(audioCheck)
        hideCustomView()
        tabs.values.toList().forEach { record ->
            runCatching { record.webView.stopLoading(); record.webView.onPause(); record.webView.removeAllViews(); record.webView.destroy() }
        }
        tabs.clear()
        overlay?.let { (it.parent as? ViewGroup)?.removeView(it) }
        overlay = null
        host?.removeOnLayoutChangeListener(layoutListener)
        host?.viewTreeObserver?.takeIf { it.isAlive }?.removeOnGlobalLayoutListener(globalLayoutListener)
        host = null
        shellWebView = null
        loadedPlugin = null
    }

    private fun urisFromResult(intent: Intent): List<Uri> {
        val result = ArrayList<Uri>()
        intent.data?.let(result::add)
        intent.clipData?.let { clip -> for (index in 0 until clip.itemCount) result.add(clip.getItemAt(index).uri) }
        return result.distinct()
    }
}
