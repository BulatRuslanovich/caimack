// SPDX-License-Identifier: AGPL-3.0-only

package app.caimack.ui

import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertIsSelected
import androidx.compose.ui.test.click
import androidx.compose.ui.test.hasAnyAncestor
import androidx.compose.ui.test.hasClickAction
import androidx.compose.ui.test.hasContentDescription
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.v2.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performTouchInput
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.unit.dp
import androidx.test.platform.app.InstrumentationRegistry
import app.caimack.CaimackApp
import app.caimack.MainActivity
import app.caimack.R
import app.caimack.api.HomeBlock
import app.caimack.api.HomeFeed
import app.caimack.api.HomeMix
import app.caimack.api.Track
import app.caimack.api.User
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.Json
import mockwebserver3.Dispatcher
import mockwebserver3.MockResponse
import mockwebserver3.MockWebServer
import mockwebserver3.RecordedRequest
import okio.Buffer
import org.junit.Rule
import org.junit.Test

class HomeNavigationUiTest {
    @get:Rule
    val compose = createAndroidComposeRule<MainActivity>()

    private fun node(label: Int) =
        compose.onNode(hasText(compose.activity.getString(label)) and hasClickAction())

    @Test
    fun dailyMixHeaderOpensPlaylistAndPlaybackControlsStayIndependent() {
        check(compose.activity.packageName.endsWith(".uitest"))
        val container = (compose.activity.application as CaimackApp).container
        val originalLocalHttp = container.connectionPreferences.allowLocalHttp.value
        val user = User("daily-mix-navigation", "Daily Mix Navigation")
        val tracks = (1..3).map { Track("daily-$it", "Mix recording $it", "artist", "Artist", durationSeconds = 5) }
        val preview = HomeBlock("daily", "dailyMix", "Hero", "Lead", tracks = tracks.take(2), totalCount = tracks.size)
        val fullMixTrack = tracks.last().title
        val title = compose.activity.getString(R.string.home_daily_mix)
        val playLabel = compose.activity.getString(R.string.action_play)
        val audio = InstrumentationRegistry.getInstrumentation().context.assets.open("sync/tone.mp3").use { it.readBytes() }

        MockWebServer().use { web ->
            web.dispatcher = object : Dispatcher() {
                override fun dispatch(request: RecordedRequest): MockResponse {
                    val body = when (request.url.encodedPath) {
                        "/api/auth/login", "/api/auth/me" -> Json.encodeToString(user)
                        "/api/auth/logout" -> return MockResponse.Builder().code(204).build()
                        "/api/config" -> """{"recommendationsEnabled":true}"""
                        "/api/me/settings" -> "{}"
                        "/api/home/feed" -> Json.encodeToString(HomeFeed(listOf(preview)))
                        "/api/home/mixes/daily" -> Json.encodeToString(HomeMix(tracks))
                        "/api/tracks/daily-1/stream", "/api/tracks/daily-2/stream" -> return MockResponse.Builder()
                            .addHeader("Content-Type", "audio/mpeg").body(Buffer().write(audio)).build()
                        else -> return MockResponse.Builder().code(404).build()
                    }
                    return MockResponse.Builder().addHeader("Content-Type", "application/json").body(body).build()
                }
            }
            web.start()
            container.connectionPreferences.setAllowLocalHttp(true)
            Remote.cache.clear()
            try {
                runBlocking { check(container.session.login(web.url("/").toString(), user.username, "fixture") == null) }
                compose.waitUntil(10_000) {
                    compose.onAllNodes(hasText(title), useUnmergedTree = true).fetchSemanticsNodes().isNotEmpty()
                }

                fun verifyPlaylistAndGoBack() {
                    compose.waitUntil(10_000) {
                        compose.onAllNodes(hasText(fullMixTrack)).fetchSemanticsNodes().isNotEmpty()
                    }
                    compose.onNodeWithText(fullMixTrack).assertIsDisplayed()
                    compose.activityRule.scenario.onActivity { it.onBackPressedDispatcher.onBackPressed() }
                }

                compose.onNodeWithText(title, useUnmergedTree = true).performTouchInput { click() }
                verifyPlaylistAndGoBack()
                node(R.string.home_daily_mix).performTouchInput { click(Offset(38.dp.toPx(), 24.dp.toPx())) }
                verifyPlaylistAndGoBack()
                node(R.string.action_see_all).performTouchInput { click() }
                verifyPlaylistAndGoBack()

                compose.onNode(hasContentDescription(playLabel) and hasAnyAncestor(hasText(title)))
                    .performTouchInput { click() }
                compose.waitUntil(5_000) { container.player.state.value.current?.id == tracks.first().id }
                node(R.string.home_daily_mix).assertIsDisplayed()

                compose.onNodeWithText(tracks[1].title).performTouchInput { click() }
                compose.waitUntil(5_000) { container.player.state.value.current?.id == tracks[1].id }
                node(R.string.home_daily_mix).assertIsDisplayed()
            } finally {
                runBlocking { container.session.logout() }
                container.connectionPreferences.setAllowLocalHttp(originalLocalHttp)
                Remote.cache.clear()
            }
        }
    }

    @Test
    fun homeButtonResetsCategoriesAndDownloads() {
        check(compose.activity.packageName.endsWith(".uitest"))
        val container = (compose.activity.application as CaimackApp).container
        val originalLocalHttp = container.connectionPreferences.allowLocalHttp.value
        val user = User("home-navigation", "Home Navigation")
        MockWebServer().use { web ->
            web.dispatcher = object : Dispatcher() {
                override fun dispatch(request: RecordedRequest): MockResponse {
                    val body = when (request.url.encodedPath) {
                        "/api/auth/login", "/api/auth/me" -> Json.encodeToString(user)
                        "/api/auth/logout" -> return MockResponse.Builder().code(204).build()
                        "/api/experiments/audiobooks" -> """{"enabled":true}"""
                        "/api/config", "/api/me/settings" -> "{}"
                        "/api/home/feed" -> """{"blocks":[]}"""
                        "/api/genres", "/api/audiobooks" -> "[]"
                        else -> return MockResponse.Builder().code(404).build()
                    }
                    return MockResponse.Builder().addHeader("Content-Type", "application/json").body(body).build()
                }
            }
            web.start()
            container.connectionPreferences.setAllowLocalHttp(true)
            Remote.cache.clear()
            try {
                runBlocking {
                    check(container.session.login(web.url("/").toString(), user.username, "fixture") == null)
                }
                compose.waitUntil(5_000) { container.audiobooksEnabled.value }
                val all = node(R.string.home_filter_all)
                all.assertIsSelected()

                for (category in listOf(R.string.home_filter_music, R.string.nav_audiobooks)) {
                    val filter = node(category)
                    val downloads = node(R.string.collection_downloaded)
                    val home = node(R.string.nav_home)

                    filter.performTouchInput { click() }.assertIsSelected()
                    home.performTouchInput { click() }
                    all.assertIsDisplayed().assertIsSelected()

                    filter.performTouchInput { click() }
                    downloads.performTouchInput { click() }.assertIsSelected()
                    home.performTouchInput { click() }
                    all.assertIsDisplayed().assertIsSelected()
                    downloads.assertDoesNotExist()

                    filter.performTouchInput { click() }
                    node(R.string.nav_search).performTouchInput { click() }.assertIsSelected()
                    home.performTouchInput { click() }
                    all.assertIsDisplayed().assertIsSelected()
                }
            } finally {
                runBlocking { container.session.logout() }
                container.connectionPreferences.setAllowLocalHttp(originalLocalHttp)
                Remote.cache.clear()
            }
        }
    }
}
