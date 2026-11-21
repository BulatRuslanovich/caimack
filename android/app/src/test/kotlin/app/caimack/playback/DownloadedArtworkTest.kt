// SPDX-License-Identifier: AGPL-3.0-only
package app.caimack.playback

import app.caimack.api.ArtistRef
import app.caimack.api.Track
import java.io.File
import java.net.URI
import java.nio.file.Files
import java.util.Base64
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import mockwebserver3.Dispatcher
import mockwebserver3.MockResponse
import mockwebserver3.MockWebServer
import mockwebserver3.RecordedRequest
import okhttp3.OkHttpClient
import okio.Buffer
import org.junit.Assert.*
import org.junit.Test

class DownloadedArtworkTest {
    private val png = Base64.getDecoder().decode("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=")
    private fun image() = MockResponse.Builder().addHeader("Content-Type", "image/png").body(Buffer().write(png)).build()

    @Test fun `legacy fork artwork survives an offline upgrade and remains account scoped`() {
        val directory = Files.createTempDirectory("artwork-fork-upgrade").toFile()
        try {
            val legacy = File(directory, "legacy").apply { mkdirs() }
            val server = "http://192.168.1.10:8080/"
            val account = "$server|alice"
            val path = "api/albums/album/cover"
            val key = java.security.MessageDigest.getInstance("SHA-256").digest((account + path).toByteArray())
                .joinToString("") { "%02x".format(it) }
            File(legacy, key).writeBytes(png)
            val current = File(directory, "current")
            val cache = DownloadedArtwork(current, legacy)
            assertNull(cache.asset(server, path, "$server|bob"))
            val uri = cache.asset(server, path, account)
            assertNotNull(uri)
            assertArrayEquals(png, File(URI(uri!!)).readBytes())
            assertFalse(File(legacy, key).exists())
            assertEquals(uri, DownloadedArtwork(current, legacy).asset(server, path, account))
            assertNull(cache.asset(server, path, "$server|bob"))
        } finally { directory.deleteRecursively() }
    }

    @Test fun `artwork is private to its server and account`() {
        val directory = Files.createTempDirectory("artwork-account").toFile()
        MockWebServer().use { web ->
            web.start()
            try {
                val cache = DownloadedArtwork(directory)
                val server = web.url("/").toString()
                val path = "api/playlists/private/cover"
                web.enqueue(image())
                cache.cache(server, listOf(path), OkHttpClient(), "alice")
                assertNotNull(cache.asset(server, path, "alice"))
                assertNull(cache.asset(server, path, "bob"))
                assertNull(cache.asset("http://another-server/", path, "alice"))
            } finally { directory.deleteRecursively() }
        }
    }

    @Test fun `expired artwork is revalidated and changed bytes get a new local URI`() {
        val directory = Files.createTempDirectory("artwork-refresh").toFile()
        MockWebServer().use { web ->
            web.start()
            try {
                val cache = DownloadedArtwork(directory)
                val server = web.url("/").toString()
                val path = "api/albums/album/cover"
                val client = OkHttpClient()
                web.enqueue(image().newBuilder().addHeader("ETag", "\"old\"").build())
                cache.cache(server, listOf(path), client)
                val oldUri = cache.asset(server, path)
                directory.listFiles()!!.forEach { it.setLastModified(0) }
                val replacement = png + byteArrayOf(1)
                web.enqueue(MockResponse.Builder().addHeader("Content-Type", "image/png")
                    .addHeader("ETag", "\"new\"").body(Buffer().write(replacement)).build())
                cache.cache(server, listOf(path), client)
                assertEquals(2, web.requestCount)
                web.takeRequest()
                assertEquals("\"old\"", web.takeRequest().headers["If-None-Match"])
                assertNotEquals(oldUri, cache.asset(server, path))
                assertArrayEquals(replacement, File(URI(cache.asset(server, path)!!)).readBytes())
            } finally { directory.deleteRecursively() }
        }
    }

    @Test fun `a not modified response preserves offline artwork`() {
        val directory = Files.createTempDirectory("artwork-not-modified").toFile()
        MockWebServer().use { web ->
            web.start()
            try {
                val cache = DownloadedArtwork(directory)
                val server = web.url("/").toString()
                val path = "api/artists/artist/image"
                val client = OkHttpClient()
                web.enqueue(image().newBuilder().addHeader("ETag", "\"same\"").build())
                cache.cache(server, listOf(path), client)
                val uri = cache.asset(server, path)
                directory.listFiles()!!.forEach { it.setLastModified(0) }
                web.enqueue(MockResponse.Builder().code(304).build())
                cache.cache(server, listOf(path), client)
                assertEquals(2, web.requestCount)
                assertEquals(uri, cache.asset(server, path))
                assertEquals(1L, cache.revision.value)
            } finally { directory.deleteRecursively() }
        }
    }

    @Test fun `editing artwork revalidates immediately while retaining the offline image`() {
        val directory = Files.createTempDirectory("artwork-edit").toFile()
        MockWebServer().use { web ->
            web.start()
            try {
                val cache = DownloadedArtwork(directory)
                val server = web.url("/").toString()
                val path = "api/playlists/mix/cover"
                val client = OkHttpClient()
                web.enqueue(image())
                cache.cache(server, listOf(path), client)
                val oldUri = cache.asset(server, path)
                cache.invalidate(server, path)
                assertEquals(oldUri, cache.asset(server, path))
                web.enqueue(MockResponse.Builder().code(503).build())
                cache.cache(server, listOf(path), client)
                assertEquals(oldUri, cache.asset(server, path))
                web.enqueue(MockResponse.Builder().addHeader("Content-Type", "image/png")
                    .body(Buffer().write(png + byteArrayOf(1))).build())
                cache.cache(server, listOf(path), client)
                assertNotEquals(oldUri, cache.asset(server, path))
                assertEquals(3, web.requestCount)
            } finally { directory.deleteRecursively() }
        }
    }

    @Test fun `cached artwork stays readable while another image waits on the server`() {
        val directory = Files.createTempDirectory("artwork-concurrent").toFile()
        val workers = Executors.newFixedThreadPool(2)
        val started = CountDownLatch(1)
        val reply = CountDownLatch(1)
        MockWebServer().use { web ->
            web.start()
            val cache = DownloadedArtwork(directory)
            val server = web.url("/").toString()
            val client = OkHttpClient()
            try {
                web.enqueue(image())
                cache.cache(server, listOf("cover"), client)
                val ready = cache.asset(server, "cover")
                assertNotNull(ready)
                web.dispatcher = object : Dispatcher() {
                    override fun dispatch(request: RecordedRequest): MockResponse {
                        started.countDown()
                        reply.await(5, TimeUnit.SECONDS)
                        return image()
                    }
                }
                val refresh = workers.submit { cache.cache(server, listOf("slow"), client) }
                assertTrue(started.await(2, TimeUnit.SECONDS))
                try {
                    assertEquals(ready, workers.submit<String?> { cache.asset(server, "cover") }.get(2, TimeUnit.SECONDS))
                } finally { reply.countDown() }
                refresh.get(3, TimeUnit.SECONDS)
                assertNotNull(cache.asset(server, "slow"))
            } finally {
                reply.countDown()
                workers.shutdownNow()
                directory.deleteRecursively()
            }
        }
    }

    @Test fun `album covers and every collaborating artist are requested once`() {
        val track = Track("a", "Song", "main", "Main", albumId = "album", durationSeconds = 10,
            hasCover = true, artists = listOf(ArtistRef("main", "Main"), ArtistRef("guest", "Guest")))
        assertEquals(listOf("api/albums/album/cover", "api/artists/main/image", "api/artists/guest/image"),
            DownloadedArtwork.paths(listOf(track, track.copy(id = "b"))))
    }

    @Test fun `images survive restart and offline reads and cached files are not fetched again`() {
        val directory = Files.createTempDirectory("artwork-test").toFile()
        val web = MockWebServer()
        web.start()
        val server = web.url("/").toString()
        val path = "api/artists/artist/image"
        try {
            val cache = DownloadedArtwork(directory)
            web.enqueue(image())
            cache.cache(server, listOf(path), OkHttpClient())
            assertEquals(1L, cache.revision.value)
            cache.cache(server, listOf(path), OkHttpClient())
            assertEquals(1, web.requestCount)
            web.close()
            val restored = DownloadedArtwork(directory)
            assertArrayEquals(png, File(URI(restored.asset(server, path)!!)).readBytes())
            assertNull(restored.asset("http://another-server/", path))
        } finally { runCatching { web.close() }; directory.deleteRecursively() }
    }

    @Test fun `failed or non-image responses remain retryable and do not hide other artwork`() {
        val directory = Files.createTempDirectory("artwork-test").toFile()
        MockWebServer().use { web ->
            web.start()
            try {
                val cache = DownloadedArtwork(directory)
                val server = web.url("/").toString()
                val client = OkHttpClient()
                web.enqueue(MockResponse.Builder().code(404).build())
                web.enqueue(MockResponse.Builder().addHeader("Content-Type", "text/html").body("login").build())
                web.enqueue(image())
                cache.cache(server, listOf("missing", "html", "valid"), client)
                assertNull(cache.asset(server, "missing"))
                assertNull(cache.asset(server, "html"))
                assertNotNull(cache.asset(server, "valid"))
                web.enqueue(image())
                cache.cache(server, listOf("missing"), client)
                assertNotNull(cache.asset(server, "missing"))
                assertEquals(2L, cache.revision.value)
                assertFalse(directory.listFiles()!!.any { it.extension == "part" })
            } finally { directory.deleteRecursively() }
        }
    }
}
