// SPDX-License-Identifier: AGPL-3.0-only
package app.caimack.ui

import androidx.compose.foundation.layout.Column
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.test.platform.app.InstrumentationRegistry
import app.caimack.CaimackApp
import app.caimack.api.Track
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test

class OfflineTrackAvailabilityTest {
    @get:Rule val compose = createComposeRule()
    @Test fun onlyDownloadedTracksArePlayableWithoutTheServer() {
        val container = (InstrumentationRegistry.getInstrumentation().targetContext.applicationContext as CaimackApp).container
        var played = 0
        compose.setContent {
            CaimackTheme(dark = true) {
                CompositionLocalProvider(LocalContainer provides container, LocalOfflineLibrary provides true,
                    LocalAvailableTracks provides setOf("local-test")) {
                    Column {
                        TrackRow(Track("local-test", "Available offline", "artist", "Artist", durationSeconds = 10), { played++ })
                        TrackRow(Track("remote-test", "Needs server", "artist", "Artist", durationSeconds = 10), { played++ })
                    }
                }
            }
        }
        compose.onNodeWithText("Needs server").assertIsNotEnabled()
        compose.onNodeWithText("Available offline").assertIsEnabled().performClick()
        compose.runOnIdle { assertEquals(1, played) }
    }
}
