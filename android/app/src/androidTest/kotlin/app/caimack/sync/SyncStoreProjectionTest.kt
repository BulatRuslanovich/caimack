// SPDX-License-Identifier: AGPL-3.0-only
package app.caimack.sync

import android.content.Context
import android.content.ContextWrapper
import android.net.Uri
import androidx.datastore.preferences.core.PreferenceDataStoreFactory
import androidx.test.platform.app.InstrumentationRegistry
import app.caimack.api.Track
import app.caimack.api.User
import app.caimack.session.Server
import java.io.File
import java.util.UUID
import kotlinx.coroutines.*
import kotlinx.serialization.json.*
import org.junit.Assert.*
import org.junit.Test

class SyncStoreProjectionTest {
    @Test fun decodedTracksAreReusedUntilMetadataChangesAndAvailabilityRemainsCurrent() = runBlocking {
        val base = InstrumentationRegistry.getInstrumentation().targetContext
        val prefix = "projection-${UUID.randomUUID()}"
        val directory = File(base.cacheDir, prefix).apply { mkdirs() }
        val isolated = object : ContextWrapper(base) {
            override fun getFilesDir() = directory
            override fun getSharedPreferences(name: String, mode: Int) = base.getSharedPreferences("$prefix-$name", mode)
        }
        val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
        val preferences = PreferenceDataStoreFactory.create(scope = scope) { File(directory, "test.preferences_pb") }
        val server = Server(preferences)
        server.remember("https://example.invalid/")
        val json = Json { ignoreUnknownKeys = true }
        val user = User("alice", "Alice")
        val first = Track("one", "One", "artist", "Artist", durationSeconds = 60)
        val second = first.copy(id = "two", title = "Two")
        fun manifest(tracks: List<Track>) = buildJsonObject {
            put("protocol", 1); put("serverId", "test"); put("user", json.encodeToJsonElement(user))
            put("tracks", json.encodeToJsonElement(tracks))
            put("files", JsonArray(tracks.map { buildJsonObject { put("id", it.id) } }))
        }
        fun audio(id: String) = SyncedFile("content://test/$id", "$id.mp3", "v1", "hash", 0, 0, 1)
        try {
            val store = SyncStore(isolated, json, server)
            store.configure(Uri.parse("content://test/folder"), user)
            store.enable(true)
            store.accept(manifest(listOf(first, second)))
            store.updateIndex { it.copy(files = mapOf(first.id to audio(first.id))) }
            val initial = store.tracks()
            assertEquals(listOf("one"), initial.map { it.id })
            store.status.value = store.status.value.copy(bytes = 100)
            assertSame(initial, store.tracks())
            store.updateIndex { it.copy(files = it.files + (second.id to audio(second.id))) }
            assertEquals(listOf("one", "two"), store.tracks().map { it.id })
            assertSame(initial.single(), store.tracks().first())
            store.accept(manifest(listOf(first.copy(title = "Updated"), second)))
            assertEquals("Updated", store.tracks().first().title)
            store.updateIndex { it.copy(files = emptyMap()) }
            assertTrue(store.tracks().isEmpty())
            store.logout()
            assertTrue(store.tracks().isEmpty())
        } finally {
            scope.coroutineContext.job.cancelAndJoin()
            base.deleteSharedPreferences("$prefix-library-sync")
            directory.deleteRecursively()
        }
    }
}
