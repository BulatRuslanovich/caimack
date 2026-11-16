// SPDX-License-Identifier: AGPL-3.0-only
package app.caimack.ui

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.test.platform.app.InstrumentationRegistry
import app.caimack.CaimackApp
import app.caimack.R
import app.caimack.api.ConnectCommand
import app.caimack.api.Track
import app.caimack.playback.PlayerState
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test

class MiniPlayerGestureTest {
    @get:Rule val compose = createComposeRule()
    private val context = InstrumentationRegistry.getInstrumentation().targetContext
    private val container get() = (context.applicationContext as CaimackApp).container
    private val queue = listOf("first", "second", "third").map {
        Track(it, it, "artist", "Artist", durationSeconds = 180)
    }
    private var state by mutableStateOf(PlayerState())
    private val jumps = mutableListOf<Int>()
    private var opened = 0
    private fun stateAt(index: Int) = PlayerState(queue = queue, index = index,
        nextIndex = (index + 1) % queue.size, previousIndex = (index - 1 + queue.size) % queue.size)

    private fun withPlayer(test: () -> Unit) {
        check(context.packageName.endsWith(".uitest"))
        val player = container.player
        val oldRoute = player.remoteRoute
        val oldSelected = player.remoteSelected
        val oldEffects = container.appearance.playerEffects.value
        container.appearance.setPlayerEffects(true)
        state = stateAt(0)
        player.showRemote(state) { 0 }
        player.remoteSelected = { true }
        player.remoteRoute = { command ->
            when (command) {
                is ConnectCommand.Jump -> { jumps += command.index; state = stateAt(command.index) }
                is ConnectCommand.SetPlaying -> state = state.copy(playing = command.playing)
                else -> Unit
            }
            player.showRemote(state) { 0 }
            true
        }
        compose.setContent {
            CaimackTheme(dark = true, colorway = Colorway.Graphite) {
                CompositionLocalProvider(LocalContainer provides container) {
                    Box(Modifier.fillMaxSize(), contentAlignment = Alignment.BottomCenter) {
                        MiniPlayer(state) { opened++ }
                    }
                }
            }
        }
        compose.waitForIdle()
        compose.mainClock.autoAdvance = false
        try { test() } finally {
            compose.mainClock.autoAdvance = true
            compose.waitForIdle()
            player.remoteRoute = oldRoute
            player.remoteSelected = oldSelected
            player.showLocal()
            container.appearance.setPlayerEffects(oldEffects)
        }
    }

    private fun x(key: String) = compose.onNodeWithTag("mini-track-$key", useUnmergedTree = true).fetchSemanticsNode().positionInRoot.x

    @Test fun dragHandsItsPositionToIncomingTextAndKeepsCoverAndButtonsStill() = withPlayer {
        val resting = x("0:first")
        val controls = compose.onNodeWithTag("mini-player-controls", useUnmergedTree = true).fetchSemanticsNode().boundsInRoot
        val cover = compose.onNodeWithTag("mini-player-cover").fetchSemanticsNode().boundsInRoot
        val width = compose.onNodeWithTag("mini-player-tracks", useUnmergedTree = true).fetchSemanticsNode().boundsInRoot.width
        compose.onNodeWithTag("mini-player").performTouchInput {
            down(center)
            advanceEventTime(300)
            moveBy(Offset(-width * 0.7f, 0f))
        }
        compose.mainClock.advanceTimeByFrame()
        val dragged = x("0:first")
        assertTrue("The text should follow the drag: $resting -> $dragged", dragged < resting - 20)
        assertTrue(x("1:second") > resting)
        assertEquals(controls, compose.onNodeWithTag("mini-player-controls", useUnmergedTree = true).fetchSemanticsNode().boundsInRoot)
        assertEquals(cover, compose.onNodeWithTag("mini-player-cover").fetchSemanticsNode().boundsInRoot)
        compose.onNodeWithTag("mini-player").performTouchInput { up() }
        compose.mainClock.advanceTimeByFrame()
        assertEquals(listOf(1), jumps)
        assertEquals(dragged, x("0:first"), 2f)
        var previous = x("1:second")
        repeat(6) {
            compose.mainClock.advanceTimeBy(60)
            val current = x("1:second")
            assertTrue("The incoming track must not restart its slide", current <= previous + 0.5f)
            previous = current
            assertEquals(controls, compose.onNodeWithTag("mini-player-controls", useUnmergedTree = true).fetchSemanticsNode().boundsInRoot)
            assertEquals(cover, compose.onNodeWithTag("mini-player-cover").fetchSemanticsNode().boundsInRoot)
        }
        assertEquals(resting, x("1:second"), 0.5f)
        compose.onNodeWithTag("mini-track-0:first", useUnmergedTree = true).assertDoesNotExist()
        assertEquals(0, opened)
    }

    @Test fun aShortSwipeHeldBeforeReleaseReturnsWithoutChangingTheTrack() = withPlayer {
        val resting = x("0:first")
        val width = compose.onNodeWithTag("mini-player-tracks", useUnmergedTree = true).fetchSemanticsNode().boundsInRoot.width
        compose.onNodeWithTag("mini-player").performTouchInput {
            down(center)
            moveBy(Offset(-width * 0.16f, 0f))
            advanceEventTime(500)
        }
        compose.mainClock.advanceTimeByFrame()
        assertTrue("The text should move before the cancelled release", x("0:first") < resting)
        compose.onNodeWithTag("mini-player").performTouchInput { up() }
        compose.mainClock.advanceTimeBy(300)
        assertTrue(jumps.isEmpty())
        assertEquals(resting, x("0:first"), 0.5f)
        compose.onNodeWithTag("mini-track-1:second", useUnmergedTree = true).assertDoesNotExist()
    }

    @Test fun repeatedSwipesFollowTheWholeQueueInBothDirectionsAndPlayPauseStillWorks() = withPlayer {
        repeat(3) {
            compose.onNodeWithTag("mini-player").performTouchInput { swipeLeft(durationMillis = 350) }
            compose.mainClock.advanceTimeBy(600)
        }
        repeat(3) {
            compose.onNodeWithTag("mini-player").performTouchInput { swipeRight(durationMillis = 350) }
            compose.mainClock.advanceTimeBy(600)
        }
        assertEquals(listOf(1, 2, 0, 2, 1, 0), jumps)
        compose.onNodeWithContentDescription(context.getString(R.string.action_play)).performClick()
        compose.mainClock.advanceTimeByFrame()
        compose.runOnIdle { assertTrue(state.playing) }
        compose.onNodeWithContentDescription(context.getString(R.string.action_pause)).performClick()
        compose.mainClock.advanceTimeByFrame()
        compose.runOnIdle { assertFalse(state.playing) }
        compose.onNodeWithContentDescription(context.getString(R.string.player_next)).assertDoesNotExist()
        assertEquals(0, opened)
    }
}
