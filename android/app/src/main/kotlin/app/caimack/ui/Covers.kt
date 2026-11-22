// SPDX-License-Identifier: AGPL-3.0-only

package app.caimack.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.key
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Shape
import androidx.compose.ui.graphics.RectangleShape
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.unit.dp
import app.caimack.api.Track
import app.caimack.api.PlaylistCoverTrack
import coil3.compose.SubcomposeAsyncImage
import coil3.compose.LocalPlatformContext
import coil3.request.CachePolicy
import coil3.request.ImageRequest
import coil3.request.crossfade

internal val LocalArtworkRevision = androidx.compose.runtime.staticCompositionLocalOf { 0L }
internal val LocalArtworkResolver = androidx.compose.runtime.staticCompositionLocalOf<(String) -> String?> { { null } }

@Composable
fun Cover(url: String?, name: String, modifier: Modifier = Modifier, round: Boolean = false, fadeIn: Boolean = true, book: Boolean = false, square: Boolean = false) {
    val revision = LocalArtworkRevision.current
    val resolve = LocalArtworkResolver.current
    val resolvedUrl = remember(url, revision, resolve) { url?.let { resolve(it) ?: it } }
    val palette = LocalPalette.current
    val shape: Shape = when {
        round -> CircleShape
        square -> RectangleShape
        else -> Radius.cover
    }

    Box(modifier.clip(shape).background(palette.accent)) {
        val fallback = @Composable {
            if (book) {
                Box(Modifier.fillMaxSize().background(sleeveColor(name, palette)), contentAlignment = Alignment.Center) {
                    Text(initialsOf(name), style = Type.section, color = palette.foreground)
                }
            } else if (round) {
                Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                    Text(initialsOf(name), style = Type.section, color = palette.faint)
                }
            } else {
                Sleeve(name, Modifier.fillMaxSize())
            }
        }

        if (resolvedUrl == null) {
            fallback()
        } else {
            val context = LocalPlatformContext.current
            val offline = LocalOfflineLibrary.current
            val request = remember(resolvedUrl, context, fadeIn, offline) {
                ImageRequest.Builder(context).data(resolvedUrl).crossfade(fadeIn)
                    .networkCachePolicy(if (offline) CachePolicy.DISABLED else CachePolicy.ENABLED)
                    .build()
            }
            // A recycled image painter must never display the previous song while loading.
            key(resolvedUrl, offline) {
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
fun trackCover(track: Track, small: Boolean = true): String? = LocalContainer.current.media.cover(track.albumId, track.id, track.hasCover, small, revision = track.coverRevision)

internal data class CoverTile(val url: String, val name: String)

@Composable
internal fun BadgedCover(
    icon: ImageVector,
    hasArtwork: Boolean,
    modifier: Modifier,
    content: @Composable () -> Unit,
) {
    val palette = LocalPalette.current
    BoxWithConstraints(modifier.clip(Radius.cover).background(palette.raised)) {
        content()
        val badge = Modifier.align(Alignment.BottomEnd)
            .padding((maxWidth * .045f).coerceIn(3.dp, 7.dp))
            .size((maxWidth * .18f).coerceIn(14.dp, 24.dp))
        if (hasArtwork) {
            Icon(icon, null, tint = Color.Black.copy(alpha = 0.8f), modifier = badge.offset(y = 1.dp))
        }
        Icon(icon, null, tint = if (hasArtwork) Color.White else palette.primary, modifier = badge)
    }
}

@Composable
internal fun PlaylistArtwork(
    fallback: String?,
    coverTracks: List<PlaylistCoverTrack>?,
    name: String,
    modifier: Modifier,
) {
    val media = LocalContainer.current.media
    val tiles = coverTracks.orEmpty().asSequence()
        .filter { it.hasCover }
        .distinctBy { it.coverRevision ?: it.albumId ?: it.id }
        .mapNotNull { track ->
            media.cover(track.albumId, track.id, track.hasCover, small = true, revision = track.coverRevision)
                ?.let { CoverTile(it, track.albumTitle ?: track.title) }
        }
        .take(4)
        .toList()
    val image = fallback.takeIf { coverTracks == null }
    BadgedCover(Lucide.ListMusic, image != null || tiles.isNotEmpty(), modifier) {
        if (tiles.isEmpty()) Cover(image, name, Modifier.fillMaxSize())
        else CoverMosaic(tiles, Modifier.fillMaxSize())
    }
}

@Composable
internal fun CoverMosaic(tiles: List<CoverTile>, modifier: Modifier) {
    Box(modifier.clip(Radius.cover)) {
        when (tiles.size) {
            1 -> MosaicTile(tiles[0], Modifier.fillMaxSize())
            2 -> Row(Modifier.fillMaxSize()) {
                tiles.forEach { MosaicTile(it, Modifier.weight(1f).fillMaxSize()) }
            }
            3 -> Row(Modifier.fillMaxSize()) {
                MosaicTile(tiles[0], Modifier.weight(1f).fillMaxSize())
                Column(Modifier.weight(1f).fillMaxSize()) {
                    MosaicTile(tiles[1], Modifier.weight(1f).fillMaxSize())
                    MosaicTile(tiles[2], Modifier.weight(1f).fillMaxSize())
                }
            }
            4 -> Column(Modifier.fillMaxSize()) {
                tiles.chunked(2).forEach { pair ->
                    Row(Modifier.weight(1f).fillMaxSize()) {
                        pair.forEach { MosaicTile(it, Modifier.weight(1f).fillMaxSize()) }
                    }
                }
            }
        }
    }
}

@Composable
private fun MosaicTile(tile: CoverTile, modifier: Modifier) {
    Cover(tile.url, tile.name, modifier, square = true)
}

fun artistsOf(track: Track): String = track.artists?.takeIf { it.isNotEmpty() }?.joinToString(", ") { it.name } ?: track.artistName
fun durationOf(seconds: Int): String = "%d:%02d".format(seconds / 60, seconds % 60)
