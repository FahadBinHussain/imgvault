package com.imgvault.app.core.neon

import java.net.URI
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody

/** A Neon call failed. The message always names WHAT failed and why. */
class NeonException(message: String, cause: Throwable? = null) : Exception(message, cause)

/**
 * The Neon SQL-over-HTTP client.
 *
 * Same wire shape as the extension's `@neondatabase/serverless`:
 *
 *   POST https://<host>/sql
 *   headers: Neon-Connection-String, Neon-Raw-Text-Output: true, Neon-Array-Mode: true
 *   body:    { "query": "...", "params": [...] }
 *
 * The host is the connection string's host with its FIRST dns label replaced by
 * "api." — the same rule the JS client uses (measured live 2026-11-26: both
 * the api-prefixed host and the bare host answer 200 for the user's own
 * database; the api-prefixed form is the library default, so it is the one
 * used here).
 *
 * With `Neon-Raw-Text-Output` + `Neon-Array-Mode` the answer is
 * `{"fields":[{"name":...}],"rows":[[...]]}` — the rows are arrays aligned to
 * the field names, and EVERY value is a text string (numbers included).
 */
class NeonClient(
    private val connectionString: String,
    private val httpClient: OkHttpClient,
) {
    private val json = Json { ignoreUnknownKeys = true }

    /** the SQL-over-HTTP endpoint for this connection string */
    val endpoint: String by lazy { buildEndpoint(connectionString) }

    suspend fun query(
        sql: String,
        params: List<JsonElement> = emptyList(),
    ): List<Map<String, JsonElement>> = withContext(Dispatchers.IO) {
        val payload = buildString {
            append("{\"query\":")
            append(json.encodeToString(JsonPrimitive.serializer(), JsonPrimitive(sql)))
            append(",\"params\":")
            append(json.encodeToString(JsonElement.serializer(), JsonArray(params)))
            append("}")
        }

        val request = Request.Builder()
            .url(endpoint)
            .addHeader("Content-Type", "application/json")
            .addHeader("Neon-Connection-String", connectionString)
            .addHeader("Neon-Raw-Text-Output", "true")
            .addHeader("Neon-Array-Mode", "true")
            .post(payload.toRequestBody(JSON_MEDIA))
            .build()

        val response = try {
            httpClient.newCall(request).execute()
        } catch (error: Exception) {
            throw NeonException(
                "Could not reach Neon at $endpoint: ${error.message ?: error::class.java.simpleName}",
                error,
            )
        }

        response.use {
            val body = it.body?.string().orEmpty()
            if (!it.isSuccessful) {
                throw NeonException("Neon refused the query (HTTP ${it.code}): ${body.take(400)}")
            }
            parseRows(body)
        }
    }

    private fun parseRows(body: String): List<Map<String, JsonElement>> {
        if (body.isBlank()) return emptyList()
        val root = try {
            json.parseToJsonElement(body).jsonObject
        } catch (error: Exception) {
            throw NeonException("Neon answered with something that is not JSON: ${body.take(200)}", error)
        }
        val names = root["fields"]?.jsonArray
            ?.map { it.jsonObject["name"]?.jsonPrimitive?.content ?: "" }
            ?: emptyList()
        val rows = root["rows"]?.jsonArray ?: JsonArray(emptyList())
        return rows.map { row ->
            val cells = row.jsonArray
            names.zip(cells.toList()).associate { (name, value) -> name to value }
        }
    }

    companion object {
        private val JSON_MEDIA = "application/json; charset=utf-8".toMediaType()

        /**
         * The SQL-over-HTTP endpoint for a postgres connection string.
         *
         * `postgresql://user:pass@ep-name.region.aws.neon.tech/db` becomes
         * `https://api.<region>.aws.neon.tech/sql` — the first dns label is
         * replaced by "api.", exactly like the JS client.
         */
        fun buildEndpoint(connectionString: String): String {
            val raw = connectionString.trim()
            if (raw.isEmpty()) throw NeonException("No Neon connection string configured")
            val host = try {
                URI(raw).host
            } catch (error: Exception) {
                throw NeonException("The Neon connection string is not a valid URL: ${error.message}", error)
            }
            if (host.isNullOrBlank()) throw NeonException("The Neon connection string has no host")
            val labels = host.split(".")
            val apiHost = if (labels.size >= 3) {
                "api." + labels.drop(1).joinToString(".")
            } else {
                host
            }
            return "https://$apiHost/sql"
        }
    }
}

// ---------------------------------------------------------------------------
// Row value helpers — every Neon value arrives as TEXT because of
// Neon-Raw-Text-Output, so the conversions live here instead of at every
// call site.
// ---------------------------------------------------------------------------

fun JsonElement?.asTextOrEmpty(): String {
    if (this == null || this is JsonNull) return ""
    val primitive = this as? JsonPrimitive ?: return ""
    if (primitive is JsonNull) return ""
    return primitive.content
}

// ---------------------------------------------------------------------------
// JSON that arrives as TEXT
//
// With `Neon-Raw-Text-Output` EVERY value arrives as a string, so a column
// that holds JSON (`extra_metadata` is jsonb, `tags` is a text array) shows up
// as the JSON TEXT itself — NOT as parsed JSON. Reading such a cell with
// `.jsonArray` therefore throws on a JsonLiteral, which is exactly what the
// gallery did on the phone:
//
//   Element class kotlinx.serialization.json.JsonLiteral
//   (Kotlin reflection is not available) is not a JsonArray
//
// These helpers read the cell back into the structure it holds. They never
// throw: a cell that is not JSON yields the empty structure and every other
// column still shows up.
// ---------------------------------------------------------------------------

/** the JSON a cell holds — parsed already, or carried as text */
fun JsonElement?.asJsonValue(): JsonElement? {
    when (this) {
        null -> return null
        is JsonNull -> return null
        is JsonObject -> return this
        is JsonArray -> return this
        is JsonPrimitive -> {
            val text = content.trim()
            if (text.isEmpty()) return null
            if (text[0] != '{' && text[0] != '[') return null
            return runCatching { Json.parseToJsonElement(text) }.getOrNull()
        }
    }
}

/** a JSON object carried as text (`extra_metadata`) */
fun JsonElement?.asJsonObjectOrEmpty(): JsonObject =
    (this.asJsonValue() as? JsonObject) ?: JsonObject(emptyMap())

/**
 * A list of strings carried as text — a JSON array (`["a","b"]`), a plain
 * comma separated list (`a,b`), or nothing at all.
 */
fun JsonElement?.asJsonListOrEmpty(): List<String> {
    when (val value = this.asJsonValue()) {
        is JsonArray -> return value
            .map { cell -> (cell as? JsonPrimitive)?.content.orEmpty() }
            .filter { it.isNotEmpty() }
        is JsonObject -> return emptyList()
        else -> Unit
    }
    val raw = (this as? JsonPrimitive)?.content?.trim().orEmpty()
    if (raw.isEmpty()) return emptyList()
    // a cell that looks like JSON but does not parse has no safe reading —
    // do not turn it into garbage
    if (raw.startsWith("[") || raw.startsWith("{")) return emptyList()
    return raw.split(',')
        .map { it.trim().trim('"', '\'') }
        .filter { it.isNotEmpty() }
}

fun JsonElement?.asLongOrNull(): Long? = asTextOrEmpty().trim().toLongOrNull()

fun JsonElement?.asDoubleOrNull(): Double? = asTextOrEmpty().trim().toDoubleOrNull()

fun JsonElement?.asBooleanOrFalse(): Boolean {
    val text = asTextOrEmpty().trim().lowercase()
    // postgres writes a boolean as t/f, and the json write says true/false
    return text == "true" || text == "t" || text == "1" || text == "yes"
}

fun JsonElement?.asObjectOrEmpty(): JsonObject {
    if (this == null || this is JsonNull) return JsonObject(emptyMap())
    return this as? JsonObject ?: JsonObject(emptyMap())
}
