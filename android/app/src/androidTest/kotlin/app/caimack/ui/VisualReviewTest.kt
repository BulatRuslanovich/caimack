// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Bulat Ruslanovich

package app.caimack.ui

import android.Manifest
import android.app.Notification
import android.app.NotificationManager
import android.appwidget.AppWidgetHost
import android.appwidget.AppWidgetManager
import android.content.ComponentName
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.widget.FrameLayout
import android.widget.ImageView
import android.widget.TextView
import android.content.ContentValues
import android.content.res.Configuration
import android.graphics.Bitmap
import android.os.Environment
import android.provider.MediaStore
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.captureToImage
import androidx.compose.ui.test.performTouchInput
import androidx.compose.ui.test.swipe
import androidx.compose.ui.graphics.toPixelMap
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.test.hasClickAction
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.v2.createAndroidComposeRule
import androidx.compose.ui.test.onAllNodesWithContentDescription
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.onNodeWithTag
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
import app.caimack.api.RadioBatch
import app.caimack.api.RecommendedTrack
import app.caimack.api.User
import app.caimack.playback.PlayerState
import app.caimack.playback.toMediaItem
import app.caimack.widget.NowPlayingWidget
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
import androidx.core.graphics.drawable.toBitmap
import androidx.compose.ui.graphics.toArgb
import okio.Buffer
import java.nio.ByteBuffer
import java.nio.ByteOrder

class VisualReviewTest {
    @get:Rule
    val compose = createAndroidComposeRule<MainActivity>()
    private val context = InstrumentationRegistry.getInstrumentation().targetContext
    private val container get() = (context.applicationContext as CaimackApp).container
    private val web = MockWebServer()
    private val originalTheme = container.appearance.theme.value
    private val originalLanguage = container.appearance.language
    private val originalFontScale = context.resources.configuration.fontScale
    private val originalDensity = container.appearance.libraryDensity.value
    private val originalColorway = container.appearance.colorway.value
    private val user = User("visual-review", "Визуальная проверка")
    private val original = listOf(
        Track("first", "Ночной город", "artist", "Электрические сны", durationSeconds = 214),
        Track("second", "Тепло твоих рук", "artist", "Электрические сны", durationSeconds = 185),
        Track("third", "На последнем поезде", "artist", "Электрические сны", durationSeconds = 247),
    )
    @Volatile private var tracks = original
    private var screenshotTracks = original
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
        container.appearance.setLibraryDensity(originalDensity)
        container.appearance.setColorway(originalColorway)
        shell("settings put system font_scale $originalFontScale")
        container.session.expire()
        Remote.cache.clear()
        web.close()
    }

    private fun shell(command: String) {
        val descriptor = InstrumentationRegistry.getInstrumentation().uiAutomation.executeShellCommand(command)
        android.os.ParcelFileDescriptor.AutoCloseInputStream(descriptor).use { it.readBytes() }
    }

    private fun capture(name: String, settle: Boolean = true, seedPlayback: Boolean = true) {
        if (seedPlayback) compose.runOnIdle {
            (container.player.state as MutableStateFlow<PlayerState>).value = PlayerState(queue = screenshotTracks, index = 1)
        }
        compose.waitForIdle()
        if (settle) compose.mainClock.advanceTimeBy(500)
        compose.waitForIdle()
        InstrumentationRegistry.getInstrumentation().waitForIdleSync()
        Thread.sleep(80) // Let the emulator compositor present the frame before the system screenshot.
        val bitmap = checkNotNull(InstrumentationRegistry.getInstrumentation().uiAutomation.takeScreenshot())
        val values = ContentValues().apply {
            put(MediaStore.Downloads.DISPLAY_NAME, "${InstrumentationRegistry.getArguments().getString("visualPrefix").orEmpty()}$name.png")
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
        screenshotTracks = original.mapIndexed { index, track -> track.copy(albumId = "album-$index", hasCover = true) }
        val albums = original.mapIndexed { index, track -> Album("album-$index", track.title, track.artistId, track.artistName, trackCount = 1, hasCover = true) }
        val covers = listOf(0xFF385A68.toInt(), 0xFF9B593F.toInt(), 0xFF595B84.toInt()).mapIndexed { index, colour ->
            val bitmap = Bitmap.createBitmap(320, 320, Bitmap.Config.ARGB_8888)
            val paint = android.graphics.Paint(android.graphics.Paint.ANTI_ALIAS_FLAG)
            val canvas = Canvas(bitmap)
            canvas.drawColor(colour)
            paint.color = 0xFFE2CB9E.toInt()
            canvas.drawCircle(230f - index * 42f, 125f + index * 30f, 104f, paint)
            paint.color = 0xFF202B32.toInt()
            paint.strokeWidth = 12f
            repeat(8) { line -> canvas.drawLine(-20f, 210f + line * 18, 340f, 80f + line * 18, paint) }
            paint.color = 0xFFF6EBDD.toInt()
            paint.textSize = 22f
            canvas.drawText("CAIMACK / 0${index + 1}", 20f, 294f, paint)
            java.io.ByteArrayOutputStream().use { output ->
                bitmap.compress(Bitmap.CompressFormat.PNG, 100, output)
                bitmap.recycle()
                output.toByteArray()
            }
        }
        val samples = 8000 * 30
        val audio = ByteBuffer.allocate(44 + samples * 2).order(ByteOrder.LITTLE_ENDIAN).apply {
            put("RIFF".toByteArray()); putInt(36 + samples * 2); put("WAVEfmt ".toByteArray())
            putInt(16); putShort(1); putShort(1); putInt(8000); putInt(16000); putShort(2); putShort(16)
            put("data".toByteArray()); putInt(samples * 2)
            repeat(samples) { putShort(0) }
        }.array()
        web.dispatcher = object : Dispatcher() {
            override fun dispatch(request: RecordedRequest): MockResponse {
                if (request.url.encodedPath.endsWith("/stream")) {
                    return MockResponse.Builder().code(200).addHeader("Content-Type", "audio/wav").body(Buffer().write(audio)).build()
                }
                if (request.url.encodedPath.endsWith("/cover")) {
                    val index = request.url.encodedPath.substringBeforeLast('/').substringAfterLast('-').toIntOrNull() ?: 0
                    return MockResponse.Builder().code(200).addHeader("Content-Type", "image/png").body(Buffer().write(covers[index % covers.size])).build()
                }
                val body = when (request.url.encodedPath) {
                    "/api/home/feed" -> Json.encodeToString(HomeFeed(listOf(HomeBlock("daily", "dailyMix", "Hero", "Lead", tracks = screenshotTracks, totalCount = 26))))
                    "/api/recommendations/radio" -> Json.encodeToString(RadioBatch((listOf(screenshotTracks[1]) + screenshotTracks.filterIndexed { index, _ -> index != 1 }).map { RecommendedTrack(it) }))
                    "/api/albums" -> Json.encodeToString(Paged(albums, albums.size, 1, 60))
                    else -> return previous.dispatch(request)
                }
                return MockResponse.Builder().code(200).addHeader("Content-Type", "application/json").body(body).build()
            }
        }
        Remote.cache.clear()
        container.appearance.setLanguage("ru")
        container.appearance.setTheme(Appearance.DARK)
        container.appearance.setLibraryDensity(LibraryDensity.Comfortable)
        compose.activityRule.scenario.recreate()
        compose.waitUntil(10_000) { compose.onAllNodesWithText(label(R.string.home_daily_mix)).fetchSemanticsNodes().isNotEmpty() }
        capture("parity-home-dark")

        val radioBounds = compose.onNodeWithTag("personal-radio").fetchSemanticsNode().boundsInRoot
        compose.mainClock.autoAdvance = false
        compose.onNodeWithTag("radio-toggle").performClick()
        compose.waitUntil(10_000) {
            compose.mainClock.advanceTimeByFrame()
            container.player.state.value.playing && !container.player.state.value.buffering
        }
        compose.mainClock.advanceTimeByFrame()
        compose.waitForIdle()
        compose.mainClock.advanceTimeBy(1000)
        assertEquals(radioBounds, compose.onNodeWithTag("personal-radio").fetchSemanticsNode().boundsInRoot)
        capture("parity-radio-playing", settle = false, seedPlayback = false)
        compose.onNodeWithTag("radio-toggle").performClick()
        compose.waitUntil(5_000) { !container.player.state.value.playing }
        compose.mainClock.advanceTimeBy(1000)
        compose.onNodeWithTag("radio-toggle").performClick()
        compose.waitUntil(10_000) {
            compose.mainClock.advanceTimeByFrame()
            container.player.state.value.playing && !container.player.state.value.buffering
        }
        compose.mainClock.advanceTimeBy(1000)

        compose.onNodeWithContentDescription(label(R.string.player_open_full)).performClick()
        compose.mainClock.advanceTimeBy(110)
        capture("parity-cover-opening-110ms", settle = false, seedPlayback = false)
        compose.mainClock.advanceTimeBy(110)
        capture("parity-cover-opening-220ms", settle = false, seedPlayback = false)
        compose.mainClock.advanceTimeBy(500)
        compose.onNodeWithText(original[1].title).assertIsDisplayed()
        val title = compose.onNodeWithText(original[1].title).fetchSemanticsNode().boundsInRoot
        val heart = compose.onNodeWithContentDescription(label(R.string.menu_like)).fetchSemanticsNode().boundsInRoot
        assertTrue("Favorite belongs to the right of the title", heart.left >= title.right)
        capture("parity-player-dark", settle = false, seedPlayback = false)
        compose.mainClock.advanceTimeByFrame()
        compose.waitForIdle()
        compose.mainClock.advanceTimeBy(1000)
        capture("parity-player-playing", settle = false, seedPlayback = false)
        compose.runOnIdle { container.player.pause() }
        compose.waitUntil(5_000) { !container.player.state.value.playing }
        compose.mainClock.advanceTimeBy(1000)
        compose.mainClock.autoAdvance = true
        compose.onNodeWithContentDescription(label(R.string.player_close_full)).performClick()

        compose.onNode(hasText("В") and hasClickAction()).performClick()
        compose.onNodeWithText(label(R.string.settings_title)).performClick()
        compose.onNodeWithContentDescription(label(R.string.settings_search)).performTextInput("альбом")
        compose.onNodeWithText(label(R.string.view_crate)).assertDoesNotExist()
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
        capture("parity-albums-grid")
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

    @Test
    fun swipingTheFullPlayerNeverFlashesAnotherSongsArtwork() {
        val previous = web.dispatcher
        val colours = listOf(android.graphics.Color.RED, android.graphics.Color.GREEN, android.graphics.Color.BLUE)
        val pictured = original.map { it.copy(hasCover = true) }
        val covers = colours.map { colour ->
            val bitmap = Bitmap.createBitmap(320, 320, Bitmap.Config.ARGB_8888).apply { eraseColor(colour) }
            java.io.ByteArrayOutputStream().use { output ->
                bitmap.compress(Bitmap.CompressFormat.PNG, 100, output)
                bitmap.recycle()
                output.toByteArray()
            }
        }
        val samples = 8000 * 30
        val audio = ByteBuffer.allocate(44 + samples * 2).order(ByteOrder.LITTLE_ENDIAN).apply {
            put("RIFF".toByteArray()); putInt(36 + samples * 2); put("WAVEfmt ".toByteArray())
            putInt(16); putShort(1); putShort(1); putInt(8000); putInt(16000); putShort(2); putShort(16)
            put("data".toByteArray()); putInt(samples * 2)
            repeat(samples) { putShort(0) }
        }.array()
        web.dispatcher = object : Dispatcher() {
            override fun dispatch(request: RecordedRequest): MockResponse {
                val path = request.url.encodedPath
                if (path.endsWith("/stream")) return MockResponse.Builder().code(200)
                    .addHeader("Content-Type", "audio/wav").body(Buffer().write(audio)).build()
                if (path.endsWith("/cover")) {
                    val index = pictured.indexOfFirst { path.contains("/${it.id}/") }.coerceAtLeast(0)
                    return MockResponse.Builder().code(200).addHeader("Content-Type", "image/png")
                        .body(Buffer().write(covers[index])).build()
                }
                return previous.dispatch(request)
            }
        }
        // All three colours are ready, including the third song that used to flash on A -> B.
        runBlocking {
            pictured.forEach { track ->
                coil3.SingletonImageLoader.get(context).execute(coil3.request.ImageRequest.Builder(context)
                    .data(container.media.cover(null, track.id, true, small = false)).size(1024).build())
            }
        }
        compose.runOnIdle { container.player.play(pictured, 0) }
        compose.waitUntil(10_000) { container.player.state.value.playing && !container.player.state.value.buffering }
        compose.runOnIdle { container.player.pause() }
        compose.waitUntil(5_000) { !container.player.state.value.playing }
        compose.onNodeWithContentDescription(label(R.string.player_open_full)).performClick()
        compose.mainClock.advanceTimeBy(1000)
        compose.waitForIdle()
        val deck = compose.onNodeWithTag("player-deck")
        val bounds = deck.fetchSemanticsNode().boundsInRoot
        val centre = compose.onNodeWithTag("player-record").fetchSemanticsNode().boundsInRoot.center - bounds.topLeft
        fun pixel() = deck.captureToImage().toPixelMap()[centre.x.toInt(), centre.y.toInt()].toArgb()
        compose.waitUntil(5_000) { pixel() == colours[0] }
        compose.mainClock.autoAdvance = false

        for ((target, direction) in listOf(1 to -1, 0 to 1, 1 to -1, 2 to -1)) {
            val outgoing = container.player.state.value.index
            deck.performTouchInput { swipe(centre, centre + Offset(direction * bounds.width * 0.38f, 0f), 300) }
            var acknowledged = false
            repeat(28) {
                compose.mainClock.advanceTimeBy(16)
                val shown = pixel()
                if (container.player.state.value.index == target) acknowledged = true
                if (acknowledged) {
                    assertEquals("The acknowledged song must own the centre on every frame", colours[target], shown)
                } else {
                    colours.indices.filter { it != target && it != outgoing }.forEach { other ->
                        assertTrue("An unrelated song flashed during the swipe", shown != colours[other])
                    }
                }
                Thread.sleep(12) // MediaController delivers its acknowledgement on the real main looper.
            }
            assertTrue("The swipe must change the queue item", acknowledged)
            assertEquals(colours[target], pixel())
        }
        compose.mainClock.autoAdvance = true
    }

    @Test
    fun widgetAndNotificationRemainVisibleWithoutArtworkInOledTheme() {
        val previous = web.dispatcher
        val samples = 8000 * 60
        val audio = ByteBuffer.allocate(44 + samples * 2).order(ByteOrder.LITTLE_ENDIAN).apply {
            put("RIFF".toByteArray()); putInt(36 + samples * 2); put("WAVEfmt ".toByteArray())
            putInt(16); putShort(1); putShort(1); putInt(8000); putInt(16000); putShort(2); putShort(16)
            put("data".toByteArray()); putInt(samples * 2)
            repeat(samples) { putShort((kotlin.math.sin(it * 2.0 * Math.PI * 440 / 8000) * 100).toInt().toShort()) }
        }.array()
        web.dispatcher = object : Dispatcher() {
            override fun dispatch(request: RecordedRequest): MockResponse = if (request.url.encodedPath.endsWith("/stream")) {
                MockResponse.Builder().code(200).addHeader("Content-Type", "audio/wav").body(Buffer().write(audio)).build()
            } else previous.dispatch(request)
        }
        container.appearance.setTheme(Appearance.DARK)
        container.appearance.setColorway(Colorway.Graphite)
        val track = original[1]
        val uri = checkNotNull(track.toMediaItem(container.media).mediaMetadata.artworkUri)
        assertEquals("/placeholder", uri.path)
        val artwork = checkNotNull(context.contentResolver.openInputStream(uri).use { BitmapFactory.decodeStream(it) })
        assertTrue("Missing artwork has an opaque, drawn sleeve", !artwork.sameAs(Bitmap.createBitmap(artwork.width, artwork.height, Bitmap.Config.ARGB_8888)))
        artwork.recycle()

        shell("appwidget grantbind --package ${context.packageName} --user 0")
        val host = AppWidgetHost(context, 2400)
        try {
            val manager = AppWidgetManager.getInstance(context)
            val id = host.allocateAppWidgetId()
            val component = ComponentName(context, NowPlayingWidget::class.java)
            assertTrue(manager.bindAppWidgetIdIfAllowed(id, component))
            lateinit var widget: android.appwidget.AppWidgetHostView
            compose.runOnIdle {
                host.startListening()
                widget = host.createView(compose.activity, id, manager.getAppWidgetInfo(id))
                compose.activity.addContentView(widget, FrameLayout.LayoutParams(850, 450))
                NowPlayingWidget.show(context, track, false)
            }
            compose.waitUntil(10_000) { widget.findViewById<TextView>(R.id.widget_title)?.text == track.title }
            compose.runOnIdle {
                val drawable = checkNotNull(widget.findViewById<ImageView>(R.id.widget_art).drawable)
                val image = drawable.toBitmap()
                val colours = (0 until image.width step 8).flatMap { x -> (0 until image.height step 8).map { y -> image.getPixel(x, y) } }.toSet()
                assertTrue("Widget should show record artwork, not an empty square", colours.size > 10)
            }
            capture("oled-widget-no-cover")
            compose.runOnIdle { (widget.parent as android.view.ViewGroup).removeView(widget) }
            compose.runOnIdle { container.player.play(listOf(track), 0) }
            val notifications = context.getSystemService(NotificationManager::class.java)
            compose.waitUntil(20_000) {
                notifications.activeNotifications.any { it.notification.extras.getCharSequence(Notification.EXTRA_TITLE)?.toString() == track.title && it.notification.getLargeIcon() != null }
            }
            val notification = notifications.activeNotifications.first { it.notification.extras.getCharSequence(Notification.EXTRA_TITLE)?.toString() == track.title }.notification
            assertEquals(paletteOf(Colorway.Graphite, true).background.toArgb(), notification.color)
            assertTrue(notification.extras.getBoolean(Notification.EXTRA_COLORIZED))
            shell("cmd statusbar expand-notifications")
            Thread.sleep(500)
            capture("oled-notification-no-cover")
            shell("cmd statusbar collapse")
        } finally {
            host.stopListening()
            host.deleteHost()
            shell("appwidget revokebind --package ${context.packageName} --user 0")
        }
    }
}
