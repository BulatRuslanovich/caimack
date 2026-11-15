// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

package app.caimack.ui

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.test.click
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.longClick
import androidx.compose.ui.test.onRoot
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.performScrollTo
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.unit.Density
import androidx.compose.ui.test.performTouchInput
import androidx.test.platform.app.InstrumentationRegistry
import app.caimack.CaimackApp
import app.caimack.api.Track
import app.caimack.playback.PlayerState
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import app.caimack.R
import org.junit.Rule
import org.junit.Test

class FullPlayerTest {
    @get:Rule
    val compose = createComposeRule()

    @Test fun pausedCoverIsCenteredAndLargeTextCanReachTheTransport() {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val container = (context.applicationContext as CaimackApp).container
        val track = Track(id = "long-title", title = "Очень длинное название концертной записи, которое нужно прочитать полностью при увеличенном тексте", artistId = "artist", artistName = "Artist", durationSeconds = 200)
        compose.setContent {
            val density = LocalDensity.current
            CaimackTheme(dark = true) {
                CompositionLocalProvider(LocalContainer provides container, LocalDensity provides Density(density.density, 2f)) {
                    FullPlayer(PlayerState(queue = listOf(track)), onClose = {})
                }
            }
        }
        val root = compose.onRoot().fetchSemanticsNode().boundsInRoot
        val cover = compose.onNodeWithTag("player-record").fetchSemanticsNode().boundsInRoot
        assertTrue("Paused artwork should be centered", kotlin.math.abs(root.center.x - cover.center.x) < 2f)
        compose.onNodeWithContentDescription(context.getString(R.string.player_next)).performScrollTo().assertIsDisplayed()
    }

    @Test
    fun touchesOnTheFullPlayerNeverReachTheScreenBehindIt() {
        val container = (InstrumentationRegistry.getInstrumentation().targetContext.applicationContext as CaimackApp).container
        val track = Track(id = "track", title = "Title", artistId = "artist", artistName = "Artist", durationSeconds = 200)
        var behind = 0

        compose.setContent {
            CaimackTheme(dark = true) {
                CompositionLocalProvider(LocalContainer provides container) {
                    Box(Modifier.fillMaxSize()) {
                        Box(Modifier.fillMaxSize().clickable { behind++ })
                        FullPlayer(PlayerState(queue = listOf(track)), onClose = {})
                    }
                }
            }
        }

        compose.onRoot().performTouchInput {
            longClick(center)
            click(center)
            click(Offset(centerX, bottom - 4f))
        }

        compose.runOnIdle { assertEquals(0, behind) }
    }
}
