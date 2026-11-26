// SPDX-License-Identifier: AGPL-3.0-only
package app.caimack.ui

import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.v2.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.test.platform.app.InstrumentationRegistry
import app.caimack.CaimackApp
import app.caimack.MainActivity
import app.caimack.R
import app.caimack.api.ConnectCommand
import app.caimack.api.User
import app.caimack.audiobooks.Audiobook
import app.caimack.audiobooks.AudiobookChapter
import app.caimack.playback.SleepTimerState
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withContext
import mockwebserver3.Dispatcher
import mockwebserver3.MockResponse
import mockwebserver3.MockWebServer
import mockwebserver3.RecordedRequest
import okio.Buffer
import org.junit.Rule
import org.junit.Test

class AudiobookSleepTimerDeviceTest {
    @get:Rule val compose = createAndroidComposeRule<MainActivity>()

    @Test fun timerPausesTheBookAndKeepsTheMusicTimerIndependent() {
        check(compose.activity.packageName.endsWith(".uitest"))
        val container = (compose.activity.application as CaimackApp).container
        val originalHttp = container.connectionPreferences.allowLocalHttp.value
        val playback = container.audiobookPlayback
        val audio = InstrumentationRegistry.getInstrumentation().context.assets.open("sync/tone.mp3").use { it.readBytes() }
        val first = AudiobookChapter("sleep-first", "First chapter", 2_000, audio.size.toLong(), "/api/book-audio")
        val second = first.copy(id = "sleep-second", title = "Second chapter")
        val book = Audiobook("sleep-book", "Sleep timer book", durationMs = 4_000, chapters = listOf(first, second))
        val user = User("book-sleep", "Sleep listener")
        fun label(id: Int) = compose.activity.getString(id)

        MockWebServer().use { web ->
            web.dispatcher = object : Dispatcher() {
                override fun dispatch(request: RecordedRequest): MockResponse {
                    val body = when (request.url.encodedPath) {
                        "/api/auth/login", "/api/auth/me" -> container.json.encodeToString(user)
                        "/api/auth/logout" -> return MockResponse.Builder().code(204).build()
                        "/api/config", "/api/me/settings", "/api/search/popular" -> "{}"
                        "/api/home/feed" -> """{"blocks":[]}"""
                        "/api/experiments/audiobooks" -> """{"enabled":true}"""
                        "/api/audiobooks" -> container.json.encodeToString(listOf(book))
                        "/api/audiobooks/${book.id}" -> container.json.encodeToString(book)
                        "/api/audiobooks/${book.id}/progress" -> request.body?.utf8().orEmpty()
                        "/api/book-audio" -> return MockResponse.Builder()
                            .addHeader("Content-Type", "audio/mpeg").body(Buffer().write(audio)).build()
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
                }
                compose.waitUntil(10_000) { container.audiobookStore.state.value.books.any { it.id == book.id } }
                runBlocking {
                    withContext(Dispatchers.Main) {
                        playback.receiveHandoff(ConnectCommand.PlayAudiobook(book.id, first.id, 0, playing = false))
                    }
                }
                container.sleepTimer.set(90)
                val musicTimer = container.sleepTimer.state.value
                compose.onNodeWithContentDescription(label(R.string.player_open_full)).performClick()
                compose.onNodeWithContentDescription(label(R.string.sleep_title)).performClick()
                compose.onNodeWithText(compose.activity.getString(R.string.sleep_minutes, 15)).performClick()
                check((playback.sleepTimer.state.value as? SleepTimerState.Minutes)?.minutes == 15)
                check(container.sleepTimer.state.value == musicTimer)

                compose.onNodeWithContentDescription(
                    compose.activity.getString(R.string.sleep_remaining, "§").substringBefore("§").trimEnd(),
                    substring = true,
                ).performClick()
                compose.onNodeWithText(label(R.string.sleep_off)).performClick()
                check(playback.sleepTimer.state.value == null)

                compose.onNodeWithContentDescription(label(R.string.sleep_title)).performClick()
                compose.onNodeWithText(label(R.string.sleep_chapter_end)).performClick()
                compose.onNodeWithContentDescription(label(R.string.sleep_at_chapter_end)).assertIsDisplayed()
                compose.activityRule.scenario.onActivity { it.onBackPressedDispatcher.onBackPressed() }
                compose.runOnUiThread { playback.toggle(book) }
                compose.waitUntil(5_000) { playback.state.value?.playing == true }
                compose.waitUntil(8_000) { playback.sleepTimer.state.value == null && playback.state.value?.playing == false }
                check(playback.state.value?.chapterId == first.id)
                check(container.sleepTimer.state.value == musicTimer)

                compose.runOnUiThread { playback.toggle(book) }
                compose.waitUntil(8_000) { playback.state.value?.let { it.chapterId == second.id && it.playing } == true }
                compose.runOnUiThread { playback.sleepTimer.set(0) }
                compose.waitUntil(5_000) { playback.sleepTimer.state.value == null && playback.state.value?.playing == false }
                check(playback.state.value?.chapterId == second.id)
                check(container.sleepTimer.state.value == musicTimer)

                compose.runOnUiThread {
                    playback.sleepTimer.untilTrackEnd()
                    playback.toggle(book)
                }
                compose.waitUntil(8_000) {
                    container.audiobookStore.state.value.books.firstOrNull { it.id == book.id }?.progress?.completed == true
                }
                check(playback.sleepTimer.state.value == null)
            } finally {
                compose.runOnUiThread { playback.pauseForMusic() }
                playback.sleepTimer.cancel()
                container.sleepTimer.cancel()
                runBlocking { container.session.logout() }
                container.connectionPreferences.setAllowLocalHttp(originalHttp)
                Remote.cache.clear()
            }
        }
    }
}
