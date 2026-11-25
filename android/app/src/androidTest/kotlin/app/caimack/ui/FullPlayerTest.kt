// SPDX-License-Identifier: AGPL-3.0-only

package app.caimack.ui

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.mutableIntStateOf
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
import androidx.compose.ui.test.assertIsSelected
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import androidx.compose.ui.test.captureToImage
import androidx.compose.ui.test.getUnclippedBoundsInRoot
import androidx.compose.ui.graphics.asAndroidBitmap
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.unit.Density
import androidx.compose.ui.test.performTouchInput
import androidx.compose.ui.test.swipeUp
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.test.platform.app.InstrumentationRegistry
import app.caimack.CaimackApp
import app.caimack.api.Track
import app.caimack.api.LyricLine
import app.caimack.api.Lyrics
import app.caimack.api.PlaybackCollection
import app.caimack.api.PlaylistDetail
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

    @Test fun queueOriginOpensTheCollectionThatStartedPlayback() {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val container = (context.applicationContext as CaimackApp).container
        val track = Track(
            id = "source-track", title = "Corner lights", albumId = "source-album",
            albumTitle = "Coastline", artistId = "artist", artistName = "Harbor Signals", durationSeconds = 200,
        )
        val state = mutableStateOf(PlayerState(queue = listOf(track), collection = PlaybackCollection("album", "source-album")))
        val playlist = PlaylistDetail(id = "source-playlist", name = "After Hours", tracks = listOf(track))
        Remote.cache["playlist:${playlist.id}"] = playlist
        var route: Any? = null

        try {
            compose.setContent {
                CaimackTheme(dark = true) {
                    CompositionLocalProvider(LocalContainer provides container, LocalNavigate provides { route = it }) {
                        FullPlayer(state.value, onClose = {})
                    }
                }
            }
            compose.onNodeWithText(context.getString(R.string.player_from_album, "Coastline")).performClick()
            compose.runOnIdle {
                assertEquals(AlbumRoute("source-album"), route)
                state.value = state.value.copy(collection = PlaybackCollection("playlist", playlist.id))
            }
            compose.onNodeWithText(context.getString(R.string.player_from_playlist, playlist.name)).performClick()
            compose.runOnIdle { assertEquals(PlaylistRoute(playlist.id), route) }
        } finally {
            Remote.cache.remove("playlist:${playlist.id}")
        }
    }

    @Test fun scrollingLyricsPausesFollowingUntilTheReturnButtonIsPressed() {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val container = (context.applicationContext as CaimackApp).container
        val active = mutableIntStateOf(0)
        val lyrics = Lyrics(lines = List(50) { LyricLine(it * 1000L, "Line ${it + 1}") })

        compose.setContent {
            CaimackTheme(dark = true) {
                CompositionLocalProvider(LocalContainer provides container) {
                    TimedLyrics(lyrics, active.intValue, { active.intValue * 1000L }, {})
                }
            }
        }

        val list = compose.onNodeWithTag("timed-lyrics")
        val follow = compose.onNodeWithText(context.getString(R.string.lyrics_follow))
        fun scrollPosition() = list.fetchSemanticsNode().config[SemanticsProperties.VerticalScrollAxisRange].value()
        list.performTouchInput { swipeUp(durationMillis = 600) }
        follow.assertIsDisplayed()
        val manualPosition = scrollPosition()
        assertTrue("The lyrics moved in response to the swipe", manualPosition > 0f)
        compose.runOnIdle { active.intValue = 33 }
        assertEquals("Playback does not take over the scroll position", manualPosition, scrollPosition(), 0.01f)

        follow.performClick()
        compose.onNodeWithTag("lyrics-line-33").assertIsDisplayed().assertIsSelected()
        follow.assertDoesNotExist()
    }

    @Test fun changingTitleLengthKeepsArtworkStableAndHeaderCentered() {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val container = (context.applicationContext as CaimackApp).container
        val tracks = listOf("Тепло твоих рук", "Очень длинное название концертной записи на берегу реки, которое занимает несколько строк и не должно сдвигать пластинку").mapIndexed { index, title ->
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
        assertTrue("The sleeve and vinyl have horizontal breathing room", visuals.left > scene.left && visuals.right < scene.right)
        assertTrue("The sleeve and vinyl have vertical breathing room", visuals.top > scene.top && visuals.bottom < scene.bottom)
        val before = compose.onNodeWithTag("player-record").fetchSemanticsNode().boundsInRoot
        val root = compose.onRoot().fetchSemanticsNode().boundsInRoot
        assertTrue("Artwork fills at least 58% of the portrait width", before.width >= root.width * 0.58f)
        val aura = compose.onNodeWithTag("player-record-aura").fetchSemanticsNode().boundsInRoot
        assertEquals("Aura follows the extended disc's spindle", before.left + before.width * (0.5f + RECORD_OUT), aura.center.x, 1.5f)
        assertEquals("Aura is vertically centered on the disc", before.center.y, aura.center.y, 1.5f)
        assertEquals("Aura uses the physical disc diameter", before.width * 0.96f, aura.width, 2f)
        assertEquals("The sleeve and extended disc are centered together", root.center.x, before.center.x + before.width * RECORD_OUT / 2, 1.5f)
        assertEquals("The artwork area starts below the header", header.bottom, scene.top, 1.5f)
        assertEquals("Artwork is centered in the area above the seekbar block", scene.center.y, before.center.y, 1.5f)
        val title = compose.onNodeWithText(tracks[0].title).fetchSemanticsNode().boundsInRoot
        assertTrue("The artwork area ends before the track metadata", scene.bottom <= title.top)
        assertTrue("The title belongs below the artwork", title.top > before.bottom)
        val footer = compose.onNodeWithTag("full-player-footer").getUnclippedBoundsInRoot()
        val controls = compose.onNodeWithTag("full-player-controls-region").getUnclippedBoundsInRoot()
        assertTrue("The entire footer fits without scrolling for a two-line title", footer.bottom <= controls.bottom)
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
        val pausedCover = compose.onNodeWithTag("player-record").fetchSemanticsNode().boundsInRoot
        val pausedAura = compose.onNodeWithTag("player-record-aura").fetchSemanticsNode().boundsInRoot
        assertEquals("Aura returns with the retracted disc", pausedCover.center.x, pausedAura.center.x, 1.5f)
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
