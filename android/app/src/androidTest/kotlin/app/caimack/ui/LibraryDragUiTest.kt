// SPDX-License-Identifier: AGPL-3.0-only
package app.caimack.ui

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.layout.boundsInRoot
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.unit.dp
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import kotlinx.coroutines.flow.first

class LibraryDragUiTest {
    @get:Rule val compose = createComposeRule()
    private fun drag(from: String, to: String, fraction: Float = .5f) {
        val root = compose.onNodeWithTag("library-drag-grid").fetchSemanticsNode().boundsInRoot
        val start = compose.onNodeWithTag("library-entry:$from").fetchSemanticsNode().boundsInRoot.center - root.topLeft
        val target = compose.onNodeWithTag("library-entry:$to").fetchSemanticsNode().boundsInRoot
        val end = Offset(target.center.x, target.top + target.height * fraction) - root.topLeft
        compose.onNodeWithTag("library-drag-grid").performTouchInput {
            down(start); advanceEventTime(650); moveTo(start)
        }
        compose.onNodeWithTag("library-drag-overlay:$from").assertExists()
        compose.onNodeWithTag("library-drag-grid").performTouchInput {
            moveTo(end, delayMillis = 150); up()
        }
        compose.waitForIdle()
    }
    @Test fun longPressReordersAndFolderCentreMovesWithoutOpening() {
        var keys by mutableStateOf(listOf("folder:a", "album:b", "album:c", "downloads"))
        var moved: Pair<String, String>? = null
        var opened = 0
        compose.setContent {
            CaimackTheme {
                LibraryDragGrid(keys, grid = false, enabled = true, scopeKey = "root",
                    canDrop = { source, target -> source != "downloads" && target == "folder:a" },
                    onOrder = { keys = it }, onFolder = { source, target -> moved = source to target },
                ) { key -> Text(key, Modifier.fillMaxWidth().height(84.dp).clickable { opened++ }.padding(16.dp)) }
            }
        }
        drag("album:c", "folder:a")
        compose.runOnIdle { assertEquals("album:c" to "folder:a", moved); assertEquals(0, opened) }
        drag("downloads", "album:b")
        compose.runOnIdle { assertEquals(listOf("folder:a", "downloads", "album:b", "album:c"), keys); assertEquals(0, opened) }
        compose.onNodeWithText("album:b").performClick()
        compose.runOnIdle { assertEquals(1, opened) }
    }

    @Test fun folderToolbarAcceptsDropWithoutAParentRow() {
        var moved: Pair<String, String>? = null
        compose.setContent {
            CaimackTheme {
                var parentBounds by remember { mutableStateOf<Rect?>(null) }
                Column {
                    Box(Modifier.size(48.dp).testTag("folder-parent")
                        .onGloballyPositioned { parentBounds = it.boundsInRoot() })
                    LibraryDragGrid(
                        listOf("album:a"), grid = false, enabled = true, scopeKey = "folder",
                        canDrop = { _, target -> target == "up" },
                        onOrder = {}, onFolder = { source, target -> moved = source to target },
                        parentDropBounds = parentBounds,
                    ) { key -> Text(key, Modifier.fillMaxWidth().height(84.dp)) }
                }
            }
        }
        compose.onNodeWithTag("library-entry:up").assertDoesNotExist()
        val grid = compose.onNodeWithTag("library-drag-grid")
        val origin = grid.fetchSemanticsNode().boundsInRoot.topLeft
        val start = compose.onNodeWithTag("library-entry:album:a").fetchSemanticsNode().boundsInRoot.center - origin
        val end = compose.onNodeWithTag("folder-parent").fetchSemanticsNode().boundsInRoot.center - origin
        grid.performTouchInput { down(start); advanceEventTime(650); moveTo(start) }
        grid.performTouchInput { moveTo(end, delayMillis = 150); up() }
        compose.runOnIdle { assertEquals("album:a" to "up", moved) }
    }
    @Test fun gridFolderEdgeReordersInsteadOfMovingInside() {
        var keys by mutableStateOf(listOf("folder:a", "album:b", "album:c", "downloads"))
        var moved = false
        compose.setContent {
            CaimackTheme {
                LibraryDragGrid(keys, grid = true, enabled = true, scopeKey = "grid",
                    canDrop = { _, target -> target == "folder:a" },
                    onOrder = { keys = it }, onFolder = { _, _ -> moved = true },
                ) { key -> Text(key, Modifier.fillMaxWidth().height(100.dp).padding(16.dp)) }
            }
        }
        drag("album:c", "folder:a", .1f)
        compose.runOnIdle {
            assertEquals(listOf("album:c", "folder:a", "album:b", "downloads"), keys)
            assertFalse(moved)
        }
    }

    @Test fun normalScrollingAndCancelledDragKeepTheOrder() {
        val keys = (0..30).map { "album:$it" }
        var changes = 0
        compose.setContent {
            CaimackTheme {
                LibraryDragGrid(keys, grid = false, enabled = true, scopeKey = "scroll",
                    canDrop = { _, _ -> false }, onOrder = { changes++ }, onFolder = { _, _ -> changes++ },
                ) { key -> Text(key, Modifier.fillMaxWidth().height(84.dp).padding(16.dp)) }
            }
        }
        val root = compose.onNodeWithTag("library-drag-grid")
        val start = compose.onNodeWithTag("library-entry:album:0").fetchSemanticsNode().boundsInRoot.center - root.fetchSemanticsNode().boundsInRoot.topLeft
        root.performTouchInput { down(start); advanceEventTime(650); moveTo(start) }
        val lifted = compose.onNodeWithTag("library-drag-highlight:album:0").fetchSemanticsNode().boundsInRoot
        val viewport = root.fetchSemanticsNode().boundsInRoot
        assertTrue("Held row must leave room for its left border", lifted.left > viewport.left)
        assertTrue("Held row must leave room for its right border", lifted.right < viewport.right)
        root.performTouchInput { moveBy(Offset(0f, 200f)); cancel() }
        compose.waitForIdle()
        compose.onNodeWithTag("library-drag-overlay:album:0").assertDoesNotExist()
        root.performTouchInput { swipeUp() }
        compose.waitForIdle()
        compose.onNodeWithTag("library-entry:album:0").assertDoesNotExist()
        compose.runOnIdle { assertEquals(0, changes) }
    }

    @Test fun folderStaysStillAndPickupKeepsContentBounds() {
        var keys by mutableStateOf(listOf("album:a", "folder:b", "album:c"))
        var moved: Pair<String, String>? = null
        compose.setContent {
            CaimackTheme {
                LibraryDragGrid(keys, grid = false, enabled = true, scopeKey = "stationary",
                    canDrop = { _, target -> target == "folder:b" },
                    onOrder = { fail("Hover must not commit a new order") },
                    onFolder = { source, target -> moved = source to target; keys = keys - source },
                ) { key -> Text(key, Modifier.fillMaxWidth().height(100.dp).padding(16.dp)) }
            }
        }
        val root = compose.onNodeWithTag("library-drag-grid")
        val origin = root.fetchSemanticsNode().boundsInRoot.topLeft
        val source = compose.onNodeWithTag("library-entry:album:a").fetchSemanticsNode().boundsInRoot
        val folder = compose.onNodeWithTag("library-entry:folder:b").fetchSemanticsNode().boundsInRoot
        val other = compose.onNodeWithTag("library-entry:album:c").fetchSemanticsNode().boundsInRoot
        val grab = Offset(source.left + 20f, source.center.y) - origin
        root.performTouchInput { down(grab); advanceEventTime(650); moveTo(grab) }
        assertEquals("Pickup must not resize or shift the contents", source,
            compose.onNodeWithTag("library-drag-overlay:album:a").fetchSemanticsNode().boundsInRoot)
        root.performTouchInput { moveTo(other.center - origin, delayMillis = 150) }
        compose.waitForIdle()
        assertEquals(folder, compose.onNodeWithTag("library-entry:folder:b").fetchSemanticsNode().boundsInRoot)
        root.performTouchInput { moveTo(Offset(folder.left + 20f, folder.center.y) - origin, delayMillis = 150) }
        compose.waitForIdle()
        assertEquals("A folder accepting a drop must stay in place", folder,
            compose.onNodeWithTag("library-entry:folder:b").fetchSemanticsNode().boundsInRoot)
        root.performTouchInput { up() }
        compose.waitForIdle()
        compose.runOnIdle { assertEquals("album:a" to "folder:b", moved) }
        compose.onNodeWithTag("library-entry:album:a").assertDoesNotExist()
        compose.onNodeWithTag("library-drag-overlay:album:a").assertDoesNotExist()
    }

    @Test fun releasedItemStaysAtItsDestinationWhileSaving() {
        val original = listOf("album:a", "album:b", "album:c")
        var keys by mutableStateOf(original)
        val saved = kotlinx.coroutines.CompletableDeferred<Unit>()
        compose.setContent {
            CaimackTheme {
                LibraryDragGrid(keys, grid = false, enabled = true, scopeKey = "saving",
                    canDrop = { _, _ -> false },
                    onOrder = { saved.await(); keys = it }, onFolder = { _, _ -> fail("Not a folder") },
                ) { key -> Text(key, Modifier.fillMaxWidth().height(100.dp).padding(16.dp)) }
            }
        }
        val destination = compose.onNodeWithTag("library-entry:album:c").fetchSemanticsNode().boundsInRoot
        drag("album:a", "album:c")
        compose.runOnIdle { assertEquals("The server response is still pending", original, keys) }
        assertEquals("The released item must already be at the new position", destination,
            compose.onNodeWithTag("library-entry:album:a").fetchSemanticsNode().boundsInRoot)
        compose.runOnIdle { saved.complete(Unit) }
        compose.waitForIdle()
        assertEquals(destination, compose.onNodeWithTag("library-entry:album:a").fetchSemanticsNode().boundsInRoot)
        compose.runOnIdle { assertEquals(listOf("album:b", "album:c", "album:a"), keys) }
    }

    /** Explicit opt-in: exercise the connected account using disposable folders only. */
    @Test fun liveServerPersistsOrderAndMoves() = kotlinx.coroutines.runBlocking {
        val instrumentation = androidx.test.platform.app.InstrumentationRegistry.getInstrumentation()
        org.junit.Assume.assumeTrue(androidx.test.platform.app.InstrumentationRegistry.getArguments().getString("liveLibrary") == "true")
        val container = (instrumentation.targetContext.applicationContext as app.caimack.CaimackApp).container
        kotlinx.coroutines.withTimeout(15_000) {
            container.session.state.first { it is app.caimack.session.SessionState.SignedIn }
        }
        val api = container.api
        val parent = java.util.UUID.randomUUID().toString()
        val child = java.util.UUID.randomUUID().toString()
        try {
            api.organizeLibrary(app.caimack.api.LibraryChange("create", parent, name = "Drag validation temporary"))
            api.organizeLibrary(app.caimack.api.LibraryChange("create", child, name = "Drag validation child", folderId = parent))
            api.organizeLibrary(app.caimack.api.LibraryChange("reorder", folderId = parent, order = listOf("folder:$child")))
            assertEquals(listOf("folder:$child"), api.libraryOrder()[parent])
            api.organizeLibrary(app.caimack.api.LibraryChange("moveFolder", child))
            assertNull(api.libraryFolders().first { it.id == child }.parentId)
        } finally {
            api.organizeLibrary(app.caimack.api.LibraryChange("delete", child))
            api.organizeLibrary(app.caimack.api.LibraryChange("delete", parent))
        }
    }

}
