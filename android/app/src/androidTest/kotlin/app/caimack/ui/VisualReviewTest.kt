// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Bulat Ruslanovich

package app.caimack.ui

import android.Manifest
import android.content.ContentValues
import android.content.res.Configuration
import android.graphics.Bitmap
import android.os.Environment
import android.provider.MediaStore
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.hasClickAction
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.v2.createAndroidComposeRule
import androidx.compose.ui.test.onAllNodesWithContentDescription
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performImeAction
import androidx.compose.ui.test.performTextInput
import androidx.compose.ui.test.performScrollTo
import androidx.test.platform.app.InstrumentationRegistry
import app.caimack.CaimackApp
import app.caimack.MainActivity
import app.caimack.R
import app.caimack.api.Paged
import app.caimack.api.Album
import app.caimack.api.HomeBlock
import app.caimack.api.HomeFeed
import app.caimack.api.Playlist
import app.caimack.api.PlaylistDetail
import app.caimack.api.Track
import app.caimack.api.User
import app.caimack.playback.PlayerState
import app.caimack.session.SessionState
import java.util.Locale
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.serialization.json.Json
import mockwebserver3.Dispatcher
import mockwebserver3.MockResponse
import mockwebserver3.MockWebServer
import mockwebserver3.RecordedRequest
import org.junit.After
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue

class VisualReviewTest {
    @get:Rule
    val compose = createAndroidComposeRule<MainActivity>()
    private val context = InstrumentationRegistry.getInstrumentation().targetContext
    private val container get() = (context.applicationContext as CaimackApp).container
    private val web = MockWebServer()
    private val originalTheme = container.appearance.theme.value
    private val originalLanguage = container.appearance.language
    private val originalFontScale = context.resources.configuration.fontScale
    private val originalLayout = container.appearance.albumLayout.value
    private val originalDensity = container.appearance.libraryDensity.value
    private val user = User("visual-review", "Визуальная проверка")
    private val original = listOf(
        Track("first", "Ночной город", "artist", "Электрические сны", durationSeconds = 214),
        Track("second", "Тепло твоих рук", "artist", "Электрические сны", durationSeconds = 185),
        Track("third", "На последнем поезде", "artist", "Электрические сны", durationSeconds = 247),
    )
    @Volatile private var tracks = original
    private val configuration = Configuration(context.resources.configuration).apply { setLocale(Locale.forLanguageTag("ru")) }
    private val localized = context.createConfigurationContext(configuration)
    private fun label(id: Int) = localized.getString(id)

    @Before
    fun start() = runBlocking {
        InstrumentationRegistry.getInstrumentation().uiAutomation.grantRuntimePermission(context.packageName, Manifest.permission.POST_NOTIFICATIONS)
        Remote.cache.clear()
        web.dispatcher = object : Dispatcher() {
            override fun dispatch(request: RecordedRequest): MockResponse {
                val path = request.url.encodedPath
                fun json(value: String) = MockResponse.Builder().code(200).addHeader("Content-Type", "application/json").body(value).build()
                return when {
                    path == "/api/auth/login" || path == "/api/auth/me" -> json(Json.encodeToString(user))
                    path == "/api/me/settings" -> json("{\"quality\":\"Original\"}")
                    path == "/api/home/feed" -> json("{\"blocks\":[]}")
                    path == "/api/playlists" || path == "/api/playlists/public" -> json(Json.encodeToString(listOf(Playlist("review", "Вечерний маршрут", ownerId = user.id, ownerName = user.username, trackCount = tracks.size))))
                    path == "/api/playlists/review" -> json(Json.encodeToString(PlaylistDetail("review", "Вечерний маршрут", description = "Музыка, чтобы выдохнуть после длинного дня", ownerId = user.id, ownerName = user.username, tracks = tracks)))
                    path.startsWith("/api/playlists/review/tracks/") && request.method == "DELETE" -> {
                        tracks = tracks.filterNot { it.id == path.substringAfterLast('/') }
                        MockResponse.Builder().code(204).build()
                    }
                    path == "/api/playlists/review/tracks" && request.method == "POST" -> {
                        tracks = tracks + original.filter { candidate -> tracks.none { it.id == candidate.id } }
                        MockResponse.Builder().code(204).build()
                    }
                    path == "/api/playlists/review/tracks/order" -> {
                        tracks = original.filter { candidate -> tracks.any { it.id == candidate.id } }
                        MockResponse.Builder().code(204).build()
                    }
                    path == "/api/favorites" || path == "/api/history/recent" || path == "/api/tracks" -> json(Json.encodeToString(Paged(tracks, tracks.size, 1, 50)))
                    path == "/api/genres" || path == "/api/recommendations/moods" -> json("[]")
                    else -> MockResponse.Builder().code(204).build()
                }
            }
        }
        web.start()
        check(container.session.login(web.url("/").toString(), user.username, "visual-fixture") == null)
    }

    @After
    fun stop() {
        container.player.stop()
        container.appearance.setTheme(originalTheme)
        container.appearance.setLanguage(originalLanguage)
        container.appearance.setAlbumLayout(originalLayout)
        container.appearance.setLibraryDensity(originalDensity)
        shell("settings put system font_scale $originalFontScale")
        container.session.expire()
        Remote.cache.clear()
        web.close()
    }

    private fun shell(command: String) {
        val descriptor = InstrumentationRegistry.getInstrumentation().uiAutomation.executeShellCommand(command)
        android.os.ParcelFileDescriptor.AutoCloseInputStream(descriptor).use { it.readBytes() }
    }

    private fun capture(name: String, settle: Boolean = true) {
        compose.runOnIdle {
            (container.player.state as MutableStateFlow<PlayerState>).value = PlayerState(queue = original, index = 1)
        }
        compose.waitForIdle()
        if (settle) compose.mainClock.advanceTimeBy(500)
        compose.waitForIdle()
        InstrumentationRegistry.getInstrumentation().waitForIdleSync()
        Thread.sleep(80) // Let the emulator compositor present the frame before the system screenshot.
        val bitmap = checkNotNull(InstrumentationRegistry.getInstrumentation().uiAutomation.takeScreenshot())
        val values = ContentValues().apply {
            put(MediaStore.Downloads.DISPLAY_NAME, "$name.png")
            put(MediaStore.Downloads.MIME_TYPE, "image/png")
            put(MediaStore.Downloads.RELATIVE_PATH, "${Environment.DIRECTORY_DOWNLOADS}/CaimackReview/checked")
            put(MediaStore.Downloads.IS_PENDING, 1)
        }
        val uri = checkNotNull(context.contentResolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values))
        context.contentResolver.openOutputStream(uri).use { bitmap.compress(Bitmap.CompressFormat.PNG, 100, checkNotNull(it)) }
        context.contentResolver.update(uri, ContentValues().apply { put(MediaStore.Downloads.IS_PENDING, 0) }, null, null)
        bitmap.recycle()
    }

    private fun review(dark: Boolean, fontScale: Float, prefix: String) {
        container.appearance.setLanguage("ru")
        container.appearance.setTheme(if (dark) Appearance.DARK else Appearance.LIGHT)
        shell("settings put system font_scale $fontScale")
        compose.activityRule.scenario.recreate()
        compose.onNodeWithText(label(R.string.nav_library)).performClick()
        compose.waitUntil(10_000) { compose.onAllNodesWithText("Вечерний маршрут").fetchSemanticsNodes().isNotEmpty() }
        capture("$prefix-library")
        compose.onNodeWithText("Вечерний маршрут").performClick()
        compose.waitUntil(10_000) { compose.onAllNodesWithText(original.first().title).fetchSemanticsNodes().isNotEmpty() }
        check((container.session.state.value as? SessionState.SignedIn)?.user?.id == user.id)
        compose.onAllNodesWithContentDescription(label(R.string.menu_more))[0].performClick()
        capture("$prefix-track-menu")
        compose.onNodeWithText(label(R.string.playlist_remove_track)).performScrollTo().performClick()
        compose.waitUntil(10_000) { compose.onAllNodesWithText(label(R.string.action_undo)).fetchSemanticsNodes().isNotEmpty() }
        capture("$prefix-undo")
        compose.onNodeWithText(label(R.string.action_undo)).performClick()
        compose.waitUntil(10_000) { compose.onAllNodesWithText(original.first().title).fetchSemanticsNodes().isNotEmpty() }
        capture("$prefix-restored")
        compose.onNode(hasText("В") and hasClickAction()).performClick()
        compose.onNodeWithText(label(R.string.settings_title)).performClick()
        compose.onNodeWithContentDescription(label(R.string.settings_search)).assertIsDisplayed()
        capture("$prefix-settings")
        compose.onNodeWithContentDescription(label(R.string.settings_search)).performTextInput("тёмная")
        compose.onNodeWithContentDescription(label(R.string.settings_search)).performImeAction()
        capture("$prefix-settings-search")
        compose.onNodeWithText(label(R.string.nav_home)).performClick()
        compose.onNodeWithText(label(R.string.home_empty_title)).assertIsDisplayed()
    }

    @Test fun darkTheme() = review(dark = true, fontScale = 1f, prefix = "dark")
    @Test fun lightTheme() = review(dark = false, fontScale = 1f, prefix = "light")
    @Test fun largerText() = review(dark = true, fontScale = 1.3f, prefix = "large-text")

    @Test
    fun interfaceMatchesTheUpdatedWebClient() {
        val previous = web.dispatcher
        val albums = original.mapIndexed { index, track -> Album("album-$index", track.title, track.artistId, track.artistName, trackCount = 1) }
        web.dispatcher = object : Dispatcher() {
            override fun dispatch(request: RecordedRequest): MockResponse {
                val body = when (request.url.encodedPath) {
                    "/api/home/feed" -> Json.encodeToString(HomeFeed(listOf(HomeBlock("daily", "dailyMix", "Hero", "Lead", tracks = original, totalCount = 26))))
                    "/api/albums" -> Json.encodeToString(Paged(albums, albums.size, 1, 60))
                    else -> return previous.dispatch(request)
                }
                return MockResponse.Builder().code(200).addHeader("Content-Type", "application/json").body(body).build()
            }
        }
        Remote.cache.clear()
        container.appearance.setLanguage("ru")
        container.appearance.setTheme(Appearance.DARK)
        container.appearance.setAlbumLayout(AlbumLayout.Grid)
        container.appearance.setLibraryDensity(LibraryDensity.Comfortable)
        compose.activityRule.scenario.recreate()
        compose.waitUntil(10_000) { compose.onAllNodesWithText(label(R.string.home_daily_mix)).fetchSemanticsNodes().isNotEmpty() }
        capture("parity-home-dark")

        compose.mainClock.autoAdvance = false
        compose.onNodeWithContentDescription(label(R.string.player_open_full)).performClick()
        compose.mainClock.advanceTimeBy(110)
        capture("parity-cover-opening-110ms", settle = false)
        compose.mainClock.advanceTimeBy(110)
        capture("parity-cover-opening-220ms", settle = false)
        compose.mainClock.advanceTimeBy(500)
        compose.mainClock.autoAdvance = true
        compose.onNodeWithText(original[1].title).assertIsDisplayed()
        val title = compose.onNodeWithText(original[1].title).fetchSemanticsNode().boundsInRoot
        val heart = compose.onNodeWithContentDescription(label(R.string.menu_like)).fetchSemanticsNode().boundsInRoot
        assertTrue("Favorite belongs to the right of the title", heart.left >= title.right)
        capture("parity-player-dark")
        compose.onNodeWithContentDescription(label(R.string.player_close_full)).performClick()

        compose.onNode(hasText("В") and hasClickAction()).performClick()
        compose.onNodeWithText(label(R.string.settings_title)).performClick()
        compose.onNodeWithContentDescription(label(R.string.settings_search)).performTextInput("альбом")
        compose.onNodeWithText(label(R.string.view_crate)).performScrollTo().performClick()
        assertEquals(AlbumLayout.Crate, Appearance(context).albumLayout.value)
        capture("parity-layout-settings")
        compose.onNodeWithContentDescription(label(R.string.search_clear)).performClick()
        compose.onNodeWithContentDescription(label(R.string.settings_search)).performTextInput("плотность")
        compose.onNodeWithText(label(R.string.settings_density_spacious)).performScrollTo().performClick()
        assertEquals(LibraryDensity.Spacious, Appearance(context).libraryDensity.value)
        capture("parity-density-settings")
        compose.activityRule.scenario.recreate()
        compose.onNodeWithText(label(R.string.nav_library)).performClick()
        compose.onNodeWithText(label(R.string.nav_albums)).performClick()
        compose.waitUntil(10_000) { compose.onAllNodesWithText(original[0].title).fetchSemanticsNodes().isNotEmpty() }
        compose.onNodeWithText(label(R.string.view_grid)).assertDoesNotExist()
        compose.onNodeWithText(label(R.string.view_crate)).assertDoesNotExist()
        capture("parity-albums-crate")
        compose.onNodeWithText(label(R.string.nav_home)).performClick()
        container.appearance.setTheme(Appearance.LIGHT)
        capture("parity-home-light")
        compose.onNodeWithContentDescription(label(R.string.player_open_full)).performClick()
        capture("parity-player-light")
        compose.onNodeWithContentDescription(label(R.string.player_close_full)).performClick()
        container.appearance.setTheme(Appearance.DARK)
        shell("settings put system font_scale 1.3")
        compose.activityRule.scenario.recreate()
        compose.onNodeWithText(label(R.string.nav_home)).performClick()
        capture("parity-home-large-text")
    }
}
