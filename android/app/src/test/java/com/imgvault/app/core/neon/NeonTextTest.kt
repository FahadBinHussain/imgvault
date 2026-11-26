// REGRESSION TEST for the phone crash of 1.0.0:
//
//   Element class kotlinx.serialization.json.JsonLiteral
//   (Kotlin reflection is not available) is not a JsonArray
//
// With `Neon-Raw-Text-Output` every value arrives as TEXT, so a column that
// holds JSON (`tags` is a text array, `extra_metadata` is jsonb) arrives as
// the JSON text itself. Reading such a cell with `.jsonArray` throws, because
// the cell is a JsonLiteral, not a JsonArray.
//
// The cells below are built exactly the way the Neon client hands them over:
// a JSON string that CONTAINS the JSON text.
package com.imgvault.app.core.neon

import com.imgvault.app.data.model.toMediaItem
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class NeonTextTest {

    /** a cell that carries JSON as text, the way Neon-Raw-Text-Output delivers it */
    private fun textCell(text: String) = JsonPrimitive(text)

    @Test
    fun `a tags cell holding an empty json array reads as no tags`() {
        assertEquals(emptyList<String>(), textCell("[]").asJsonListOrEmpty())
    }

    @Test
    fun `a tags cell holding a json array reads as its tags`() {
        assertEquals(listOf("a", "b"), textCell("[\"a\",\"b\"]").asJsonListOrEmpty())
    }

    @Test
    fun `a tags cell holding a plain list reads as its tags`() {
        assertEquals(listOf("a", "b"), textCell("a, b").asJsonListOrEmpty())
    }

    @Test
    fun `a broken json cell reads as empty instead of crashing`() {
        assertEquals(emptyList<String>(), textCell("[\"a\"").asJsonListOrEmpty())
        assertEquals(emptyList<String>(), textCell("{oops").asJsonListOrEmpty())
        assertTrue(textCell("{oops").asJsonObjectOrEmpty().isEmpty())
    }

    @Test
    fun `an extra_metadata cell holding json text reads as an object`() {
        val extra = textCell("""{"isVaulted": true, "vaultHosts": ["terabox", "telegram"]}""")
            .asJsonObjectOrEmpty()
        assertEquals("true", extra["isVaulted"].asTextOrEmpty())
        assertEquals(listOf("terabox", "telegram"), extra["vaultHosts"].asJsonListOrEmpty())
    }

    @Test
    fun `a cell that already holds parsed json stays parsed`() {
        val parsed = Json.parseToJsonElement("""{"a": 1}""")
        assertEquals("1", parsed.asJsonObjectOrEmpty()["a"].asTextOrEmpty())
    }
    /**
     * The whole row, the way the gallery reads it: a plain row where `tags` and
     * `extra_metadata` are TEXT cells.
     */
    @Test
    fun `a gallery row maps its tags and its extra metadata`() {
        val row: Map<String, kotlinx.serialization.json.JsonElement> = mapOf(
            "id" to textCell("263e545f-1997-4fca-b31b-05732399a322"),
            "kind" to textCell("image"),
            "tags" to textCell("[]"),
            "page_title" to textCell("a title"),
            "extra_metadata" to textCell(
                """{"isVaulted": true, "vaultHost": "terabox", "vaultHosts": ["terabox", "telegram"]}""",
            ),
        )
        val item = row.toMediaItem()
        assertEquals("263e545f-1997-4fca-b31b-05732399a322", item.id)
        assertEquals(emptyList<String>(), item.tags)
        assertEquals("a title", item.pageTitle)
        assertTrue(item.isVaulted)
        assertEquals(listOf("terabox", "telegram"), item.vaultHosts)
    }
}
