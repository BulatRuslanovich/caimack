// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

package app.caimack.ui

import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectDragGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import app.caimack.R
import app.caimack.playback.PlayerState
import kotlin.math.abs
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

@Composable
internal fun rememberPosition(state: PlayerState): Long {
    val player = LocalContainer.current.player
    val position by produceState(player.position, state.index, state.playing) {
        while (true) {
            value = player.position
            delay(if (state.playing) 250 else 1000)
        }
    }
    return position
}
internal fun clock(ms: Long) = durationOf((ms / 1000).toInt())
@Composable
fun MiniPlayer(state: PlayerState, onOpen: () -> Unit) {
    val motion = playerMotionEnabled()
    val palette = LocalPalette.current
    val container = LocalContainer.current
    val player = container.player
    val track = state.current ?: return
    val openLabel = stringResource(R.string.player_open_full)
    val position = rememberPosition(state)
    val duration = state.durationMs.takeIf { it > 0 } ?: (track.durationSeconds * 1000L)
    val swipe = remember { Animatable(0f) }
    val scope = rememberCoroutineScope()
    val skipPx = with(LocalDensity.current) { 80.dp.toPx() }
    val openPx = with(LocalDensity.current) { 40.dp.toPx() }

    val tone = LocalNowPlayingTone.current
    val wash = tone.copy(alpha = tone.alpha * if (palette.dark) 0.16f else 0.12f)

    Column(
        Modifier
            .padding(horizontal = 8.dp, vertical = 5.dp)
            .musicSurface(palette)
            .background(Brush.horizontalGradient(0f to wash, 0.75f to Color.Transparent))
            .clickable(onClick = onOpen)
            .pointerInput(motion) {
                var total = Offset.Zero
                val settle = { scope.launch { swipe.animateTo(0f, tween(if (motion) 200 else 0)) } }
                detectDragGestures(
                    onDragStart = { total = Offset.Zero },
                    onDragEnd = {
                        if (abs(total.x) > abs(total.y)) {
                            if (total.x <= -skipPx) player.next() else if (total.x >= skipPx) player.previous()
                        } else if (-total.y > openPx) {
                            onOpen()
                        }
                        settle()
                    },
                    onDragCancel = { settle() },
                ) { change, amount ->
                    change.consume()
                    total += amount
                    if (abs(total.x) > abs(total.y)) scope.launch { swipe.snapTo(total.x) }
                }
            },
    ) {
        Row(
            Modifier
                .fillMaxWidth()
                .graphicsLayer {
                    translationX = swipe.value
                    alpha = 1f - (abs(swipe.value) / (skipPx * 3)).coerceAtMost(0.5f)
                }
                .padding(start = 10.dp, end = 4.dp, top = 9.dp, bottom = 9.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            val transition = LocalNowPlayingTransition.current
            Box(Modifier.size(48.dp).semantics { contentDescription = openLabel }.clickable(onClick = onOpen)) {
                androidx.compose.animation.AnimatedVisibility(visible = transition?.full != true, enter = fadeIn(tween(if (motion) NOW_PLAYING_TRANSITION_MS else 0)), exit = fadeOut(tween(if (motion) NOW_PLAYING_TRANSITION_MS else 0))) {
                    Cover(trackCover(track), track.albumTitle ?: track.title, Modifier.fillMaxSize().nowPlayingCover(this))
                }
            }
            Column(Modifier.weight(1f)) {
                Text(track.title, style = Type.body.copy(fontWeight = FontWeight.Medium), color = palette.foreground, maxLines = 1, overflow = TextOverflow.Ellipsis)
                Text(artistsOf(track), style = Type.small, color = palette.muted, maxLines = 1, overflow = TextOverflow.Ellipsis)
            }
            Row(verticalAlignment = Alignment.CenterVertically) {
                Box(Modifier.size(48.dp), contentAlignment = Alignment.Center) {
                    Box(Modifier.size(40.dp).clip(CircleShape).background(palette.action))
                    IconAction(if (state.playing) Lucide.Pause else Lucide.Play,
                        stringResource(if (state.playing) R.string.action_pause else R.string.action_play),
                        tint = palette.onAction, size = 20) { player.toggle() }
                    BufferingRing(state.buffering, Modifier.size(40.dp))
                }
                IconAction(Lucide.SkipForward, stringResource(R.string.player_next), size = 20) { player.next() }
            }
        }
        Box(Modifier.padding(start = 12.dp, end = 12.dp, bottom = 3.dp)
            .fillMaxWidth().height(2.dp).clip(CircleShape).background(palette.border)) {
            val progress = if (duration > 0) (position.toFloat() / duration).coerceIn(0f, 1f) else 0f
            Box(Modifier.fillMaxWidth(progress).height(2.dp).background(palette.primary))
        }
    }
}
@Composable
internal fun IconAction(icon: ImageVector, label: String, tint: Color = LocalPalette.current.foreground, size: Int = 22, onClick: () -> Unit) {
    Box(Modifier.size(48.dp).clip(CircleShape).clickable(onClick = onClick), contentAlignment = Alignment.Center) {
        Icon(icon, label, tint = tint, modifier = Modifier.size(size.dp))
    }
}
