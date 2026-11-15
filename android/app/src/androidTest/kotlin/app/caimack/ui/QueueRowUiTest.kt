// SPDX-License-Identifier: AGPL-3.0-only
package app.caimack.ui

import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.test.SemanticsMatcher
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertIsNotEnabled
import androidx.compose.ui.test.assertIsSelected
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.test.platform.app.InstrumentationRegistry
import app.caimack.CaimackApp
import app.caimack.R
import app.caimack.api.Track
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test

class QueueRowUiTest {
    @get:Rule val compose = createComposeRule()
    private val context = InstrumentationRegistry.getInstrumentation().targetContext
    private val container get() = (context.applicationContext as CaimackApp).container
    private val track = Track("queue-row", "A long title with a distinct ending", "artist", "Artist", durationSeconds = 180)
    private var moved = 0
    private var removed = 0

    private fun show(editing: Boolean = false, playing: Boolean = false, canMoveUp: Boolean = true) {
        compose.setContent {
            CaimackTheme(dark = true) {
                CompositionLocalProvider(LocalContainer provides container) {
                    QueueRow(
                        track = track, current = true, playing = playing, editing = editing,
                        enabled = true, note = null, lifted = false, onPlay = {},
                        onRemove = { removed++ }, onMoveUp = if (canMoveUp) ({ moved++ }) else null,
                        onMoveDown = { moved-- }, handle = Modifier,
                    )
                }
            }
        }
    }

    @Test fun pausedCurrentTrackRemainsSelectedAndAnnouncesItsState() {
        show()
        compose.onNode(SemanticsMatcher.expectValue(SemanticsProperties.StateDescription, context.getString(R.string.queue_current_paused)))
            .assertIsSelected().assertIsDisplayed()
        compose.onNodeWithText(track.title).assertIsDisplayed()
    }

    @Test fun playingCurrentTrackAnnouncesPlayback() {
        show(playing = true)
        compose.onNode(SemanticsMatcher.expectValue(SemanticsProperties.StateDescription, context.getString(R.string.queue_current_playing)))
            .assertIsSelected().assertIsDisplayed()
    }

    @Test fun ordinaryModeOffersMoveWithoutDragging() {
        show()
        compose.onNodeWithContentDescription(context.getString(R.string.queue_reorder, track.title)).assertDoesNotExist()
        compose.onNodeWithContentDescription(context.getString(R.string.queue_more, track.title)).performClick()
        compose.onNodeWithText(context.getString(R.string.queue_move_up)).performClick()
        compose.runOnIdle { assertEquals(1, moved) }
    }

    @Test fun firstEntryCannotBeMovedAboveTheQueue() {
        show(canMoveUp = false)
        compose.onNodeWithContentDescription(context.getString(R.string.queue_more, track.title)).performClick()
        compose.onNodeWithText(context.getString(R.string.queue_move_up)).assertIsNotEnabled()
    }

    @Test fun editingRetainsRemoveAndDragActions() {
        show(editing = true)
        compose.onNodeWithContentDescription(context.getString(R.string.queue_reorder, track.title), useUnmergedTree = true).assertIsDisplayed()
        compose.onNodeWithContentDescription(context.getString(R.string.queue_remove, track.title)).performClick()
        compose.runOnIdle { assertEquals(1, removed) }
    }
}
