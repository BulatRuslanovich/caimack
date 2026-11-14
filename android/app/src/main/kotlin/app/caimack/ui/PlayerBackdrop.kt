// SPDX-License-Identifier: AGPL-3.0-only

package app.caimack.ui

import android.graphics.Bitmap
import android.util.LruCache
import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.SizeTransform
import androidx.compose.animation.core.tween
import androidx.compose.animation.slideInHorizontally
import androidx.compose.animation.slideOutHorizontally
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.testTag
import coil3.SingletonImageLoader
import coil3.compose.LocalPlatformContext
import coil3.request.ImageRequest
import coil3.request.SuccessResult
import coil3.request.allowHardware
import coil3.toBitmap
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeoutOrNull
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlin.coroutines.coroutineContext

private data class LoadedPlayerTone(val url: String?, val tone: PlayerBackdropTone?)
private val playerTones = LruCache<String, LoadedPlayerTone>(PlayerBackdropSettings.cacheEntries)
private val sampling = Mutex()

@Composable
private fun rememberLoadedPlayerTone(url: String?): LoadedPlayerTone? {
    val context = LocalPlatformContext.current
    val revision = LocalArtworkRevision.current
    val resolve = LocalArtworkResolver.current
    val source = remember(url, revision, resolve) { url?.let { resolve(it) ?: it } }
    val loaded by produceState<LoadedPlayerTone?>(null, source, context) {
        if (source == null) { value = LoadedPlayerTone(null, null); return@produceState }
        playerTones.get(source)?.let { value = it; return@produceState }
        val tone = try {
            withTimeoutOrNull(PlayerBackdropSettings.loadTimeoutMs) {
                val request = ImageRequest.Builder(context).data(source).size(PlayerBackdropSettings.sampleEdge).allowHardware(false).build()
                val result = SingletonImageLoader.get(context).execute(request) as? SuccessResult
                result?.let {
                    withContext(Dispatchers.Default) {
                        sampling.withLock {
                            playerTones.get(source)?.let { return@withLock it.tone }
                            val original = it.image.toBitmap()
                            val edge = PlayerBackdropSettings.sampleEdge
                            val bitmap = Bitmap.createScaledBitmap(original, edge, edge, true)
                            val pixels = IntArray(edge * edge)
                            bitmap.getPixels(pixels, 0, edge, 0, 0, edge, edge)
                            playerBackdropTone(pixels).also { tone -> playerTones.put(source, LoadedPlayerTone(source, tone)) }
                        }
                    }
                }
            }
        } catch (cancel: CancellationException) { throw cancel }
        catch (_: Exception) { null }
        // A cancelled decode may finish on a worker; it must never publish its colour.
        coroutineContext.ensureActive()
        value = LoadedPlayerTone(source, tone).also { playerTones.put(source, it) }
    }
    return loaded?.takeIf { it.url == source }
}

/** Same cached cover selection as fullscreen; UI lightness follows its theme. */
@Composable
internal fun rememberPlayerCoverTone(url: String?): CoverTone? =
    rememberLoadedPlayerTone(url)?.tone?.let { CoverTone(it.hue, it.chroma) }

@Composable
internal fun rememberPlayerSurface(url: String?): PlayerBackdropSurface {
    val loaded = rememberLoadedPlayerTone(url)
    var surface by remember { mutableStateOf(playerBackdropSurface(null)) }
    val resolved = remember(loaded) { loaded?.let { playerBackdropSurface(it.tone) } }
    resolved?.let { surface = it }
    return surface
}

@Composable
internal fun PlayerBackdrop(url: String?, index: Int, queueSize: Int, modifier: Modifier = Modifier) {
    val motion = playerMotionEnabled()
    val surface = rememberPlayerSurface(url)
    var previousIndex by remember { mutableStateOf(index) }
    var direction by remember { mutableStateOf(1) }
    if (index != previousIndex) {
        direction = if (queueSize > 0 && index == (previousIndex + 1) % queueSize) 1 else if (index < previousIndex) -1 else 1
        previousIndex = index
    }
    PlayerBackdropSurface(surface, direction, motion, modifier)
}

@Composable
internal fun PlayerBackdropSurface(surface: PlayerBackdropSurface, direction: Int, motion: Boolean, modifier: Modifier = Modifier) {
    AnimatedContent(
        targetState = surface,
        modifier = modifier.clipToBounds().testTag("player-backdrop"),
        transitionSpec = {
            val animation = tween<androidx.compose.ui.unit.IntOffset>(if (motion) PlayerBackdropSettings.transitionMs else 0)
            (slideInHorizontally(animation) { it * direction } togetherWith slideOutHorizontally(animation) { -it * direction }).using(SizeTransform(clip = false))
        },
        label = "player-backdrop",
    ) { colors ->
        val brush = remember(colors) { Brush.verticalGradient(listOf(Color(colors.top), Color(colors.bottom))) }
        Canvas(Modifier.fillMaxSize()) { drawRect(brush) }
    }
}
