// SPDX-License-Identifier: AGPL-3.0-only
@file:Suppress("RestrictedApi")

package app.caimack.playback

import android.app.Notification
import android.app.NotificationManager
import android.content.ComponentName
import android.media.MediaMetadata
import android.media.session.MediaController as LegacyController
import android.media.session.PlaybackState
import android.os.Bundle
import android.os.SystemClock
import androidx.annotation.OptIn
import androidx.core.util.writeText
import androidx.media3.common.MediaItem
import androidx.media3.common.util.UnstableApi
import androidx.media3.session.MediaBrowser
import androidx.media3.session.MediaConstants
import androidx.media3.session.SessionError
import androidx.media3.session.SessionToken
import androidx.media3.session.legacy.MediaBrowserCompat as LegacyBrowser
import androidx.test.platform.app.InstrumentationRegistry
import app.caimack.CaimackApp
import app.caimack.api.Paged
import app.caimack.api.RadioBatch
import app.caimack.api.RecommendedTrack
import app.caimack.api.SearchResults
import app.caimack.api.Track
import app.caimack.api.User
import app.caimack.api.UserSettings
import app.caimack.audiobooks.Audiobook
import app.caimack.audiobooks.AudiobookChapter
import app.caimack.session.SessionState
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.util.concurrent.CompletableFuture
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicInteger
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.flow.first
import mockwebserver3.Dispatcher
import mockwebserver3.MockResponse
import mockwebserver3.MockWebServer
import mockwebserver3.RecordedRequest
import okio.Buffer
import org.junit.Assert.*
import org.junit.FixMethodOrder
import org.junit.Test
import org.junit.runners.MethodSorters

@OptIn(UnstableApi::class)
@FixMethodOrder(MethodSorters.NAME_ASCENDING)
class CarMediaSessionDeviceTest {
    private val instrumentation = InstrumentationRegistry.getInstrumentation()
    private val context = instrumentation.targetContext
    private val container = (context.applicationContext as CaimackApp).container
    private val service = ComponentName(context, PlaybackService::class.java)
    private val songs = (1..3).map { track(it) }
    private val voice = listOf(track(4), track(5))
    private val book = Audiobook("car-book", "Test book", durationMs = 30_000, chapters = listOf(
        AudiobookChapter("chapter", "Test chapter", 30_000, 0, "/api/audiobooks/car-book/chapter/stream"),
    ))

    @Test fun coldStartRestoresPausedQueueAndLegacyHostCanReconnectAndPlay() = fixture(saved = true) {
        val first = legacyBrowser()
        try {
            val controller = legacyController(first)
            await { controller.playbackState?.state == PlaybackState.STATE_PAUSED && controller.queue?.size == songs.size }
            val metadata = requireNotNull(controller.metadata)
            val queue = requireNotNull(controller.queue)
            val state = requireNotNull(controller.playbackState)
            assertEquals(songs[1].id, metadata.getString(MediaMetadata.METADATA_KEY_MEDIA_ID))
            assertEquals(songs[1].title, metadata.getString(MediaMetadata.METADATA_KEY_TITLE))
            assertEquals(songs[1].artistName, metadata.getString(MediaMetadata.METADATA_KEY_ARTIST))
            assertEquals(songs.map { it.id }, queue.map { it.description.mediaId })
            assertEquals(queue[1].queueId, state.activeQueueItemId)
            assertEquals(1_375L, state.position)
            val actions = PlaybackState.ACTION_PLAY or PlaybackState.ACTION_PLAY_PAUSE or PlaybackState.ACTION_PLAY_FROM_MEDIA_ID or
                PlaybackState.ACTION_PLAY_FROM_SEARCH or PlaybackState.ACTION_SKIP_TO_NEXT or PlaybackState.ACTION_SKIP_TO_PREVIOUS
            assertEquals(actions, state.actions and actions)
            val root = children(first, first.root)
            assertEquals(4, root.size)
            assertTrue(root.all { it.isBrowsable && !it.isPlayable })

            val smaller = legacyBrowser(rootLimit = 2)
            try {
                val tabs = children(smaller, smaller.root)
                assertEquals(2, tabs.size)
                assertTrue(tabs.all { it.isBrowsable && !it.isPlayable })
                val forYou = children(smaller, requireNotNull(tabs.first().mediaId))
                assertEquals(listOf("radio", "library", "downloads"), forYou.take(3).map { it.mediaId })
                assertTrue(forYou.first().isPlayable)
                assertEquals(PlaybackState.STATE_PAUSED, legacyController(smaller).playbackState?.state)
            } finally {
                onMain { smaller.disconnect() }
            }

            controller.transportControls.play()
            await { controller.playbackState?.state == PlaybackState.STATE_PLAYING }
            assertTrue(requireNotNull(controller.playbackState).actions and PlaybackState.ACTION_PAUSE != 0L)
            await { container.player.state.value.current?.id == songs[1].id && container.player.state.value.playing }
            val notifications = context.getSystemService(NotificationManager::class.java)
            await { notifications.activeNotifications.any { it.notification.extras.getString(Notification.EXTRA_TITLE) == songs[1].title } }
            controller.transportControls.skipToNext()
            await { controller.metadata?.getString(MediaMetadata.METADATA_KEY_MEDIA_ID) == songs[2].id }
            controller.transportControls.skipToPrevious()
            await { controller.metadata?.getString(MediaMetadata.METADATA_KEY_MEDIA_ID) == songs[1].id }
            controller.transportControls.pause()
            await { controller.playbackState?.state == PlaybackState.STATE_PAUSED }
        } finally {
            onMain { first.disconnect() }
        }
    }

    @Test fun legacyHostStartsEmptyAndPlaysTheSelectedTrackAndVoiceSearch() = fixture {
        val browser = legacyBrowser()
        try {
            val controller = legacyController(browser)
            assertEquals(PlaybackState.STATE_NONE, controller.playbackState?.state)
            assertTrue(controller.queue.isNullOrEmpty())
            val favorites = children(browser, browser.root).single { it.mediaId == "favorites" }
            val tracks = children(browser, requireNotNull(favorites.mediaId))
            assertEquals(songs.map { it.title }, tracks.map { it.description.title })
            val artwork = requireNotNull(tracks[1].description.iconUri)
            assertEquals("content", artwork.scheme)
            context.contentResolver.openInputStream(artwork)!!.use { assertTrue(it.read() >= 0) }

            controller.transportControls.playFromMediaId(tracks[1].mediaId, null)
            await {
                controller.playbackState?.state == PlaybackState.STATE_PLAYING &&
                    controller.metadata?.getString(MediaMetadata.METADATA_KEY_MEDIA_ID) == songs[1].id
            }
            assertEquals(songs.map { it.id }.toSet(), queueIds(controller).toSet())

            controller.transportControls.playFromSearch("voice", Bundle.EMPTY)
            await { controller.metadata?.getString(MediaMetadata.METADATA_KEY_MEDIA_ID) == voice.first().id }
            assertEquals(voice.map { it.id }, queueIds(controller))

            val forYou = children(browser, browser.root).first()
            val radio = children(browser, requireNotNull(forYou.mediaId)).first()
            controller.transportControls.playFromMediaId(radio.mediaId, null)
            await { controller.metadata?.getString(MediaMetadata.METADATA_KEY_MEDIA_ID) == songs.first().id }
            assertTrue(container.radio.state.value.active)
        } finally {
            onMain { browser.disconnect() }
        }
    }

    @Test fun searchesKeepTheirQueuesAcrossQueriesAndControllers() {
        val slowStarted = CountDownLatch(1)
        val finishSlow = CountDownLatch(1)
        val fastSearches = AtomicInteger()
        fixture(search = { request ->
            when (request.url.queryParameter("q")) {
                "slow" -> {
                    slowStarted.countDown()
                    check(finishSlow.await(10, TimeUnit.SECONDS))
                    songs
                }
                "fast" -> if (fastSearches.getAndIncrement() == 0) voice else songs
                else -> emptyList()
            }
        }) {
            val first = onMain { MediaBrowser.Builder(context, SessionToken(context, service)).buildAsync() }
            val second = onMain { MediaBrowser.Builder(context, SessionToken(context, service)).buildAsync() }
            try {
                val browser = first.get(10, TimeUnit.SECONDS)
                val other = second.get(10, TimeUnit.SECONDS)
                val slow = onMain { browser.search("slow", null) }
                assertTrue(slowStarted.await(10, TimeUnit.SECONDS))
                onMain { browser.search("fast", null) }.get(10, TimeUnit.SECONDS)
                onMain { other.search("fast", null) }.get(10, TimeUnit.SECONDS)
                finishSlow.countDown()
                slow.get(10, TimeUnit.SECONDS)

                fun results(browser: MediaBrowser, query: String): List<MediaItem> =
                    onMain { browser.getSearchResult(query, 0, 25, null) }.get(10, TimeUnit.SECONDS).value.orEmpty()
                assertEquals(voice.map { it.title }, results(browser, "fast").map { it.mediaMetadata.title })
                assertEquals(songs.map { it.title }, results(other, "fast").map { it.mediaMetadata.title })
                assertTrue(results(other, "slow").isEmpty())
                val matches = results(browser, "slow")
                assertEquals(songs.map { it.title }, matches.map { it.mediaMetadata.title })

                val legacy = legacyBrowser()
                try {
                    val controller = legacyController(legacy)
                    controller.transportControls.playFromMediaId(matches[1].mediaId, null)
                    await { controller.metadata?.getString(MediaMetadata.METADATA_KEY_MEDIA_ID) == songs[1].id }
                    assertEquals(songs.map { it.id }.toSet(), queueIds(controller).toSet())
                } finally {
                    onMain { legacy.disconnect() }
                }
            } finally {
                finishSlow.countDown()
                onMain {
                    MediaBrowser.releaseFuture(first)
                    MediaBrowser.releaseFuture(second)
                }
            }
        }
    }

    @Test fun legacyHostCanPlayDownloadsWhileTheServerIsUnavailable() {
        val online = AtomicBoolean(true)
        fixture(online = online) {
            try {
                runBlocking { container.downloads.addInBackground(listOf(songs[1]), UserSettings()) }
                await { container.locallyAvailable(songs[1].id) }
                online.set(false)
                val browser = legacyBrowser()
                try {
                    val downloads = children(browser, browser.root).single { it.mediaId == "downloads" }
                    val track = children(browser, requireNotNull(downloads.mediaId)).single { it.description.title == songs[1].title }
                    val controller = legacyController(browser)
                    controller.transportControls.playFromMediaId(track.mediaId, null)
                    await {
                        controller.playbackState?.state == PlaybackState.STATE_PLAYING &&
                            controller.metadata?.getString(MediaMetadata.METADATA_KEY_MEDIA_ID) == songs[1].id
                    }
                } finally {
                    onMain { browser.disconnect() }
                }
            } finally {
                online.set(true)
                onMain { container.downloads.removeInBackground(listOf(songs[1].id)) }
            }
        }
    }

    @Test fun signedInBrowserRecoversAfterSessionExpires() = fixture {
        val connection = onMain { MediaBrowser.Builder(context, SessionToken(context, service)).buildAsync() }
        try {
            val browser = connection.get(10, TimeUnit.SECONDS)
            val root = onMain { browser.getLibraryRoot(null) }.get(10, TimeUnit.SECONDS).value!!.mediaId
            val server = container.server.url.value.toString()
            container.session.expire()
            val expired = onMain { browser.getChildren(root, 0, 4, null) }.get(10, TimeUnit.SECONDS)
            assertEquals(SessionError.ERROR_SESSION_AUTHENTICATION_EXPIRED, expired.resultCode)

            runBlocking { assertNull(container.session.login(server, "car-fixture", "fixture")) }
            val tabs = onMain { browser.getChildren(root, 0, 4, null) }.get(10, TimeUnit.SECONDS)
            assertEquals(4, tabs.value?.size)
        } finally {
            onMain { MediaBrowser.releaseFuture(connection) }
        }
    }

    @Test fun switchingToBookWhileMusicBuffersAndReturningToMusic() {
        val bookRequested = CountDownLatch(1)
        val startMusic = CountDownLatch(1)
        val startBook = CountDownLatch(1)
        fixture(audiobookRequest = {
            bookRequested.countDown()
            startBook.await(3, TimeUnit.SECONDS)
        }, musicRequest = {
            startMusic.await(10, TimeUnit.SECONDS)
        }) {
            try {
                await { container.audiobooksEnabled.value }
                await { container.audiobookStore.state.value.books.any { it.id == book.id } }
                onMain { container.player.play(songs, 1) }
                await { container.player.state.value.current?.id == songs[1].id && container.player.state.value.buffering }
                onMain { container.audiobookPlayback.play(book) }
                assertTrue(bookRequested.await(10, TimeUnit.SECONDS))
                startMusic.countDown()
                await { container.player.state.value.let { it.playing && !it.buffering } }
                startBook.countDown()
                await { container.audiobookPlayback.state.value?.playing == true && !container.player.state.value.playing }
                onMain { container.player.resume() }
                await {
                    container.player.state.value.let { it.current?.id == songs[1].id && it.playing && !it.buffering } &&
                        container.audiobookPlayback.state.value?.playing != true
                }
            } finally {
                startMusic.countDown()
                startBook.countDown()
            }
        }
    }

    private fun fixture(
        saved: Boolean = false,
        search: (RecordedRequest) -> List<Track> = { voice },
        online: AtomicBoolean = AtomicBoolean(true),
        audiobookRequest: (() -> Unit)? = null,
        musicRequest: () -> Unit = {},
        test: () -> Unit,
    ) {
        check(context.packageName.endsWith(".uitest"))
        val oldHttp = container.connectionPreferences.allowLocalHttp.value
        val audio = silentWav()
        MockWebServer().use { web ->
            web.dispatcher = object : Dispatcher() {
                override fun dispatch(request: RecordedRequest): MockResponse {
                    if (!online.get()) return MockResponse.Builder().code(503).build()
                    return when (request.url.encodedPath) {
                        "/api/auth/login", "/api/auth/me" -> json(User("car-fixture", "Car fixture"))
                        "/api/config" -> MockResponse.Builder().body("""{"recommendationsEnabled":true}""").build()
                        "/api/me/settings" -> json(UserSettings())
                        "/api/favorites" -> json(Paged(songs, songs.size, 1, 200))
                        "/api/search" -> json(SearchResults(tracks = search(request)))
                        "/api/recommendations/radio" -> json(RadioBatch(tracks = songs.map(::RecommendedTrack)))
                        "/api/experiments/audiobooks" -> MockResponse.Builder()
                            .body("""{"enabled":${audiobookRequest != null}}""").build()
                        "/api/audiobooks" -> json(listOf(book))
                        "/api/audiobooks/${book.id}" -> {
                            audiobookRequest?.invoke()
                            json(book)
                        }
                        else -> if (request.url.encodedPath.endsWith("/stream")) {
                            if (request.url.encodedPath.startsWith("/api/tracks/")) musicRequest()
                            val offset = request.headers["Range"]?.substringAfter("bytes=")?.substringBefore('-')?.toIntOrNull() ?: 0
                            MockResponse.Builder().code(if (offset == 0) 200 else 206)
                                .addHeader("Content-Type", "audio/wav")
                                .addHeader("Content-Range", "bytes $offset-${audio.lastIndex}/${audio.size}")
                                .body(Buffer().write(audio, offset, audio.size - offset)).build()
                        } else {
                            MockResponse.Builder().code(404).build()
                        }
                    }
                }
            }
            web.start()
            container.connectionPreferences.setAllowLocalHttp(true)
            try {
                runBlocking { container.session.state.first { it !is SessionState.Restoring } }
                container.queue.delete()
                if (saved) container.queue.writeText(container.json.encodeToString(SavedQueue(songs, 1, 1_375L)))
                runBlocking { assertNull(container.session.login(web.url("/").toString(), "car-fixture", "fixture")) }
                test()
            } finally {
                onMain { context.stopService(android.content.Intent().setComponent(service)) }
                runBlocking { container.session.logout() }
                container.connectionPreferences.setAllowLocalHttp(oldHttp)
            }
        }
    }

    private inline fun <reified T> json(value: T) = MockResponse.Builder()
        .addHeader("Content-Type", "application/json").body(container.json.encodeToString(value)).build()

    private fun legacyBrowser(rootLimit: Int? = null): LegacyBrowser {
        val ready = CompletableFuture<Unit>()
        val hints = Bundle().apply {
            if (rootLimit != null) putInt(MediaConstants.EXTRAS_KEY_ROOT_CHILDREN_LIMIT, rootLimit)
            putInt("androidx.media.MediaBrowserCompat.Extras.KEY_ROOT_CHILDREN_SUPPORTED_FLAGS", LegacyBrowser.MediaItem.FLAG_BROWSABLE)
        }
        val browser = onMain {
            LegacyBrowser(context, service, object : LegacyBrowser.ConnectionCallback() {
                override fun onConnected() { ready.complete(Unit) }
                override fun onConnectionFailed() { ready.completeExceptionally(AssertionError("Cannot connect to music service")) }
            }, hints).also { it.connect() }
        }
        ready.get(10, TimeUnit.SECONDS)
        return browser
    }

    private fun legacyController(browser: LegacyBrowser) =
        LegacyController(context, browser.sessionToken.token)

    private fun children(browser: LegacyBrowser, parent: String): List<LegacyBrowser.MediaItem> {
        val result = CompletableFuture<List<LegacyBrowser.MediaItem>>()
        onMain {
            browser.subscribe(parent, Bundle.EMPTY, object : LegacyBrowser.SubscriptionCallback() {
                override fun onChildrenLoaded(id: String?, children: MutableList<LegacyBrowser.MediaItem>?, options: Bundle?) {
                    browser.unsubscribe(parent)
                    result.complete(children.orEmpty())
                }
                override fun onError(id: String?, options: Bundle?) {
                    result.completeExceptionally(AssertionError("Could not browse $id as ${container.session.state.value}"))
                }
            })
        }
        return result.get(10, TimeUnit.SECONDS)
    }

    private fun track(number: Int) = Track("car-track-$number", "Track $number", "artist", "Artist", durationSeconds = 30)

    private fun queueIds(controller: LegacyController) = controller.queue.orEmpty().map { it.description.mediaId }

    private fun silentWav(): ByteArray {
        val sampleRate = 8_000
        val dataSize = sampleRate * 2 * 30
        return ByteBuffer.allocate(44 + dataSize).order(ByteOrder.LITTLE_ENDIAN).apply {
            put("RIFF".toByteArray()).putInt(dataSize + 36).put("WAVEfmt ".toByteArray())
            putInt(16).putShort(1).putShort(1).putInt(sampleRate).putInt(sampleRate * 2).putShort(2).putShort(16)
            put("data".toByteArray()).putInt(dataSize)
        }.array()
    }

    private fun await(condition: () -> Boolean) {
        val deadline = SystemClock.elapsedRealtime() + 10_000
        while (!condition()) {
            check(SystemClock.elapsedRealtime() < deadline) { "Timed out waiting for playback state" }
            SystemClock.sleep(25)
        }
    }

    private fun <T> onMain(block: () -> T): T {
        var result: Result<T>? = null
        instrumentation.runOnMainSync { result = runCatching(block) }
        return checkNotNull(result).getOrThrow()
    }
}
