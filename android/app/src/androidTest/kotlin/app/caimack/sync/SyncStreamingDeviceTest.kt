// SPDX-License-Identifier: AGPL-3.0-only
package app.caimack.sync

import java.io.File
import java.security.MessageDigest
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger
import java.util.concurrent.atomic.AtomicReference
import kotlinx.coroutines.*
import kotlinx.serialization.json.*
import mockwebserver3.*
import okio.BufferedSink
import org.junit.Assert.*
import org.junit.Test

class SyncStreamingDeviceTest {
    private fun SyncDeviceFixture.vectorServer(): Pair<AtomicReference<() -> MockResponse>, AtomicInteger> {
        val response = AtomicReference<() -> MockResponse>({
            MockResponse.Builder().body("""{"protocol":1,"items":[]}""").build()
        })
        val requests = AtomicInteger()
        web.dispatcher = object : Dispatcher() {
            override fun dispatch(request: RecordedRequest): MockResponse = when (request.url.encodedPath) {
                "/api/sync/snapshot" -> MockResponse.Builder().body(manifest {
                    put("vectorVersion", "v1")
                    put("tracks", JsonArray(emptyList()))
                    put("files", JsonArray(emptyList()))
                }.toString()).build()
                "/api/sync/vectors" -> {
                    requests.incrementAndGet()
                    response.get()()
                }
                else -> MockResponse.Builder().code(404).build()
            }
        }
        return response to requests
    }

    @Test fun storesMoreThan100MbOfVectorsWithBoundedMemoryAndSkipsAnUnchangedVersion() = runBlocking {
        withLibrarySync {
            val (response, requests) = vectorServer()
            val prefix = "{\"protocol\":1,\"items\":[".toByteArray()
            val row = ("{\"trackId\":\"vector-track\",\"dimension\":1024,\"vector\":[" +
                List(1024) { "0.123456789" }.joinToString(",") + "]}").toByteArray()
            val comma = byteArrayOf(','.code.toByte())
            val suffix = "]}".toByteArray()
            val rows = 10_000
            val length = prefix.size.toLong() + row.size.toLong() * rows + rows - 1 + suffix.size
            assertTrue(length > 100L * 1024 * 1024)
            fun payload(write: (ByteArray) -> Unit) {
                write(prefix)
                repeat(rows) { if (it > 0) write(comma); write(row) }
                write(suffix)
            }
            val expected = MessageDigest.getInstance("SHA-256").apply { payload { update(it) } }.digest()
            response.set {
                MockResponse.Builder().body(object : MockResponseBody {
                    override val contentLength = length
                    override fun writeTo(sink: BufferedSink) { payload { sink.write(it); sink.emitCompleteSegments() } }
                }).build()
            }
            sync.run()
            assertNotEquals(store.status.value.message, 0L, store.status.value.lastSync)
            assertEquals("v1", store.index.vectorVersion)
            val vectors = store.vectorFile.baseFile
            assertEquals(length, vectors.length())
            val actual = MessageDigest.getInstance("SHA-256")
            vectors.inputStream().use { input ->
                val buffer = ByteArray(8192)
                while (true) {
                    val count = input.read(buffer)
                    if (count == -1) break
                    actual.update(buffer, 0, count)
                }
            }
            assertArrayEquals(expected, actual.digest())
            sync.run()
            assertEquals("An unchanged vectors file must not be fetched again", 1, requests.get())
            val restored = SyncStore(context, json, server).apply { session(user) }
            assertEquals("v1", restored.index.vectorVersion)
            assertEquals(store.snapshot, restored.snapshot)
        }
    }

    @Test fun interruptedVectorTransferKeepsTheCompleteCopyAndRetriesAfterResume() = runBlocking {
        withLibrarySync {
            val (response, requests) = vectorServer()
            sync.run()
            val vectors = store.vectorFile.baseFile
            val original = vectors.readBytes()
            // Simulate a newer server version while retaining the complete local export.
            store.updateIndex { it.copy(vectorVersion = "old-version") }
            val started = CountDownLatch(1)
            val release = CountDownLatch(1)
            response.set {
                MockResponse.Builder().body(object : MockResponseBody {
                    override val contentLength = 100_000L
                    override fun writeTo(sink: BufferedSink) {
                        sink.writeUtf8("{\"items\":["); sink.flush(); started.countDown()
                        release.await(10, TimeUnit.SECONDS)
                    }
                }).build()
            }
            try {
                val task = async(Dispatchers.IO) { sync.run() }
                assertTrue(started.await(10, TimeUnit.SECONDS))
                withTimeout(10_000) { while (!File(vectors.path + ".new").exists()) delay(10) }
                sync.pause()
                release.countDown()
                try { task.await() } catch (_: CancellationException) { }
                assertEquals("old-version", store.index.vectorVersion)
                assertArrayEquals(original, vectors.readBytes())
                assertFalse(store.status.value.running)
                response.set { MockResponse.Builder().body("{\"protocol\":1,\"items\":[{\"trackId\":\"new\"}]}").build() }
                store.paused = false
                sync.run()
                assertEquals("v1", store.index.vectorVersion)
                assertTrue(vectors.readText().contains("new"))
                assertEquals(3, requests.get())
            } finally { release.countDown() }
        }
    }
}
