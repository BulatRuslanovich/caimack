// SPDX-License-Identifier: AGPL-3.0-only

package app.caimack.sync

import app.caimack.api.CaimackApi
import app.caimack.api.CopyPlaylistTracks
import app.caimack.api.CreatePlaylistWithTracks
import app.caimack.api.Playlist
import app.caimack.api.PlaylistMembershipChange
import app.caimack.api.Track
import java.util.UUID
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.*
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import org.junit.Assert.*
import org.junit.Test
import retrofit2.Retrofit
import retrofit2.converter.kotlinx.serialization.asConverterFactory

class PlaylistJournalDeviceTest {
    @Test fun playlistCreationAndMembershipSurviveReopeningTheOfflineJournal() = runBlocking {
        withLibrarySync {
            val first = Track("a", "First", "artist", "Artist", durationSeconds = 150)
            val second = first.copy(id = "b", title = "Second")
            val source = Playlist("source", "Source", ownerId = user.id)
            store.accept(manifest {
                put("tracks", json.encodeToJsonElement(listOf(first, second)))
                put("files", JsonArray(listOf(first, second).map { buildJsonObject { put("id", it.id) } }))
                put("playlists", json.encodeToJsonElement(listOf(source)))
                put("playlistTracks", buildJsonObject { put(source.id, json.encodeToJsonElement(listOf(first.id, second.id))) })
            })
            fun api(syncStore: SyncStore): CaimackApi = Retrofit.Builder()
                .baseUrl(checkNotNull(server.url.value))
                .client(OkHttpClient.Builder().addInterceptor(OfflineCatalog(syncStore) {}.interceptor)
                    .addInterceptor { error("An offline playlist request went to the network") }.build())
                .addConverterFactory(json.asConverterFactory("application/json".toMediaType()))
                .build().create(CaimackApi::class.java)
            val offline = api(store)
            val request = CreatePlaylistWithTracks("Created offline", null, false, listOf(first.id), UUID.randomUUID().toString())
            val created = offline.createPlaylistWithTracks(request)
            assertTrue(created.pendingSync)
            assertEquals(created.id, offline.createPlaylistWithTracks(request).id)
            val added = offline.copyPlaylistTracks(source.id, CopyPlaylistTracks(created.id))
            assertEquals(1, added.changed)
            assertEquals(1, added.unchanged)
            assertTrue(added.pendingSync)
            val removed = offline.changePlaylistMembership(source.id, PlaylistMembershipChange(listOf(first.id), false))
            assertTrue(removed.pendingSync)
            assertEquals(0, offline.changePlaylistMembership(source.id, PlaylistMembershipChange(listOf(first.id), false)).changed)

            val restored = SyncStore(context, json, server).apply { session(user) }
            assertEquals(listOf("playlistCreate", "playlistAdd", "playlistRemove"), restored.pending().map { it.kind })
            val reopened = api(restored)
            val destination = reopened.playlist(created.id)
            assertEquals(listOf(first.id, second.id), destination.tracks.map(Track::id))
            assertEquals(setOf(first.id, second.id), destination.trackAddedAt.keys)
            val memberships = reopened.playlistMemberships(first.id).associateBy { it.playlist.id }
            assertTrue(memberships.getValue(created.id).containsTrack)
            assertFalse(memberships.getValue(source.id).containsTrack)
            assertTrue(memberships.values.all { it.pendingSync })
        }
    }
}
