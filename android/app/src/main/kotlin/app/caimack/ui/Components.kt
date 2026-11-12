// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

package app.caimack.ui

import android.util.Log
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.rotate
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import app.caimack.AppContainer
import app.caimack.R
import java.util.concurrent.ConcurrentHashMap
import java.io.IOException
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.delay
import kotlinx.coroutines.channels.BufferOverflow
import kotlinx.coroutines.flow.MutableSharedFlow

val LocalContainer = staticCompositionLocalOf<AppContainer> { error("No container") }
val LocalOfflineLibrary = staticCompositionLocalOf { false }
val LocalAvailableTracks = staticCompositionLocalOf<Set<String>> { emptySet() }
@Composable
internal fun catalogApi() = LocalContainer.current.api

val LocalSnackbar = staticCompositionLocalOf<androidx.compose.material3.SnackbarHostState> { error("No snackbar host") }
object Remote {
    val cache = ConcurrentHashMap<String, Any>()
    val updates = MutableSharedFlow<Pair<String, Any>>(extraBufferCapacity = 16, onBufferOverflow = BufferOverflow.DROP_OLDEST)

    fun update(key: String, value: Any) {
        cache[key] = value
        updates.tryEmit(key to value)
    }
}
@Composable
fun <T : Any> Load(
    key: String,
    load: suspend () -> T,
    isEmpty: (T) -> Boolean = { false },
    empty: @Composable () -> Unit = {},
    content: @Composable (T) -> Unit,
) {
    val local = LocalOfflineLibrary.current
    val artworkRevision = if (local) LocalArtworkRevision.current else 0L
    @Suppress("UNCHECKED_CAST")
    var value by remember(key, local) { mutableStateOf(if (local) null else Remote.cache[key] as T?) }
    var failed by remember(key) { mutableStateOf(false) }
    var attempt by remember(key) { mutableIntStateOf(0) }

    LaunchedEffect(key, local) {
        if (local) return@LaunchedEffect
        Remote.updates.collect { (updatedKey, updatedValue) ->
            if (updatedKey == key) {
                @Suppress("UNCHECKED_CAST")
                value = updatedValue as T
            }
        }
    }

    LaunchedEffect(key, attempt, artworkRevision, local) {
        failed = false
        val cachedBeforeRequest = Remote.cache[key]
        runCatching { withNetworkRetries(load) }
            .onSuccess {
                // A completed edit takes precedence over an older in-flight read.
                val edited = if (local) null else Remote.cache[key]
                if (edited != null && edited !== cachedBeforeRequest) {
                    @Suppress("UNCHECKED_CAST")
                    value = edited as T
                } else {
                    if (!local) Remote.cache[key] = it
                    value = it
                }
            }
            .onFailure {
                if (it is CancellationException) throw it
                Log.w("Caimack", "Loading $key failed", it)
                failed = value == null
            }
    }

    val shown = value
    when {
        shown != null -> if (isEmpty(shown)) empty() else content(shown)
        failed -> Failure { attempt++ }
        else -> Box(Modifier.fillMaxWidth().padding(vertical = 64.dp), contentAlignment = Alignment.Center) {
            RecordLoading(44.dp)
        }
    }
}
suspend fun <T> withNetworkRetries(load: suspend () -> T): T {
    for (pause in NETWORK_RETRY_PAUSES) {
        try {
            return load()
        } catch (_: IOException) {
            delay(pause)
        }
    }
    return load()
}
private val NETWORK_RETRY_PAUSES = listOf(1_000L, 3_000L)
@Composable
fun Failure(retry: () -> Unit) {
    val palette = LocalPalette.current
    Column(
        Modifier.fillMaxWidth().padding(vertical = 48.dp, horizontal = 16.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Icon(Lucide.TriangleAlert, null, tint = palette.destructive)
        Text(stringResource(R.string.error_load), style = Type.small, color = palette.muted)
        TextButton(onClick = retry) { Text(stringResource(R.string.action_try_again), color = palette.foreground) }
    }
}
@Composable
fun Empty(title: String, description: String? = null) {
    val palette = LocalPalette.current
    Column(
        Modifier.fillMaxWidth().padding(vertical = 48.dp, horizontal = 24.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        Text(title, style = Type.section, textAlign = TextAlign.Center)
        description?.let { Text(it, style = Type.small, color = palette.muted, textAlign = TextAlign.Center) }
    }
}
@Composable
fun RecordLoading(size: Dp) {
    val palette = LocalPalette.current
    val armed = size > 24.dp
    val spin = rememberInfiniteTransition(label = "record")
    val angle by spin.animateFloat(0f, 360f, infiniteRepeatable(tween(1800, easing = LinearEasing)), label = "spin")
    val track by spin.animateFloat(35f, 41f, infiniteRepeatable(tween(3000), RepeatMode.Reverse), label = "track")
    val drop = remember { Animatable(6f) }
    LaunchedEffect(Unit) { drop.animateTo(37f, tween(700)) }

    Canvas(Modifier.width(if (armed) size * 1.3f else size).height(size)) {
        val disc = this.size.height
        val radius = disc / 2
        val center = Offset(radius, radius)

        drawCircle(Color(0xFF121010), radius, center)
        var groove = radius * 0.42f
        while (groove < radius * 0.96f) {
            drawCircle(Color(0xFF221E1C), groove, center, style = Stroke(width = 1f))
            groove += 2.4f
        }
        drawCircle(palette.borderStrong, radius, center, style = Stroke(width = 1.dp.toPx()))
        drawCircle(palette.primary, radius * 0.36f, center)
        drawCircle(palette.background, radius * 0.08f, center)

        rotate(angle, center) {
            if (armed) {
                drawRect(palette.onPrimary, Offset(radius - disc * 0.02f, disc * 0.34f), Size(disc * 0.04f, disc * 0.09f))
            } else {
                drawRoundRect(
                    palette.primary,
                    Offset(radius - disc * 0.07f, disc * 0.06f),
                    Size(disc * 0.14f, disc * 0.18f),
                    CornerRadius(disc * 0.07f),
                )
            }
        }

        if (armed) {
            val pivot = Offset(disc * 1.18f + disc * 0.0225f, disc * 0.06f)
            val swing = if (drop.isRunning) drop.value else track
            rotate(swing, pivot) {
                drawLine(palette.faint, pivot, pivot + Offset(0f, disc * 0.83f), disc * 0.045f, StrokeCap.Round)
                drawCircle(palette.faint, disc * 0.08f, pivot)
                drawRect(palette.primary, pivot + Offset(-disc * 0.045f, disc * 0.83f - disc * 0.105f), Size(disc * 0.09f, disc * 0.15f))
            }
        }
    }
}
