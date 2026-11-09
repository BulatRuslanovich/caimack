// SPDX-License-Identifier: AGPL-3.0-only
package app.caimack.ui

import androidx.compose.foundation.layout.Column
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.test.platform.app.InstrumentationRegistry
import app.caimack.R
import app.caimack.updates.AppRelease
import app.caimack.updates.UpdateState
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test

class AppUpdatesUiTest {
    @get:Rule val compose = createComposeRule()
    private val context = InstrumentationRegistry.getInstrumentation().targetContext
    private val release = AppRelease("v1.0.9", "Independent glow lines and a new star atlas.", "https://github.com/owner/music/releases/download/v1.0.9/caimack-v1.0.9-arm64.apk", "https://github.com/owner/music/releases/tag/v1.0.9")

    @Test fun bannerOpensReleaseNotesAndDismissesWithoutLosingTheUpdate() {
        compose.setContent {
            CaimackTheme(dark = true) {
                var state by remember { mutableStateOf(UpdateState(release = release)) }
                var details by remember { mutableStateOf(false) }
                Column {
                    UpdateBanner(state, onDetails = { details = true }, onDismiss = { state = state.copy(dismissedTag = release.tag) })
                    UpdatesPanel(state, onCheck = {}, onDetails = { details = true })
                }
                if (details) UpdateDetails(release) { details = false }
            }
        }
        compose.onNodeWithText(context.getString(R.string.update_details)).performClick()
        compose.onNodeWithText(release.notes).assertIsDisplayed()
        capture("app-update-dialog")
        compose.onNodeWithText(context.getString(R.string.update_download)).assertIsDisplayed()
        compose.onNodeWithText(context.getString(R.string.update_later)).performClick()
        compose.onNodeWithContentDescription(context.getString(R.string.update_later)).performClick()
        compose.onNodeWithText(context.getString(R.string.update_details)).assertDoesNotExist()
        compose.onNodeWithText(context.getString(R.string.update_whats_new)).assertIsDisplayed().performClick()
        compose.onNodeWithText(release.notes).assertIsDisplayed()
    }

    private fun capture(name: String) {
        if (InstrumentationRegistry.getArguments().getString("screenshots") != "true") return
        compose.waitForIdle()
        val directory = java.io.File(context.getExternalFilesDir(null), "update-review").apply { mkdirs() }
        InstrumentationRegistry.getInstrumentation().uiAutomation.takeScreenshot()?.let { bitmap ->
            java.io.File(directory, "$name.png").outputStream().use { bitmap.compress(android.graphics.Bitmap.CompressFormat.PNG, 100, it) }
            bitmap.recycle()
        }
    }

    @Test fun failedCheckOffersRetryWithoutSayingTheAppIsUpToDate() {
        var checks = 0
        compose.setContent {
            CaimackTheme(dark = false) {
                UpdatesPanel(UpdateState(failed = true), onCheck = { checks++ }, onDetails = {})
            }
        }
        compose.onNodeWithText(context.getString(R.string.update_failed)).assertIsDisplayed()
        compose.onNodeWithText(context.getString(R.string.update_current)).assertDoesNotExist()
        compose.onNodeWithText(context.getString(R.string.update_check)).performClick()
        assertEquals(1, checks)
    }

    @Test fun longReleaseNotesKeepTheDownloadActionVisible() {
        compose.setContent {
            CaimackTheme(dark = true) {
                UpdateDetails(release.copy(notes = "New in Caimack\n".repeat(200))) {}
            }
        }
        compose.onNodeWithText(context.getString(R.string.update_download)).assertIsDisplayed()
        compose.onNodeWithText(context.getString(R.string.update_later)).assertIsDisplayed()
    }
}
