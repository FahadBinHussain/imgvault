package com.imgvault.app.core.terabox

import android.util.Log
import com.imgvault.app.core.settings.SettingsRepository
import java.net.URLDecoder
import java.net.URLEncoder
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import okhttp3.OkHttpClient
import okhttp3.Request

/**
 * A TeraBox API client that runs entirely in the app — no extension, no
 * browser tab, no hidden scrape.
 *
 * The extension resolves fresh TeraBox links by scraping `window.jsToken`
 * from a hidden tab, because a fetch() from a chrome-extension page gets
 * bounced to /simple-verify. A native app sends no browser Sec-Fetch
 * headers, so a plain GET of https://www.terabox.com/ returns the real
 * homepage HTML with the jsToken embedded (`fn("<hex>")`) — verified
 * 2026-11-28 from a plain curl. That token + the user's TeraBox session
 * cookie (pasted in Settings, `ndus=` is the session) is everything the
 * /api/list and /api/filemetas calls need.
 *
 * Stored TeraBox dlinks (thumbnail + video) expire in 8h, so a gallery
 * video older than a day has BOTH links dead. This client mints fresh ones:
 * /api/list carries `thumbs.{icon,url1,url2,url3}` per file (url3 is the
 * largest, ~850px) and /api/filemetas with dlink=1 returns a fresh download
 * link. The root listing is cached 60s so a gallery full of TeraBox videos
 * shares one listing instead of one per tile.
 *
 * Fails loudly by returning null and logging the errno — a missing cookie,
 * a captcha gate, or a dead session must surface as "TeraBox needs attention"
 * in the UI, never as a silent placeholder.
 */
class TeraBoxClient(
    private val settings: SettingsRepository,
    private val http: OkHttpClient,
) {
    private val json = Json { ignoreUnknownKeys = true }

    private var cachedJsToken: String? = null
    private var jsTokenAtMs: Long = 0

    private var cachedListing: List<TeraBoxFile>? = null
    private var listingAtMs: Long = 0

    private val tag = "ImgVault"

    data class TeraBoxFile(
        val fsId: String,
        val path: String,
        val name: String,
        val thumbUrl3: String,
        val thumbUrl2: String,
        val thumbUrl1: String,
        val thumbIcon: String,
    ) {
        /** the largest usable thumbnail, or empty */
        val bestThumb: String
            get() = thumbUrl3.ifEmpty { thumbUrl2 }.ifEmpty { thumbUrl1 }.ifEmpty { thumbIcon }
    }

    /** the session cookie from Settings, or null when the user has not set it */
    private fun cookie(): String? {
        val raw = settings.teraboxCookie?.trim().orEmpty()
        return raw.ifEmpty { null }
    }

    fun hasCookie(): Boolean = !cookie().isNullOrBlank()

    /**
     * The jsToken, scraped from the TeraBox homepage HTML. Cached ~12h like
     * the extension; a fetch that finds nothing is retried on the next call
     * (no negative cache — a captcha clears on its own).
     *
     * The HTTP call is blocking, so it runs on Dispatchers.IO — the gallery
     * tile calls this from the main thread and a network call there throws
     * NetworkOnMainThreadException (whose message is null, which is why the
     * first build logged only "fetch failed: null").
     */
    private suspend fun jsToken(forceFresh: Boolean = false): String? = withContext(Dispatchers.IO) {
        val now = System.currentTimeMillis()
        if (!forceFresh && cachedJsToken != null && now - jsTokenAtMs < JS_TOKEN_TTL_MS) {
            return@withContext cachedJsToken
        }
        val html = try {
            val req = Request.Builder()
                .url("$TOKEN_BASE/")
                .header("User-Agent", USER_AGENT)
                .build()
            http.newCall(req).execute().use { resp ->
                if (!resp.isSuccessful) {
                    Log.w(tag, "terabox homepage HTTP ${resp.code} — no jsToken")
                    return@withContext null
                }
                resp.body?.string().orEmpty()
            }
        } catch (e: Exception) {
            Log.w(tag, "terabox homepage fetch failed: ${e.message}")
            return@withContext null
        }
        // the page embeds fn("<64-hex-token>") — the same pattern the
        // extension's hidden-tab scrape reads out of window.jsToken.
        val token = JS_TOKEN_RE.find(html)?.groupValues?.getOrNull(1).orEmpty()
        if (token.isEmpty()) {
            Log.w(tag, "terabox homepage had no jsToken (captcha gate?)")
            return@withContext null
        }
        cachedJsToken = token
        jsTokenAtMs = now
        return@withContext token
    }

    private fun apiUrl(pathname: String, jsToken: String?, params: Map<String, String>): String {
        val qp = StringBuilder()
        fun add(key: String, value: String) {
            if (qp.isNotEmpty()) qp.append('&')
            qp.append(URLEncoder.encode(key, "UTF-8"))
            qp.append('=')
            qp.append(URLEncoder.encode(value, "UTF-8"))
        }
        add("app_id", "250528")
        add("web", "1")
        add("channel", "dubox")
        add("clienttype", "0")
        if (!jsToken.isNullOrEmpty()) add("jsToken", jsToken)
        params.forEach { (k, v) -> add(k, v) }
        return "$API_BASE$pathname?$qp"
    }

    private suspend fun apiGet(url: String, cookie: String): JsonObject? = withContext(Dispatchers.IO) {
        return@withContext try {
            val req = Request.Builder()
                .url(url)
                .header("Cookie", cookie)
                .header("Accept", "application/json, text/plain, */*")
                .header("Referer", "$API_BASE/")
                .header("User-Agent", USER_AGENT)
                .header("X-Requested-With", "XMLHttpRequest")
                .build()
            http.newCall(req).execute().use { resp ->
                val body = resp.body?.string().orEmpty()
                if (!resp.isSuccessful) {
                    Log.w(tag, "terabox api HTTP ${resp.code}: ${body.take(120)}")
                    return@withContext null
                }
                runCatching { json.parseToJsonElement(body).jsonObject }.getOrNull()
            }
        } catch (e: Exception) {
            Log.w(tag, "terabox api call failed: ${e.message}")
            null
        }
    }

    /**
     * List the root folder (paginated past the 100-per-page cap). Cached 60s.
     * Returns an empty list on failure — the caller logs the errno.
     */
    private suspend fun listRoot(forceFresh: Boolean = false): List<TeraBoxFile> {
        val cookie = cookie() ?: return emptyList()
        val now = System.currentTimeMillis()
        if (!forceFresh && cachedListing != null && now - listingAtMs < LISTING_TTL_MS) {
            return cachedListing.orEmpty()
        }
        val token = jsToken(forceFresh) ?: return emptyList()
        val all = mutableListOf<TeraBoxFile>()
        var page = 1
        while (page <= MAX_PAGES) {
            val url = apiUrl("/api/list", token, mapOf(
                "dir" to "/",
                "order" to "time",
                "desc" to "1",
                "showempty" to "0",
                "web_tt" to "1",
                "num" to PAGE_SIZE.toString(),
                "page" to page.toString(),
            ))
            val obj = apiGet(url, cookie)
            if (obj == null) {
                Log.w(tag, "terabox /api/list page $page: no response")
                return emptyList()
            }
            val errno = obj["errno"]?.jsonPrimitive?.content?.toIntOrNull()
            if (errno == ERRNO_NEED_VERIFY && !forceFresh) {
                // stale token — one forced refresh, then retry this page once.
                val fresh = jsToken(forceFresh = true) ?: return emptyList()
                val retryUrl = apiUrl("/api/list", fresh, mapOf(
                    "dir" to "/",
                    "order" to "time",
                    "desc" to "1",
                    "showempty" to "0",
                    "web_tt" to "1",
                    "num" to PAGE_SIZE.toString(),
                    "page" to page.toString(),
                ))
                val retryObj = apiGet(retryUrl, cookie) ?: return emptyList()
                val retryErrno = retryObj["errno"]?.jsonPrimitive?.content?.toIntOrNull()
                if (retryErrno != 0) {
                    Log.w(tag, "terabox /api/list page $page after token refresh: errno=$retryErrno")
                    return emptyList()
                }
                val list = retryObj["list"]?.jsonArray.orEmpty()
                list.forEach { el -> parseFile(el.jsonObject)?.let { all.add(it) } }
                if (list.size < PAGE_SIZE) break
                page += 1
                continue
            }
            if (errno != 0) {
                Log.w(tag, "terabox /api/list page $page: errno=$errno")
                return emptyList()
            }
            val list = obj["list"]?.jsonArray.orEmpty()
            list.forEach { el -> parseFile(el.jsonObject)?.let { all.add(it) } }
            if (list.size < PAGE_SIZE) break
            page += 1
        }
        cachedListing = all
        listingAtMs = now
        return all
    }

    private fun parseFile(obj: JsonObject): TeraBoxFile? {
        if (obj["isdir"]?.jsonPrimitive?.content?.toIntOrNull() == 1) return null
        val thumbs = obj["thumbs"]?.jsonObject
        return TeraBoxFile(
            fsId = obj["fs_id"]?.jsonPrimitive?.content.orEmpty(),
            path = obj["path"]?.jsonPrimitive?.content.orEmpty(),
            name = obj["server_filename"]?.jsonPrimitive?.content.orEmpty(),
            thumbUrl3 = thumbs?.get("url3")?.jsonPrimitive?.content.orEmpty(),
            thumbUrl2 = thumbs?.get("url2")?.jsonPrimitive?.content.orEmpty(),
            thumbUrl1 = thumbs?.get("url1")?.jsonPrimitive?.content.orEmpty(),
            thumbIcon = thumbs?.get("icon")?.jsonPrimitive?.content.orEmpty(),
        )
    }

    private suspend fun filePath(fsId: String, fileName: String): String? {
        if (fsId.isEmpty() && fileName.isEmpty()) return null
        val entries = listRoot()
        val hit = when {
            fsId.isNotEmpty() -> entries.firstOrNull { it.fsId == fsId }
            else -> null
        } ?: entries.firstOrNull { it.name.isNotEmpty() && it.name == fileName }
        return hit?.path?.ifEmpty { null }
    }

    /**
     * A fresh thumbnail URL for a TeraBox file id, or null when the file is
     * not on the account, the cookie is missing, or the API refused.
     */
    suspend fun resolveThumbnail(fsId: String): String? {
        val target = fsId.trim()
        if (target.isEmpty()) return null
        if (cookie() == null) {
            Log.w(tag, "terabox thumbnail: no cookie set — paste the TeraBox cookie in Settings")
            return null
        }
        val entries = listRoot()
        val hit = entries.firstOrNull { it.fsId == target }
        if (hit == null) {
            Log.w(tag, "terabox thumbnail: fs_id $target not in root listing")
            return null
        }
        return hit.bestThumb.ifEmpty { null }
    }

    /**
     * A fresh, currently-valid download link (dlink) for a TeraBox file, or
     * null when unavailable. Stored dlinks carry an 8h expiry — this is the
     * refresh the video player and the frame decoder need.
     */
    suspend fun resolveDlink(fsId: String, fileName: String = ""): String? {
        if (cookie() == null) {
            Log.w(tag, "terabox dlink: no cookie set — paste the TeraBox cookie in Settings")
            return null
        }
        val path = filePath(fsId, fileName) ?: run {
            Log.w(tag, "terabox dlink: no path for fs_id=$fsId name=$fileName")
            return null
        }
        val cookie = cookie() ?: return null
        val token = jsToken() ?: return null
        val url = apiUrl("/api/filemetas", token, mapOf(
            "target" to "[\"$path\"]",
            "dlink" to "1",
            "origin" to "dlna",
        ))
        val obj = apiGet(url, cookie) ?: return null
        val errno = obj["errno"]?.jsonPrimitive?.content?.toIntOrNull()
        if (errno != 0) {
            Log.w(tag, "terabox /api/filemetas errno=$errno for $path")
            return null
        }
        val info = obj["info"]?.jsonArray?.firstOrNull()?.jsonObject
        return info?.get("dlink")?.jsonPrimitive?.content?.ifEmpty { null }
    }

    companion object {
        private const val API_BASE = "https://dm.terabox.com"
        private const val TOKEN_BASE = "https://www.terabox.com"
        private const val USER_AGENT =
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
        private const val JS_TOKEN_TTL_MS = 12L * 60 * 60 * 1000
        private const val LISTING_TTL_MS = 60L * 1000
        private const val PAGE_SIZE = 100
        private const val MAX_PAGES = 100
        private const val ERRNO_NEED_VERIFY = 4000023

        /** fn("<token>") in the homepage HTML — the jsToken the extension scrapes from a tab */
        private val JS_TOKEN_RE = Regex("""fn\("([A-Za-z0-9]{10,})"\)""")

        /**
         * TeraBox dlinks embed the file id: ?fid=<vuk>-<app>-<fs_id> — the
         * trailing numeric segment IS the fs_id (verified against the DB).
         */
        fun fsIdFromUrl(url: String): String {
            return try {
                val fid = url.substringAfter("fid=", "").substringBefore("&").substringBefore("#")
                if (fid.isEmpty()) return ""
                val decoded = URLDecoder.decode(fid, "UTF-8")
                val last = decoded.split("-").lastOrNull().orEmpty()
                if (last.isNotEmpty() && last.all { it.isDigit() }) last else ""
            } catch (_: Exception) {
                ""
            }
        }
    }
}
