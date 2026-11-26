// SPDX-License-Identifier: AGPL-3.0-only
package app.caimack.ui

import android.provider.Settings
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.width
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.asAndroidBitmap
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.semantics.SemanticsActions
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.text.TextLayoutResult
import androidx.compose.ui.unit.Density
import androidx.compose.ui.unit.dp
import androidx.navigation.compose.rememberNavController
import androidx.test.platform.app.InstrumentationRegistry
import app.caimack.CaimackApp
import app.caimack.R
import app.caimack.api.Album
import app.caimack.api.HomeBlock
import app.caimack.api.Playlist
import app.caimack.api.Track
import app.caimack.playback.PlayerState
import kotlinx.coroutines.flow.MutableStateFlow
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test

class RecentTilesUiTest {
    @get:Rule val compose = createComposeRule()

    @Test fun historyFitsOrScrollsAndMarksTheFirstLineOfTheSoundingItem() {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val container = (context.applicationContext as CaimackApp).container
        val states = container.player.state as MutableStateFlow<PlayerState>
        val previous = states.value
        val album = Album("album", "An album with a long two-line title", "a", "Album artist")
        val tracks = (1..4).map { Track("t$it", "Recording $it", "b", "Track artist", durationSeconds = 60) }
        val playlist = Playlist("p", "Own playlist")
        val history = HomeBlock("quick", "quickTiles", "QuickTiles", "Quick", albums = listOf(album),
            tracks = tracks, playlists = listOf(playlist))
        var block by mutableStateOf(history)
        var width by mutableStateOf(800.dp)
        val glyph = compose.onNodeWithContentDescription(context.getString(R.string.player_now_playing), useUnmergedTree = true)
        val scrolling = SemanticsMatcher.keyIsDefined(SemanticsProperties.HorizontalScrollAxisRange)
        try {
            states.value = PlayerState(queue = listOf(tracks.first().copy(id = "album-track", albumId = album.id)), playing = true)
            compose.mainClock.autoAdvance = false
            compose.setContent {
                CompositionLocalProvider(LocalContainer provides container, LocalDensity provides Density(1f)) {
                    CaimackTheme(dark = true) {
                        Box(Modifier.width(width)) { QuickTiles(block, rememberNavController()) }
                    }
                }
            }
            compose.mainClock.advanceTimeBy(64)
            compose.onNode(scrolling).assertDoesNotExist()
            compose.onNodeWithText(tracks[2].title).assertIsDisplayed()
            compose.onNodeWithText(tracks[3].title).assertDoesNotExist()
            compose.onNodeWithText(playlist.name).assertDoesNotExist()

            // The album can be sounding even when its own collection was never opened.
            val title = compose.onNodeWithText(album.title, useUnmergedTree = true)
            val layouts = mutableListOf<TextLayoutResult>()
            title.performSemanticsAction(SemanticsActions.GetTextLayoutResult) { it(layouts) }
            val layout = layouts.single()
            assertEquals(2, layout.lineCount)
            val bounds = title.fetchSemanticsNode().boundsInRoot
            val bars = glyph.fetchSemanticsNode().boundsInRoot
            assertTrue(bars.left >= bounds.right)
            assertEquals(bounds.top + (layout.getLineTop(0) + layout.getLineBottom(0)) / 2, bars.center.y, 2f)
            assertEquals(bounds.left, compose.onNodeWithText(album.artistName, useUnmergedTree = true).fetchSemanticsNode().boundsInRoot.left, 0.5f)
            val animationsOff = Settings.Global.getFloat(context.contentResolver, Settings.Global.ANIMATOR_DURATION_SCALE, 1f) == 0f
            val before = glyph.captureToImage().asAndroidBitmap()
            compose.mainClock.advanceTimeBy(350)
            assertEquals(animationsOff, before.sameAs(glyph.captureToImage().asAndroidBitmap()))
            compose.mainClock.autoAdvance = true

            compose.runOnIdle {
                width = 280.dp
                states.value = PlayerState(queue = tracks, index = 2, playing = true)
            }
            compose.onNode(scrolling).assertExists()
            compose.onNodeWithText(tracks[2].title).performScrollTo().assertIsDisplayed()
            glyph.assertIsDisplayed()
            compose.runOnIdle { states.value = states.value.copy(playing = false) }
            glyph.assertDoesNotExist()
            compose.runOnIdle { block = history.copy(albums = emptyList(), tracks = emptyList()) }
            compose.onNodeWithText(context.getString(R.string.home_quick_picks)).assertDoesNotExist()
            compose.onNodeWithText(context.getString(R.string.action_see_all)).assertDoesNotExist()
        } finally {
            compose.mainClock.autoAdvance = true
            compose.runOnIdle { states.value = previous }
        }
    }
}
