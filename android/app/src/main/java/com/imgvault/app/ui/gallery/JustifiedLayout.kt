package com.imgvault.app.ui.gallery

import com.imgvault.app.data.model.MediaItem
import java.time.LocalDate
import java.time.format.DateTimeFormatter
import java.time.format.TextStyle
import java.util.Locale

/**
 * The Google Photos layout.
 *
 * Google Photos does NOT put every photo into a square: it packs a row of
 * photos that all share ONE height, and every photo keeps its own shape inside
 * that height (the crop is horizontal, the photo is never squashed). The rows
 * fill the screen edge to edge, the photos have small rounded corners, and the
 * feed is grouped under a date header.
 *
 * This file is the pure geometry of that layout — no Compose, so it can be
 * pinned by unit tests. The screen draws what this returns.
 */

/** one photo in a row */
data class GridTile(
    val item: MediaItem,
    val widthDp: Float,
)

/** a row of photos that share one height */
data class GridRow(
    val tiles: List<GridTile>,
    val heightDp: Float,
)

/** the feed is a list of date headers and photo rows */
sealed interface GridEntry {
    data class Header(val label: String) : GridEntry
    data class Photos(val row: GridRow) : GridEntry
}

/** the gaps Google Photos leaves between photos */
const val GRID_GAP_DP = 3f

/** how wide a full row of photos gets, in screen widths */
const val GRID_TARGET_RATIO = 2.9f

/**
 * Pack the feed into rows.
 *
 * A row keeps filling until its photos add up to [targetRatio] screen widths,
 * then the row is closed. Every photo in a row ends up with the same height;
 * the widths follow from the photos' own aspect ratio, so a panorama gets a
 * wide tile and a portrait gets a narrow one.
 */
fun buildGrid(
    items: List<MediaItem>,
    containerWidthDp: Float,
    gapDp: Float = GRID_GAP_DP,
    targetRatio: Float = GRID_TARGET_RATIO,
): List<GridEntry> {
    val entries = mutableListOf<GridEntry>()
    var index = 0
    var lastLabel: String? = null
    while (index < items.size) {
        val label = dayLabel(items[index])
        if (label != lastLabel) {
            entries += GridEntry.Header(label)
            lastLabel = label
        }
        val rowItems = mutableListOf<MediaItem>()
        var sum = 0f
        while (index < items.size) {
            val item = items[index]
            if (rowItems.isNotEmpty() && dayLabel(item) != label) break
            rowItems += item
            sum += item.aspectRatio
            index++
            if (sum >= targetRatio) break
        }
        entries += GridEntry.Photos(layoutRow(rowItems, containerWidthDp, gapDp))
    }
    return entries
}

/**
 * Give one row its shape.
 *
 * The height is the container width divided by the sum of the photos' aspect
 * ratios — that is what makes every photo in the row the same height while
 * keeping its own shape. A row that would end up absurdly tall (a single
 * portrait) is capped, and the leftover width is shared out over the photos,
 * which is how Google Photos fills the last row of a section.
 */
fun layoutRow(
    rowItems: List<MediaItem>,
    containerWidthDp: Float,
    gapDp: Float = GRID_GAP_DP,
): GridRow {
    if (rowItems.isEmpty()) return GridRow(emptyList(), 0f)
    if (containerWidthDp <= 0f) {
        return GridRow(rowItems.map { GridTile(it, 0f) }, 0f)
    }

    val gaps = gapDp * (rowItems.size - 1)
    val usable = containerWidthDp - gaps
    val sum = rowItems.sumOf { it.aspectRatio.toDouble() }.toFloat().coerceAtLeast(0.01f)

    var height = usable / sum
    // a row of one very tall photo would fill the whole screen - cap it
    height = height.coerceIn(containerWidthDp / 6f, containerWidthDp / 1.35f)

    val raw = rowItems.map { it.aspectRatio * height }
    val rawTotal = raw.sum()
    val extra = containerWidthDp - gaps - rawTotal

    val widths: List<Float>
    val finalHeight: Float
    if (extra >= 0f) {
        // the row is shorter than the screen: share the leftover over the photos
        widths = raw.map { it + if (rawTotal > 0f) extra * (it / rawTotal) else 0f }
        finalHeight = height
    } else {
        // the row is longer than the screen: scale it down
        val scale = (containerWidthDp - gaps) / rawTotal
        widths = raw.map { it * scale }
        finalHeight = height * scale
    }

    return GridRow(
        tiles = rowItems.mapIndexed { index, item -> GridTile(item, widths[index]) },
        heightDp = finalHeight,
    )
}

/**
 * The date header a photo belongs under.
 *
 * "Today" and "Yesterday" first, then the day and the month — and the year
 * only when it is not the current one. The same words Google Photos uses.
 */
fun dayLabel(item: MediaItem): String {
    val date = item.sortDate() ?: return "Earlier"
    val today = LocalDate.now()
    return when (date) {
        today -> "Today"
        today.minusDays(1) -> "Yesterday"
        else -> {
            val month = date.month.getDisplayName(TextStyle.FULL, Locale.getDefault())
            if (date.year == today.year) {
                "$month ${date.dayOfMonth}"
            } else {
                "$month ${date.dayOfMonth}, ${date.year}"
            }
        }
    }
}

/** the date of a photo, read from the text timestamps the database hands over */
private fun MediaItem.sortDate(): LocalDate? {
    val stamp = internalAddedTimestamp.ifEmpty { creationDate }
    if (stamp.length < 10) return null
    return try {
        LocalDate.parse(stamp.take(10), DateTimeFormatter.ISO_LOCAL_DATE)
    } catch (error: Exception) {
        null
    }
}
