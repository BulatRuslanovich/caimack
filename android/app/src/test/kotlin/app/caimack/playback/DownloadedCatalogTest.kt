// SPDX-License-Identifier: AGPL-3.0-only
package app.caimack.playback

import app.caimack.api.*
import app.caimack.sync.OfflineCatalog
import kotlinx.serialization.json.*
import okhttp3.HttpUrl.Companion.toHttpUrl
import org.junit.Assert.*
import org.junit.Test

class DownloadedCatalogTest {
    private val json = Json { ignoreUnknownKeys = true }
    private fun track(id: String, album: String = "album", number: Int = 1) =
        Track(id, "Song $id", "artist", "Artist", albumId = album, albumTitle = album,
            durationSeconds = 60, trackNumber = number)
    private fun read(path: String, data: JsonObject) = OfflineCatalog.read(path,
        "http://downloads/api/$path".toHttpUrl(), buildJsonObject {}, data)!!.value

    @Test fun `private playlist metadata survives restart without crossing account or server boundaries`() {
        val directory = java.nio.file.Files.createTempDirectory("downloaded-account").toFile()
        var identity: String? = "server-one|alice"
        val song = track("local")
        fun catalog() = DownloadedCatalog(directory, json, { "http://downloads/" }, { listOf(song) }, { null }, { identity })
        try {
            val first = catalog()
            first.remember(PlaylistDetail("private", "Alice private", ownerId = "alice", tracks = listOf(song)))
            assertTrue(first.availableCollection("playlist", "private"))
            val restored = catalog()
            assertEquals("Alice private", read("playlists/private", restored.localSnapshot()).jsonObject["name"]?.jsonPrimitive?.content)
            for (other in listOf("server-one|bob", "server-two|alice", null)) {
                identity = other
                assertFalse(restored.availableCollection("playlist", "private"))
                assertTrue(restored.localSnapshot().getValue("playlists").jsonArray.isEmpty())
            }
            identity = "server-one|alice"
            assertTrue(restored.availableCollection("playlist", "private"))
        } finally { directory.deleteRecursively() }
    }

    @Test fun `downloaded artist discography contains only local albums and their tracks in order`() {
        val data = DownloadedCatalog.snapshot(json, listOf(track("second", number = 2), track("first"), track("third", "other")), emptyList())
        val artist = json.decodeFromJsonElement<ArtistDetail>(read("artists/artist", data))
        assertEquals(setOf("album", "other"), artist.albums.map { it.id }.toSet())
        assertEquals(3, artist.tracks.total)
        val album = json.decodeFromJsonElement<AlbumDetail>(read("albums/album", data))
        assertEquals(listOf("first", "second"), album.tracks.map { it.id })
        assertEquals(120, album.durationSeconds)
    }

    @Test fun `playlist membership and order survive serialization and exclude unavailable tracks`() {
        val first = track("a")
        val last = track("b")
        val source = PlaylistDetail("list", "My playlist", tracks = listOf(last, track("missing"), first))
        val restored = json.decodeFromString<List<PlaylistDetail>>(json.encodeToString(listOf(source)))
        val data = DownloadedCatalog.snapshot(json, listOf(first, last, first), restored)
        val playlist = json.decodeFromJsonElement<PlaylistDetail>(read("playlists/list", data))
        assertEquals(listOf("b", "a"), playlist.tracks.map { it.id })
        assertEquals(120, playlist.durationSeconds)
        val library = json.decodeFromJsonElement<List<LibraryItem>>(read("me/library", data))
        assertEquals(1, library.count { it.kind == "playlist" })
        assertEquals(2, data.getValue("tracks").jsonArray.size)
    }

    @Test fun `removing the last downloaded member removes the collection`() {
        val source = PlaylistDetail("list", "My playlist", tracks = listOf(track("gone")))
        val data = DownloadedCatalog.snapshot(json, emptyList(), listOf(source))
        assertTrue(data.getValue("savedLibrary").jsonArray.isEmpty())
        assertTrue(data.getValue("playlists").jsonArray.isEmpty())
    }

    @Test fun `featured artists can browse albums containing their downloaded tracks`() {
        val song = track("a").copy(artists = listOf(ArtistRef("guest", "Guest")))
        val data = DownloadedCatalog.snapshot(json, listOf(song), emptyList())
        val guest = json.decodeFromJsonElement<ArtistDetail>(read("artists/guest", data))
        assertEquals(listOf("album"), guest.albums.map { it.id })
        assertEquals(1, guest.tracks.total)
    }
}
