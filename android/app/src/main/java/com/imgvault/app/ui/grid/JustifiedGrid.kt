@file:OptIn(androidx.compose.material3.ExperimentalMaterial3Api::class)

package com.imgvault.app.ui.grid

import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.gestures.rememberTransformableState
import androidx.compose.foundation.gestures.transformable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp

/**
 * The feed itself: date headers with the rows under them.
 *
 * This is the shared drawing of the Google Photos grid — the gallery AND the
 * vault use it, so both look and behave the same: the row geometry comes from
 * [buildGrid], the date header sticks to the top while its day is on screen,
 * and a pinch changes how many items fit in a row.
 *
 * The caller only says what a tile looks like.
 */
@OptIn(ExperimentalFoundationApi::class)
@Composable
fun <T> JustifiedGrid(
    items: List<T>,
    ratioOf: (T) -> Float,
    dayKeyOf: (T) -> String?,
    modifier: Modifier = Modifier,
    tile: @Composable (item: T, widthDp: Float, heightDp: Float) -> Unit,
) {
    var density by remember { mutableFloatStateOf(1f) }
    val transformableState = rememberTransformableState { zoomChange, _, _ ->
        density = (density * zoomChange).coerceIn(0.45f, 2.4f)
    }
    // the lambdas change with every recomposition - the grid must not be
    // rebuilt because of that, but it must never use a stale one either
    val ratioState = rememberUpdatedState(ratioOf)
    val dayState = rememberUpdatedState(dayKeyOf)

    BoxWithConstraints(modifier = modifier.fillMaxSize()) {
        val widthDp = maxWidth.value
        val targetRatio = (GRID_TARGET_RATIO / density).coerceIn(1.1f, 7f)
        val entries = remember(items, widthDp, targetRatio) {
            buildGrid(
                items = items,
                ratioOf = { ratioState.value(it) },
                dayKeyOf = { dayState.value(it) },
                containerWidthDp = widthDp,
                targetRatio = targetRatio,
            )
        }
        LazyColumn(
            modifier = Modifier
                .fillMaxSize()
                .transformable(state = transformableState),
        ) {
            entries.forEach { entry ->
                when (entry) {
                    is GridEntry.Header -> stickyHeader { GridDateHeader(entry.label) }
                    is GridEntry.Photos -> item {
                        GridRowView(entry.row, tile)
                    }
                }
            }
        }
    }
}

/** the date header, the way Google Photos groups a feed */
@Composable
fun GridDateHeader(label: String) {
    Text(
        text = label,
        style = MaterialTheme.typography.titleSmall,
        fontWeight = FontWeight.SemiBold,
        modifier = Modifier.padding(start = 16.dp, end = 16.dp, top = 16.dp, bottom = 8.dp),
    )
}

/** one row of tiles, all of them the same height */
@Composable
private fun <T> GridRowView(
    row: GridRow<T>,
    tile: @Composable (item: T, widthDp: Float, heightDp: Float) -> Unit,
) {
    Row(
        horizontalArrangement = Arrangement.spacedBy(GRID_GAP_DP.dp),
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = GRID_GAP_DP.dp),
    ) {
        row.tiles.forEach { entry ->
            tile(entry.item, entry.widthDp, row.heightDp)
        }
    }
}
