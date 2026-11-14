// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

package app.caimack.sync

import android.content.ContextWrapper
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.net.Uri
import android.os.Handler
import android.os.Looper
import androidx.datastore.preferences.core.PreferenceDataStoreFactory
import androidx.media3.common.MediaItem
import androidx.media3.common.Player
import androidx.media3.exoplayer.ExoPlayer
import androidx.test.platform.app.InstrumentationRegistry
import app.caimack.api.User
import app.caimack.session.Server
import java.io.File
import java.net.Inet4Address
import java.net.InetAddress
import java.util.Base64
import java.util.UUID
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger
import kotlinx.coroutines.*
import kotlinx.serialization.json.*
import mockwebserver3.Dispatcher
import mockwebserver3.MockResponse
import mockwebserver3.MockWebServer
import mockwebserver3.RecordedRequest
import okhttp3.OkHttpClient
import okio.Buffer
import org.junit.Assert.*
import org.junit.Assume.assumeTrue
import org.junit.Test

/**
 * Run on a physical phone after choosing a SAF folder in Settings. The test uses its own
 * server/account namespace and never edits the user's music.
 */
class LibrarySyncDeviceTest {
    @Test
    fun realSafFilesResumePatchReplaceDeleteAndPlayWithoutServer() = runBlocking {
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        val target = instrumentation.targetContext
        val grant =
            target.contentResolver.persistedUriPermissions.firstOrNull {
                it.isReadPermission && it.isWritePermission
            }
        assumeTrue(
            "Choose a music folder in Caimack before running this device test",
            grant != null,
        )
        val connectivity = target.getSystemService(ConnectivityManager::class.java)
        @Suppress("DEPRECATION")
        val wifi =
            connectivity.allNetworks.firstOrNull {
                connectivity
                    .getNetworkCapabilities(it)
                    ?.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) == true &&
                    connectivity
                        .getNetworkCapabilities(it)
                        ?.hasTransport(NetworkCapabilities.TRANSPORT_VPN) == false
            }
        assumeTrue("A local Wi-Fi network is required", wifi != null)
        val ip =
            connectivity
                .getLinkProperties(wifi!!)
                ?.linkAddresses
                ?.first { it.address is Inet4Address }
                ?.address
                ?.hostAddress!!
        val testId = UUID.randomUUID().toString()
        val privateDir = File(target.cacheDir, "sync-device-$testId").apply { mkdirs() }
        val context =
            object : ContextWrapper(target) {
                override fun getFilesDir() = privateDir

                override fun getSharedPreferences(name: String, mode: Int) =
                    target.getSharedPreferences("test-$testId-$name", mode)
            }
        val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
        val prefs =
            PreferenceDataStoreFactory.create(scope = scope) {
                File(privateDir, "settings.preferences_pb")
            }
        val server = Server(prefs)
        val json = Json {
            ignoreUnknownKeys = true
            explicitNulls = false
        }
        val user = User(UUID.randomUUID().toString(), "Sync test")
        val trackId = UUID.randomUUID().toString()
        val serverId = UUID.randomUUID().toString()
        val original = instrumentation.context.assets.open("sync/tone.mp3").use { it.readBytes() }
        val flac = instrumentation.context.assets.open("sync/tone.flac").use { it.readBytes() }
        var audio = original
        var version = sha256(original)
        var extension = "mp3"
        var present = true
        var lyric = "Original text"
        val downloads = AtomicInteger()
        val ranges = mutableListOf<String?>()
        val received = mutableSetOf<String>()
        fun envelope(): JsonObject {
            val prefix =
                if (extension == "flac") {
                    var end = 4
                    do {
                        val last = audio[end].toInt() and 128 != 0
                        val size =
                            ((audio[end + 1].toInt() and 255) shl 16) or
                                ((audio[end + 2].toInt() and 255) shl 8) or
                                (audio[end + 3].toInt() and 255)
                        end += 4 + size
                    } while (!last)
                    end
                } else 10 + audio.sliceArray(6..9).fold(0) { n, b -> (n shl 7) or b.toInt() }
            return buildJsonObject {
                put("audioVersion", version)
                put("fileHash", sha256(audio))
                put("prefix", Base64.getEncoder().encodeToString(audio.copyOfRange(0, prefix)))
                put("suffix", "")
                put("payloadSize", audio.size - prefix)
            }
        }
        fun snapshot(): JsonObject = buildJsonObject {
            put("protocol", 1)
            put("serverId", serverId)
            put("user", json.encodeToJsonElement(user))
            put("vectorVersion", "fixture-v1")
            put(
                "tracks",
                JsonArray(
                    if (present)
                        listOf(
                            buildJsonObject {
                                put("id", trackId)
                                put("title", "Device sync test")
                                put("artistId", "artist")
                                put("artistName", "Device test")
                                put("albumTitle", "Fixtures")
                                put("durationSeconds", 2)
                            }
                        )
                    else emptyList()
                ),
            )
            put(
                "files",
                JsonArray(
                    if (present)
                        listOf(
                            buildJsonObject {
                                put("id", trackId)
                                put("audioVersion", version)
                                put("fileHash", sha256(audio))
                                put("size", audio.size)
                                put("extension", extension)
                            }
                        )
                    else emptyList()
                ),
            )
            put(
                "lyrics",
                buildJsonObject {
                    if (present)
                        put(
                            trackId,
                            buildJsonObject {
                                put("plain", lyric)
                                put(
                                    "lines",
                                    JsonArray(
                                        listOf(
                                            buildJsonObject {
                                                put("at", 1500)
                                                put("text", lyric)
                                            }
                                        )
                                    ),
                                )
                            },
                        )
                },
            )
            put("assets", JsonArray(emptyList()))
            put("albums", JsonArray(emptyList()))
            put("artists", JsonArray(emptyList()))
            put("genres", JsonArray(emptyList()))
            put("playlists", JsonArray(emptyList()))
            put("playlistTracks", buildJsonObject {})
            put("mixes", buildJsonObject {})
            put("radio", buildJsonObject { put("tracks", JsonArray(emptyList())) })
        }
        val web = MockWebServer()
        web.dispatcher =
            object : Dispatcher() {
                override fun dispatch(request: RecordedRequest): MockResponse {
                    fun answer(value: JsonElement) =
                        MockResponse.Builder()
                            .code(200)
                            .addHeader("Content-Type", "application/json")
                            .body(value.toString())
                            .build()
                    return when (request.url.encodedPath) {
                        "/api/sync/snapshot" -> answer(snapshot())
                        "/api/sync/vectors" ->
                            answer(
                                buildJsonObject {
                                    put(
                                        "items",
                                        JsonArray(
                                            listOf(
                                                buildJsonObject {
                                                    put("trackId", trackId)
                                                    put(
                                                        "vector",
                                                        JsonArray(listOf(JsonPrimitive(1.0))),
                                                    )
                                                }
                                            )
                                        ),
                                    )
                                }
                            )
                        "/api/sync/tracks/$trackId/tags" -> answer(envelope())
                        "/api/sync/tracks/$trackId/audio" -> {
                            downloads.incrementAndGet()
                            ranges += request.headers["Range"]
                            val offset =
                                request.headers["Range"]
                                    ?.substringAfter("bytes=")
                                    ?.substringBefore('-')
                                    ?.toInt() ?: 0
                            MockResponse.Builder()
                                .code(if (offset > 0) 206 else 200)
                                .addHeader("ETag", "\"${sha256(audio)}\"")
                                .apply {
                                    if (offset > 0)
                                        addHeader(
                                            "Content-Range",
                                            "bytes $offset-${audio.size-1}/${audio.size}",
                                        )
                                }
                                .body(Buffer().write(audio, offset, audio.size - offset))
                                .build()
                        }
                        "/api/sync/actions" -> {
                            val actions =
                                json
                                    .parseToJsonElement(request.body!!.utf8())
                                    .jsonObject
                                    .objects("actions")
                            answer(
                                buildJsonObject {
                                    put(
                                        "results",
                                        JsonArray(
                                            actions.map { action ->
                                                received += action.string("id")
                                                buildJsonObject {
                                                    put("id", action.string("id"))
                                                    put("status", "applied")
                                                }
                                            }
                                        ),
                                    )
                                }
                            )
                        }
                        else -> MockResponse.Builder().code(404).build()
                    }
                }
            }
        web.start(InetAddress.getByName("0.0.0.0"), 0)
        server.remember(web.url("/").newBuilder().host(ip).build().toString())
        val store = SyncStore(context, json, server)
        store.configure(grant!!.uri, user)
        store.enable(true)
        val sync = LibrarySync(context, store, server) { OkHttpClient() }
        val folder = MusicFolder(context, grant.uri)
        val identity = "Caimack-${serverId.take(8)}-${user.id.take(8)}"
        val root = folder.directory(folder.root, identity)
        val parent = folder.directory(folder.directory(root, "Device test"), "Fixtures")
        val unrelated = folder.create(root, "keep-me.txt", "text/plain")
        folder.output(unrelated).use { it.write("User file".toByteArray()) }
        try {
            // Simulate process death part-way through the first download.
            val partial = folder.create(parent, ".partial.mp3.part", "application/octet-stream")
            folder.output(partial).use { it.write(original, 0, 100) }
            File(store.directory, "transfer.json")
                .writeText(
                    buildJsonObject {
                        put("id", trackId)
                        put("hash", sha256(original))
                        put("uri", partial.toString())
                        put("parent", parent.toString())
                        put("finalName", "Device sync test.mp3")
                        put("relativePath", "$identity/Device test/Fixtures/Device sync test.mp3")
                    }
                        .toString()
                )
            sync.run()
            assertEquals(store.status.value.message, 1, store.index.files.size)
            assertEquals("bytes=100-", ranges.first())
            assertThrows(IllegalArgumentException::class.java) {
                store.accept(JsonObject(snapshot() - "files"))
            }
            assertEquals(1, store.index.files.size)
            assertEquals(
                sha256(original),
                folder.input(store.audio(trackId)!!).use { sha256(it.readBytes()) },
            )
            assertTrue(store.index.exports.containsKey("vectors"))
            assertTrue(
                Uri.decode(store.index.files.getValue(trackId).companions.single()).endsWith(".lrc")
            )
            assertTrue(Uri.decode(store.index.exports.getValue("station:radio")).endsWith(".m3u8"))
            folder.delete(Uri.parse(store.index.exports.getValue("vectors")))
            sync.run()
            assertTrue(folder.exists(Uri.parse(store.index.exports.getValue("vectors"))))
            assertEquals("Unchanged music must not be downloaded again", 1, downloads.get())

            // Change only ID3 padding; the audio payload remains identical.
            val prefix = Base64.getDecoder().decode(envelope().string("prefix"))
            val bodySize = prefix.size - 10 + 1
            val patchedPrefix = prefix + byteArrayOf(0)
            for (i in 0..3) patchedPrefix[6 + i] = ((bodySize shr (7 * (3 - i))) and 127).toByte()
            audio = patchedPrefix + original.copyOfRange(prefix.size, original.size)
            lyric = "Updated text"
            sync.run()
            assertEquals(
                store.status.value.message,
                sha256(audio),
                folder.input(store.audio(trackId)!!).use { sha256(it.readBytes()) },
            )
            assertEquals("Tag edits must not download audio", 1, downloads.get())
            assertTrue(
                store.index.files.getValue(trackId).companions.any {
                    folder.input(Uri.parse(it)).use { input ->
                        String(input.readBytes()).contains(lyric)
                    }
                }
            )

            audio = flac
            extension = "flac"
            version = sha256(flac)
            val old = store.audio(trackId)!!
            sync.run()
            assertEquals(2, downloads.get())
            assertFalse(folder.exists(old))
            val local = store.audio(trackId)!!
            assertEquals(sha256(flac), folder.input(local).use { sha256(it.readBytes()) })
            val event =
                SyncAction(
                    kind = "favorite",
                    entityId = trackId,
                    payload = buildJsonObject { put("value", true) },
                )
            store.enqueue(event)
            val restored = SyncStore(context, json, server).apply { session(user) }
            assertEquals(event.id, restored.pending().single().id)
            assertEquals(local, restored.audio(trackId))
            sync.run()
            assertTrue(received.contains(event.id))
            assertTrue(store.pending().isEmpty())

            // A real Media3 decoder reads the SAF file, with the mock server shut
            // down. This also catches providers that return non-seekable handles.
            web.close()
            val ended = CountDownLatch(1)
            var player: ExoPlayer? = null
            var playbackError: String? = null
            Handler(Looper.getMainLooper()).post {
                player =
                    ExoPlayer.Builder(target).build().apply {
                        volume = 0f
                        addListener(
                            object : Player.Listener {
                                override fun onPlaybackStateChanged(state: Int) {
                                    if (state == Player.STATE_ENDED) ended.countDown()
                                }

                                override fun onPlayerError(
                                    error: androidx.media3.common.PlaybackException
                                ) {
                                    playbackError = error.toString()
                                    ended.countDown()
                                }
                            }
                        )
                        setMediaItem(MediaItem.fromUri(local))
                        prepare()
                        play()
                    }
            }
            assertTrue("Local playback did not finish", ended.await(15, TimeUnit.SECONDS))
            assertNull(playbackError)
            Handler(Looper.getMainLooper()).post { player?.release() }
            // Restore a new local server on the same address for deletion testing.
            val port = server.url.value!!.port
            val again =
                MockWebServer().apply {
                    dispatcher = web.dispatcher
                    start(InetAddress.getByName("0.0.0.0"), port)
                }
            present = false
            sync.run()
            assertTrue(store.index.files.isEmpty())
            assertFalse(folder.exists(local))
            assertTrue(folder.exists(unrelated))
            again.close()
        } finally {
            runCatching { web.close() }
            store.enable(false)
            folder.delete(root) // only this test's unique namespace
            scope.cancel()
            privateDir.deleteRecursively()
        }
    }
}
