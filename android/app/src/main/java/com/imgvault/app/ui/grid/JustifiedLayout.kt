package com.imgvault.app.ui.grid

import com.imgvault.app.core.time.parseIsoDay
import java.time.LocalDate
import java.time.format.TextStyle
import java.util.Locale

/**
 * The Google Photos layout — the geometry, shared by every feed in the app.
 *
 * Google Photos does NOT put every photo into a square: it packs a row of
 * photos that all share ONE height, and every photo keeps its own shape inside
 * that height (the crop is horizontal, the photo is never squashed). The rows
 * fill the screen edge to edge, the photos have small rounded corners, and the
 * feed is grouped under a date header.
 *
 * This file is the pure geometry of that layout — no Compose, so it can be
 * pinned by unit tests. The screen draws what this returns.
 *
 * The layout knows NOTHING about photos: it works on any item, as long as the
 * caller says how wide each item is and which day it belongs to. That is what
 * lets the gallery and the vault share the very same grid.
 */

/** one tile in a row */
data class GridTile<out T>(
    val item: T,
    val widthDp: Float,
)

/** a row of tiles that share one height */
data class GridRow<out T>(
    val tiles: List<GridTile<T>>,
    val heightDp: Float,
)

/** the feed is a list of date headers and tile rows */
sealed interface GridEntry<out T> {
    data class Header(val label: String) : GridEntry<Nothing>
    data class Photos<T>(val row: GridRow<T>) : GridEntry<T>
}

/** the gaps Google Photos leaves between photos */
const val GRID_GAP_DP = 3f

/** how many screen widths of photos a full row holds */
const val GRID_TARGET_RATIO = 2.9f

/**
 * Pack the feed into rows.
 *
 * A row keeps filling until its items add up to [targetRatio] screen widths,
 * then the row is closed. Every item in a row ends up with the same height;
 * the widths follow from the items' own aspect ratio, so a panorama gets a
 * wide tile and a portrait a narrow one.
 *
 * A day never shares a row with another day — the date header sits between
 * them, the way Google Photos groups a feed by day.
 *
 * @param ratioOf how wide the item is compared to its height
 * @param dayKeyOf the day the item belongs to ("2026-11-26"), null when unknown
 */
fun <T> buildGrid(
    items: List<T>,
    ratioOf: (T) -> Float,
    dayKeyOf: (T) -> String?,
    containerWidthDp: Float,
    gapDp: Float = GRID_GAP_DP,
    targetRatio: Float = GRID_TARGET_RATIO,
): List<GridEntry<T>> {
    val entries = mutableListOf<GridEntry<T>>()
    var index = 0
    var lastLabel: String? = null
    while (index < items.size) {
        val label = dayLabel(dayKeyOf(items[index]))
        if (label != lastLabel) {
            entries += GridEntry.Header(label)
            lastLabel = label
        }
        val rowItems = mutableListOf<T>()
        var sum = 0f
        var closedByTarget = false
        while (index < items.size) {
            val item = items[index]
            if (rowItems.isNotEmpty() && dayLabel(dayKeyOf(item)) != label) break
            rowItems += item
            sum += ratioOf(item)
            index++
            if (sum >= targetRatio) {
                closedByTarget = true
                break
            }
        }
        entries += GridEntry.Photos(
            layoutRow(rowItems, ratioOf, containerWidthDp, gapDp, targetRatio, stretch = closedByTarget),
        )
    }
    return entries
}

/**
 * Give one row its shape.
 *
 * A full row ([stretch] = true) is solved so it fills the width exactly: the
 * height is the usable width divided by the sum of the items' aspect ratios,
 * and every item is that times as wide as it is high. That is what makes all
 * the items in a row the same height while keeping their own shape.
 *
 * The last row of a day is NOT stretched — it keeps the target height and
 * stays left, so a single item never balloons across the whole screen.
 */
fun <T> layoutRow(
    rowItems: List<T>,
    ratioOf: (T) -> Float,
    containerWidthDp: Float,
    gapDp: Float = GRID_GAP_DP,
    targetRatio: Float = GRID_TARGET_RATIO,
    stretch: Boolean = true,
): GridRow<T> {
    if (rowItems.isEmpty()) return GridRow(emptyList(), 0f)
    if (containerWidthDp <= 0f) {
        return GridRow(rowItems.map { GridTile(it, 0f) }, 0f)
    }

    val gaps = gapDp * (rowItems.size - 1)
    val usable = containerWidthDp - gaps
    val sum = rowItems.sumOf { ratioOf(it).toDouble() }.toFloat().coerceAtLeast(0.01f)
    val targetHeight = containerWidthDp / targetRatio.coerceAtLeast(0.1f)

    val height: Float
    val widths: List<Float>
    if (stretch) {
        // a full row: the height is solved so the row fills the width exactly
        height = usable / sum
        widths = rowItems.map { ratioOf(it) * height }
    } else {
        // the last row of a day: the target height, not stretched
        height = targetHeight
        widths = rowItems.map { ratioOf(it) * targetHeight }
    }

    return GridRow(
        tiles = rowItems.mapIndexed { index, item -> GridTile(item, widths[index]) },
        heightDp = height,
    )
}

/**
 * The date header an item belongs under.
 *
 * "Today" and "Yesterday" first, then the weekday, the month and the day —
 * and the year only when it is not the current one. The same words Google
 * Photos uses.
 *
 * @param dayKey the ISO day ("2026-11-26"), null when it is unknown
 */
fun dayLabel(dayKey: String?): String {
    val date = parseIsoDay(dayKey) ?: return "Earlier"
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
