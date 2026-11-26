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

/** how many screen widths of photos a full row holds */
const val GRID_TARGET_RATIO = 2.9f

/**
 * Pack the feed into rows.
 *
 * A row keeps filling until its photos add up to [targetRatio] screen widths,
 * then the row is closed. Every photo in a row ends up with the same height;
 * the widths follow from the photos' own aspect ratio, so a panorama gets a
 * wide tile and a portrait a narrow one.
 *
 * A day never shares a row with another day — the date header sits between
 * them, the way Google Photos groups a feed by day.
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
        var closedByTarget = false
        while (index < items.size) {
            val item = items[index]
            if (rowItems.isNotEmpty() && dayLabel(item) != label) break
            rowItems += item
            sum += item.aspectRatio
            index++
            if (sum >= targetRatio) {
                closedByTarget = true
                break
            }
        }
        entries += GridEntry.Photos(
            layoutRow(rowItems, containerWidthDp, gapDp, targetRatio, stretch = closedByTarget),
        )
    }
    return entries
}

/**
 * Give one row its shape.
 *
 * A full row ([stretch] = true) is solved so it fills the width exactly: the
 * height is the usable width divided by the sum of the photos' aspect ratios,
 * and every photo is that times as wide as it is high. That is what makes all
 * the photos in a row the same height while keeping their own shape.
 *
 * The last row of a day is NOT stretched — it keeps the target height and
 * stays left, so a single photo never balloons across the whole screen.
 */
fun layoutRow(
    rowItems: List<MediaItem>,
    containerWidthDp: Float,
    gapDp: Float = GRID_GAP_DP,
    targetRatio: Float = GRID_TARGET_RATIO,
    stretch: Boolean = true,
): GridRow {
    if (rowItems.isEmpty()) return GridRow(emptyList(), 0f)
    if (containerWidthDp <= 0f) {
        return GridRow(rowItems.map { GridTile(it, 0f) }, 0f)
    }

    val gaps = gapDp * (rowItems.size - 1)
    val usable = containerWidthDp - gaps
    val sum = rowItems.sumOf { it.aspectRatio.toDouble() }.toFloat().coerceAtLeast(0.01f)
    val targetHeight = containerWidthDp / targetRatio.coerceAtLeast(0.1f)

    val height: Float
    val widths: List<Float>
    if (stretch) {
        // a full row: the height is solved so the row fills the width exactly
        height = usable / sum
        widths = rowItems.map { it.aspectRatio * height }
    } else {
        // the last row of a day: the target height, not stretched
        height = targetHeight
        widths = rowItems.map { it.aspectRatio * targetHeight }
    }

    return GridRow(
        tiles = rowItems.mapIndexed { index, item -> GridTile(item, widths[index]) },
        heightDp = height,
    )
}

/**
 * The date header a photo belongs under.
 *
 * "Today" and "Yesterday" first, then the weekday, the month and the day —
 * and the year only when it is not the current one. The same words Google
 * Photos uses.
 */
fun dayLabel(item: MediaItem): String {
    val date = item.sortDate() ?: return "Earlier"
    val today = LocalDate.now()
    if (date == today) return "Today"
    if (date == today.minusDays(1)) return "Yesterday"
    val weekday = date.dayOfWeek.getDisplayName(TextStyle.FULL, Locale.getDefault())
    val month = date.month.getDisplayName(TextStyle.FULL, Locale.getDefault())
    return if (date.year == today.year) {
        "$weekday, $month ${date.dayOfMonth}"
    } else {
        "$weekday, $month ${date.dayOfMonth}, ${date.year}"
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
