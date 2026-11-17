// SPDX-License-Identifier: AGPL-3.0-only
package app.caimack.ui

import android.text.format.Formatter
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.test.platform.app.InstrumentationRegistry
import app.caimack.CaimackApp
import app.caimack.R
import app.caimack.api.Track
import app.caimack.sync.SyncStatus
import org.junit.Rule
import org.junit.Test

class DownloadsStorageUiTest {
    @get:Rule val compose = createComposeRule()

    @Test fun synchronizedLibraryShowsStorageWithoutIndividualDownloadsAndUpdatesIt() {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val container = (context.applicationContext as CaimackApp).container
        val track = Track("synced-storage-test", "Synchronized track", "artist", "Artist", durationSeconds = 60)
        var bytes by mutableLongStateOf(2_500_000_020L)
        fun label(size: Long) = context.getString(R.string.downloads_size, Formatter.formatShortFileSize(context, size))
        compose.setContent {
            CaimackTheme(dark = true) {
                CompositionLocalProvider(LocalContainer provides container, LocalAvailableTracks provides setOf(track.id)) {
                    DownloadsContent(
                        library = listOf(track), entries = emptyList(), occupiedBytes = bytes,
                        synchronized = SyncStatus(enabled = true, completed = 1, total = 1),
                        play = { _, _ -> }, remove = {},
                    )
                }
            }
        }
        compose.onNodeWithText(label(2_500_000_020L)).assertIsDisplayed()
        compose.onNodeWithText(track.title).assertIsDisplayed()
        compose.onNodeWithText(context.getString(R.string.downloads_remove_all)).assertDoesNotExist()
        compose.runOnIdle { bytes = 5_000_000_040L }
        compose.onNodeWithText(label(5_000_000_040L)).assertIsDisplayed()
        compose.onNodeWithText(label(2_500_000_020L)).assertDoesNotExist()
    }
}
