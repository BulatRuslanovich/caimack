// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich
package app.caimack.sync

import android.content.ComponentName
import androidx.media3.common.Player
import androidx.media3.session.MediaController
import androidx.media3.session.SessionToken
import androidx.test.platform.app.InstrumentationRegistry
import app.caimack.CaimackApp
import app.caimack.api.AddTracksRequest
import app.caimack.api.PlaylistChanges
import app.caimack.api.RadioRequest
import app.caimack.playback.PlaybackService
import app.caimack.session.SessionState
import java.util.UUID
import java.util.concurrent.TimeUnit
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.first
import kotlinx.serialization.json.*
import okhttp3.Request
import org.junit.Assert.*
import org.junit.Test

/**
 * Temporarily disconnects Wi-Fi and restores it in finally. Run against a signed-in, partially or
 * fully synchronized physical-device installation.
 */
class OfflineAccountDeviceTest {
    @Test
    fun offlineCatalogQueueAndPlaylistEditsReturnToTheRealServer() = runBlocking {
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        val context = instrumentation.targetContext
        val container = (context.applicationContext as CaimackApp).container
        val session =
            withTimeout(20_000) { container.session.state.first { it !is SessionState.Restoring } }
        assertTrue(session is SessionState.SignedIn)
        val user = (session as SessionState.SignedIn).user
        val store = container.syncStore
        store.session(user)
        assertTrue(store.active && store.tracks().size >= 2 && container.sync.network.available())
        val wasPaused = store.paused
        val oldOfflineQueue = store.offlineQueue
        val initialIds = store.pending().map { it.id }.toSet()
        var controller: MediaController? = null
        var playlistId: String? = null
        var restorePlayback: (() -> Unit)? = null
        fun shell(command: String) {
            instrumentation.uiAutomation.executeShellCommand(command).close()
        }
        container.sync.pause()
        withTimeout(10_000) { while (store.status.value.running) delay(100) }
        try {
            shell("svc wifi disable")
            shell("dumpsys battery unplug")
            withTimeout(15_000) { while (container.sync.network.available()) delay(100) }
            val tracks = container.api.tracks(1, 50)
            assertEquals(store.snapshot!!.objects("tracks").size, tracks.total)
            assertTrue(container.api.homeFeed().blocks.isNotEmpty())
            container.api.publicPlaylists()
            val ready = store.tracks().take(2)
            val p =
                container.api.createPlaylist(
                    PlaylistChanges("Offline device test ${UUID.randomUUID()}")
                )
            playlistId = p.id
            container.api.addToPlaylist(p.id, AddTracksRequest(ready.map { it.id }))
            container.api.reorderPlaylist(p.id, AddTracksRequest(ready.reversed().map { it.id }))
            assertEquals(
                ready.reversed().map { it.id },
                container.api.playlist(p.id).tracks.map { it.id },
            )
            container.api.deletePlaylist(p.id)
            assertFalse(container.api.playlists().any { it.id == p.id })
            val restored =
                SyncStore(context, container.json, container.server).apply { session(user) }
            assertTrue(
                restored.pending().any { it.kind == "playlistCreate" && it.entityId == p.id }
            )
            assertEquals(store.audio(ready.first().id), restored.audio(ready.first().id))
            val batch = container.radio(RadioRequest(null, emptyList()))
            assertTrue(batch.tracks.isNotEmpty() && batch.tracks.size <= 100)

            val player =
                MediaController.Builder(
                        context,
                        SessionToken(context, ComponentName(context, PlaybackService::class.java)),
                    )
                    .buildAsync()
                    .get(10, TimeUnit.SECONDS)
            controller = player
            withContext(Dispatchers.Main) {
                val items = (0 until player.mediaItemCount).map(player::getMediaItemAt)
                val index = player.currentMediaItemIndex
                val position = player.currentPosition
                val playing = player.playWhenReady
                val volume = player.volume
                val repeat = player.repeatMode
                restorePlayback = {
                    player.volume = volume
                    player.repeatMode = repeat
                    if (items.isEmpty()) player.clearMediaItems()
                    else {
                        player.setMediaItems(items, index.coerceAtLeast(0), position)
                        player.prepare()
                        player.playWhenReady = playing
                    }
                }
                player.volume = 0f
                player.repeatMode = Player.REPEAT_MODE_OFF
                container.player.executeLocal {
                    container.player.playMyRadio(batch.copy(tracks = batch.tracks.take(2)))
                }
            }
            withTimeout(20_000) {
                while (
                    withContext(Dispatchers.Main) {
                        player.mediaItemCount != 2 || player.playbackState != Player.STATE_READY
                    }
                ) delay(100)
            }
            withContext(Dispatchers.Main) {
                player.seekTo(
                    1,
                    (batch.tracks[1].track.durationSeconds * 1000L - 500).coerceAtLeast(0),
                )
                player.play()
            }
            withTimeout(15_000) {
                while (
                    withContext(Dispatchers.Main) { player.playbackState != Player.STATE_ENDED }
                ) delay(100)
            }
            assertEquals(2, withContext(Dispatchers.Main) { player.mediaItemCount })
            assertNull(withContext(Dispatchers.Main) { player.playerError })
            withContext(Dispatchers.Main) {
                restorePlayback?.invoke()
                restorePlayback = null
                player.release()
            }
            controller = null
            val ids = store.pending().map { it.id }.toSet() - initialIds
            assertTrue(ids.isNotEmpty())
            shell("svc wifi enable")
            withTimeout(20_000) { while (!container.sync.network.available()) delay(100) }
            delay(2_000) // DHCP/routing may settle after the transport appears.
            store.paused = false
            val sync = launch(Dispatchers.IO) { container.sync.run() }
            withTimeout(40_000) { while (store.pending().any { it.id in ids }) delay(100) }
            container.sync.pause()
            sync.cancelAndJoin()
            val serverPlaylists =
                withContext(Dispatchers.IO) {
                    container.http
                        .newCall(
                            Request.Builder()
                                .url(container.server.resolve("api/playlists")!!)
                                .header("X-Caimack-Sync", "1")
                                .build()
                        )
                        .execute()
                        .use {
                            assertTrue(it.isSuccessful)
                            container.json.parseToJsonElement(it.body.string()).jsonArray
                        }
                }
            assertFalse(serverPlaylists.any { it.jsonObject.string("id") == p.id })
        } finally {
            shell("svc wifi enable")
            shell("dumpsys battery reset")
            controller?.let {
                withContext(Dispatchers.Main) {
                    restorePlayback?.invoke()
                    it.release()
                }
            }
            playlistId?.let { id ->
                runCatching {
                    if (container.api.playlists().any { it.id == id })
                        container.api.deletePlaylist(id)
                }
            }
            store.offlineQueue = oldOfflineQueue
            store.paused = wasPaused
        }
    }
}
