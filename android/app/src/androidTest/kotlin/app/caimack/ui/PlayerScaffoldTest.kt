// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

package app.caimack.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.toPixelMap
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.captureToImage
import androidx.compose.ui.test.click
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollToIndex
import androidx.compose.ui.test.performTouchInput
import androidx.compose.ui.unit.dp
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test

class PlayerScaffoldTest {
    @get:Rule val compose = createComposeRule()

    private var showPlayer by mutableStateOf(true)
    private var tallPlayer by mutableStateOf(false)
    private var playerClicks = 0
    private var rowClicks = 0

    private fun start(dark: Boolean = true) {
        compose.setContent {
            CaimackTheme(dark = dark) {
                PlayerScaffold(
                    modifier = Modifier.size(width = 320.dp, height = 480.dp).testTag("scaffold"),
                    topBar = { Box(Modifier.fillMaxWidth().height(40.dp).testTag("header")) },
                    bottomBar = {
                        // Include space for system navigation as well as the app's tabs.
                        Box(Modifier.fillMaxWidth().height(72.dp).background(LocalPalette.current.card).testTag("navigation"))
                    },
                    miniPlayer = {
                        if (showPlayer) Box(
                            Modifier.fillMaxWidth().padding(horizontal = 8.dp, vertical = 5.dp)
                                .musicSurface(LocalPalette.current)
                                .height(if (tallPlayer) 110.dp else 72.dp)
                                .testTag("player")
                                .clickable { playerClicks++ },
                        )
                    },
                ) { padding ->
                    LazyColumn(
                        Modifier.padding(padding).fillMaxSize().background(Color(0xFF169B78)).testTag("list"),
                        contentPadding = playerContentPadding(bottom = 16.dp),
                    ) {
                        items(30) { index ->
                            Box(Modifier.fillMaxWidth().height(48.dp).testTag("row-$index").clickable { rowClicks++ })
                        }
                    }
                }
            }
        }
        compose.waitForIdle()
    }

    @Test fun darkThemeShowsContentAroundTheRoundedPlayer() {
        start(dark = true)
        assertFloatingViewport()
    }

    @Test fun lightThemeShowsContentAroundTheRoundedPlayer() {
        start(dark = false)
        assertFloatingViewport()
    }

    private fun assertFloatingViewport() {
        val list = compose.onNodeWithTag("list").fetchSemanticsNode().boundsInRoot
        val header = compose.onNodeWithTag("header").fetchSemanticsNode().boundsInRoot
        val navigation = compose.onNodeWithTag("navigation").fetchSemanticsNode().boundsInRoot
        val player = compose.onNodeWithTag("player").fetchSemanticsNode().boundsInRoot
        assertEquals(header.bottom, list.top, 1f)
        assertEquals(navigation.top, list.bottom, 1f)

        val root = compose.onNodeWithTag("scaffold").fetchSemanticsNode().boundsInRoot
        val pixels = compose.onNodeWithTag("scaffold").captureToImage().toPixelMap()
        // The exposed side margin beside the player must show the list, not a rectangular
        // strip of the scaffold background. Allow for the player's translucent shadow.
        val pixel = pixels[1, ((player.top + player.bottom) / 2 - root.top).toInt()]
        assertTrue("Content must remain visible beside the player: $pixel", pixel.green > 0.4f && pixel.blue > 0.3f)
        compose.onNodeWithTag("player").performClick()
        compose.runOnIdle { assertEquals(1, playerClicks); assertEquals(0, rowClicks) }
    }

    @Test fun theLastRowScrollsAboveThePlayerEvenWhenItsHeightChanges() {
        start()
        for (tall in listOf(false, true)) {
            compose.runOnIdle { tallPlayer = tall }
            compose.onNodeWithTag("list").performScrollToIndex(29)
            compose.onNodeWithTag("row-29").assertIsDisplayed()
            val last = compose.onNodeWithTag("row-29").fetchSemanticsNode().boundsInRoot
            val player = compose.onNodeWithTag("player").fetchSemanticsNode().boundsInRoot
            assertTrue("Last row must clear the player", last.bottom < player.top)
            compose.onNodeWithTag("row-29").performTouchInput { click() }
        }
        compose.runOnIdle { assertEquals(2, rowClicks); assertEquals(0, playerClicks) }
    }

    @Test fun clearingTheQueueRemovesTheExtraScrollInset() {
        start()
        compose.runOnIdle { showPlayer = false }
        compose.onNodeWithTag("player").assertDoesNotExist()
        compose.onNodeWithTag("list").performScrollToIndex(29)
        val list = compose.onNodeWithTag("list").fetchSemanticsNode().boundsInRoot
        val last = compose.onNodeWithTag("row-29").fetchSemanticsNode().boundsInRoot
        val scale = list.width / 320f
        assertEquals(16f * scale, list.bottom - last.bottom, 1f)
    }
}
