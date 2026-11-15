// SPDX-License-Identifier: AGPL-3.0-only
package app.caimack.ui

import androidx.compose.foundation.gestures.detectDragGestures
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyListState
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.material3.Text
import androidx.compose.runtime.getValue
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.unit.dp
import androidx.compose.ui.zIndex
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import app.caimack.api.Track
import kotlinx.coroutines.delay

class QueueDragUiTest {
    @get:Rule val compose = createComposeRule()
    private lateinit var list: LazyListState
    private lateinit var drag: QueueDragState
    private var order by mutableStateOf((0 until 60).toList())
    private var finished: Int? = null

    private fun show(initial: Int) {
        compose.setContent {
            CaimackTheme {
                list = rememberLazyListState(initialFirstVisibleItemIndex = initial)
                drag = rememberQueueDragState(list) { from, to ->
                    order = order.toMutableList().apply { add(indexOf(to), removeAt(indexOf(from))) }
                }
                LazyColumn(Modifier.height(360.dp).testTag("queue-scroll"), state = list) {
                    items(order, key = { it }) { key ->
                        Row(Modifier.fillMaxWidth().height(60.dp).testTag("queue-row:$key")
                            .zIndex(if (drag.dragged == key) 1f else 0f)
                            .graphicsLayer { translationY = drag.translation(key) }) {
                            Text("Track $key", Modifier.weight(1f))
                            Box(Modifier.size(48.dp).testTag("queue-handle:$key").pointerInput(key) {
                                detectDragGestures(
                                    onDragStart = { drag.start(key) },
                                    onDragEnd = { finished = drag.finish() },
                                    onDragCancel = { drag.finish() },
                                ) { change, amount -> change.consume(); drag.dragBy(amount.y) }
                            })
                        }
                    }
                }
            }
        }
        compose.waitForIdle()
    }

    private fun holdAtEdge(key: Int, top: Boolean) {
        val root = compose.onNodeWithTag("queue-scroll").fetchSemanticsNode().boundsInRoot
        val handle = compose.onNodeWithTag("queue-handle:$key").fetchSemanticsNode().boundsInRoot
        val edge = Offset(handle.center.x, if (top) root.top + 2f else root.bottom - 2f)
        compose.mainClock.autoAdvance = false
        compose.onNodeWithTag("queue-handle:$key").performTouchInput {
            down(center)
            moveBy(Offset(0f, if (top) -30f else 30f), delayMillis = 100)
        }
        compose.mainClock.advanceTimeBy(32)
        compose.onNodeWithTag("queue-scroll").performTouchInput { moveTo(edge - root.topLeft, delayMillis = 100) }
        compose.mainClock.advanceTimeBy(14_000)
    }

    @Test fun holdingAtTopScrollsAndMovesTrackToStartWithoutMorePointerMoves() {
        show(initial = 30)
        holdAtEdge(33, top = true)
        compose.runOnIdle {
            assertEquals(0, list.firstVisibleItemIndex)
            assertEquals(33, order.first())
            assertEquals(33, drag.dragged)
        }
        compose.onNodeWithTag("queue-scroll").performTouchInput { up() }
        compose.mainClock.autoAdvance = true
        compose.waitForIdle()
        compose.runOnIdle { assertEquals(33, finished); assertNull(drag.dragged) }
    }

    @Test fun holdingAtBottomScrollsToEndAndCancelStopsScrolling() {
        show(initial = 0)
        holdAtEdge(2, top = false)
        compose.runOnIdle {
            assertFalse(list.canScrollForward)
            assertEquals(2, order.last())
        }
        compose.onNodeWithTag("queue-scroll").performTouchInput { cancel() }
        val offset = compose.runOnIdle { list.firstVisibleItemIndex to list.firstVisibleItemScrollOffset }
        compose.mainClock.advanceTimeBy(500)
        compose.runOnIdle {
            assertNull(drag.dragged)
            assertEquals(offset, list.firstVisibleItemIndex to list.firstVisibleItemScrollOffset)
            assertNull(finished)
        }
        compose.mainClock.autoAdvance = true
    }

    @Test fun releasedRowDoesNotFlyBackWhileWaitingForThePlayerOrAfterAcknowledgement() {
        var source by mutableStateOf((0 until 60).map {
            Track("track-$it", "Track $it", "artist", "Artist", durationSeconds = 180)
        })
        lateinit var ordering: QueueOrderState
        compose.setContent {
            CaimackTheme {
                ordering = remember { QueueOrderState(source) }
                ordering.sync(source)
                list = rememberLazyListState(initialFirstVisibleItemIndex = 30)
                drag = rememberQueueDragState(list, ordering::move)
                LaunchedEffect(ordering.pending) {
                    if (ordering.pending != null) {
                        delay(500)
                        source = ordering.entries.map { it.track }
                    }
                }
                LazyColumn(Modifier.height(360.dp).testTag("queue-scroll"), state = list) {
                    items(ordering.entries, key = { it.key }) { entry ->
                        val key = entry.key
                        val held = drag.dragged == key
                        Row((if (held || drag.landed == key) Modifier.graphicsLayer { translationY = drag.translation(key) } else Modifier.animateItem())
                            .fillMaxWidth().height(60.dp).testTag("queue-row:$key")
                            .zIndex(if (held) 1f else 0f)) {
                            Text(entry.track.title, Modifier.weight(1f))
                            Box(Modifier.size(48.dp).testTag("queue-handle:$key").pointerInput(key, ordering.pending) {
                                if (ordering.pending != null) return@pointerInput
                                detectDragGestures(
                                    onDragStart = { drag.start(key) },
                                    onDragEnd = { drag.finish()?.let { ordering.commit(it) } },
                                    onDragCancel = { drag.cancel(); ordering.cancel() },
                                ) { change, amount -> change.consume(); drag.dragBy(amount.y) }
                            })
                        }
                    }
                }
            }
        }
        compose.waitForIdle()
        holdAtEdge(33, top = true)
        val viewport = compose.onNodeWithTag("queue-scroll").fetchSemanticsNode().boundsInRoot
        compose.onNodeWithTag("queue-scroll").performTouchInput { up() }
        // Check every few frames throughout the delayed reply, not just the
        // final order after the row has had time to jump back and return.
        repeat(45) {
            compose.mainClock.advanceTimeBy(16)
            val bounds = compose.onNodeWithTag("queue-row:33").fetchSemanticsNode().boundsInRoot
            assertEquals("The dropped row must stay at the top on frame $it", viewport.top, bounds.top, 2f)
            compose.runOnIdle { assertEquals(33, ordering.entries.first().key) }
        }
        compose.runOnIdle {
            assertNull(ordering.pending)
            assertEquals("track-33", source.first().id)
            assertEquals(0, ordering.sourceIndex(33))
        }
        compose.mainClock.autoAdvance = true
    }
}
