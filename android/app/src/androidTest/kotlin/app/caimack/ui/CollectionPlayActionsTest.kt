// SPDX-License-Identifier: AGPL-3.0-only
package app.caimack.ui

import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.performClick
import androidx.test.platform.app.InstrumentationRegistry
import app.caimack.AppContainer
import app.caimack.CaimackApp
import app.caimack.R
import app.caimack.api.ConnectCommand
import app.caimack.api.Track
import app.caimack.playback.PlayerState
import org.junit.After
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test

class CollectionPlayActionsTest {
    @get:Rule val compose = createComposeRule()
    private lateinit var container: AppContainer
    private var previousRoute: ((ConnectCommand) -> Boolean)? = null
    private val tracks = listOf("a", "b", "c").map { Track(it, it, "artist", "Artist", durationSeconds = 180) }
    private var state = PlayerState()
    private var starts = 0
    private val context get() = InstrumentationRegistry.getInstrumentation().targetContext
    private val playLabel get() = context.getString(R.string.action_play)
    private val pauseLabel get() = context.getString(R.string.action_pause)

    private fun publish(next: PlayerState) {
        state = next
        container.player.showRemote(state) { 1_337 }
    }

    private fun show(initial: PlayerState = PlayerState()) {
        container = (context.applicationContext as CaimackApp).container
        previousRoute = container.player.remoteRoute
        container.player.remoteRoute = { command ->
            if (command is ConnectCommand.SetPlaying) publish(state.copy(playing = command.playing))
            true
        }
        publish(initial)
        compose.setContent {
            CaimackTheme {
                CompositionLocalProvider(LocalContainer provides container) {
                    PlayActions(trackIds = tracks.map { it.id }) {
                        starts++
                        publish(PlayerState(queue = listOf(tracks[1], tracks[2], tracks[0]), playing = true))
                    }
                }
            }
        }
    }

    @After fun resetPlayer() {
        if (::container.isInitialized) compose.runOnIdle {
            container.player.remoteRoute = previousRoute
            container.player.showLocal()
        }
    }

    @Test fun repeatedClicksPauseAndResumeTheShuffledCollectionWithoutRestartingIt() {
        show()
        compose.onNodeWithContentDescription(playLabel).performClick()
        compose.onNodeWithContentDescription(pauseLabel).assertIsDisplayed().performClick()
        compose.runOnIdle { assertFalse(state.playing); assertEquals(1, starts) }
        compose.onNodeWithContentDescription(playLabel).assertIsDisplayed().performClick()
        compose.onNodeWithContentDescription(pauseLabel).assertIsDisplayed()
        compose.runOnIdle {
            assertTrue(state.playing)
            assertEquals(1, starts)
            assertEquals(listOf("b", "c", "a"), state.queue.map { it.id })
            assertEquals(1_337L, container.player.position)
        }
    }

    @Test fun externalPauseUpdatesTheCollectionIconAndTheButtonResumesIt() {
        show(PlayerState(queue = tracks.reversed(), index = 1, playing = true))
        compose.onNodeWithContentDescription(pauseLabel).assertIsDisplayed()
        compose.runOnIdle { publish(state.copy(playing = false)) }
        compose.onNodeWithContentDescription(playLabel).assertIsDisplayed().performClick()
        compose.onNodeWithContentDescription(pauseLabel).assertIsDisplayed()
        compose.runOnIdle { assertEquals(0, starts); assertEquals(1, state.index) }
    }

    @Test fun anotherCollectionWithASharedSongStartsInsteadOfPausing() {
        val other = tracks.toMutableList().apply { this[2] = tracks[2].copy(id = "other") }
        show(PlayerState(queue = other, playing = true))
        compose.onNodeWithContentDescription(playLabel).assertIsDisplayed().performClick()
        compose.onNodeWithContentDescription(pauseLabel).assertIsDisplayed()
        compose.runOnIdle { assertEquals(1, starts); assertEquals(listOf("b", "c", "a"), state.queue.map { it.id }) }
    }
}
