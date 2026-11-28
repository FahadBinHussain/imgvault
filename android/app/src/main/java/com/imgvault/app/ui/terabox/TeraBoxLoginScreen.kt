package com.imgvault.app.ui.terabox

import android.annotation.SuppressLint
import android.util.Log
import android.webkit.CookieManager
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material3.Button
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import com.imgvault.app.core.ServiceLocator
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch

/**
 * Log in to TeraBox inside the app, in a real WebView.
 *
 * A pasted cookie is not a durable login: TeraBox rotates/expires it, and
 * the user has to re-paste it by hand every time. A WebView is a real
 * browser — it keeps the session alive itself (cookies, refreshes), and the
 * app reads the fresh cookie + jsToken out of it on every page load, so the
 * gallery keeps working without the user ever pasting anything again.
 *
 * How it works: the WebView loads https://www.terabox.com/ and the user
 * signs in once (the WebView's CookieManager persists the session across
 * app restarts). On each page finish the screen pulls
 * CookieManager.getCookie(...) and window.jsToken and stores them — the
 * cookie into Settings (teraboxCookie) and the token into the secure store
 * — where TeraBoxClient already reads them. When the session eventually
 * dies, the gallery says so and the user comes back here and signs in
 * again: one tap, no paste.
 *
 * The jsToken cannot be scraped with plain HTTP from this phone's network:
 * a bare GET returns the 8 KB logged-out landing page with no token in it,
 * even with the cookie attached (the VM's datacenter IP gets the full page;
 * the phone's carrier IP does not). A WebView sends a real browser's
 * headers and runs the page's JS, so window.jsToken is actually there.
 */
@OptIn(ExperimentalMaterial3Api::class)
@SuppressLint("SetJavaScriptEnabled")
@Composable
fun TeraBoxLoginScreen(
    onBack: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val settingsRepo = remember { ServiceLocator.settings }
    var status by remember { mutableStateOf("Sign in to TeraBox below — the app keeps the session from here.") }
    var loggedIn by remember { mutableStateOf(false) }
    var webView by remember { mutableStateOf<WebView?>(null) }

    fun syncFromWebView(view: WebView) {
        val cookies = CookieManager.getInstance().getCookie("https://www.terabox.com").orEmpty()
        if (cookies.contains("ndus=")) {
            // the session cookie, fresh from the browser — this is what
            // keeps the gallery working without a paste.
            CoroutineScope(Dispatchers.IO).launch {
                settingsRepo.teraboxCookie = cookies
            }
            view.evaluateJavascript("(function(){return window.jsToken||''})()") { raw ->
                val token = raw?.trim()?.trim('"').orEmpty()
                if (token.length >= 10) {
                    CoroutineScope(Dispatchers.IO).launch {
                        settingsRepo.teraboxJsToken = token
                        settingsRepo.teraboxJsTokenAtMs = System.currentTimeMillis()
                    }
                    Log.i("ImgVault", "terabox webview login: session + jsToken captured")
                    status = "Logged in to TeraBox — the gallery can use fresh links now."
                    loggedIn = true
                } else {
                    status = "Signed in, but the page has no jsToken yet — wait for it to finish loading, or reload."
                }
            }
        } else {
            status = "Not signed in yet — sign in to TeraBox below."
            loggedIn = false
        }
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("Log in to TeraBox") },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Back")
                    }
                },
            )
        },
        modifier = modifier,
    ) { padding ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding),
        ) {
            Text(
                text = status,
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.padding(horizontal = 16.dp, vertical = 8.dp),
            )
            if (loggedIn) {
                Button(
                    onClick = onBack,
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(horizontal = 16.dp, vertical = 4.dp),
                ) { Text("Done") }
            }
            AndroidView(
                factory = { ctx ->
                    WebView(ctx).apply {
                        settings.javaScriptEnabled = true
                        settings.domStorageEnabled = true
                        settings.databaseEnabled = true
                        CookieManager.getInstance().setAcceptCookie(true)
                        CookieManager.getInstance().setAcceptThirdPartyCookies(this, true)
                        webViewClient = object : WebViewClient() {
                            override fun onPageFinished(view: WebView, url: String?) {
                                super.onPageFinished(view, url)
                                syncFromWebView(view)
                            }
                        }
                        // seed the WebView with the cookie the app already
                        // has (pasted in Settings), so it opens already
                        // signed in instead of asking again. If that cookie
                        // is dead, the page just shows the sign-in form and
                        // the user signs in here once.
                        val stored = settingsRepo.teraboxCookie.orEmpty()
                        if (stored.isNotBlank()) {
                            val mgr = CookieManager.getInstance()
                            stored.split(";").forEach { part ->
                                val cookie = part.trim()
                                if (cookie.contains("=")) {
                                    mgr.setCookie("https://www.terabox.com", cookie)
                                }
                            }
                            mgr.flush()
                        }
                        webView = this
                        loadUrl("https://www.terabox.com/")
                    }
                },
                update = { view -> webView = view },
                modifier = Modifier.fillMaxSize(),
            )
        }
    }
}
