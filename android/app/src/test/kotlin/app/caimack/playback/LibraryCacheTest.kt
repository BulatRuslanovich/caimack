// SPDX-License-Identifier: AGPL-3.0-only
package app.caimack.playback

import app.caimack.api.*
import app.caimack.sync.OfflineCatalog
import java.nio.file.Files
import kotlinx.serialization.json.*
import mockwebserver3.MockResponse
import mockwebserver3.MockWebServer
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.HttpUrl.Companion.toHttpUrl
import org.junit.Assert.*
import org.junit.Test

class LibraryCacheTest {
    @Test fun `saved shortcut metadata survives offline without visiting details`() {
        val saved = Json.parseToJsonElement("""[{"kind":"playlist","id":"remote-mix","title":"Saved mix","subtitle":"Owner","hasImage":true,"trackCount":12,"durationSeconds":720,"savedAt":"2026-01-01T00:00:00Z"}]""")
        val data = LibraryCache.merge(local(), mapOf("/api/me/library?" to saved))
        val item = data.getValue("savedLibrary").jsonArray.single().jsonObject
        assertEquals("Saved mix", item["title"]?.jsonPrimitive?.content)
        assertEquals(12, item["trackCount"]?.jsonPrimitive?.int)
        assertEquals(720, item["durationSeconds"]?.jsonPrimitive?.int)
    }

    private val json = Json { ignoreUnknownKeys = true }
    private val downloaded = Track("downloaded", "Downloaded", "artist", "Artist", albumId = "album", albumTitle = "Album", durationSeconds = 60)
    private val remote = downloaded.copy(id = "remote", title = "Unavailable")
    private fun local() = DownloadedCatalog.snapshot(json, listOf(downloaded), emptyList())
    private val album get() = AlbumDetail("album", "Album", "artist", "Artist", tracks = listOf(downloaded, remote))

    @Test fun `partial downloads do not reduce saved collection totals`() {
        val saved = Json.parseToJsonElement("""[{"kind":"album","id":"album","title":"Album","trackCount":12,"durationSeconds":2400,"savedAt":"2026-01-01T00:00:00Z"}]""")
        val data = LibraryCache.merge(local(), mapOf("/api/me/library?" to saved))
        val item = data.getValue("savedLibrary").jsonArray.single().jsonObject
        assertEquals(12, item["trackCount"]?.jsonPrimitive?.int)
        assertEquals(2400, item["durationSeconds"]?.jsonPrimitive?.int)
        assertEquals(1, data.getValue("tracks").jsonArray.size)
    }

    @Test fun `offline album retains undownloaded tracks and saved folders`() {
        val data = LibraryCache.merge(local(), mapOf(
            "/api/albums/album?" to json.encodeToJsonElement(album),
            "/api/me/library?" to json.encodeToJsonElement(listOf(LibraryItem("album", "album", "Album", savedAt = "2026-01-01T00:00:00Z", folderId = "folder"))),
            "/api/me/library/folders?" to json.encodeToJsonElement(listOf(LibraryFolder("folder", "Music", createdAt = "2026-01-01T00:00:00Z"))),
        ))
        val result = OfflineCatalog.read("albums/album", "http://test/api/albums/album".toHttpUrl(), buildJsonObject {}, data)!!
        assertEquals(listOf("downloaded", "remote"), json.decodeFromJsonElement<AlbumDetail>(result.value).tracks.map { it.id })
        val library = json.decodeFromJsonElement<List<LibraryItem>>(data.getValue("savedLibrary"))
        assertEquals("folder", library.first { it.kind == "album" }.folderId)
        assertEquals(1, data.getValue("libraryFolders").jsonArray.size)
    }

    @Test fun `saved collections without downloaded audio remain in the main library`() {
        val item = LibraryItem("album", "remote-album", "Not downloaded", savedAt = "2026-01-01T00:00:00Z")
        val data = LibraryCache.merge(local(), mapOf("/api/me/library?" to json.encodeToJsonElement(listOf(item))))
        val items = json.decodeFromJsonElement<List<LibraryItem>>(data.getValue("savedLibrary"))
        assertTrue(items.any { it.id == "remote-album" && it.title == "Not downloaded" })
        assertFalse(items.any { it.id == "album" })
    }

    @Test fun `an explicitly empty library never acquires downloaded collections`() {
        val data = LibraryCache.merge(local(), mapOf("/api/me/library?" to JsonArray(emptyList())))
        assertTrue(data.getValue("savedLibrary").jsonArray.isEmpty())
        assertEquals(1, data.getValue("tracks").jsonArray.size)
    }

    @Test fun `downloaded albums and artists are not appended to saved membership`() {
        val saved = LibraryItem("artist", "saved-artist", "Saved artist", savedAt = "2026-01-01T00:00:00Z")
        val data = LibraryCache.merge(local(), mapOf("/api/me/library?" to json.encodeToJsonElement(listOf(saved))))
        val items = json.decodeFromJsonElement<List<LibraryItem>>(data.getValue("savedLibrary"))
        assertEquals(listOf("saved-artist"), items.map { it.id })
    }

    @Test fun `server metadata survives cold restart and is isolated between accounts`() {
        val directory = Files.createTempDirectory("library-cache").toFile()
        val web = MockWebServer()
        web.start()
        var account = "server|user-one"
        val base = web.url("/").toString()
        fun cache() = LibraryCache(directory, { account }, ::local, json)
        fun client(cache: LibraryCache) = OkHttpClient.Builder().addInterceptor(cache.interceptor).build()
        fun get(client: OkHttpClient, path: String) = client.newCall(Request.Builder().url(base + "api/" + path).build()).execute().use { it.body.string() }
        try {
            val first = cache()
            val http = client(first)
            web.enqueue(MockResponse.Builder().body("{}").build())
            get(http, "auth/me")
            assertFalse(first.offline.value)
            web.enqueue(MockResponse.Builder().body(json.encodeToString(album)).build())
            get(http, "albums/album")
            web.close()
            val failedOver = json.decodeFromString<AlbumDetail>(get(http, "albums/album"))
            assertTrue(first.offline.value)
            assertEquals(2, failedOver.tracks.size)
            val restored = cache()
            assertEquals(2, json.decodeFromString<AlbumDetail>(get(client(restored), "albums/album")).tracks.size)
            account = "server|user-two"
            assertEquals(1, json.decodeFromString<AlbumDetail>(get(client(restored), "albums/album")).tracks.size)
        } finally { runCatching { web.close() }; directory.deleteRecursively() }
    }

    @Test fun `network authentication success restores online requests`() {
        val directory = Files.createTempDirectory("library-cache").toFile()
        MockWebServer().use { web ->
            web.start()
            try {
                val cache = LibraryCache(directory, { "account" }, ::local, json)
                val client = OkHttpClient.Builder().addInterceptor(cache.interceptor).build()
                fun get(path: String) = client.newCall(Request.Builder().url(web.url("/api/$path")).build()).execute().use { it.body.string() }
                get("albums/album")
                assertEquals(0, web.requestCount)
                web.enqueue(MockResponse.Builder().body("{}").build())
                get("auth/me")
                web.enqueue(MockResponse.Builder().body(json.encodeToString(album)).build())
                assertEquals(2, json.decodeFromString<AlbumDetail>(get("albums/album")).tracks.size)
                assertFalse(cache.offline.value)
                assertEquals(2, web.requestCount)
            } finally { directory.deleteRecursively() }
        }
    }
}
