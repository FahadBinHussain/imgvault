// The Google Photos layout, pinned.
//
// The grid packs the feed into rows of tiles that share ONE height, so a
// panorama gets a wide tile and a portrait a narrow one — nothing is squashed
// into a square. These tests keep that geometry honest.
//
// The layout is shared by the gallery AND the vault, so the tests work on a
// plain item type: the grid knows nothing about photos.
package com.imgvault.app.ui.grid

import com.imgvault.app.core.time.isoDayOf
import java.time.LocalDate
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class JustifiedLayoutTest {

    /** one item of the feed: a shape and a day */
    private data class Tile(
        val id: String,
        val ratio: Float = 1f,
        val day: String? = "2020-11-26",
    )

    private fun item(
        id: String,
        width: Int = 100,
        height: Int = 100,
        day: String? = "2020-11-26",
    ) = Tile(id = id, ratio = width.toFloat() / height.toFloat(), day = day)

    private fun layout(items: List<Tile>, widthDp: Float, gapDp: Float = 0f, stretch: Boolean = true) =
        layoutRow(items, ratioOf = { it.ratio }, containerWidthDp = widthDp, gapDp = gapDp, stretch = stretch)

    private fun grid(items: List<Tile>, widthDp: Float = 100f) =
        buildGrid(items, ratioOf = { it.ratio }, dayKeyOf = { it.day }, containerWidthDp = widthDp)

    @Test
    fun `a row of square photos fills the width`() {
        val row = layout(listOf(item("a"), item("b"), item("c"), item("d")), 100f, gapDp = 0f)
        // three gaps of 0 -> the four square photos share the 100dp, each a quarter
        assertEquals(25f, row.heightDp, 0.01f)
        row.tiles.forEach { assertEquals(25f, it.widthDp, 0.01f) }
    }

    @Test
    fun `every photo in a row gets the same height`() {
        val row = layout(
            listOf(
                item("wide", width = 200, height = 100),
                item("square"),
                item("tall", width = 50, height = 100),
            ),
            100f,
            gapDp = 2f,
        )
        assertTrue("the row has photos", row.tiles.isNotEmpty())
        // the widths follow the photos' own shape: wide > square > tall
        val widths = row.tiles.map { it.widthDp }
        assertTrue("wide is the widest", widths[0] > widths[1])
        assertTrue("tall is the narrowest", widths[2] < widths[1])
    }

    @Test
    fun `a row never grows wider than the screen`() {
        val row = layout(
            (1..6).map { item("i$it", width = 200, height = 100) },
            100f,
            gapDp = 3f,
        )
        val total = row.tiles.sumOf { it.widthDp.toDouble() }.toFloat() + 3f * (row.tiles.size - 1)
        assertTrue("the row fits: $total", total <= 100.5f)
    }

    @Test
    fun `the last row of a day is not stretched across the screen`() {
        val row = layout(listOf(item("tall", width = 50, height = 200)), 100f, stretch = false)
        val target = 100f / 2.9f
        assertEquals("the row keeps the target height", target, row.heightDp, 0.01f)
        assertTrue("the photo does not fill the screen: ${row.tiles[0].widthDp}", row.tiles[0].widthDp < 100f)
    }

    @Test
    fun `the feed is grouped under a date header`() {
        val entries = grid(
            listOf(
                item("a", day = "2020-11-26"),
                item("b", day = "2020-11-25"),
                item("c", day = "2020-10-02"),
            ),
            containerWidthDp = 100f,
        )
        val headers = entries.filterIsInstance<GridEntry.Header>().map { it.label }
        assertEquals(3, headers.size)
        // the month NAME follows the phone's language, the day never does
        assertTrue("the day is in the header: ${headers[0]}", headers[0].contains("26"))
        assertTrue("the day is in the header: ${headers[1]}", headers[1].contains("25"))
        assertTrue("the day is in the header: ${headers[2]}", headers[2].contains("2"))
        assertTrue("the year is in the header: ${headers[0]}", headers[0].endsWith("2020"))
    }

    @Test
    fun `two photos of the same day share one header`() {
        val entries = grid(
            listOf(item("a", day = "2020-11-26"), item("b", day = "2020-11-26")),
            containerWidthDp = 100f,
        )
        assertEquals(1, entries.filterIsInstance<GridEntry.Header>().size)
    }

    @Test
    fun `a day never shares a row with another day`() {
        val entries = grid(
            (1..10).map { item("i$it", day = if (it <= 5) "2020-11-26" else "2020-11-25") },
            containerWidthDp = 100f,
        )
        val rows = entries.filterIsInstance<GridEntry.Photos>()
        // the first day has five square photos -> two rows, the second day one
        assertTrue("the days are packed apart", rows.size >= 3)
    }

    @Test
    fun `today and yesterday are named the way google photos names them`() {
        val today = LocalDate.now()
        val yesterday = today.minusDays(1)
        assertEquals("Today", dayLabel(today.toString()))
        assertEquals("Yesterday", dayLabel(yesterday.toString()))
    }

    @Test
    fun `an item without a day lands under earlier`() {
        assertEquals("Earlier", dayLabel(null))
        assertEquals("Earlier", dayLabel("not a date"))
    }

    @Test
    fun `the day is read out of the timestamps the database hands over`() {
        assertEquals("2026-11-26", isoDayOf("2026-11-26 03:54:38.281+00"))
        assertEquals("2026-11-26", isoDayOf("2026-11-26T03:54:38.280Z"))
        assertNull(isoDayOf(""))
        assertNull(isoDayOf("nope"))
    }

    @Test
    fun `every photo of the feed ends up in exactly one row`() {
        val items = (1..40).map { item("i$it", width = 100 + it, height = 100) }
        val entries = grid(items, containerWidthDp = 360f)
        val inRows = entries.filterIsInstance<GridEntry.Photos<Tile>>()
            .flatMap { it.row.tiles }
            .map { it.item.id }
        assertEquals(items.size, inRows.size)
        assertEquals(items.map { it.id }.toSet(), inRows.toSet())
    }
}
