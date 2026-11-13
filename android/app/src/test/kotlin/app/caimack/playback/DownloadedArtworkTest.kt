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
