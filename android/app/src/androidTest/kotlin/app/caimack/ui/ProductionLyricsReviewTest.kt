// SPDX-License-Identifier: AGPL-3.0-only
package app.caimack.ui

import android.graphics.Bitmap
import android.media.AudioManager
import android.content.Context
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.Surface
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.test.platform.app.InstrumentationRegistry
import app.caimack.CaimackApp
import java.io.File
import kotlinx.coroutines.runBlocking
import org.junit.Assert.*
import org.junit.Assume.assumeTrue
import org.junit.Rule
import org.junit.Test

/** Explicit opt-in review against a connected server; credentials are instrumentation arguments. */
class ProductionLyricsReviewTest {
    @get:Rule val compose = createComposeRule()

    @Test fun lyricsFollowTheLiveAndroidPlaybackClock() {
        val args = InstrumentationRegistry.getArguments()
        val address = args.getString("reviewServer")
        assumeTrue(address != null)
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        val context = instrumentation.targetContext
        val container = (context.applicationContext as CaimackApp).container
        val track = runBlocking {
            assertNull(container.session.login(address!!, args.getString("reviewUser")!!, args.getString("reviewPassword")!!))
            container.api.tracks(1, 10, query = "85 Again").items.first { it.hasLyrics == true }
        }
        val lyrics = runBlocking { container.api.lyrics(track.id).body()!! }
        assertTrue(lyrics.lines.any { it.words.isNotEmpty() })
        Remote.update("lyrics:${track.id}", lyrics)
        val player = container.player
        val audio = context.getSystemService(Context.AUDIO_SERVICE) as AudioManager
        val originalVolume = audio.getStreamVolume(AudioManager.STREAM_MUSIC)
        val originalEffects = container.appearance.playerEffects.value
        audio.setStreamVolume(AudioManager.STREAM_MUSIC, 0, 0)
        compose.mainClock.autoAdvance = false
        compose.setContent {
            CaimackTheme(dark = true) {
                CompositionLocalProvider(LocalContainer provides container) {
                    val state by player.state.collectAsState()
                    val position = rememberPosition(state)
                    Surface(Modifier.fillMaxSize(), color = Color(0xff243c5b)) { LyricsPanel(track, position, state.playing) }
                }
            }
        }
        try {
            compose.runOnUiThread { player.executeLocal { player.play(listOf(track), 0) } }
            compose.waitUntil(20_000) {
                compose.mainClock.advanceTimeByFrame()
                player.state.value.current?.id == track.id && player.state.value.playing && !player.state.value.buffering
            }
            val at = lyrics.lines.first().at + 900
            compose.runOnUiThread { player.executeLocal { player.seekTo(at) } }
            var position = 0L
            compose.waitUntil(10_000) {
                compose.mainClock.advanceTimeByFrame()
                compose.runOnUiThread { position = player.position }
                position in at..(at + 6000)
            }
            val samples = mutableListOf<String>()
            repeat(20) { sample ->
                if (sample == 10) container.appearance.setPlayerEffects(false)
                Thread.sleep(25)
                compose.mainClock.advanceTimeByFrame()
                compose.runOnUiThread { position = player.position }
                val expected = lyrics.lines.indexOfLast { it.at <= position }
                compose.onNodeWithTag("lyrics-line-$expected").assertIsSelected()
                samples += "{\"positionMs\":$position,\"activeLine\":$expected}"
            }
            File(context.cacheDir, "polish-lyrics-clock.json").writeText("{\"server\":\"$address\",\"trackId\":\"${track.id}\",\"samples\":[${samples.joinToString()}]}")
            File(context.cacheDir, "polish-lyrics-live.png").outputStream().use {
                instrumentation.uiAutomation.takeScreenshot().compress(Bitmap.CompressFormat.PNG, 100, it)
            }
        } finally {
            compose.runOnUiThread { player.executeLocal { player.stop() } }
            compose.mainClock.autoAdvance = true
            audio.setStreamVolume(AudioManager.STREAM_MUSIC, originalVolume, 0)
            container.appearance.setPlayerEffects(originalEffects)
        }
    }
}
