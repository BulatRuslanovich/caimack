// SPDX-License-Identifier: AGPL-3.0-only
package app.caimack.ui

import androidx.compose.material3.Text
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.test.platform.app.InstrumentationRegistry
import app.caimack.R
import org.junit.Rule
import org.junit.Test

class RetainedContentUiTest {
    @get:Rule val compose = createComposeRule()

    @Test fun failedRefreshKeepsCachedMusicAndCanRetry() {
        val key = "retained-content-test"
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        Remote.cache[key] = "Cached music"
        var attempts = 0
        try {
            compose.setContent {
                CaimackTheme {
                    Load(key, {
                        attempts++
                        if (attempts == 1) error("Fixture refresh failure")
                        "Refreshed music"
                    }) { Text(it) }
                }
            }
            compose.onNodeWithText("Cached music").assertIsDisplayed()
            compose.onNodeWithText(context.getString(R.string.error_refresh)).assertIsDisplayed()
            compose.onNodeWithText(context.getString(R.string.action_try_again)).performClick()
            compose.onNodeWithText("Refreshed music").assertIsDisplayed()
        } finally { Remote.cache.remove(key) }
    }
}
