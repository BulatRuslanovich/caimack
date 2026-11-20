// SPDX-License-Identifier: AGPL-3.0-only

package app.caimack.sync

import android.net.Uri
import androidx.annotation.OptIn
import androidx.media3.common.MediaItem
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.common.util.UnstableApi
import androidx.media3.datasource.DataSpec
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory
import androidx.test.platform.app.InstrumentationRegistry
import app.caimack.api.LyricLine
import app.caimack.api.LyricWord
import app.caimack.api.Lyrics
import app.caimack.api.Track
import app.caimack.api.User
import app.caimack.playback.Downloads
import java.io.ByteArrayOutputStream
import java.io.File
import java.util.concurrent.ConcurrentLinkedQueue
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicReference
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeout
import kotlinx.serialization.json.*
import mockwebserver3.*
import okio.Buffer
import org.junit.Assert.*
import org.junit.Test

@OptIn(UnstableApi::class)
class LibrarySyncDeviceTest {
    @Test fun synchronizesToTheDownloadCacheAndKeepsPlaybackAndMetadataOffline() = runBlocking {
        withLibrarySync {
            val fixtures = InstrumentationRegistry.getInstrumentation().context.assets
            val mp3 = fixtures.open("sync/tone.mp3").use { it.readBytes() }
            val flac = fixtures.open("sync/tone.flac").use { it.readBytes() }
            val first = Track("first", "First", "artist", "Artist", albumId = "album", durationSeconds = 2, hasCover = true)
            val second = first.copy(id = "second", title = "Second")
            val coverPath = "api/albums/album/cover"
            val cover = byteArrayOf(3, 38, 28)
            val lyrics = Lyrics("Hello", listOf(LyricLine(0, "Hello", 1_000, listOf(LyricWord(0, 1_000, "Hello")))), provider = "Test")
            val audio = AtomicReference(mp3)
            val tracks = AtomicReference(listOf(first, second))
            val dropFirstResponse = AtomicBoolean(true)
            val corruptReplacement = AtomicBoolean(true)
            val partialManifest = AtomicBoolean(false)
            val ranges = ConcurrentLinkedQueue<Pair<String, Int>>()
            val acknowledged = ConcurrentLinkedQueue<String>()

            web.dispatcher = object : Dispatcher() {
                override fun dispatch(request: RecordedRequest): MockResponse = when (val path = request.url.encodedPath) {
                    "/api/sync/snapshot" -> MockResponse.Builder().body(manifest {
                        val current = tracks.get()
                        put("tracks", json.encodeToJsonElement(current))
                        if (!partialManifest.get()) putJsonArray("files") {
                            current.forEach { track ->
                                val bytes = if (track == first) audio.get() else mp3
                                addJsonObject {
                                    put("id", track.id)
                                    put("fileHash", sha256(bytes))
                                    put("size", bytes.size)
                                }
                            }
                        }
                        putJsonArray("assets") { addJsonObject { put("path", coverPath); put("version", "initial") } }
                        putJsonObject("lyrics") { put(first.id, json.encodeToJsonElement(lyrics)) }
                        putJsonObject("waveforms") { putJsonObject(first.id) { putJsonArray("peaks") { add(7) } } }
                        putJsonObject("playlistTracks") { putJsonArray("playlist") { add(first.id); add(second.id) } }
                    }.toString()).build()
                    "/api/sync/actions" -> {
                        val incoming = json.parseToJsonElement(request.body!!.utf8()).jsonObject.objects("actions")
                        MockResponse.Builder().body(buildJsonObject {
                            putJsonArray("results") {
                                for (action in incoming) {
                                    acknowledged += action.string("id")
                                    addJsonObject { put("id", action.string("id")); put("status", "applied") }
                                }
                            }
                        }.toString()).build()
                    }
                    "/api/sync/tracks/${first.id}/audio", "/api/sync/tracks/${second.id}/audio" -> {
                        val id = path.substringBeforeLast('/').substringAfterLast('/')
                        val bytes = if (id == first.id) audio.get() else mp3
                        if (request.url.queryParameter("version") != sha256(bytes)) {
                            MockResponse.Builder().code(412).build()
                        } else {
                            val start = request.headers["Range"]?.substringAfter('=')?.substringBefore('-')?.toInt() ?: 0
                            ranges += id to start
                            MockResponse.Builder().apply {
                                if (start > 0) code(206).addHeader("Content-Range", "bytes $start-${bytes.lastIndex}/${bytes.size}")
                                if (id == first.id && dropFirstResponse.getAndSet(false)) onResponseBody(SocketEffect.CloseSocket())
                                val payload = if (bytes === flac && corruptReplacement.getAndSet(false)) {
                                    bytes.copyOf().apply { this[lastIndex] = (this[lastIndex].toInt() xor 1).toByte() }
                                } else bytes
                                body(Buffer().write(payload, start, payload.size - start))
                            }.build()
                        }
                    }
                    "/$coverPath" -> MockResponse.Builder().body(Buffer().write(cover)).build()
                    else -> MockResponse.Builder().code(404).build()
                }
            }

            // Existing installations have a SAF index and a persisted binding before the upgrade.
            val legacy = File(context.filesDir, "old-export.mp3").apply { writeBytes(mp3) }
            val oldAudio = Uri.fromFile(legacy)
            store.updateIndex { it.copy(files = mapOf(first.id to SyncedFile(oldAudio.toString(), legacy.name, "old", sha256(mp3), 0, 0, mp3.size.toLong()))) }
            assertEquals(oldAudio, store.audio(first.id))
            context.getSharedPreferences("library-sync", 0).edit().putString("folder", "content://old/music").apply()
            val upgraded = SyncStore(context, json, server).apply { session(user) }
            assertTrue(upgraded.active)
            assertEquals(oldAudio, upgraded.audio(first.id))

            sync.run()
            assertNull(store.status.value.message)
            assertEquals(2, store.status.value.completed)
            assertTrue(ranges.any { (id, start) -> id == first.id && start > 0 })
            assertArrayEquals(mp3, read(downloads, first.id))
            assertArrayEquals(mp3, read(downloads, second.id))
            assertTrue(store.index.files.isEmpty())
            assertArrayEquals(mp3, legacy.readBytes())
            val asset = File(checkNotNull(Uri.parse(store.asset(coverPath)).path))
            assertEquals(store.directory, asset.parentFile)
            assertArrayEquals(cover, asset.readBytes())

            val requests = ranges.size
            restartDownloads()
            sync.run()
            assertEquals(requests, ranges.size)
            assertNotNull(downloads.completed(first.id))
            store.session(User("other", "Other account"))
            assertNull(downloads.completed(first.id))
            assertNull(store.asset(coverPath))
            store.session(user)

            // A partial response cannot remove the last complete copy.
            partialManifest.set(true)
            tracks.set(listOf(first))
            sync.run()
            assertNotNull(store.status.value.message)
            assertNotNull(downloads.completed(second.id))
            partialManifest.set(false)
            audio.set(flac)
            val edit = SyncAction(kind = "favorite", entityId = first.id, payload = buildJsonObject { put("value", true) })
            assertTrue(store.enqueue(edit))
            sync.run()
            assertNull(store.status.value.message)
            assertEquals(listOf(edit.id), acknowledged.toList())
            assertTrue(store.pending().isEmpty())
            assertNull(downloads.completed(second.id))
            assertArrayEquals(flac, read(downloads, first.id))
            assertEquals(1, downloads.libraryEntries().size)

            web.close()
            val restored = SyncStore(context, json, server).apply { session(user) }
            assertEquals(lyrics, restored.lyrics(first.id))
            assertEquals(store.asset(coverPath), restored.asset("api/tracks/${first.id}/cover"))
            val saved = checkNotNull(restored.snapshot)
            val lookup = checkNotNull(server.resolve("api/tracks/${first.id}/waveform"))
            assertNotNull(OfflineCatalog.read("tracks/${first.id}/waveform", lookup, buildJsonObject {}, saved))
            assertEquals(first.id, saved.getValue("playlistTracks").jsonObject.getValue("playlist").jsonArray[0].jsonPrimitive.content)
            restartDownloads()
            assertArrayEquals(flac, read(downloads, first.id))
            val request = checkNotNull(downloads.completed(first.id)).request
            withContext(Dispatchers.Main) {
                val ended = CompletableDeferred<Unit>()
                val player = ExoPlayer.Builder(context)
                    .setMediaSourceFactory(DefaultMediaSourceFactory(downloads.playback)).build()
                try {
                    player.volume = 0f
                    player.addListener(object : Player.Listener {
                        override fun onPlaybackStateChanged(state: Int) {
                            if (state == Player.STATE_ENDED) ended.complete(Unit)
                        }
                        override fun onPlayerError(error: PlaybackException) { ended.completeExceptionally(error) }
                    })
                    player.setMediaItem(request.toMediaItem(MediaItem.Builder()))
                    player.prepare()
                    player.play()
                    withTimeout(15_000) { ended.await() }
                } finally { player.release() }
            }

            store.enable(false)
            assertNotNull(downloads.completed(first.id))
            withContext(Dispatchers.Main) { downloads.remove(listOf(first.id)) }
            withTimeout(10_000) { downloads.library.revision.first { downloads.libraryEntries().isEmpty() } }
        }
    }

    private fun read(downloads: Downloads, trackId: String): ByteArray {
        val request = checkNotNull(downloads.completed(trackId)).request
        val source = downloads.playback.createDataSource()
        val output = ByteArrayOutputStream()
        try {
            source.open(DataSpec.Builder().setUri(request.uri).setKey(request.customCacheKey).build())
            val buffer = ByteArray(8192)
            while (true) {
                val count = source.read(buffer, 0, buffer.size)
                if (count == -1) break
                output.write(buffer, 0, count)
            }
        } finally { source.close() }
        return output.toByteArray()
    }
}
