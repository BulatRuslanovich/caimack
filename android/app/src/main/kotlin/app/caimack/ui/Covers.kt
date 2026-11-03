// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Bulat Ruslanovich

package app.caimack.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.key
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Shape
import androidx.compose.ui.layout.ContentScale
import app.caimack.api.Track
import coil3.compose.SubcomposeAsyncImage
import coil3.compose.LocalPlatformContext
import coil3.request.ImageRequest
import coil3.request.crossfade

@Composable
fun Cover(url: String?, name: String, modifier: Modifier = Modifier, round: Boolean = false, fadeIn: Boolean = true) {
    val palette = LocalPalette.current
    val shape: Shape = if (round) CircleShape else Radius.cover

    Box(modifier.clip(shape).background(palette.accent)) {
        val fallback = @Composable {
            if (round) {
                Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                    Text(initialsOf(name), style = Type.section, color = palette.faint)
                }
            } else {
                Sleeve(name, Modifier.fillMaxSize())
            }
        }

        if (url == null) {
            fallback()
        } else {
            val context = LocalPlatformContext.current
            val request = remember(url, context, fadeIn) {
                ImageRequest.Builder(context).data(url).crossfade(fadeIn).build()
            }
            // A recycled image painter must never display the previous song while loading.
            key(url) {
                SubcomposeAsyncImage(
                    model = request,
                    contentDescription = null,
                    contentScale = ContentScale.Crop,
                    modifier = Modifier.fillMaxSize(),
                    loading = { fallback() },
                    error = { fallback() },
                )
            }
        }
    }
}
private fun initialsOf(name: String): String {
    val words = name.trim().split(Regex("\\s+")).filter { it.isNotEmpty() }
    return when (words.size) {
        0 -> "?"
        1 -> words[0].take(2).uppercase()
        else -> "${words[0][0]}${words[1][0]}".uppercase()
    }
}
@Composable
fun trackCover(track: Track, small: Boolean = true): String? = LocalContainer.current.media.cover(track.albumId, track.id, track.hasCover, small)
fun artistsOf(track: Track): String = track.artists?.takeIf { it.isNotEmpty() }?.joinToString(", ") { it.name } ?: track.artistName
fun durationOf(seconds: Int): String = "%d:%02d".format(seconds / 60, seconds % 60)
