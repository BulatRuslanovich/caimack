// SPDX-License-Identifier: AGPL-3.0-only
package app.caimack.sync

import android.content.Context
import android.content.ContextWrapper
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
        val first = Track("one", "Тепло твоих рук 🎵 \"live\"\n", "artist", "Artist", durationSeconds = 60)
        val second = first.copy(id = "two", title = "Two")
        fun manifest(tracks: List<Track>) = buildJsonObject {
            put("protocol", 1); put("serverId", "test"); put("user", json.encodeToJsonElement(user))
            put("tracks", json.encodeToJsonElement(tracks))
            put("files", JsonArray(tracks.map { buildJsonObject { put("id", it.id) } }))
        }
        fun audio(id: String) = SyncedFile("content://test/$id", "$id.mp3", "v1", "hash", 17, 3, 2_500_000_000L)
        try {
            val store = SyncStore(isolated, json, server)
            store.configure(user)
            store.enable(true)
            store.accept(manifest(listOf(first, second)))
            store.updateIndex { it.copy(files = mapOf(first.id to audio(first.id))) }
            val initial = store.tracks()
            assertEquals("Stored size includes audio payload and embedded metadata", 2_500_000_020L, store.audioBytes())
            val restoredSize = SyncStore(isolated, json, server).apply { session(user) }
            assertEquals("Existing indexes expose their size without downloading again", 2_500_000_020L, restoredSize.audioBytes())
            assertEquals(listOf("one"), initial.map { it.id })
            store.status.value = store.status.value.copy(bytes = 100)
            assertSame(initial, store.tracks())
            store.updateIndex { it.copy(files = it.files + (second.id to audio(second.id))) }
            assertEquals(listOf("one", "two"), store.tracks().map { it.id })
            assertEquals(5_000_000_040L, store.audioBytes())
            assertSame(initial.single(), store.tracks().first())
            val edit = SyncAction(kind = "favorite", entityId = first.id, payload = buildJsonObject { put("value", true) })
            assertTrue(store.enqueue(edit))
            val restored = SyncStore(isolated, json, server).apply { session(user) }
            assertEquals(store.snapshot, restored.snapshot)
            assertEquals(store.index, restored.index)
            assertEquals(listOf(edit), restored.pending())
            assertEquals(first.title, restored.tracks().first().title)
            store.acknowledge(listOf(buildJsonObject { put("id", edit.id); put("status", "applied") }))
            val confirmed = SyncStore(isolated, json, server).apply { session(user) }
            assertTrue(confirmed.pending().isEmpty())
            assertEquals(listOf(edit), confirmed.edits())
            val rejected = edit.copy(id = "rejected-edit")
            assertTrue(store.enqueue(rejected))
            store.acknowledge(listOf(buildJsonObject {
                put("id", rejected.id); put("status", "rejected"); put("message", "Нет доступа — попробуйте позже")
            }))
            assertEquals("Нет доступа — попробуйте позже", SyncStore(isolated, json, server).rejectionMessages())
            store.accept(manifest(listOf(first.copy(title = "Updated"), second)))
            assertEquals("Updated", store.tracks().first().title)
            store.session(User("other", "Other account"))
            assertEquals("Another account must not see the synchronized size", 0L, store.audioBytes())
            store.session(user)
            assertEquals(5_000_000_040L, store.audioBytes())
            store.updateIndex { it.copy(files = emptyMap()) }
            assertEquals(0L, store.audioBytes())
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
