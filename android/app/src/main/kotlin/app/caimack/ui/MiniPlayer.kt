// SPDX-License-Identifier: AGPL-3.0-only

package app.caimack.ui

import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.core.tween
import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectDragGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.SideEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.input.pointer.util.VelocityTracker
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import app.caimack.R
import app.caimack.api.Track
import app.caimack.haptics.PlayerHaptic
import app.caimack.playback.PlayerState
import kotlin.math.abs
import kotlin.math.min
import kotlin.math.sign
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
    val haptic = rememberPlayerHaptics()
    val motion = playerMotionEnabled()
    val palette = LocalPalette.current
    val container = LocalContainer.current
    val player = container.player
    val connect by container.connect.state.collectAsStateWithLifecycle()
    val track = state.current ?: return
    val position = rememberPosition(state)
    val duration = state.durationMs.takeIf { it > 0 } ?: (track.durationSeconds * 1000L)
    val scope = rememberCoroutineScope()
    val skipPx = with(LocalDensity.current) { 64.dp.toPx() }
    val flingPx = with(LocalDensity.current) { 700.dp.toPx() }
    val openPx = with(LocalDensity.current) { 40.dp.toPx() }
    val initialWidth = with(LocalDensity.current) { 180.dp.roundToPx() }
    var metadataWidth by remember { mutableIntStateOf(initialWidth) }
    var barWidth by remember { mutableIntStateOf(initialWidth * 2) }
    val scene = rememberPlayerScene(state, transitionMs = 340, distancePx = metadataWidth, waitForTone = false)
    val open by rememberUpdatedState(onOpen)
    container.favorites.state.collectAsStateWithLifecycle().value
    val saved = container.favorites.isFavorite(track)
    val saveLabel = stringResource(if (saved) R.string.collection_remove else R.string.collection_add)

    val loaded = LocalNowPlayingCoverTone.current
    val resolved = loaded?.let { cover -> cover.tone?.let {
        oklch(if (palette.dark) 0.33 else 0.88, min(it.chroma * 0.85, if (palette.dark) 0.09 else 0.065), it.hue)
    } ?: palette.raised }
    // Keep the previous colour while the next cover loads, including uncached radio tracks.
    var lastBackground by remember(palette.dark) { mutableStateOf(palette.raised) }
    SideEffect { if (resolved != null) lastBackground = resolved }
    val background by key(palette.dark) {
        animateColorAsState(resolved ?: lastBackground, tween(if (motion) 450 else 0), label = "mini-player-background")
    }
    val foreground = palette.foreground
    val secondary = foreground.copy(alpha = 0.76f)
    val connection = if (connect.selectedId == null) null else stringResource(
        if (connect.available) R.string.connect_playing_on else R.string.connect_unavailable,
        connect.selectedName ?: stringResource(R.string.connect_title),
    )

    Box(
        Modifier
            .padding(horizontal = 8.dp, vertical = 4.dp)
            .clip(Radius.panel)
            .background(background)
            .onSizeChanged { barWidth = it.width }
            .testTag("mini-player")
            .clickable(onClick = onOpen)
            .pointerInput(scene, motion, skipPx, flingPx, openPx) {
                var total = Offset.Zero
                var gestureKey = scene.current.key
                var accepted = false
                val velocity = VelocityTracker()
                detectDragGestures(
                    orientationLock = null,
                    onDragStart = { down, _, _ ->
                        total = Offset.Zero
                        gestureKey = scene.current.key
                        accepted = scene.acceptsDrag(gestureKey)
                        velocity.resetTracking()
                        velocity.addPosition(down.uptimeMillis, down.position)
                    },
                    onDragEnd = end@{ change ->
                        if (!accepted) return@end
                        velocity.addPosition(change.uptimeMillis, change.position)
                        if (abs(total.x) > abs(total.y)) {
                            val current = scene.current
                            val index = if (total.x < 0) current.state.nextIndex else current.state.previousIndex
                            val speed = velocity.calculateVelocity().x
                            val flung = abs(speed) > flingPx && sign(speed) == sign(total.x)
                            val threshold = min(skipPx, barWidth * 0.22f)
                            if (current.key == gestureKey && current.state.queue.getOrNull(index) != null &&
                                (abs(total.x) > threshold || flung)) {
                                haptic(PlayerHaptic.Skip)
                                scene.commit(gestureKey, index)
                                val revision = scene.revision
                                val requestedKey = gestureKey
                                player.skipTo(index)
                                scope.launch {
                                    delay(1_500)
                                    if (scene.revision == revision) scene.cancel(requestedKey, onlyUnacknowledged = true)
                                }
                            } else scene.cancel(gestureKey)
                        } else if (-total.y > openPx) {
                            scene.cancel(gestureKey)
                            open()
                        } else scene.cancel(gestureKey)
                    },
                    onDragCancel = { scene.cancel(gestureKey) },
                ) { change, amount ->
                    if (!accepted) return@detectDragGestures
                    change.consume()
                    total += amount
                    velocity.addPosition(change.uptimeMillis, change.position)
                    if (abs(total.x) > abs(total.y)) {
                        val neighbour = if (total.x < 0) scene.current.state.next else scene.current.state.previous
                        val movement = total.x * if (neighbour == null) 0.2f else 1f
                        scene.drag(gestureKey, movement.coerceIn(-scene.distance * 0.95f, scene.distance * 0.95f))
                    }
                }
            },
    ) {
        Row(
            Modifier
                .fillMaxWidth()
                .heightIn(min = 60.dp)
                .padding(start = 4.dp, end = 4.dp, top = 6.dp, bottom = 6.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            MiniPlayerCover(track, onOpen)
            Box(Modifier.weight(1f).onSizeChanged { metadataWidth = it.width }.clipToBounds().testTag("mini-player-tracks")) {
                scene.frames.forEach { frame -> key(frame.key) {
                    Box(Modifier.fillMaxWidth().graphicsLayer { translationX = scene.position(frame.key) }) {
                        MiniPlayerText(frame.state, connection, Modifier.fillMaxWidth().testTag("mini-track-${frame.key}"))
                    }
                } }
            }
            Row(Modifier.testTag("mini-player-controls"), verticalAlignment = Alignment.CenterVertically) {
                PlaybackDevicesButton(Modifier.size(48.dp).testTag("mini-player-devices"), compact = true, iconTint = if (connect.selectedId != null) foreground else secondary)
                Box(Modifier.size(48.dp).testTag("mini-player-save").clip(CircleShape)
                    .semantics {
                        selected = saved
                        contentDescription = saveLabel
                    }
                    .clickable(role = Role.Button) { haptic(PlayerHaptic.Favorite); container.favorites.toggle(track) },
                    contentAlignment = Alignment.Center) {
                    if (saved) {
                        Box(Modifier.size(24.dp).clip(CircleShape).background(palette.success), contentAlignment = Alignment.Center) {
                            Icon(Lucide.Check, null, tint = palette.background, modifier = Modifier.size(16.dp))
                        }
                    } else Icon(Lucide.CirclePlus, null, tint = foreground, modifier = Modifier.size(24.dp))
                }
                Box(Modifier.size(48.dp), contentAlignment = Alignment.Center) {
                    IconAction(if (state.playing) Lucide.Pause else Lucide.Play,
                        stringResource(if (state.playing) R.string.action_pause else R.string.action_play),
                        tint = foreground, size = 25) { haptic(PlayerHaptic.Button); player.toggle() }
                    BufferingRing(state.buffering, Modifier.size(32.dp))
                }
            }
        }
        Box(Modifier.align(Alignment.BottomCenter).padding(horizontal = 8.dp)
            .fillMaxWidth().height(1.5.dp).clip(CircleShape).background(foreground.copy(alpha = 0.18f))) {
            val progress = if (duration > 0) (position.toFloat() / duration).coerceIn(0f, 1f) else 0f
            Box(Modifier.fillMaxWidth(progress).height(1.5.dp).background(foreground.copy(alpha = 0.9f)))
        }
    }
}

@Composable
private fun MiniPlayerCover(track: Track, onOpen: () -> Unit) {
    val motion = playerMotionEnabled()
    val transition = LocalNowPlayingTransition.current
    val openLabel = stringResource(R.string.player_open_full)
    Box(Modifier.size(48.dp).testTag("mini-player-cover").semantics { contentDescription = openLabel }.clickable(onClick = onOpen), contentAlignment = Alignment.Center) {
        androidx.compose.animation.AnimatedVisibility(visible = transition?.full != true,
            enter = fadeIn(tween(if (motion) NOW_PLAYING_TRANSITION_MS else 0)),
            exit = fadeOut(tween(if (motion) NOW_PLAYING_TRANSITION_MS else 0))) {
            AnimatedContent(targetState = track, contentKey = { it.id }, label = "mini-player-artwork",
                modifier = Modifier.size(40.dp).nowPlayingCover(this),
                transitionSpec = { fadeIn(tween(if (motion) 180 else 0)) togetherWith fadeOut(tween(if (motion) 120 else 0)) }) { artwork ->
                Cover(trackCover(artwork), artwork.albumTitle ?: artwork.title, Modifier.size(40.dp), fadeIn = false)
            }
        }
    }
}

@Composable
private fun MiniPlayerText(state: PlayerState, connection: String?, modifier: Modifier) {
    val track = state.current ?: return
    val palette = LocalPalette.current
    Column(modifier.heightIn(min = 48.dp), verticalArrangement = Arrangement.Center) {
        Text(track.title, style = Type.small.copy(fontWeight = FontWeight.SemiBold, lineHeight = 18.sp), color = palette.foreground, maxLines = 1, overflow = TextOverflow.Ellipsis)
        val artist = artistsOf(track)
        Text(if (connection == null) artist else "$artist · $connection", style = Type.tiny,
            color = palette.foreground.copy(alpha = 0.76f), maxLines = 1, overflow = TextOverflow.Ellipsis)
    }
}
@Composable
internal fun IconAction(icon: ImageVector, label: String, tint: Color = LocalPalette.current.foreground, size: Int = 22, onClick: () -> Unit) {
    Box(Modifier.size(48.dp).clip(CircleShape).clickable(onClick = onClick), contentAlignment = Alignment.Center) {
        Icon(icon, label, tint = tint, modifier = Modifier.size(size.dp))
    }
}
