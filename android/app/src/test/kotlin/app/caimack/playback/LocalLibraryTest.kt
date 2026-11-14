// SPDX-License-Identifier: AGPL-3.0-only
package app.caimack.playback

import app.caimack.api.*
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonObject
import org.junit.Assert.assertEquals
import org.junit.Test

class LocalLibraryTest {
    @Test fun `availability includes guests and partial playlists but excludes unavailable collections`() {
        val song = Track("one", "One", "artist", "Artist", artists = listOf(ArtistRef("guest", "Guest")),
            albumId = "album", durationSeconds = 60)
        val missing = song.copy(id = "missing", albumId = "remote")
        val playlists = listOf(PlaylistDetail("partial", "Partial", tracks = listOf(missing, song)),
            PlaylistDetail("unavailable", "Unavailable", tracks = listOf(missing)))
        val synced = Json.parseToJsonElement("""{"synced":["one"],"absent":["missing"]}""").jsonObject
        assertEquals(setOf("album" to "album", "artist" to "artist", "artist" to "guest",
            "playlist" to "partial", "playlist" to "synced"), collectionAvailability(listOf(song), playlists, synced))
        assertEquals(emptySet<Pair<String, String>>(), collectionAvailability(emptyList(), playlists, synced))
    }
}
