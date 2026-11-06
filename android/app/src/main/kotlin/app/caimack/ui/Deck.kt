// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

package app.caimack.ui

import android.view.HapticFeedbackConstants
import androidx.compose.foundation.Canvas
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.spring
import androidx.compose.animation.core.tween
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.gestures.awaitHorizontalTouchSlopOrCancellation
import androidx.compose.foundation.gestures.horizontalDrag
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.widthIn
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.runtime.withFrameNanos
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.repeatOnLifecycle
import kotlinx.coroutines.delay
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.input.pointer.positionChange
import androidx.compose.ui.input.pointer.util.VelocityTracker
import androidx.compose.ui.layout.LayoutCoordinates
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.dp
import app.caimack.api.Track
import app.caimack.playback.PlayerState
import kotlin.math.PI
import kotlin.math.abs
import kotlin.math.atan2
import kotlin.math.exp
import kotlin.math.floor
import kotlin.math.roundToInt
import kotlin.math.sign
import kotlinx.coroutines.launch

internal const val RECORD_OUT = 0.42f
internal const val CRATE_OUT = 0.46f
private const val BEAT_DECAY = 5.0

private const val SCRATCH_MS_PER_TURN = 10_000f

private const val GROOVE_DEGREES = 15f

private const val SWIPE_COMMIT = 0.25f

private const val SWIPE_RESISTANCE = 0.25f

private const val FLING_DP_PER_SECOND = 800
private const val SKIP_ACK_TIMEOUT_MS = 1_500L

@Composable
fun Deck(state: PlayerState, onScrub: (Long?) -> Unit, modifier: Modifier = Modifier) {
    val track = state.current ?: return
    // The new song and its neutral position must be installed in the same composition.
    // Resetting the old offset in an effect briefly puts the next neighbour in the centre.
    key(track.id, state.index) { TrackDeck(state, onScrub, modifier.testTag("player-deck")) }
}

@Composable
private fun TrackDeck(state: PlayerState, onScrub: (Long?) -> Unit, modifier: Modifier) {
    val track = state.current ?: return
    val player = LocalContainer.current.player
    val motion = playerMotionEnabled()
    val latestMotion by rememberUpdatedState(motion)
    val view = LocalView.current
    val scope = rememberCoroutineScope()
    val latest by rememberUpdatedState(state)
    val swipe = remember { Animatable(0f) }
    var swiping by remember { mutableStateOf(false) }
    var scratching by remember { mutableStateOf(false) }
    var twist by remember(track.id) { mutableFloatStateOf(0f) }
    val layout = remember { DeckLayout() }

    val tick = { view.performHapticFeedback(HapticFeedbackConstants.CLOCK_TICK) }

    Box(
        modifier
            .onGloballyPositioned { layout.deck = it }
            .pointerInput(Unit) {
                awaitEachGesture {
                    val down = awaitFirstDown()
                    if (swiping) return@awaitEachGesture
                    val sleeve = layout.sleeve() ?: return@awaitEachGesture
                    val gap = 24.dp.toPx()
                    val step = sleeve.width * (1 + RECORD_OUT) + gap
                    val disc = Rect(sleeve.right, sleeve.top, sleeve.right + sleeve.width * RECORD_OUT, sleeve.bottom)

                    if (latest.playing && disc.contains(down.position)) {
                        val center = Offset(sleeve.left + sleeve.width * (RECORD_OUT + 0.5f), sleeve.center.y)
                        fun angleOf(point: Offset) = atan2(point.y - center.y, point.x - center.x)

                        down.consume()
                        scratching = true
                        player.pause()
                        val length = latest.durationMs.takeIf { it > 0 } ?: (track.durationSeconds * 1000L)
                        var target = player.position.toFloat()
                        var last = angleOf(down.position)
                        var groove = 0f
                        onScrub(target.toLong())

                        while (true) {
                            val change = awaitPointerEvent().changes.firstOrNull { it.id == down.id } ?: break
                            if (!change.pressed) break
                            change.consume()

                            val angle = angleOf(change.position)
                            var delta = angle - last
                            if (delta > PI) delta -= (2 * PI).toFloat()
                            if (delta < -PI) delta += (2 * PI).toFloat()
                            last = angle

                            val degrees = Math.toDegrees(delta.toDouble()).toFloat()
                            twist += degrees
                            groove += abs(degrees)
                            if (groove >= GROOVE_DEGREES) {
                                groove %= GROOVE_DEGREES
                                tick()
                            }
                            target = (target + degrees / 360f * SCRATCH_MS_PER_TURN).coerceIn(0f, length.toFloat())
                            onScrub(target.toLong())
                        }

                        player.seekTo(target.toLong())
                        player.resume()
                        scratching = false
                        onScrub(null)
                        return@awaitEachGesture
                    }

                    val velocity = VelocityTracker().apply { addPosition(down.uptimeMillis, down.position) }
                    var dragged = 0f
                    val start = awaitHorizontalTouchSlopOrCancellation(down.id) { change, over ->
                        change.consume()
                        dragged = over
                    } ?: return@awaitEachGesture

                    fun neighbour(towards: Float): Track? = if (towards < 0) latest.next else latest.previous
                    fun shown(distance: Float) = if (neighbour(distance) == null) distance * SWIPE_RESISTANCE else distance
                    fun committing(distance: Float) = neighbour(distance) != null && abs(distance) > sleeve.width * SWIPE_COMMIT

                    swiping = true
                    var armed = committing(dragged)
                    scope.launch { swipe.snapTo(shown(dragged)) }

                    val released = horizontalDrag(start.id) { change ->
                        dragged += change.positionChange().x
                        change.consume()
                        velocity.addPosition(change.uptimeMillis, change.position)
                        if (committing(dragged) != armed) {
                            armed = !armed
                            tick()
                        }
                        scope.launch { swipe.snapTo(shown(dragged)) }
                    }

                    val speed = velocity.calculateVelocity().x
                    val flung = abs(speed) > FLING_DP_PER_SECOND.dp.toPx() && sign(speed) == sign(dragged)
                    val toNext = dragged < 0
                    val index = if (toNext) latest.nextIndex else latest.previousIndex
                    val commit = released && neighbour(dragged) != null && (armed || flung)

                    scope.launch {
                        if (commit) {
                            if (latestMotion) swipe.animateTo(if (toNext) -step else step, tween(220)) else swipe.snapTo(if (toNext) -step else step)
                            player.skipTo(index)
                            // Keep the incoming sleeve in place until the player acknowledges
                            // the new song. The keyed deck then replaces both art and offset.
                            if (index != latest.index) delay(SKIP_ACK_TIMEOUT_MS)
                            // A failed command (or repeating the same queue item) must not
                            // leave the deck outside its resting position indefinitely.
                            if (latestMotion) swipe.animateTo(0f, spring()) else swipe.snapTo(0f)
                            swiping = false
                        } else {
                            if (latestMotion) swipe.animateTo(0f, spring()) else swipe.snapTo(0f)
                            swiping = false
                        }
                    }
                }
            },
        contentAlignment = Alignment.Center,
    ) {
        Box(
            Modifier
                .fillMaxWidth(0.68f)
                .widthIn(max = 300.dp)
                .offset(x = (-48).dp)
                .aspectRatio(1f)
                .testTag("player-record")
                .onGloballyPositioned { layout.record = it },
        ) {
            val offset = swipe.value
            if (offset != 0f) {
                val gap = with(LocalDensity.current) { 24.dp.toPx() }
                val step = (layout.record?.size?.width ?: 0) * (1 + RECORD_OUT) + gap
                state.previous?.takeIf { offset > 0 }?.let { Neighbour(it, offset - step) }
                state.next?.takeIf { offset < 0 }?.let { Neighbour(it, offset + step) }
            }

            BeatGlow(track, state.playing && !state.buffering, Modifier.fillMaxSize().offset { IntOffset(swipe.value.roundToInt(), 0) })

            Record(
                track,
                spinning = state.playing && !state.buffering,
                out = (state.playing || scratching) && !swiping,
                twist = twist,
                modifier = Modifier.fillMaxSize().offset { IntOffset(swipe.value.roundToInt(), 0) },
                jacket = Modifier.nowPlayingCover(LocalFullPlayerVisibility.current),
            )
        }
    }
}

@Composable
private fun BeatGlow(track: Track, playing: Boolean, modifier: Modifier) {
    val player = LocalContainer.current.player
    val palette = LocalPalette.current
    val tone = LocalNowPlayingTone.current
    val light = if (tone.alpha > 0f) tone.copy(alpha = 1f) else palette.primary
    val lifecycle = LocalLifecycleOwner.current.lifecycle
    val bpm = track.cues?.bpm
    var pulse by remember(track.id) { mutableFloatStateOf(0f) }
    var phase by remember { mutableFloatStateOf(0f) }
    val still = !playerMotionEnabled()
    val opacity by animateFloatAsState(if (playing && !still) 1f else 0f, tween(if (still) 0 else 500), label = "record-aura")

    LaunchedEffect(track.id, playing, bpm, still, lifecycle) {
        if (!playing || still) return@LaunchedEffect
        lifecycle.repeatOnLifecycle(Lifecycle.State.RESUMED) {
            var origin = 0L
            while (true) {
                withFrameNanos { time ->
                    if (origin == 0L) origin = time
                    phase = ((time - origin) / 1_000_000_000.0 % 120).toFloat()
                    pulse = if (bpm != null && bpm > 0) {
                        val beats = player.position / 1000.0 * bpm / 60.0
                        exp(-(beats - floor(beats)) * BEAT_DECAY).toFloat()
                    } else 0f
                }
                delay(32)
            }
        }
    }

    Canvas(modifier) {
        if (opacity < 0.01f) return@Canvas
        val centre = Offset(size.width * (RECORD_OUT + 0.5f), size.height / 2)
        val disc = size.width * 0.5f
        val radius = disc * (1.6f + 0.1f * pulse)
        drawCircle(Brush.radialGradient(listOf(light.copy(alpha = opacity * (0.07f + 0.035f * pulse)),
            Color.Transparent), centre, radius), radius, centre)
        // Slow broken orbits; the wider bass arc follows the track BPM when available.
        repeat(3) { ring ->
            val r = disc * (1.12f + ring * 0.15f + pulse * 0.025f)
            val direction = if (ring == 1) -1 else 1
            val start = phase * (2.5f + ring) * direction + ring * 108f
            repeat(2) { segment ->
                drawArc(light.copy(alpha = opacity * (0.16f - ring * 0.03f)), start + segment * 180f,
                    64f + ring * 12f, false, Offset(centre.x - r, centre.y - r), Size(r * 2, r * 2),
                    style = Stroke((0.8f + (2 - ring) * 0.25f).dp.toPx(), cap = androidx.compose.ui.graphics.StrokeCap.Round))
            }
        }
        if (pulse > 0.02f) {
            val r = disc * (1.08f + (1 - pulse) * 0.48f)
            drawArc(light.copy(alpha = opacity * pulse * 0.15f), -58f, 116f, false,
                Offset(centre.x - r, centre.y - r), Size(r * 2, r * 2), style = Stroke(2.dp.toPx()))
        }
        repeat(3) { glint ->
            val angle = (phase * (3.0 + glint) + glint * 123) * Math.PI / 180
            val r = disc * (1.15f + glint * 0.12f)
            val shimmer = (0.5 + 0.5 * kotlin.math.sin(phase * 0.8 + glint * 2)).toFloat()
            drawCircle(light.copy(alpha = opacity * shimmer * 0.35f), (0.8f + shimmer * 0.5f).dp.toPx(),
                centre + Offset(kotlin.math.cos(angle).toFloat() * r, kotlin.math.sin(angle).toFloat() * r))
        }
    }
}

@Composable
private fun Neighbour(track: Track, x: Float) {
    Cover(
        trackCover(track, small = false),
        track.albumTitle ?: track.title,
        Modifier.fillMaxSize().offset { IntOffset(x.roundToInt(), 0) }.shadow(18.dp, Radius.cover),
        fadeIn = false,
    )
}

private class DeckLayout {
    var deck: LayoutCoordinates? = null
    var record: LayoutCoordinates? = null

    fun sleeve(): Rect? {
        val deck = deck?.takeIf { it.isAttached } ?: return null
        val record = record?.takeIf { it.isAttached } ?: return null
        return deck.localBoundingBoxOf(record, clipBounds = false)
    }
}
