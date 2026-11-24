// SPDX-License-Identifier: AGPL-3.0-only
package app.caimack.sync

import app.caimack.api.CaimackApi
import app.caimack.api.HistoryEntryRequest
import app.caimack.api.TasteRuleRequest
import app.caimack.playback.LibraryCache
import app.caimack.playback.ListeningTracker
import app.caimack.playback.PlaySources
import app.caimack.playback.Signals
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.*
import mockwebserver3.MockResponse
import mockwebserver3.MockWebServer
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import retrofit2.Retrofit
import retrofit2.converter.kotlinx.serialization.asConverterFactory
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder

class PlaybackSyncTest {
    @get:Rule val temporary = TemporaryFolder()
    private val json = Json { ignoreUnknownKeys = true }

    private fun api(server: MockWebServer, client: OkHttpClient = OkHttpClient()): CaimackApi =
        Retrofit.Builder().baseUrl(server.url("/")).client(client)
            .addConverterFactory(json.asConverterFactory("application/json".toMediaType()))
            .build().create(CaimackApi::class.java)

    @Test fun playingSignalsKeepTheirPlaylistSessionAfterTheTrackIsRetagged() = runBlocking {
        MockWebServer().use { server ->
            server.start()
            val events = mutableListOf<JsonObject>()
            val signals = Signals(api(server), this, "device-session") { _, payload, _ -> events.add(payload) }
            val track = "playlist-seed"
            PlaySources.tag(listOf(track), "radio:playlist", "playlist-session")
            try {
                signals.begin(track, 60)
                PlaySources.tag(listOf(track), "queue")
                assertFalse(signals.hasSameSession(track))
                signals.tracker.finish(ListeningTracker.COMPLETED)
                signals.begin(track, 60)
                assertEquals(listOf("playlist-session", "playlist-session", "device-session", "device-session"),
                    events.map { it.string("sessionId") })
            } finally {
                PlaySources.tag(listOf(track), "queue")
            }
        }
    }

    @Test fun offlineActivitySurvivesRestartAndRetriesWithTheSameReceipts() = runBlocking {
        MockWebServer().use { server ->
            server.start()
            val alice = PlaybackSync.Owner(server.url("/"), "alice")
            var owner = alice
            val directory = temporary.newFolder()
            fun queue() = PlaybackSync(directory, json, api(server)) { owner }
            var queue = queue()
            val offline = api(server, OkHttpClient.Builder().addInterceptor(queue.interceptor).build())
            val signals = Signals(offline, this, "test") { kind, payload, at ->
                queue.enqueue(owner, SyncAction(kind = kind, payload = payload, occurredAt = at))
            }
            signals.begin("track", 60)
            (1..30).forEach { signals.progress("track", 60, it.toDouble()) }
            offline.like("track")
            offline.recordPlay(HistoryEntryRequest("another", 31, 31))
            offline.addTasteRule(TasteRuleRequest("block", "artist", "artist"))
            assertEquals(0, server.requestCount)

            queue = queue()
            assertEquals(true, queue.favorite(alice.key, "track"))
            assertEquals(setOf("track", "another"), queue.edits(alice.key).filter { it.kind == "history" }
                .map { it.payload.string("trackId") }.toSet())
            server.enqueue(response("""{"serverId":"server","userId":"alice"}"""))
            server.enqueue(response("""{"results":[]}"""))
            assertFalse(queue.flush())
            assertEquals("/api/sync/identity", server.takeRequest().url.encodedPath)
            val sent = server.takeRequest()
            val actions = json.parseToJsonElement(sent.body!!.utf8()).jsonObject.objects("actions")
            assertEquals(setOf("signal", "history", "favorite", "tasteRule"), actions.map { it.string("kind") }.toSet())
            assertEquals("1", sent.headers["X-Caimack-Sync"])

            owner = PlaybackSync.Owner(server.url("/"), "bob")
            assertNull(queue.favorite(owner.key, "track"))
            owner = alice
            queue = queue()
            server.enqueue(response(buildJsonObject {
                putJsonArray("results") { actions.forEach { action ->
                    addJsonObject { put("id", action.string("id")); put("status", "applied") }
                } }
            }.toString()))
            assertTrue(queue.flush())
            val retried = json.parseToJsonElement(server.takeRequest().body!!.utf8()).jsonObject
            assertEquals("server", retried.string("serverId"))
            assertEquals(actions, retried.objects("actions"))
            assertEquals(3, queue.confirmed(alice.key).size)
            assertTrue(queue.flush())
            assertEquals(3, server.requestCount)
        }
    }

    @Test fun pendingAndAcknowledgedPreferencesAreVisibleInTheOfflineCatalog() = runBlocking {
        MockWebServer().use { server ->
            server.start()
            val owner = PlaybackSync.Owner(server.url("/"), "alice")
            val queue = PlaybackSync(temporary.newFolder(), json, api(server)) { owner }
            val cache = LibraryCache(temporary.newFolder(), { owner.key }, {
                json.parseToJsonElement("""{"tracks":[{"id":"track","title":"Saved","isFavorite":false}]}""").jsonObject
            }, json, clock = { 0L }, edits = queue::edits, confirmed = queue::confirmed, observed = queue::observed)
            val offline = api(server, OkHttpClient.Builder().addInterceptor(queue.interceptor).addInterceptor(cache.interceptor).build())
            // The nominal server has never supplied a full catalog to this account.
            val action = SyncAction(kind = "favorite", entityId = "track", payload = buildJsonObject { put("value", true) })
            assertTrue(queue.enqueue(owner, action))
            val url = owner.url("api/favorites")
            val client = OkHttpClient.Builder().addInterceptor(cache.interceptor).build()
            fun localFavorite(): Boolean = client.newCall(okhttp3.Request.Builder().url(url).build()).execute().use {
                json.parseToJsonElement(it.body.string()).jsonObject.objects("items").single()["isFavorite"]!!.jsonPrimitive.boolean
            }
            assertTrue(localFavorite())
            server.enqueue(response("""{"serverId":"server","userId":"alice"}"""))
            server.enqueue(response("""{"results":[{"id":"${action.id}","status":"applied"}]}"""))
            assertTrue(queue.flush())
            assertTrue(localFavorite())
            offline.unlike("track")
            assertEquals(false, queue.favorite(owner.key, "track"))
        }
    }

    private fun response(body: String) = MockResponse.Builder().addHeader("Content-Type", "application/json").body(body).build()
}
