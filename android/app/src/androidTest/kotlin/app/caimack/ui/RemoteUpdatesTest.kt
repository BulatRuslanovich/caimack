// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

package app.caimack.ui

import androidx.compose.material3.Text
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import kotlinx.coroutines.CompletableDeferred
import org.junit.After
import org.junit.Rule
import org.junit.Test

class RemoteUpdatesTest {
    @get:Rule
    val compose = createComposeRule()
    private val key = "live-update-${System.nanoTime()}"

    @After
    fun clear() { Remote.cache.remove(key) }

    @Test
    fun completedEditsUpdateTheScreenAndTakePrecedenceOverAnOlderRead() {
        val response = CompletableDeferred<String>()
        Remote.cache[key] = "original"
        compose.setContent {
            CaimackTheme(dark = true) { Load(key, { response.await() }) { Text(it) } }
        }
        compose.onNodeWithText("original").assertIsDisplayed()
        compose.runOnIdle { Remote.update(key, "edited") }
        compose.onNodeWithText("edited").assertIsDisplayed()
        compose.runOnIdle { response.complete("stale response") }
        compose.onNodeWithText("edited").assertIsDisplayed()
        compose.onNodeWithText("stale response").assertDoesNotExist()
    }

    @Test
    fun aCacheEvictionDoesNotDiscardAFreshResponse() {
        val response = CompletableDeferred<String>()
        Remote.cache[key] = "original"
        compose.setContent {
            CaimackTheme(dark = true) { Load(key, { response.await() }) { Text(it) } }
        }
        compose.onNodeWithText("original").assertIsDisplayed()
        compose.runOnIdle { Remote.cache.remove(key); response.complete("fresh response") }
        compose.onNodeWithText("fresh response").assertIsDisplayed()
    }
}
