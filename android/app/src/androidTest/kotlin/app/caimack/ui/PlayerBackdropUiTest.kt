// SPDX-License-Identifier: AGPL-3.0-only
package app.caimack.ui

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.SideEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.asAndroidBitmap
import androidx.compose.ui.test.captureToImage
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onRoot
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.test.platform.app.InstrumentationRegistry
import app.caimack.CaimackApp
import app.caimack.api.Track
import app.caimack.playback.PlayerState
import java.io.ByteArrayOutputStream
import java.io.File
import java.util.concurrent.TimeUnit
import kotlinx.coroutines.runBlocking
import mockwebserver3.Dispatcher
import mockwebserver3.MockResponse
import mockwebserver3.MockWebServer
import mockwebserver3.RecordedRequest
import okio.Buffer
import org.junit.Assert.*
import org.junit.Assume.assumeTrue
import org.junit.Rule
import org.junit.Test

class PlayerBackdropUiTest {
    @get:Rule val compose = createComposeRule()

    private fun png(color: Int): ByteArray = ByteArrayOutputStream().use { out ->
        Bitmap.createBitmap(64, 64, Bitmap.Config.ARGB_8888).apply { eraseColor(color) }
            .compress(Bitmap.CompressFormat.PNG, 100, out)
        out.toByteArray()
    }

    private fun image(bytes: ByteArray) = MockResponse.Builder().addHeader("Content-Type", "image/png").body(Buffer().write(bytes))
    private fun topPixel(): Int {
        val bitmap = compose.onNodeWithTag("player-backdrop").captureToImage().asAndroidBitmap()
        return bitmap.getPixel(bitmap.width / 2, 2)
    }

    @Test fun lateLoadCannotReplaceCurrentCoverAndFailuresBecomeNeutral() {
        val server = MockWebServer()
        server.dispatcher = object : Dispatcher() {
            override fun dispatch(request: RecordedRequest) = when (request.url.encodedPath) {
                "/slow" -> image(png(0xffd52b35.toInt())).bodyDelay(700, TimeUnit.MILLISECONDS).build()
                "/blue" -> image(png(0xff2864c8.toInt())).build()
                else -> MockResponse.Builder().code(404).build()
            }
        }
        server.start()
        val container = (InstrumentationRegistry.getInstrumentation().targetContext.applicationContext as CaimackApp).container
        var url by mutableStateOf<String?>(server.url("/slow").toString())
        var accent: CoverTone? = null
        compose.setContent {
            CaimackTheme {
                CompositionLocalProvider(LocalContainer provides container) {
                    val currentAccent = rememberPlayerCoverTone(url)
                    SideEffect { accent = currentAccent }
                    PlayerBackdrop(url, 0, 1, Modifier.fillMaxSize())
                }
            }
        }
        try {
            assertNotNull(server.takeRequest(5, TimeUnit.SECONDS))
            compose.runOnIdle { url = server.url("/blue").toString() }
            Thread.sleep(1200)
            compose.waitForIdle()
            val blue = topPixel()
            assertTrue((blue and 255) > ((blue shr 16) and 255) + 20)
            val expected = playerBackdropTone(IntArray(64 * 64) { 0xff2864c8.toInt() })!!
            assertEquals(expected.hue, accent!!.hue, 0.0001)
            assertEquals(expected.chroma, accent!!.chroma, 0.0001)
            compose.runOnIdle { url = server.url("/missing").toString() }
            Thread.sleep(400)
            compose.waitForIdle()
            assertEquals(0xff525252.toInt(), topPixel())
            assertNull(accent)
            val requests = server.requestCount
            compose.runOnIdle { url = server.url("/blue").toString() }
            compose.waitForIdle()
            assertEquals(blue, topPixel())
            assertEquals(requests, server.requestCount)
            compose.runOnIdle { url = null }
            compose.waitForIdle()
            assertEquals(0xff525252.toInt(), topPixel())
            assertNull(accent)
        } finally { server.close() }
    }

    /** Optional visual audit: supply the locally captured reference assets via a Gradle init script. */
    @Test fun capturedReferencesRenderInTheFullPlayer() {
        assumeTrue(InstrumentationRegistry.getArguments().getString("backdropFixtures") == "true")
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        val assets = instrumentation.context.assets
        val names = assets.list("player-backdrop")!!.filter { it.endsWith("-cover.png") }.sorted()
        assertTrue(names.size >= 5)
        val container = (instrumentation.targetContext.applicationContext as CaimackApp).container
        val oldServer = container.server.url.value
        val server = MockWebServer()
        server.dispatcher = object : Dispatcher() {
            override fun dispatch(request: RecordedRequest): MockResponse {
                val name = request.url.encodedPath.substringAfter("/api/albums/").substringBefore("/cover")
                return if ("$name-cover.png" in names) image(assets.open("player-backdrop/$name-cover.png").readBytes()).build()
                else MockResponse.Builder().addHeader("Content-Type", "application/json").body("{\"peaks\":[]}").build()
            }
        }
        server.start()
        runBlocking { container.server.remember(server.url("/").toString()) }
        val tracks = names.map { file ->
            val name = file.removeSuffix("-cover.png")
            Track(id = name, title = name.substringAfter('-').replace('-', ' '), artistId = "visual", artistName = "Background comparison", albumId = name, hasCover = true, durationSeconds = 200)
        }
        var state by mutableStateOf(PlayerState(queue = tracks))
        compose.setContent {
            CaimackTheme(dark = false) {
                CompositionLocalProvider(LocalContainer provides container) { FullPlayer(state, onClose = {}) }
            }
        }
        try {
            tracks.forEachIndexed { index, track ->
                val original = assets.open("player-backdrop/${track.id}-cover.png").use { BitmapFactory.decodeStream(it) }
                val edge = PlayerBackdropSettings.sampleEdge
                val sampled = Bitmap.createScaledBitmap(original, edge, edge, true)
                val pixels = IntArray(edge * edge)
                sampled.getPixels(pixels, 0, edge, 0, 0, edge, edge)
                val expected = playerBackdropSurface(playerBackdropTone(pixels)).top
                compose.runOnIdle { state = PlayerState(queue = tracks, index = index) }
                // Network/worker completion is not covered by Compose's idling resource.
                // Wait for the rendered colour and the end of the slide, not a fixed delay.
                compose.waitUntil(15_000) {
                    val bitmap = compose.onNodeWithTag("player-backdrop").captureToImage().asAndroidBitmap()
                    val left = bitmap.getPixel(2, 2)
                    val right = bitmap.getPixel(bitmap.width - 3, 2)
                    left == right && listOf(0, 8, 16).all { shift ->
                        kotlin.math.abs(((left shr shift) and 255) - ((expected shr shift) and 255)) <= 10
                    }
                }
                compose.waitForIdle()
                val output = File(instrumentation.targetContext.cacheDir, "player-background-${track.id}.png")
                output.outputStream().use { compose.onRoot().captureToImage().asAndroidBitmap().compress(Bitmap.CompressFormat.PNG, 100, it) }
                val bitmap = compose.onNodeWithTag("player-backdrop").captureToImage().asAndroidBitmap()
                // A one-hue vertical fill has no horizontal colour variation or cover texture.
                assertEquals(bitmap.getPixel(2, bitmap.height / 2), bitmap.getPixel(bitmap.width - 3, bitmap.height / 2))
            }
        } finally {
            runBlocking {
                if (oldServer != null) container.server.remember(oldServer.toString())
                else { container.preferences.edit { it.remove(stringPreferencesKey("server")) }; container.server.restore() }
            }
            server.close()
        }
    }
}
