// SPDX-License-Identifier: AGPL-3.0-only
package app.caimack.ui

import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.SizeTransform
import androidx.compose.animation.core.Transition
import androidx.compose.animation.core.tween
import androidx.compose.animation.core.updateTransition
import androidx.compose.animation.slideInHorizontally
import androidx.compose.animation.slideOutHorizontally
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.platform.testTag
import app.caimack.playback.PlayerState

internal data class PlayerSceneFrame(val key: String, val state: PlayerState, val surface: PlayerBackdropSurface)
internal class PlayerScene(val transition: Transition<PlayerSceneFrame>, val direction: Int, val duration: Int, val distance: Int)

@Composable
internal fun rememberPlayerScene(state: PlayerState): PlayerScene {
    val track = state.current
    val loaded = rememberLoadedPlayerTone(track?.let { trackCover(it) })
    val colors = remember(loaded) { playerBackdropSurface(loaded?.tone) }
    val key = "${state.index}:${track?.id}"
    var shown by remember { mutableStateOf(PlayerSceneFrame(key, state, colors)) }
    var direction by remember { mutableIntStateOf(1) }
    // Initial colour arrival updates the same content key, so opening never slides.
    // During a track change keep the old scene until its replacement colour is ready.
    if (loaded != null || shown.key == key) {
        if (shown.key != key) {
            direction = if (state.queue.isNotEmpty() && state.index == (shown.state.index + 1) % state.queue.size) 1 else if (state.index < shown.state.index) -1 else 1
        }
        val next = PlayerSceneFrame(key, state, if (loaded != null) colors else shown.surface)
        if (next != shown) shown = next
    }
    return PlayerScene(updateTransition(shown, label = "player-scene"), direction,
        if (playerMotionEnabled()) PlayerBackdropSettings.transitionMs else 0, LocalView.current.width)
}

@Composable
internal fun PlayerSceneLayer(scene: PlayerScene, modifier: Modifier = Modifier, content: @Composable (PlayerSceneFrame) -> Unit) {
    scene.transition.AnimatedContent(
        modifier = modifier.clipToBounds(),
        contentKey = { it.key },
        transitionSpec = {
            val spec = tween<androidx.compose.ui.unit.IntOffset>(scene.duration)
            (slideInHorizontally(spec) { scene.distance * scene.direction } togetherWith
                slideOutHorizontally(spec) { -scene.distance * scene.direction }).using(SizeTransform(clip = false))
        },
    ) { frame -> content(frame) }
}

@Composable
internal fun PlayerSceneBackground(scene: PlayerScene, modifier: Modifier) {
    PlayerSceneLayer(scene, modifier.testTag("player-backdrop")) { frame ->
        PlayerBackdropFill(frame.surface, Modifier.fillMaxSize().testTag("player-background-frame-${frame.key}"))
    }
}
