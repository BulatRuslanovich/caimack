// SPDX-License-Identifier: AGPL-3.0-only
package app.caimack.ui

import android.graphics.Bitmap
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.asAndroidBitmap
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.semantics.getOrNull
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.test.platform.app.InstrumentationRegistry
import app.caimack.CaimackApp
import app.caimack.api.ConnectCommand
import app.caimack.api.Track
import app.caimack.playback.PlayerState
import java.io.ByteArrayOutputStream
import java.io.File
import kotlinx.coroutines.runBlocking
import mockwebserver3.*
import okio.Buffer
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test

class PlayerSceneSwipeTest {
    @get:Rule val compose = createComposeRule()
    private val context = InstrumentationRegistry.getInstrumentation().targetContext
    private val container get() = (context.applicationContext as CaimackApp).container
    private lateinit var scene: PlayerScene
    private var state by mutableStateOf(PlayerState())
    private var jumps = 0

    private fun stateAt(index: Int, queue: List<Track> = state.queue) = PlayerState(queue = queue, index = index,
        nextIndex = (index + 1) % queue.size, previousIndex = (index - 1 + queue.size) % queue.size)

    private fun withScene(test: () -> Unit) {
        val web = MockWebServer()
        fun png(color: Int) = ByteArrayOutputStream().use { out ->
            Bitmap.createBitmap(64, 64, Bitmap.Config.ARGB_8888).apply { eraseColor(color) }
                .compress(Bitmap.CompressFormat.PNG, 100, out)
            out.toByteArray()
        }
        val images = mapOf("blue" to png(0xff306bc2.toInt()), "red" to png(0xffd74334.toInt()), "green" to png(0xff34a66a.toInt()))
        web.dispatcher = object : Dispatcher() {
            override fun dispatch(request: RecordedRequest): MockResponse {
                val id = images.keys.firstOrNull { request.url.encodedPath.contains(it) }
                return if (id == null) MockResponse.Builder().code(404).build() else
                    MockResponse.Builder().addHeader("Content-Type", "image/png").body(Buffer().write(images.getValue(id))).build()
            }
        }
        web.start()
        val player = container.player
        val oldServer = container.server.url.value
        val oldRoute = player.remoteRoute
        val oldSelected = player.remoteSelected
        val oldEffects = container.appearance.playerEffects.value
        val oldLocalHttp = container.connectionPreferences.allowLocalHttp.value
        check(context.packageName.endsWith(".uitest"))
        container.connectionPreferences.setAllowLocalHttp(true)
        if (android.os.Build.VERSION.SDK_INT >= 37) InstrumentationRegistry.getInstrumentation().uiAutomation.grantRuntimePermission(context.packageName, "android.permission.ACCESS_LOCAL_NETWORK")
        runBlocking { container.server.remember(web.url("/").toString()) }
        container.appearance.setPlayerEffects(true)
        val queue = images.keys.map { Track(it, it, "artist", "Artist", albumId = it, hasCover = true, durationSeconds = 200) }
        state = stateAt(0, queue)
        player.showRemote(state) { 0 }
        player.remoteSelected = { true }
        player.remoteRoute = { command ->
            if (command is ConnectCommand.Jump) {
                jumps++
                state = stateAt(command.index)
                player.showRemote(state) { 0 }
            }
            true
        }
        compose.setContent {
            CaimackTheme {
                CompositionLocalProvider(LocalContainer provides container) {
                    scene = rememberPlayerScene(state)
                    Box(Modifier.fillMaxSize()) {
                        PlayerSceneBackground(scene, Modifier.fillMaxSize())
                        PlayerSceneLayer(scene, Modifier.fillMaxSize()) { frame ->
                            Box(Modifier.fillMaxSize().testTag("swipe-art-${frame.key}")) {
                                Deck(frame.state, {}, Modifier.fillMaxSize())
                            }
                        }
                    }
                }
            }
        }
        try {
            compose.waitUntil(10_000) { ::scene.isInitialized && scene.current.surface.top != playerBackdropSurface(null).top }
            // All three colours are prefetched before the controlled gesture begins.
            compose.waitUntil(10_000) { web.requestCount >= 3 }
            Thread.sleep(300)
            compose.waitForIdle()
            compose.mainClock.autoAdvance = false
            test()
        } finally {
            compose.mainClock.autoAdvance = true
            compose.waitForIdle()
            player.remoteRoute = oldRoute
            player.remoteSelected = oldSelected
            player.showLocal()
            container.appearance.setPlayerEffects(oldEffects)
            container.connectionPreferences.setAllowLocalHttp(oldLocalHttp)
            runBlocking {
                if (oldServer != null) container.server.remember(oldServer.toString())
                else { container.preferences.edit { it.remove(stringPreferencesKey("server")) }; container.server.restore() }
            }
            web.close()
        }
    }

    private fun x(tag: String) = compose.onNodeWithTag(tag).fetchSemanticsNode().positionInRoot.x
    private fun aligned() {
        fun layers(prefix: String) = compose.onAllNodes(SemanticsMatcher(prefix) {
            it.config.getOrNull(SemanticsProperties.TestTag)?.startsWith(prefix) == true
        }).fetchSemanticsNodes().associate {
            it.config[SemanticsProperties.TestTag].removePrefix(prefix) to it.positionInRoot.x
        }
        val backgrounds = layers("player-background-frame-")
        val artwork = layers("swipe-art-")
        assertEquals(backgrounds.keys, artwork.keys)
        backgrounds.forEach { (key, position) -> assertEquals(position, artwork.getValue(key), 0.5f) }
        assertTrue(backgrounds.size <= 2)
        assertTrue("Only an outgoing and an incoming frame may exist", scene.frames.size <= 2)
    }
    private fun capture(name: String) {
        File(context.cacheDir, "scene-swipe-$name.png").outputStream().use {
            compose.onRoot().captureToImage().asAndroidBitmap().compress(Bitmap.CompressFormat.PNG, 100, it)
        }
    }

    @Test fun swipeHandsItsPositionToOneSharedTransitionWithoutReplayingTheMove() = withScene {
        val old = scene.current.key
        compose.onRoot().performTouchInput {
            down(center)
            advanceEventTime(200)
            moveBy(Offset(-width * 0.30f, 0f))
        }
        compose.mainClock.advanceTimeByFrame()
        aligned()
        val before = x("swipe-art-$old")
        assertTrue(before < -20)
        capture("drag")
        compose.onRoot().performTouchInput { up() }
        // The cover cache publishes from a coroutine after the player's acknowledgement.
        // Hold the gesture position until that frame is installed; do not race composition.
        repeat(20) {
            if (scene.current.key == old) {
                compose.mainClock.advanceTimeByFrame()
                Thread.sleep(8)
            }
        }
        compose.runOnIdle {
            assertEquals(1, jumps)
            assertEquals("1:red", scene.current.key)
        }
        aligned()
        assertEquals(before, x("swipe-art-$old"), 1f)
        val revision = scene.revision
        var previousX = x("swipe-art-1:red")
        repeat(12) { step ->
            compose.mainClock.advanceTimeBy(80)
            compose.runOnIdle {
                state = state.copy(buffering = step % 2 == 0)
            }
            aligned()
            val currentX = x("swipe-art-1:red")
            assertTrue("The incoming scene must not restart: $previousX -> $currentX", currentX <= previousX + 1f)
            previousX = currentX
            if (step == 3) capture("transition")
        }
        assertEquals(revision, scene.revision)
        assertFalse(scene.isRunning)
        assertEquals(0f, x("swipe-art-1:red"), 0.5f)
        assertEquals(1, scene.frames.size)
        capture("settled")
    }

    @Test fun cancelledSwipeReturnsBackgroundAndArtworkTogetherWithoutChangingTrack() = withScene {
        compose.onRoot().performTouchInput {
            down(center)
            advanceEventTime(500)
            moveBy(Offset(-width * 0.06f, 0f))
            advanceEventTime(500)
        }
        compose.mainClock.advanceTimeByFrame()
        aligned()
        compose.onRoot().performTouchInput { up() }
        compose.mainClock.advanceTimeBy(400)
        aligned()
        compose.runOnIdle {
            assertEquals(0, jumps)
            assertEquals("0:blue", scene.current.key)
            assertEquals(1, scene.frames.size)
            assertFalse(scene.isRunning)
        }
        assertEquals(0f, x("swipe-art-0:blue"), 0.5f)
    }

    @Test fun backwardsSwipeAndItsCancellationKeepThePreviousColourOnTheLeft() = withScene {
        compose.runOnIdle { state = stateAt(1) }
        compose.mainClock.advanceTimeBy(1200)
        assertEquals("1:red", scene.current.key)
        val previousSurface = scene.frames.single().surface
        fun startBack(distance: Float) {
            compose.onRoot().performTouchInput {
                down(center)
                advanceEventTime(500)
                moveBy(Offset(width * distance, 0f))
                advanceEventTime(500)
            }
            compose.mainClock.advanceTimeByFrame()
            aligned()
            assertEquals("0:blue", scene.preview?.key)
            assertTrue("The previous cover must carry its own cached colour", scene.preview!!.surface != previousSurface)
            assertTrue("The previous background enters from the left", scene.position("0:blue") < 0)
        }
        startBack(0.06f)
        compose.onRoot().performTouchInput { up() }
        repeat(5) {
            compose.mainClock.advanceTimeBy(32)
            aligned()
            if (scene.preview != null) assertTrue(scene.position("0:blue") < 0)
        }
        compose.mainClock.advanceTimeBy(400)
        assertEquals("1:red", scene.current.key)
        assertEquals(previousSurface, scene.current.surface)
        assertEquals(0, jumps)
        startBack(0.30f)
        val before = x("swipe-art-1:red")
        compose.onRoot().performTouchInput { up() }
        repeat(20) {
            if (scene.current.key != "0:blue") {
                compose.mainClock.advanceTimeByFrame()
                Thread.sleep(8)
            }
        }
        assertEquals("0:blue", scene.current.key)
        assertEquals(before, x("swipe-art-1:red"), 1f)
        repeat(16) {
            compose.mainClock.advanceTimeBy(80)
            aligned()
        }
        assertEquals(1, jumps)
        assertEquals(0f, x("swipe-art-0:blue"), 0.5f)
        assertTrue(scene.current.surface != previousSurface)
        capture("backwards-settled")
    }

    @Test fun rapidTrackChangesKeepTwoFramesAndOnlyTheLatestPendingDestination() = withScene {
        compose.runOnIdle { state = stateAt(1) }
        compose.mainClock.advanceTimeBy(240)
        val started = scene.revision
        compose.runOnIdle { state = stateAt(2) }
        aligned()
        compose.mainClock.advanceTimeBy(80)
        compose.runOnIdle { state = stateAt(0) }
        aligned()
        compose.mainClock.advanceTimeBy(80)
        compose.runOnIdle { state = stateAt(2) }
        aligned()
        repeat(25) {
            compose.mainClock.advanceTimeBy(80)
            aligned()
        }
        assertEquals(started + 1, scene.revision)
        assertEquals("2:green", scene.current.key)
        assertFalse(scene.isRunning)
        assertEquals(1, scene.frames.size)
    }

    @Test fun shuffleAndRadioQueueChangesDoNotAnimateOrRemountThePlayingTrack() = withScene {
        val key = scene.current.key
        val revision = scene.revision
        val record = compose.onNodeWithTag("player-record").fetchSemanticsNode().boundsInRoot
        val original = state.queue
        fun unchanged() {
            aligned()
            assertEquals(key, scene.current.key)
            assertEquals(revision, scene.revision)
            assertEquals(1, scene.frames.size)
            assertFalse(scene.isRunning)
            assertEquals(0f, scene.position(key), 0.5f)
            assertEquals(record, compose.onNodeWithTag("player-record").fetchSemanticsNode().boundsInRoot)
        }
        compose.runOnIdle { state = stateAt(2, listOf(original[1], original[2], original[0])) }
        compose.mainClock.advanceTimeByFrame()
        unchanged()
        assertEquals(2, scene.current.state.index)
        compose.runOnIdle { state = stateAt(0, listOf(original[0], original[2])) }
        compose.mainClock.advanceTimeByFrame()
        unchanged()
        assertEquals(0, scene.current.state.index)
        // The retained scene must use the new radio neighbours for its next swipe.
        compose.onRoot().performTouchInput { swipe(center, center + Offset(-width * 0.30f, 0f), 300) }
        repeat(20) {
            compose.mainClock.advanceTimeBy(80)
            Thread.sleep(8)
        }
        aligned()
        assertEquals("green", scene.current.state.current?.id)
        assertEquals(1, jumps)
    }

    @Test fun repeatedOccurrencesAfterShuffleDoNotCreateTwoLayersWithTheSameKey() = withScene {
        val revision = scene.revision
        val original = state.queue
        compose.runOnIdle { state = stateAt(2, listOf(original[0], original[1], original[0])) }
        compose.mainClock.advanceTimeByFrame()
        compose.onRoot().performTouchInput { swipe(center, center + Offset(-width * 0.30f, 0f), 300) }
        repeat(20) {
            compose.mainClock.advanceTimeBy(80)
            Thread.sleep(8)
        }
        aligned()
        assertEquals(0, scene.current.state.index)
        assertEquals("blue", scene.current.state.current?.id)
        assertEquals(revision, scene.revision)
        assertEquals(1, scene.frames.size)
        assertFalse(scene.isRunning)
        assertEquals(1, jumps)
    }
}
