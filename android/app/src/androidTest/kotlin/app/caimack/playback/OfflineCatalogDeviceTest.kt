// SPDX-License-Identifier: AGPL-3.0-only

package app.caimack.playback

import androidx.test.platform.app.InstrumentationRegistry
import app.caimack.CaimackApp
import app.caimack.api.*
import app.caimack.session.SessionState
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicInteger
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import mockwebserver3.*
import org.junit.Test

class OfflineCatalogDeviceTest {
    @Test fun cachedCollectionsOpenWhileTheServerProbeIsStillWaiting() {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        check(context.packageName.endsWith(".uitest"))
        val container = (context.applicationContext as CaimackApp).container
        runBlocking { withTimeout(5_000) { container.session.state.first { it !is SessionState.Restoring } } }
        val originalHttp = container.connectionPreferences.allowLocalHttp.value
        val online = AtomicBoolean(true)
        val remoteCollectionCalls = AtomicInteger()
        val probeStarted = CompletableDeferred<Unit>()
        val networkQueueFull = CompletableDeferred<Unit>()
        val slowSettingsReads = AtomicInteger()
        val user = User("catalog-speed", "Catalog listener")
        val track = Track("track", "Local collection song", "artist", "Catalog artist", durationSeconds = 60)
        val saved = listOf(
            LibraryItem("playlist", "list", "Catalog playlist", savedAt = "2026-01-01T00:00:00Z"),
            LibraryItem("artist", track.artistId, track.artistName, savedAt = "2026-01-01T00:00:00Z"),
        )
        val playlist = PlaylistDetail("list", "Catalog playlist", ownerId = user.id, tracks = listOf(track))
        val artist = ArtistDetail(track.artistId, track.artistName, albums = emptyList(), tracks = Paged(listOf(track), 1, 1, 50))
        MockWebServer().use { web ->
            web.dispatcher = object : Dispatcher() {
                override fun dispatch(request: RecordedRequest): MockResponse {
                    val path = request.url.encodedPath
                    if (!online.get()) {
                        val response = MockResponse.Builder().code(503)
                        when (path) {
                            "/api/me/settings" -> {
                                if (slowSettingsReads.incrementAndGet() >= 4) networkQueueFull.complete(Unit)
                                response.headersDelay(8, TimeUnit.SECONDS)
                            }
                            "/api/auth/me" -> { probeStarted.complete(Unit); response.headersDelay(4, TimeUnit.SECONDS) }
                            "/api/playlists/list", "/api/artists/artist", "/api/me/library/folders" -> {
                                remoteCollectionCalls.incrementAndGet()
                                response.headersDelay(4, TimeUnit.SECONDS)
                            }
                        }
                        return response.build()
                    }
                    val body = when (path) {
                        "/api/auth/login", "/api/auth/me" -> container.json.encodeToString(user)
                        "/api/config", "/api/me/settings", "/api/me/library/order" -> "{}"
                        "/api/home/feed" -> """{"blocks":[]}"""
                        "/api/me/library/folders" -> "[]"
                        "/api/me/library" -> container.json.encodeToString(saved)
                        "/api/playlists/list" -> container.json.encodeToString(playlist)
                        "/api/artists/artist" -> container.json.encodeToString(artist)
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
                    container.api.savedLibrary()
                    container.api.playlist("list")
                    container.api.artist("artist")
                    online.set(false)
                    container.api.homeFeed()
                }
                check(container.libraryCache.offline.value)
                runBlocking {
                    // Let the reconnect cooldown elapse while the server is still slow.
                    delay(5_100)
                    withTimeout(2_000) {
                        container.api.libraryFolders()
                        check(container.api.playlist("list").tracks.single().id == track.id)
                        check(container.api.artist("artist").tracks.items.single().id == track.id)
                        probeStarted.await()
                    }
                    coroutineScope {
                        // Hold five ordinary calls so even the first cached read would queue on the shared dispatcher.
                        val waiting = List(5) { async { runCatching { container.api.settings() } } }
                        try {
                            withTimeout(2_000) {
                                networkQueueFull.await()
                                check(container.api.homeFeed().blocks.isEmpty())
                                check(container.api.playlist("list").tracks.single().id == track.id)
                            }
                        } finally {
                            waiting.forEach { it.cancel() }
                        }
                    }
                    check(container.libraryCache.offline.value)
                    check(remoteCollectionCalls.get() == 0)
                }
            } finally {
                online.set(true)
                runBlocking { container.session.logout() }
                container.connectionPreferences.setAllowLocalHttp(originalHttp)
            }
        }
    }
}
