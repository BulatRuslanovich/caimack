// SPDX-License-Identifier: AGPL-3.0-only
package app.caimack.ui

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.tween
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.platform.testTag
import app.caimack.playback.PlayerState
import kotlin.math.abs
import kotlin.math.roundToInt

internal data class PlayerSceneFrame(val key: String, val state: PlayerState, val surface: PlayerBackdropSurface)
private enum class SceneMotion { Idle, Dragging, Awaiting, Returning, Changing }
internal val LocalPlayerSceneGesture = staticCompositionLocalOf<PlayerSceneGesture?> { null }

/** One clock and at most two frames for both the artwork and the fullscreen fill. */
@Stable
internal class PlayerScene(initial: PlayerSceneFrame) {
    var current by mutableStateOf(initial)
        private set
    var outgoing by mutableStateOf<PlayerSceneFrame?>(null)
        private set
    var preview by mutableStateOf<PlayerSceneFrame?>(null)
        private set
    var revision by mutableLongStateOf(0)
        private set
    var duration = PlayerBackdropSettings.transitionMs
    var distance by mutableIntStateOf(1)
    private var motion by mutableStateOf(SceneMotion.Idle)
    private var pending: PlayerSceneFrame? = null
    private var requestedKey = initial.key
    private var neighbours = emptyMap<Int, PlayerSceneFrame>()
    private var direction = 1
    private var previewDirection = 1
    private var drag by mutableFloatStateOf(0f)
    private var start = 0f
    private var started by mutableStateOf(false)
    private val offset = Animatable(0f)

    val isRunning get() = motion == SceneMotion.Changing || motion == SceneMotion.Returning
    val frames: List<PlayerSceneFrame> get() = listOfNotNull(outgoing, current, preview)
    private val shift: Float get() = if (isRunning) (if (started) offset.value else start) else drag

    fun position(key: String): Float = when {
        key == outgoing?.key -> shift - direction
        key == preview?.key -> shift + previewDirection
        else -> shift
    } * distance

    fun update(key: String, ready: PlayerSceneFrame?, neighbours: Map<Int, PlayerSceneFrame>) {
        requestedKey = key
        this.neighbours = neighbours
        if (motion == SceneMotion.Dragging || motion == SceneMotion.Awaiting)
            preview = preview?.let { old -> neighbours.values.firstOrNull { it.key == old.key } ?: old }
        if (ready == null) { pending = null; return }
        val sameTrack = ready.state.current?.id == current.state.current?.id
        val sameTrackAcknowledged = sameTrack && motion == SceneMotion.Awaiting && ready.state.index != current.state.index
        if (ready.key == current.key || (sameTrack && motion != SceneMotion.Dragging && (motion != SceneMotion.Awaiting || sameTrackAcknowledged))) {
            // Shuffle and radio can move the playing entry to another index.
            // Refresh its queue state without replacing or animating its scene.
            current = ready.copy(key = current.key)
            requestedKey = current.key
            pending = null
            if (sameTrackAcknowledged) finish()
        } else if (isRunning) {
            // Rapid skips replace the pending destination, never add a third moving layer.
            pending = ready
        } else begin(ready)
    }

    private fun begin(frame: PlayerSceneFrame) {
        val fromSwipe = preview?.key == frame.key
        direction = if (fromSwipe) previewDirection else sceneDirection(current.state, frame.state)
        start = direction + if (fromSwipe) drag else 0f
        outgoing = current
        current = frame
        preview = null
        pending = null
        drag = 0f
        started = false
        motion = SceneMotion.Changing
        revision++
        if (duration == 0) finish()
    }

    fun acceptsDrag(key: String) = current.key == key && (motion == SceneMotion.Idle || motion == SceneMotion.Dragging)
    fun sharedCover(key: String) = current.key == key && motion == SceneMotion.Idle

    fun drag(key: String, pixels: Float) {
        if (!acceptsDrag(key)) return
        motion = SceneMotion.Dragging
        drag = pixels / distance.coerceAtLeast(1)
        previewDirection = if (pixels < 0) 1 else -1
        val index = if (pixels < 0) current.state.nextIndex else current.state.previousIndex
        preview = neighbour(index)
        // Repeated occurrences of one song have the same artwork and colour.
        if (neighbours[index] != null && preview == null) drag = 0f
    }

    fun commit(key: String, index: Int) {
        if (current.key != key || motion != SceneMotion.Dragging) return
        preview = neighbour(index)
        motion = SceneMotion.Awaiting
    }

    private fun neighbour(index: Int) = neighbours[index]?.takeUnless { it.state.current?.id == current.state.current?.id }

    fun cancel(key: String, onlyUnacknowledged: Boolean = false) {
        if (current.key != key || (motion != SceneMotion.Dragging && motion != SceneMotion.Awaiting)) return
        if (onlyUnacknowledged && requestedKey != key) return
        start = drag
        started = false
        motion = SceneMotion.Returning
        revision++
        if (duration == 0) finish()
    }

    suspend fun animate() {
        if (!isRunning) return
        val token = revision
        offset.snapTo(start)
        started = true
        val milliseconds = if (motion == SceneMotion.Returning) minOf(duration, 220)
            else (duration * abs(start).coerceAtMost(1f)).roundToInt()
        offset.animateTo(0f, tween(milliseconds))
        if (revision == token) finish()
    }

    private fun finish() {
        outgoing = null
        preview = null
        drag = 0f
        motion = SceneMotion.Idle
        val next = pending?.takeIf { it.key == requestedKey && it.key != current.key }
        pending = null
        if (next != null) begin(next)
    }
}

internal class PlayerSceneGesture(private val scene: PlayerScene, private val key: String) {
    val acceptsDrag get() = scene.acceptsDrag(key)
    val sharedCover get() = scene.sharedCover(key)
    fun drag(pixels: Float) = scene.drag(key, pixels)
    fun commit(index: Int) = scene.commit(key, index)
    fun cancel() = scene.cancel(key)
    fun cancelUnacknowledged() = scene.cancel(key, onlyUnacknowledged = true)
}

private fun sceneKey(state: PlayerState) = "${state.index}:${state.current?.id}"
private fun sceneDirection(from: PlayerState, to: PlayerState): Int {
    if (to.index == from.previousIndex && to.index != from.nextIndex) return -1
    if (to.index == from.nextIndex) return 1
    if (to.queue.isNotEmpty() && to.index == (from.index + 1) % to.queue.size) return 1
    if (to.queue.isNotEmpty() && to.index == (from.index - 1 + to.queue.size) % to.queue.size) return -1
    return if (to.index < from.index) -1 else 1
}

@Composable
internal fun rememberPlayerScene(
    state: PlayerState,
    transitionMs: Int = PlayerBackdropSettings.transitionMs,
    distancePx: Int = LocalView.current.width,
    waitForTone: Boolean = true,
): PlayerScene {
    // Text-only transitions do not decode or sample adjacent artwork.
    val loaded = if (waitForTone) rememberLoadedPlayerTone(state.current?.let { trackCover(it) }) else null
    val nextTone = if (waitForTone) rememberLoadedPlayerTone(state.next?.let { trackCover(it) }) else null
    val previousTone = if (waitForTone) rememberLoadedPlayerTone(state.previous?.let { trackCover(it) }) else null
    val key = sceneKey(state)
    val scene = remember { PlayerScene(PlayerSceneFrame(key, state, playerBackdropSurface(loaded?.tone))) }
    val neighbours = buildMap {
        listOf(state.nextIndex to nextTone, state.previousIndex to previousTone).forEach { (index, tone) ->
            if (state.queue.getOrNull(index) != null && index != state.index) {
                val candidate = state.copy(index = index)
                put(index, PlayerSceneFrame(sceneKey(candidate), candidate, tone?.let { playerBackdropSurface(it.tone) } ?: scene.current.surface))
            }
        }
    }
    scene.duration = if (playerMotionEnabled()) transitionMs else 0
    scene.distance = distancePx.coerceAtLeast(1)
    val ready = loaded?.let { PlayerSceneFrame(key, state, playerBackdropSurface(it.tone)) }
        ?: (if (!waitForTone) PlayerSceneFrame(key, state, scene.current.surface) else null)
        ?: scene.current.takeIf { it.key == key }?.copy(state = state)
    scene.update(key, ready, neighbours)
    LaunchedEffect(scene, scene.revision, scene.duration) { scene.animate() }
    return scene
}

@Composable
internal fun PlayerSceneLayer(scene: PlayerScene, modifier: Modifier = Modifier, content: @Composable (PlayerSceneFrame) -> Unit) {
    Box(modifier.clipToBounds()) {
        scene.frames.forEach { frame -> key(frame.key) {
            val gesture = remember(scene, frame.key) { PlayerSceneGesture(scene, frame.key) }
            CompositionLocalProvider(LocalPlayerSceneGesture provides gesture) {
                Box(Modifier.fillMaxSize().graphicsLayer { translationX = scene.position(frame.key) }) { content(frame) }
            }
        } }
    }
}

@Composable
internal fun PlayerSceneBackground(scene: PlayerScene, modifier: Modifier) {
    Box(modifier.testTag("player-backdrop")) {
        // Edge resistance can expose a margin; retain the same fill beneath the moving scene.
        PlayerBackdropFill(scene.current.surface, Modifier.fillMaxSize())
        PlayerSceneLayer(scene, Modifier.fillMaxSize()) { frame ->
            PlayerBackdropFill(frame.surface, Modifier.fillMaxSize().testTag("player-background-frame-${frame.key}"))
        }
    }
}
