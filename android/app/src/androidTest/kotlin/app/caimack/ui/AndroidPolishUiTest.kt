// SPDX-License-Identifier: AGPL-3.0-only
package app.caimack.ui

import android.content.res.Configuration
import android.graphics.Bitmap
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Surface
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.asAndroidBitmap
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.unit.Density
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.unit.dp
import androidx.test.platform.app.InstrumentationRegistry
import app.caimack.CaimackApp
import app.caimack.api.Track
import app.caimack.api.LyricLine
import app.caimack.api.LyricWord
import app.caimack.playback.PlayerState
import app.caimack.updates.AppRelease
import app.caimack.updates.UpdateState
import java.io.ByteArrayOutputStream
import java.io.File
import java.util.Locale
import java.util.concurrent.TimeUnit
import mockwebserver3.*
import okio.Buffer
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import kotlinx.coroutines.runBlocking
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.stringPreferencesKey

class AndroidPolishUiTest {
    @get:Rule val compose = createComposeRule()
    private val instrumentation = InstrumentationRegistry.getInstrumentation()
    private val context = instrumentation.targetContext
    private val container get() = (context.applicationContext as CaimackApp).container
    private fun screenshot(name: String) {
        File(context.cacheDir, "polish-$name.png").outputStream().use {
            instrumentation.uiAutomation.takeScreenshot().compress(Bitmap.CompressFormat.PNG, 100, it)
        }
    }

    @Test fun titleLengthDoesNotResizeOrMoveTheRecord() {
        val tracks = listOf("Short title", "Очень длинное название композиции с дополнительным описанием, именами исполнителей и названием концертной версии записи")
            .mapIndexed { index, title -> Track("title-$index", title, "artist", "Artist", durationSeconds = 200) }
        var state by mutableStateOf(PlayerState(queue = tracks))
        var fontScale by mutableFloatStateOf(1f)
        val effects = container.appearance.playerEffects.value
        container.appearance.setPlayerEffects(false)
        compose.setContent {
            val density = LocalDensity.current
            CompositionLocalProvider(LocalContainer provides container, LocalDensity provides Density(density.density, fontScale)) {
                CaimackTheme { FullPlayer(state, {}) }
            }
        }
        try {
            for (scale in listOf(1f, 1.3f)) {
                compose.runOnIdle { fontScale = scale; state = state.copy(index = 0) }
                compose.waitForIdle()
                val record = compose.onNodeWithTag("player-record").fetchSemanticsNode().boundsInRoot
                val controls = compose.onNodeWithTag("full-player-transport").fetchSemanticsNode().boundsInRoot
                for (index in listOf(1, 0)) {
                    compose.runOnIdle { state = state.copy(index = index) }
                    compose.waitForIdle()
                    assertEquals(record, compose.onNodeWithTag("player-record").fetchSemanticsNode().boundsInRoot)
                    assertEquals(controls, compose.onNodeWithTag("full-player-transport").fetchSemanticsNode().boundsInRoot)
                }
            }
            screenshot("stable-title-layout")
        } finally { container.appearance.setPlayerEffects(effects) }
    }

    @Test fun wordHighlightIsBrightAndFollowsItsTimestamp() {
        var at by mutableLongStateOf(900)
        // Exercise the downloaded text after a restart with all network access failing.
        val line = runBlocking {
            val context = InstrumentationRegistry.getInstrumentation().targetContext
            val directory = java.nio.file.Files.createTempDirectory(context.cacheDir.toPath(), "lyrics-test-").toFile()
            val json = kotlinx.serialization.json.Json { ignoreUnknownKeys = true }
            val rich = app.caimack.api.Lyrics(lines = listOf(
                LyricLine(at = 1000, text = "Sing with me", words = listOf(LyricWord(1000, 2000, "Sing with me"))),
            ))
            var now = 0L
            var response = rich.copy(lines = rich.lines.map { it.copy(words = emptyList()) })
            try {
                val cache = app.caimack.playback.DownloadedLyrics(directory, json, { "test-account" }, { setOf("song") },
                    { retrofit2.Response.success(response) }, { now })
                assertTrue(cache.refresh(listOf("song")))
                now += 15_000
                response = rich
                assertFalse(cache.refresh(listOf("song")))
                val restored = app.caimack.playback.DownloadedLyrics(directory, json, { "test-account" }, { setOf("song") },
                    { throw java.io.IOException("Network unavailable") })
                restored.load("song", offline = true).lines.single()
            } finally { directory.deleteRecursively() }
        }
        compose.setContent {
            CaimackTheme {
                Box(Modifier.fillMaxSize().background(Color(0xff243c5b)).padding(24.dp)) {
                    TimedLyricText(line, { at }, Type.section, Color.White, Color.White.copy(alpha = 0.65f), Modifier.testTag("lyric-highlight"))
                }
            }
        }
        fun brightPixels(): Int {
            val bitmap = compose.onNodeWithTag("lyric-highlight").captureToImage().asAndroidBitmap()
            var count = 0
            for (y in 0 until bitmap.height) for (x in 0 until bitmap.width) {
                val pixel = bitmap.getPixel(x, y)
                if (listOf(0, 8, 16).all { ((pixel shr it) and 255) >= 240 }) count++
            }
            return count
        }
        assertEquals(0, brightPixels())
        compose.runOnIdle { at = 1500 }
        val half = brightPixels()
        assertTrue(half > 20)
        compose.runOnIdle { at = 2000 }
        assertTrue(brightPixels() > half)
    }

    @Test fun settingsActionsAndUpdateStatesFitRussianText() {
        var page by mutableIntStateOf(0)
        var added by mutableStateOf(false)
        var details by mutableStateOf(false)
        var checks = 0
        val release = AppRelease("v9.8.7", "## Изменения\n- Улучшена синхронизация текста песен\n- Исправлено переключение треков\n\nОбновление клиента Android.", "https://example.com/app.apk", "https://example.com/release")
        val configuration = Configuration(context.resources.configuration).apply { setLocale(Locale.forLanguageTag("ru")); fontScale = 1.2f }
        val localized = context.createConfigurationContext(configuration)
        compose.setContent {
            CompositionLocalProvider(LocalContext provides localized, LocalConfiguration provides configuration, LocalContainer provides container) {
                CaimackTheme {
                    Surface(Modifier.fillMaxSize(), color = LocalPalette.current.background) {
                        Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(top = 24.dp)) {
                            when (page) {
                                0 -> {
                                    Column(Modifier.padding(24.dp)) { QuickSettingsTile(added) { added = true } }
                                    SettingsAbout()
                                }
                                1 -> UpdatesPanel(UpdateState(checked = true, published = true), { checks++ }, {})
                                2 -> UpdatesPanel(UpdateState(checking = true), { checks++ }, {})
                                3 -> UpdatesPanel(UpdateState(checked = true, failed = true), { checks++ }, {})
                                else -> UpdatesPanel(UpdateState(checked = true, published = true, release = release), { checks++ }, { details = true })
                            }
                        }
                    }
                    if (details) UpdateDetails(release) { details = false }
                }
            }
        }
        compose.onNodeWithText(localized.getString(app.caimack.R.string.settings_tile_add)).performClick()
        compose.onNodeWithText(localized.getString(app.caimack.R.string.settings_tile_added)).assertIsDisplayed()
        screenshot("settings-about")
        for (value in 1..4) {
            compose.runOnIdle { page = value }
            compose.waitForIdle()
            screenshot("updates-$value")
        }
        compose.onNodeWithText(localized.getString(app.caimack.R.string.update_whats_new)).performClick()
        compose.waitForIdle()
        screenshot("release-notes")
        compose.waitUntil(5_000) { compose.onNodeWithText(localized.getString(app.caimack.R.string.update_download)).isDisplayed() }
        compose.onNodeWithText(localized.getString(app.caimack.R.string.update_download)).assertIsDisplayed()
        screenshot("release-notes")
    }

    @Test fun artworkAndBackgroundShareOneTransitionWithoutAnOpeningSlide() {
        fun image(color: Int): ByteArray = ByteArrayOutputStream().use { out ->
            Bitmap.createBitmap(64, 64, Bitmap.Config.ARGB_8888).apply { eraseColor(color) }.compress(Bitmap.CompressFormat.PNG, 100, out)
            out.toByteArray()
        }
        val web = MockWebServer()
        web.dispatcher = object : Dispatcher() {
            override fun dispatch(request: RecordedRequest): MockResponse = MockResponse.Builder().addHeader("Content-Type", "image/png")
                .body(Buffer().write(image(if (request.url.encodedPath.contains("red")) 0xffd74334.toInt() else 0xff306bc2.toInt())))
                .bodyDelay(180, TimeUnit.MILLISECONDS).build()
        }
        web.start()
        val oldServer = container.server.url.value
        runBlocking { container.server.remember(web.url("/").toString()) }
        val tracks = listOf("blue", "red").map { Track(it, it, "artist", "Artist", albumId = it, hasCover = true, durationSeconds = 200) }
        var state by mutableStateOf(PlayerState(queue = tracks))
        var scene: PlayerScene? = null
        val originalEffects = container.appearance.playerEffects.value
        container.appearance.setPlayerEffects(true)
        compose.setContent {
            CaimackTheme {
                CompositionLocalProvider(LocalContainer provides container, LocalArtworkResolver provides { url ->
                    web.url(if (url.contains("red")) "/red" else "/blue").toString()
                }) {
                    val current = rememberPlayerScene(state)
                    SideEffect { scene = current }
                    Box(Modifier.fillMaxSize()) {
                        PlayerSceneBackground(current, Modifier.fillMaxSize())
                        PlayerSceneLayer(current, Modifier.fillMaxSize()) { frame ->
                            Box(Modifier.fillMaxSize().testTag("record-frame-${frame.key}")) { Deck(frame.state, {}, Modifier.fillMaxSize()) }
                        }
                    }
                }
            }
        }
        try {
            compose.waitUntil(10_000) { scene?.current?.surface?.top?.let { it != playerBackdropSurface(null).top } == true }
            compose.waitForIdle()
            assertFalse(scene!!.isRunning)
            assertEquals(0f, compose.onNodeWithTag("record-frame-0:blue").fetchSemanticsNode().boundsInRoot.left, 0.5f)
            screenshot("player-open")
            compose.mainClock.autoAdvance = false
            compose.runOnIdle { state = state.copy(index = 1) }
            repeat(70) { compose.mainClock.advanceTimeByFrame(); Thread.sleep(8) }
            // Start a fresh transition backwards with both colours already cached.
            compose.mainClock.advanceTimeBy(1200)
            compose.runOnIdle { state = state.copy(index = 0) }
            compose.mainClock.advanceTimeBy(240)
            val record = compose.onNodeWithTag("record-frame-0:blue").fetchSemanticsNode().positionInRoot.x
            val backdrop = compose.onNodeWithTag("player-background-frame-0:blue").fetchSemanticsNode().positionInRoot.x
            assertEquals(backdrop, record, 0.5f)
            screenshot("player-transition")
            assertTrue("The entering scene must still be moving: x=$record", kotlin.math.abs(record) in 1f..(context.resources.displayMetrics.widthPixels - 1).toFloat())
            compose.mainClock.advanceTimeBy(1200)
            compose.mainClock.autoAdvance = true
            compose.waitForIdle()
            assertFalse(scene!!.isRunning)
        } finally {
            container.appearance.setPlayerEffects(originalEffects)
            runBlocking {
                if (oldServer != null) container.server.remember(oldServer.toString())
                else { container.preferences.edit { it.remove(stringPreferencesKey("server")) }; container.server.restore() }
            }
            web.close()
        }
    }
}
