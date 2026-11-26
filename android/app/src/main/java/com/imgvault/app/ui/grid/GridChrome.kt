package com.imgvault.app.ui.grid

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.BrokenImage
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp

/**
 * The look of a tile — shared by every feed.
 *
 * The gallery shows a picture from a host url, the vault shows a picture it
 * decrypted itself. What they both need is the same chrome: what a tile looks
 * like when there is no picture, how a video is marked and how long it runs.
 */

/**
 * What is shown when there is no picture to show.
 *
 * It never hides the problem: a file without a thumbnail says so with an icon
 * and the file name, so the grid is never a row of empty squares.
 */
@Composable
fun TileFallback(title: String, isVideo: Boolean, loading: Boolean = false) {
    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(8.dp),
        verticalArrangement = Arrangement.Center,
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        if (loading) {
            CircularProgressIndicator(modifier = Modifier.size(20.dp), strokeWidth = 2.dp)
        } else {
            Icon(
                imageVector = if (isVideo) Icons.Filled.PlayArrow else Icons.Filled.BrokenImage,
                contentDescription = null,
                modifier = Modifier.size(22.dp),
                tint = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        Text(
            text = title,
            style = MaterialTheme.typography.labelSmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            maxLines = 2,
            overflow = TextOverflow.Ellipsis,
            modifier = Modifier.padding(top = 4.dp),
        )
    }
}

/**
 * A video without a poster frame.
 *
 * The database has no thumbnail for a video, so the tile says what it is: a
 * dark tile with a play button in the middle, the way Google Photos shows a
 * video it has no frame for.
 */
@Composable
fun VideoPlaceholder() {
    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(Color(0xFF232323)),
        contentAlignment = Alignment.Center,
    ) {
        Surface(
            color = Color.White.copy(alpha = 0.22f),
            contentColor = Color.White,
            shape = CircleShape,
        ) {
            Icon(
                imageVector = Icons.Filled.PlayArrow,
                contentDescription = "Video",
                modifier = Modifier
                    .padding(10.dp)
                    .size(28.dp),
            )
        }
    }
}

/** the play badge and the length of a video, on the tile */
@Composable
fun VideoBadge(duration: String, withPlayIcon: Boolean, modifier: Modifier = Modifier) {
    Row(
        modifier = modifier,
        horizontalArrangement = Arrangement.spacedBy(4.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        if (withPlayIcon) {
            Surface(
                color = MaterialTheme.colorScheme.scrim,
                contentColor = MaterialTheme.colorScheme.onPrimary,
                shape = CircleShape,
            ) {
                Icon(
                    imageVector = Icons.Filled.PlayArrow,
                    contentDescription = "Video",
                    modifier = Modifier
                        .padding(3.dp)
                        .size(16.dp),
                )
            }
        }
        if (duration.isNotEmpty()) {
            Surface(
                color = Color.Black.copy(alpha = 0.6f),
                contentColor = Color.White,
                shape = RoundedCornerShape(6.dp),
            ) {
                Text(
                    text = duration,
                    style = MaterialTheme.typography.labelSmall,
                    modifier = Modifier.padding(horizontal = 6.dp, vertical = 2.dp),
                )
            }
        }
    }
}
