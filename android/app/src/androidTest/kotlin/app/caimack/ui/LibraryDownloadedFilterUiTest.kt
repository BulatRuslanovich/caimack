// SPDX-License-Identifier: AGPL-3.0-only
package app.caimack.ui

import androidx.compose.runtime.*
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.test.platform.app.InstrumentationRegistry
import app.caimack.R
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test

class LibraryDownloadedFilterUiTest {
    @get:Rule val compose = createComposeRule()

    @Test fun downloadedCombinesWithCollectionTypeAndCanBeCleared() {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        var kind by mutableStateOf("all")
        var downloaded by mutableStateOf(false)
        compose.setContent {
            CaimackTheme {
                LibraryFilters(kind, downloaded, audiobooksEnabled = false, onFilter = { kind = it }, onDownloaded = { downloaded = it })
            }
        }
        val label = context.getString(R.string.collection_downloaded)
        compose.onNodeWithText(label).performScrollTo().performClick().assertIsSelected()
        compose.onNodeWithText(context.getString(R.string.nav_albums)).performScrollTo().performClick().assertIsSelected()
        compose.onNodeWithText(label).assertIsSelected()
        val downloadedBounds = compose.onNodeWithText(label).fetchSemanticsNode().boundsInRoot
        val albumBounds = compose.onNodeWithText(context.getString(R.string.nav_albums)).fetchSemanticsNode().boundsInRoot
        assertTrue("Selected downloaded filter precedes the type filter", downloadedBounds.left < albumBounds.left)
        compose.runOnIdle { assertEquals("album", kind); assertTrue(downloaded) }
        compose.onNodeWithText(label).performClick().assertIsNotSelected()
        compose.runOnIdle { assertEquals("album", kind) }
        compose.onNodeWithText(label).performClick()
        compose.onNodeWithContentDescription(context.getString(R.string.collection_clear_filter)).performScrollTo().performClick()
        compose.runOnIdle { assertEquals("all", kind); assertFalse(downloaded) }
    }
}
