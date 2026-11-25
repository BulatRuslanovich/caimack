// SPDX-License-Identifier: AGPL-3.0-only
package app.caimack.ui

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.heightIn
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.test.assertCountEquals
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.onRoot
import androidx.compose.ui.test.performTouchInput
import androidx.compose.ui.test.swipe
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.test.platform.app.InstrumentationRegistry
import app.caimack.CaimackApp
import app.caimack.R
import app.caimack.api.ConnectCommand
import app.caimack.api.Track
import app.caimack.playback.PlayerState
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test

class QueueGesturesUiTest {
    @get:Rule val compose = createComposeRule()
    private val commands = mutableListOf<ConnectCommand>()
    private val queue = listOf("Current", "First", "Second", "Third").map {
        Track(it, it, "artist", "Artist", durationSeconds = 180)
    }
    private var state by mutableStateOf(PlayerState(queue))

    private fun withQueue(maxHeight: Dp = Dp.Unspecified, test: () -> Unit) {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        check(context.packageName.endsWith(".uitest"))
        val container = (context.applicationContext as CaimackApp).container
        val player = container.player
        val oldRoute = player.remoteRoute
        val oldSelected = player.remoteSelected
        try {
            compose.runOnUiThread {
                player.showRemote(state) { 0 }
                player.remoteSelected = { true }
                player.remoteRoute = { command ->
                    commands += command
                    state = state.copy(queue = state.queue.toMutableList().apply {
                        when (command) {
                            is ConnectCommand.Enqueue -> add(state.index + 1, queue.first { it.id == command.trackId })
                            is ConnectCommand.Remove -> removeAt(command.index)
                            is ConnectCommand.Move -> add(command.to, removeAt(command.from))
                            else -> Unit
                        }
                    })
                    player.showRemote(state) { 0 }
                    true
                }
            }
            compose.setContent {
                CaimackTheme {
                    CompositionLocalProvider(LocalContainer provides container) {
                        Box(Modifier.heightIn(max = maxHeight)) {
                            QueuePanel(state) { _, _ -> }
                        }
                    }
                }
            }
            test()
        } finally {
            compose.runOnUiThread {
                player.remoteRoute = oldRoute
                player.remoteSelected = oldSelected
                player.showLocal()
            }
        }
    }

    private fun position(title: String) =
        compose.onNodeWithText(title).fetchSemanticsNode().boundsInRoot.center

    private fun swipeRow(title: String, fraction: Float) {
        val root = compose.onRoot()
        val bounds = root.fetchSemanticsNode().boundsInRoot
        val start = Offset(bounds.width / 2f, position(title).y - bounds.top)
        root.performTouchInput {
            swipe(start, start + Offset(bounds.width * fraction, 0f), durationMillis = 280)
        }
    }

    @Test fun shortSwipeCancelsAndRightThenLeftEditOnlyTheSwipedOccurrence() = withQueue {
        val resting = position("Third")
        swipeRow("Third", -0.12f)
        assertEquals(resting, position("Third"))
        swipeRow("Current", -0.40f)
        compose.runOnIdle { assertTrue("Unexpected queue commands: $commands", commands.isEmpty()) }

        swipeRow("Second", 0.40f)
        compose.onAllNodesWithText("Second").assertCountEquals(2)
        compose.runOnIdle {
            assertEquals(listOf(ConnectCommand.Enqueue("Second", next = true)), commands)
            assertEquals(listOf("Current", "Second", "First", "Second", "Third"), state.queue.map { it.id })
        }

        val duplicate = compose.onAllNodesWithText("Second")[0].fetchSemanticsNode().boundsInRoot.center
        val root = compose.onRoot()
        val bounds = root.fetchSemanticsNode().boundsInRoot
        root.performTouchInput {
            val start = Offset(bounds.width / 2f, duplicate.y - bounds.top)
            swipe(start, start - Offset(bounds.width * 0.40f, 0f), durationMillis = 280)
        }
        compose.onAllNodesWithText("Second").assertCountEquals(1)
        compose.runOnIdle {
            assertEquals(ConnectCommand.Remove(1, "Second"), commands.last())
            assertEquals(queue, state.queue)
        }
    }

    @Test fun holdingTheTrackBodyReordersAndTheReleaseDoesNotPlayIt() = withQueue {
        val root = compose.onRoot()
        val origin = root.fetchSemanticsNode().boundsInRoot.topLeft
        val start = position("Third") - origin
        val destination = position("First") - origin
        compose.mainClock.autoAdvance = false
        try {
            root.performTouchInput {
                down(start)
                advanceEventTime(650)
                moveTo(start)
            }
            compose.mainClock.advanceTimeBy(650)
            root.performTouchInput {
                moveTo(destination, delayMillis = 120)
                up()
            }
        } finally {
            compose.mainClock.autoAdvance = true
        }
        compose.runOnIdle {
            assertEquals(listOf(ConnectCommand.Move(3, 1, "Third")), commands)
            assertEquals(listOf("Current", "Third", "First", "Second"), state.queue.map { it.id })
        }
    }

    @Test fun holdingStillDoesNotPlayAndDraggingFromTheOverflowDoesNotReorder() = withQueue {
        val root = compose.onRoot()
        val origin = root.fetchSemanticsNode().boundsInRoot.topLeft
        val start = position("Third") - origin
        val destination = position("First") - origin
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val overflow = compose.onNodeWithContentDescription(context.getString(R.string.queue_more, "Third"))
            .fetchSemanticsNode().boundsInRoot.center - origin
        compose.mainClock.autoAdvance = false
        try {
            root.performTouchInput { down(start); advanceEventTime(650); moveTo(start) }
            compose.mainClock.advanceTimeBy(650)
            root.performTouchInput { up() }
            compose.mainClock.advanceTimeByFrame()
            root.performTouchInput { down(overflow); advanceEventTime(650); moveTo(overflow) }
            compose.mainClock.advanceTimeBy(650)
            root.performTouchInput { moveTo(Offset(overflow.x, destination.y)); up() }
        } finally {
            compose.mainClock.autoAdvance = true
        }
        compose.runOnIdle { assertTrue("Unexpected queue commands: $commands", commands.isEmpty()) }
    }

    @Test fun diagonalScrollCanStartOnTheCurrentTrack() = withQueue(maxHeight = 230.dp) {
        val root = compose.onRoot()
        val bounds = root.fetchSemanticsNode().boundsInRoot
        val before = position("First").y
        val start = Offset(bounds.width / 2, position("Current").y - bounds.top)
        root.performTouchInput {
            swipe(start, start + Offset(bounds.width * 0.35f, -start.y * 0.8f))
        }
        assertTrue(position("First").y < before)
        compose.runOnIdle { assertTrue("Unexpected queue commands: $commands", commands.isEmpty()) }
    }
}
