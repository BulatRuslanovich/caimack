// SPDX-License-Identifier: AGPL-3.0-only
package app.caimack.playback

import app.caimack.api.ArtistRef
import app.caimack.api.Track
import java.io.File
import java.net.URI
import java.nio.file.Files
import java.util.Base64
import mockwebserver3.MockResponse
import mockwebserver3.MockWebServer
import okhttp3.OkHttpClient
import okio.Buffer
import org.junit.Assert.*
import org.junit.Test

class DownloadedArtworkTest {
    private val png = Base64.getDecoder().decode("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=")
    private fun image() = MockResponse.Builder().addHeader("Content-Type", "image/png").body(Buffer().write(png)).build()

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
