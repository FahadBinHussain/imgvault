// The Google Photos layout, pinned.
//
// The grid packs the feed into rows of photos that share ONE height, so a
// panorama gets a wide tile and a portrait a narrow one — nothing is squashed
// into a square. These tests keep that geometry honest.
package com.imgvault.app.ui.gallery

import com.imgvault.app.data.model.MediaItem
import java.time.LocalDate
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class JustifiedLayoutTest {

    private fun item(
        id: String,
        width: Int = 100,
        height: Int = 100,
        day: String = "2026-11-26",
    ) = MediaItem(
        id = id,
        width = width,
        height = height,
        internalAddedTimestamp = "${day}T10:00:00.000Z",
    )

    @Test
    fun `a row of square photos fills the width`() {
        val row = layoutRow(listOf(item("a"), item("b"), item("c"), item("d")), 100f, gapDp = 0f)
        // three gaps of 0 -> the four photos share the 100dp
        assertEquals(100f, row.heightDp, 0.01f)
        row.tiles.forEach { assertEquals(25f, it.widthDp, 0.01f) }
    }

    @Test
    fun `every photo in a row gets the same height`() {
        val row = layoutRow(
            listOf(item("wide", width = 200, height = 100), item("square"), item("tall", width = 50, height = 100)),
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
        val row = layoutRow(
            (1..6).map { item("i$it", width = 200, height = 100) },
            100f,
            gapDp = 3f,
        )
        val total = row.tiles.sumOf { it.widthDp.toDouble() }.toFloat() + 3f * (row.tiles.size - 1)
        assertTrue("the row fits: $total", total <= 100.5f)
    }

    @Test
    fun `a single photo does not fill the whole screen`() {
        val row = layoutRow(listOf(item("tall", width = 50, height = 200)), 100f)
        assertTrue("the row is capped: ${row.heightDp}", row.heightDp <= 100f / 1.3f)
    }

    @Test
    fun `the feed is grouped under a date header`() {
        val entries = buildGrid(
            listOf(
                item("a", day = "2026-11-26"),
                item("b", day = "2026-11-25"),
                item("c", day = "2026-10-02"),
            ),
            containerWidthDp = 100f,
        )
        val headers = entries.filterIsInstance<GridEntry.Header>().map { it.label }
        assertEquals(3, headers.size)
        // the month NAME follows the phone's language, the year never does
        assertTrue("the year is in the header: ${headers[0]}", headers[0].endsWith("2026"))
        assertTrue("the year is in the header: ${headers[2]}", headers[2].endsWith("2026"))
        assertTrue("the months differ", headers[0] != headers[2])
    }

    @Test
    fun `today and yesterday are named the way google photos names them`() {
        val today = LocalDate.now()
        val yesterday = today.minusDays(1)
        assertEquals(
            "Today",
            monthLabel(item("a", day = today.toString())),
        )
        assertEquals(
            "Yesterday",
            monthLabel(item("b", day = yesterday.toString())),
        )
    }

    @Test
    fun `every photo of the feed ends up in exactly one row`() {
        val items = (1..40).map { item("i$it", width = 100 + it, height = 100) }
        val entries = buildGrid(items, containerWidthDp = 360f)
        val inRows = entries.filterIsInstance<GridEntry.Photos>()
            .flatMap { it.row.tiles }
            .map { it.item.id }
        assertEquals(items.size, inRows.size)
        assertEquals(items.map { it.id }.toSet(), inRows.toSet())
    }
}
