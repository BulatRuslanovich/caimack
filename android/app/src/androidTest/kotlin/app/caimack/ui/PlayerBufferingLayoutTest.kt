// SPDX-License-Identifier: AGPL-3.0-only
package app.caimack.ui

import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onAllNodesWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.test.platform.app.InstrumentationRegistry
import app.caimack.CaimackApp
import app.caimack.api.Track
import app.caimack.playback.PlayerState
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test

class PlayerBufferingLayoutTest {
    @get:Rule val compose = createComposeRule()

    @Test fun bufferingOverlayDoesNotMovePlayerContent() {
        val container = (InstrumentationRegistry.getInstrumentation().targetContext.applicationContext as CaimackApp).container
        val track = Track(id = "layout-check", title = "Buffering layout check", artistId = "layout", artistName = "Layout check", durationSeconds = 200)
        var state by mutableStateOf(PlayerState(queue = listOf(track)))
        compose.setContent {
            CaimackTheme {
                CompositionLocalProvider(LocalContainer provides container) { FullPlayer(state, onClose = {}) }
            }
        }
        val transport = compose.onNodeWithTag("full-player-transport")
        val title = compose.onNodeWithText(track.title)
        compose.waitForIdle()
        val transportBounds = transport.fetchSemanticsNode().boundsInRoot
        val titleBounds = title.fetchSemanticsNode().boundsInRoot
        val buttonBounds = transport.fetchSemanticsNode().children.map { it.boundsInRoot }
        for (playing in listOf(false, true)) {
            compose.runOnIdle { state = state.copy(buffering = true, playing = playing) }
            compose.waitUntil(5_000) { compose.onAllNodesWithTag("full-player-buffering").fetchSemanticsNodes().isNotEmpty() }
            compose.onNodeWithTag("full-player-buffering").assertIsDisplayed()
            assertEquals(transportBounds, transport.fetchSemanticsNode().boundsInRoot)
            assertEquals(titleBounds, title.fetchSemanticsNode().boundsInRoot)
            // Ignore the decorative progress node; all five control slots stay put.
            assertEquals(buttonBounds, transport.fetchSemanticsNode().children.filterNot { it.config.contains(androidx.compose.ui.semantics.SemanticsProperties.ProgressBarRangeInfo) }.map { it.boundsInRoot })
            compose.runOnIdle { state = state.copy(buffering = false, playing = false) }
            compose.waitForIdle()
            compose.onNodeWithTag("full-player-buffering").assertDoesNotExist()
            assertEquals(transportBounds, transport.fetchSemanticsNode().boundsInRoot)
        }
    }
}
