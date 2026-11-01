// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Bulat Ruslanovich

package app.caimack.playback

import android.content.ComponentName
import android.content.Context
import androidx.media3.common.C
import androidx.media3.common.MediaItem
import androidx.media3.common.MediaMetadata
import androidx.media3.common.MediaItem.RequestMetadata
import androidx.media3.common.Player
import androidx.media3.session.MediaController
import androidx.media3.session.SessionToken
import app.caimack.api.Media
import app.caimack.api.PlaybackHandoff
import app.caimack.api.RadioBatch
import app.caimack.api.Track
import app.caimack.ui.artistsOf
import com.google.common.util.concurrent.ListenableFuture
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow

data class PlayerState(
    val queue: List<Track> = emptyList(),
    val index: Int = 0,
    val playing: Boolean = false,
    val buffering: Boolean = false,
    val durationMs: Long = 0,
    val shuffle: Boolean = false,
    val repeat: Int = Player.REPEAT_MODE_OFF,
    val previousIndex: Int = C.INDEX_UNSET,
    val nextIndex: Int = C.INDEX_UNSET,
) {
    val current: Track? get() = queue.getOrNull(index)

    val previous: Track? get() = queue.getOrNull(previousIndex)
    val next: Track? get() = queue.getOrNull(nextIndex)
}

data class QueueSnapshot(val tracks: List<Track>, val index: Int, val positionMs: Long, val radio: RadioState)

class PlayerConnection(
    private val context: Context,
    private val media: Media,
    private val known: MutableMap<String, Track>,
    private val radio: RadioSession,
) {
    private val token = SessionToken(context, ComponentName(context, PlaybackService::class.java))
    private var controller: ListenableFuture<MediaController>? = null
    private val current = MutableStateFlow(PlayerState())

    val state: StateFlow<PlayerState> = current

    val position: Long get() = connected()?.currentPosition ?: 0

    fun connect() = withController { }

    fun play(tracks: List<Track>, index: Int, source: String? = null) = withController {
        PlaySources.tag(tracks.map { track -> track.id }, source)
        radio.reset()
        load(it, tracks, index)
    }

    fun startRadio(seed: Track, batch: RadioBatch) = withController {
        val tracks = batch.tracks.map { recommended -> recommended.track }.filter { track -> track.id != seed.id }
        radio.start(seed.id, batch)

        if (it.currentMediaItem?.mediaId != seed.id) {
            load(it, listOf(seed) + tracks, 0)
            return@withController
        }

        tracks.forEach { track -> known[track.id] = track }
        val current = it.currentMediaItemIndex
        it.removeMediaItems(current + 1, it.mediaItemCount)
        it.removeMediaItems(0, current)
        it.addMediaItems(tracks.map { track -> track.toMediaItem(media) })
        it.play()
    }

    fun takeOver(handoff: PlaybackHandoff) = withController {
        val tracks = handoff.tracks.takeIf { it.isNotEmpty() } ?: return@withController
        radio.reset()
        tracks.forEach { track -> known[track.id] = track }
        it.shuffleModeEnabled = handoff.shuffle
        it.repeatMode = when (handoff.repeat) {
            "all" -> Player.REPEAT_MODE_ALL
            "one" -> Player.REPEAT_MODE_ONE
            else -> Player.REPEAT_MODE_OFF
        }
        it.setMediaItems(
            tracks.map { track -> track.toMediaItem(media) },
            handoff.index.coerceIn(0, tracks.size - 1),
            (handoff.positionSeconds * 1000).toLong(),
        )
        it.prepare()
        it.play()
    }

    fun enqueue(track: Track, next: Boolean) = withController {
        known[track.id] = track
        PlaySources.tag(listOf(track.id), "queue")
        val item = track.toMediaItem(media)
        when {
            it.mediaItemCount == 0 -> {
                it.setMediaItem(item)
                it.prepare()
                it.play()
            }
            next -> it.addMediaItem(it.currentMediaItemIndex + 1, item)
            else -> it.addMediaItem(item)
        }
    }

    fun playFromSearch(query: String) = withController {
        it.setMediaItem(MediaItem.Builder().setRequestMetadata(RequestMetadata.Builder().setSearchQuery(query).build()).build())
        it.prepare()
        it.play()
    }

    fun toggle() = withController { if (it.playWhenReady) it.pause() else it.play() }

    fun pause() = withController { it.pause() }

    fun resume() = withController { it.play() }

    fun playMyRadio(batch: RadioBatch, mood: String? = null) = withController {
        radio.start(null, batch, mood)
        load(it, batch.tracks.map { recommended -> recommended.track }, 0)
    }

    fun next() = withController { it.seekToNext() }

    fun previous() = withController { it.seekToPrevious() }

    fun seekTo(positionMs: Long) = withController { it.seekTo(positionMs) }

    fun skipTo(index: Int) = withController { it.seekTo(index, 0) }

    fun remove(index: Int) = withController { if (index in 0 until it.mediaItemCount) it.removeMediaItem(index) }

    fun move(from: Int, to: Int) = withController {
        if (from != to && from in 0 until it.mediaItemCount && to in 0 until it.mediaItemCount) it.moveMediaItem(from, to)
    }

    fun clearUpcoming() = withController { it.removeMediaItems(it.currentMediaItemIndex + 1, it.mediaItemCount) }

    fun snapshot(): QueueSnapshot = current.value.let { QueueSnapshot(it.queue, it.index, position, radio.state.value) }

    fun restore(snapshot: QueueSnapshot) = withController {
        if (snapshot.tracks.isEmpty()) return@withController
        snapshot.tracks.forEach { track -> known[track.id] = track }
        it.setMediaItems(snapshot.tracks.map { track -> track.toMediaItem(media) }, snapshot.index, snapshot.positionMs)
        it.prepare()
        radio.restore(snapshot.radio)
    }

    fun toggleShuffle() = withController { it.shuffleModeEnabled = !it.shuffleModeEnabled }

    fun cycleRepeat() = withController {
        it.repeatMode = when (it.repeatMode) {
            Player.REPEAT_MODE_OFF -> Player.REPEAT_MODE_ALL
            Player.REPEAT_MODE_ALL -> Player.REPEAT_MODE_ONE
            else -> Player.REPEAT_MODE_OFF
        }
    }

    fun stop() = withController {
        radio.reset()
        it.stop()
        it.clearMediaItems()
    }

    private fun load(player: MediaController, tracks: List<Track>, index: Int) {
        tracks.forEach { track -> known[track.id] = track }
        player.setMediaItems(tracks.map { track -> track.toMediaItem(media) }, index, 0)
        player.prepare()
        player.play()
    }

    private fun connected(): MediaController? = controller?.takeIf { it.isDone }?.let { runCatching { it.get() }.getOrNull() }

    private fun withController(action: (MediaController) -> Unit) {
        val future = controller ?: MediaController.Builder(context, token)
            .setListener(object : MediaController.Listener {
                override fun onDisconnected(controller: MediaController) {
                    this@PlayerConnection.controller = null
                }
            })
            .buildAsync()
            .also { future ->
                controller = future
                future.addListener({
                    val built = runCatching { future.get() }.getOrNull()
                    if (built == null) {
                        controller = null
                        return@addListener
                    }
                    built.addListener(object : Player.Listener {
                        override fun onEvents(player: Player, events: Player.Events) = publish(built)
                    })
                    publish(built)
                }, context.mainExecutor)
            }
        future.addListener({ runCatching { future.get() }.getOrNull()?.let(action) }, context.mainExecutor)
    }

    private fun publish(player: MediaController) {
        val buffering = player.playWhenReady && player.playbackState == Player.STATE_BUFFERING
        val queue = (0 until player.mediaItemCount).map { position ->
            val item = player.getMediaItemAt(position)
            known[item.mediaId] ?: item.mediaMetadata.let {
                Track(
                    id = item.mediaId,
                    title = it.title?.toString().orEmpty(),
                    artistId = "",
                    artistName = it.artist?.toString().orEmpty(),
                    albumTitle = it.albumTitle?.toString(),
                    durationSeconds = ((it.durationMs ?: 0) / 1000).toInt(),
                )
            }
        }
        current.value = PlayerState(
            queue = queue,
            index = player.currentMediaItemIndex.coerceIn(0, (queue.size - 1).coerceAtLeast(0)),
            playing = player.isPlaying || buffering,
            buffering = buffering,
            durationMs = player.duration.takeIf { it != C.TIME_UNSET } ?: 0,
            shuffle = player.shuffleModeEnabled,
            repeat = player.repeatMode,
            previousIndex = player.previousMediaItemIndex,
            nextIndex = player.nextMediaItemIndex,
        )
    }
}

fun Track.toMediaItem(media: Media): MediaItem = MediaItem.Builder()
    .setMediaId(id)
    .setMediaMetadata(
        MediaMetadata.Builder()
            .setTitle(title)
            .setArtist(artistsOf(this))
            .setAlbumTitle(albumTitle)
            .setArtworkUri(ArtworkProvider.uriFor(media.cover(albumId, id, hasCover, small = false)))
            .setDurationMs(durationSeconds * 1000L)
            .build(),
    )
    .build()
