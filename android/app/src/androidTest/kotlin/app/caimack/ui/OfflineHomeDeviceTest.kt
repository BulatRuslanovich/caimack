// SPDX-License-Identifier: AGPL-3.0-only
package app.caimack.ui

import android.graphics.Bitmap
import android.graphics.Color
import androidx.compose.ui.graphics.asAndroidBitmap
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.v2.createAndroidComposeRule
import androidx.test.platform.app.InstrumentationRegistry
import app.caimack.CaimackApp
import app.caimack.MainActivity
import app.caimack.R
import app.caimack.api.*
import app.caimack.audiobooks.Audiobook
import app.caimack.audiobooks.AudiobookChapter
import java.io.ByteArrayOutputStream
import java.util.concurrent.atomic.AtomicInteger
import java.util.concurrent.atomic.AtomicBoolean
import kotlinx.coroutines.runBlocking
import mockwebserver3.*
import okio.Buffer
import org.junit.Rule
import org.junit.Test

class OfflineHomeDeviceTest {
    @get:Rule val compose = createAndroidComposeRule<MainActivity>()

    private fun awaitText(text: String) = compose.waitUntil(15_000) {
        compose.onAllNodesWithText(text).fetchSemanticsNodes().isNotEmpty()
    }

    @Test fun downloadedBookCoverRefreshesOnTheOpenScreenAfterReconnect() {
        check(compose.activity.packageName.endsWith(".uitest"))
        val container = (compose.activity.application as CaimackApp).container
        val originalHttp = container.connectionPreferences.allowLocalHttp.value
        val online = AtomicBoolean(true)
        val version = AtomicInteger(1)
        val audioRequests = AtomicInteger()
        val audio = InstrumentationRegistry.getInstrumentation().context.assets.open("sync/tone.mp3").use { it.readBytes() }
        val chapter = AudiobookChapter("chapter", "Chapter", 2_000, audio.size.toLong(), "/api/book-audio")
        fun book() = Audiobook("cover-book", "Cover test book", durationMs = 2_000, chapters = listOf(chapter),
            coverUrl = "/api/audiobooks/cover-book/cover?v=${version.get()}")
        fun png(color: Int): ByteArray = ByteArrayOutputStream().use { output ->
            val bitmap = Bitmap.createBitmap(8, 8, Bitmap.Config.ARGB_8888)
            bitmap.eraseColor(color)
            bitmap.compress(Bitmap.CompressFormat.PNG, 100, output)
            bitmap.recycle()
            output.toByteArray()
        }
        val colors = listOf(Color.rgb(218, 17, 66), Color.rgb(15, 119, 217))
        val images = colors.map(::png)
        fun awaitCover(color: Int) {
            compose.waitUntil(8_000) {
                val screen = compose.onRoot().captureToImage().asAndroidBitmap()
                (0 until screen.height step 8).sumOf { y ->
                    (0 until screen.width step 8).count { x -> screen.getPixel(x, y) == color }
                } > 40
            }
        }
        MockWebServer().use { web ->
            web.dispatcher = object : Dispatcher() {
                override fun dispatch(request: RecordedRequest): MockResponse {
                    if (!online.get()) return MockResponse.Builder().code(503).build()
                    val body = when (request.url.encodedPath) {
                        "/api/auth/login", "/api/auth/me" -> container.json.encodeToString(User("covers", "Cover listener"))
                        "/api/config", "/api/me/settings" -> "{}"
                        "/api/home/feed" -> """{"blocks":[]}"""
                        "/api/experiments/audiobooks" -> """{"enabled":true}"""
                        "/api/audiobooks" -> container.json.encodeToString(listOf(book()))
                        "/api/audiobooks/cover-book/cover" -> {
                            val image = request.url.queryParameter("v")?.toIntOrNull()?.let { images.getOrNull(it - 1) }
                                ?: return MockResponse.Builder().code(404).build()
                            return MockResponse.Builder().addHeader("Content-Type", "image/png").body(Buffer().write(image)).build()
                        }
                        "/api/book-audio" -> {
                            audioRequests.incrementAndGet()
                            return MockResponse.Builder().body(Buffer().write(audio)).build()
                        }
                        else -> return MockResponse.Builder().code(404).build()
                    }
                    return MockResponse.Builder().addHeader("Content-Type", "application/json").body(body).build()
                }
            }
            web.start()
            try {
                container.connectionPreferences.setAllowLocalHttp(true)
                runBlocking { check(container.session.login(web.url("/").toString(), "covers", "fixture") == null) }
                compose.waitUntil(15_000) { container.audiobookStore.state.value.books.any { it.id == book().id } }
                container.audiobookStore.download(book())
                compose.waitUntil(15_000) { book().id in container.audiobookStore.state.value.downloaded }
                compose.onNode(hasText(compose.activity.getString(R.string.nav_audiobooks)) and hasClickAction()).performClick()
                awaitText(book().title)
                awaitCover(colors.first())
                fun disconnect() {
                    online.set(false)
                    runBlocking { container.api.homeFeed() }
                    container.audiobookStore.requestRefresh()
                    compose.waitUntil(8_000) { !container.audiobookStore.state.value.online }
                }
                disconnect()
                awaitCover(colors.first())
                version.set(2)
                online.set(true)
                container.refreshLibraryConnection()
                awaitCover(colors.last())
                disconnect()
                check(container.audiobookStore.cover(book())?.startsWith("file:") == true)
                awaitCover(colors.last())
                check(audioRequests.get() == 1)
            } finally {
                online.set(true)
                runBlocking { container.session.logout() }
                container.connectionPreferences.setAllowLocalHttp(originalHttp)
                Remote.cache.clear()
            }
        }
    }

    @Test fun homeSurvivesLossOfServerAndReopensWithOnlyPlayableMusic() {
        check(compose.activity.packageName.endsWith(".uitest"))
        val container = (compose.activity.application as CaimackApp).container
        val originalHttp = container.connectionPreferences.allowLocalHttp.value
        val saved = Track("offline-home-saved", "Saved recording", "artist", "Artist", durationSeconds = 5)
        val missing = saved.copy(id = "offline-home-missing", title = "Server recording")
        val user = User("offline-home", "Home listener")
        val online = AtomicBoolean(true)
        val includeMix = AtomicBoolean(false)
        val audio = InstrumentationRegistry.getInstrumentation().context.assets.open("sync/tone.mp3").use { it.readBytes() }
        val chapter = AudiobookChapter("chapter", "Chapter", 2_000, audio.size.toLong(), "/api/book-audio")
        val localBook = Audiobook("local-book", "Downloaded book", durationMs = 2_000, chapters = listOf(chapter))
        val remoteBook = localBook.copy(id = "remote-book", title = "Online-only book")
        MockWebServer().use { web ->
            web.dispatcher = object : Dispatcher() {
                override fun dispatch(request: RecordedRequest): MockResponse {
                    if (!online.get()) return MockResponse.Builder().code(503).build()
                    val body = when (request.url.encodedPath) {
                        "/api/auth/login", "/api/auth/me" -> container.json.encodeToString(user)
                        "/api/experiments/audiobooks" -> """{"enabled":true}"""
                        "/api/audiobooks" -> container.json.encodeToString(listOf(localBook, remoteBook))
                        "/api/book-audio" -> return MockResponse.Builder().body(Buffer().write(audio)).build()
                        "/api/config", "/api/me/settings" -> "{}"
                        "/api/home/feed" -> container.json.encodeToString(HomeFeed(if (includeMix.get()) listOf(
                            HomeBlock("daily", "dailyMix", "Hero", "Lead", tracks = listOf(missing, saved))
                        ) else emptyList()))
                        "/api/tracks/${saved.id}/stream" -> return MockResponse.Builder().addHeader("Content-Type", "audio/mpeg").body(Buffer().write(audio)).build()
                        else -> return MockResponse.Builder().code(404).build()
                    }
                    return MockResponse.Builder().addHeader("Content-Type", "application/json").body(body).build()
                }
            }
            web.start()
            try {
                container.connectionPreferences.setAllowLocalHttp(true)
                runBlocking {
                    check(container.session.login(web.url("/").toString(), user.username, "fixture") == null)
                    container.downloads.addInBackground(listOf(saved), UserSettings(quality = "Original"))
                }
                compose.waitUntil(15_000) { saved.id in container.localLibrary.value.trackIds }
                compose.waitUntil(15_000) { container.audiobookStore.state.value.books.size == 2 }
                container.audiobookStore.download(localBook)
                compose.waitUntil(15_000) { localBook.id in container.audiobookStore.state.value.downloaded }
                fun disconnect() {
                    online.set(false)
                    runBlocking { container.api.homeFeed() }
                    compose.waitUntil(5_000) { container.libraryCache.offline.value }
                }
                disconnect()
                awaitText(compose.activity.getString(R.string.home_downloaded))
                val play = hasContentDescription(compose.activity.getString(R.string.action_play))
                compose.onNode(play and hasAnyAncestor(hasScrollAction())).performClick()
                compose.waitUntil(10_000) { container.player.state.value.current?.id == saved.id && compose.runOnUiThread { container.player.localPosition > 0 } }
                compose.runOnUiThread { container.player.pause() }

                awaitText(compose.activity.getString(R.string.radio_local_collection))
                compose.onNodeWithTag("radio-toggle").performClick()
                compose.waitUntil(10_000) {
                    container.radio.state.value.active && container.player.state.value.queue.map { it.id } == listOf(saved.id) &&
                        compose.runOnUiThread { container.player.localPosition > 0 }
                }
                compose.runOnUiThread { container.player.pause() }
                compose.onNode(hasText(compose.activity.getString(R.string.nav_audiobooks)) and hasClickAction()).performClick()
                awaitText(localBook.title)
                compose.onNodeWithText(remoteBook.title).assertDoesNotExist()
                compose.onNode(hasText(compose.activity.getString(R.string.home_filter_all)) and hasClickAction()).performClick()

                includeMix.set(true)
                online.set(true)
                runBlocking { container.api.me() }
                awaitText(missing.title)
                disconnect()
                Remote.cache.clear()
                compose.activityRule.scenario.recreate()
                awaitText(compose.activity.getString(R.string.home_daily_mix))
                compose.onNodeWithText(missing.title).assertDoesNotExist()
                compose.onNodeWithText(compose.activity.getString(R.string.action_see_all)).performClick()
                awaitText(missing.title)
                compose.onNodeWithText(missing.title).assertIsNotEnabled()
                compose.activityRule.scenario.onActivity { it.onBackPressedDispatcher.onBackPressed() }
                awaitText(compose.activity.getString(R.string.home_daily_mix))
                compose.runOnUiThread { container.downloads.removeInBackground(listOf(saved.id)) }
                awaitText(compose.activity.getString(R.string.home_empty_downloads))
                online.set(true)
                runBlocking { container.api.me() }
                awaitText(missing.title)
            } finally {
                online.set(true)
                runBlocking { container.session.logout() }
                container.connectionPreferences.setAllowLocalHttp(originalHttp)
                Remote.cache.clear()
            }
        }
    }
}
