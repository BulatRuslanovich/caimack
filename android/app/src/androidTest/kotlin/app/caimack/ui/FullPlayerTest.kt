// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

package app.caimack.ui

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.mutableStateOf
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.test.click
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.longClick
import androidx.compose.ui.test.onRoot
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.performScrollTo
import androidx.compose.ui.test.captureToImage
import androidx.compose.ui.graphics.asAndroidBitmap
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
import java.io.File

class FullPlayerTest {
    @get:Rule
    val compose = createComposeRule()

    @Test fun changingTitleLengthKeepsArtworkStableAndHeaderCentered() {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val container = (context.applicationContext as CaimackApp).container
        val tracks = listOf("Коротко", "Очень длинное название концертной записи на берегу реки, которое занимает несколько строк и не должно сдвигать пластинку").mapIndexed { index, title ->
            Track(id = "layout-$index", title = title, artistId = "artist", artistName = "Artist", durationSeconds = 200)
        }
        val state = mutableStateOf(PlayerState(queue = tracks, playing = true))
        compose.mainClock.autoAdvance = false
        compose.setContent {
            CaimackTheme(dark = true) {
                CompositionLocalProvider(LocalContainer provides container) {
                    FullPlayer(state.value, onClose = {})
                }
            }
        }
        compose.mainClock.advanceTimeBy(1000)
        val header = compose.onNodeWithTag("full-player-header").fetchSemanticsNode().boundsInRoot
        val contextLabel = compose.onNodeWithTag("full-player-context").fetchSemanticsNode().boundsInRoot
        assertEquals("Now playing is centered between equal actions", header.center.x, contextLabel.center.x, 1f)
        val scene = compose.onNodeWithTag("player-artwork-scene").fetchSemanticsNode().boundsInRoot
        val visuals = compose.onNodeWithTag("player-record-visuals").fetchSemanticsNode().boundsInRoot
        assertTrue("The complete aura has horizontal breathing room", visuals.left > scene.left && visuals.right < scene.right)
        assertTrue("The complete aura has vertical breathing room", visuals.top > scene.top && visuals.bottom < scene.bottom)
        val before = compose.onNodeWithTag("player-record").fetchSemanticsNode().boundsInRoot
        val root = compose.onRoot().fetchSemanticsNode().boundsInRoot
        assertEquals("The sleeve and extended disc are centered together", root.center.x, before.center.x + before.width * RECORD_OUT / 2, 1.5f)
        assertEquals("The artwork area starts below the header", header.bottom, scene.top, 1.5f)
        assertEquals("Artwork is centered in the area above the seekbar block", scene.center.y, before.center.y, 1.5f)
        val title = compose.onNodeWithText(tracks[0].title).fetchSemanticsNode().boundsInRoot
        assertTrue("The artwork area ends before the track metadata", scene.bottom <= title.top)
        assertTrue("The title belongs below the artwork", title.top > before.bottom)
        File(context.getExternalFilesDir(null), "ux-bugs-player-short.png").outputStream().use {
            compose.onRoot().captureToImage().asAndroidBitmap().compress(android.graphics.Bitmap.CompressFormat.PNG, 100, it)
        }
        compose.runOnIdle { state.value = state.value.copy(index = 1) }
        compose.mainClock.advanceTimeBy(1200)
        val after = compose.onNodeWithTag("player-record").fetchSemanticsNode().boundsInRoot
        assertEquals("Longer metadata must not move the record vertically", before.top, after.top, 1f)
        assertEquals("Longer metadata must not resize the record", before.width, after.width, 1f)
        File(context.getExternalFilesDir(null), "ux-bugs-player-long.png").outputStream().use {
            compose.onRoot().captureToImage().asAndroidBitmap().compress(android.graphics.Bitmap.CompressFormat.PNG, 100, it)
        }
        compose.runOnIdle { state.value = state.value.copy(playing = false) }
        compose.mainClock.advanceTimeBy(1000)
        compose.mainClock.autoAdvance = true
        compose.onNodeWithContentDescription(context.getString(R.string.player_next)).performScrollTo().assertIsDisplayed()
    }

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
        val header = compose.onNodeWithTag("full-player-header").fetchSemanticsNode().boundsInRoot
        val scene = compose.onNodeWithTag("player-artwork-scene").fetchSemanticsNode().boundsInRoot
        assertEquals("The artwork area starts below the header", header.bottom, scene.top, 1.5f)
        assertEquals("Paused artwork stays centered above the seekbar block", scene.center.y, cover.center.y, 1.5f)
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
