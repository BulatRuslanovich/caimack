// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

package app.caimack.playback

import android.content.ComponentName
import android.content.Context
import android.media.AudioManager
import androidx.media3.common.C
import androidx.media3.common.MediaItem
import androidx.media3.common.MediaMetadata
import androidx.media3.common.MediaItem.RequestMetadata
import androidx.media3.common.Player
import androidx.media3.session.MediaController
import androidx.media3.session.SessionToken
import app.caimack.api.Media
import app.caimack.api.ConnectCommand
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
    val volume: Float = 1f,
    val muted: Boolean = false,
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
    private val signals: Signals,
) {
    private val token = SessionToken(context, ComponentName(context, PlaybackService::class.java))
    private var controller: ListenableFuture<MediaController>? = null
    private val current = MutableStateFlow(PlayerState())
    private var local = PlayerState()
    private var remotePosition: (() -> Long)? = null
    var remoteRoute: ((ConnectCommand) -> Boolean)? = null
    var remoteSelected: (() -> Boolean)? = null
    private val audio = context.getSystemService(AudioManager::class.java)

    val state: StateFlow<PlayerState> = current

    val position: Long get() = remotePosition?.invoke() ?: localPosition
    val localPosition: Long get() = connected()?.currentPosition ?: 0
    val localState: PlayerState get() = local
    val localVolume: Float get() = audio.getStreamVolume(AudioManager.STREAM_MUSIC).toFloat() / audio.getStreamMaxVolume(AudioManager.STREAM_MUSIC).coerceAtLeast(1)
    val localMuted: Boolean get() = audio.isStreamMute(AudioManager.STREAM_MUSIC)

    fun showRemote(state: PlayerState, position: () -> Long) {
        remotePosition = position
        current.value = state
    }

    fun showLocal() {
        remotePosition = null
        current.value = local
    }

    fun pauseLocal() = withController { it.pause() }

    fun executeLocal(action: () -> Unit) {
        val routing = remoteRoute
        remoteRoute = null
        try { action() } finally { remoteRoute = routing }
    }

    fun connect() = withController { }

    fun play(tracks: List<Track>, index: Int, source: String? = null) = withController(
        ConnectCommand.Play(tracks.map { it.id }, index, 0.0, true, state.value.shuffle, repeatOf(state.value.repeat), source),
    ) {
        PlaySources.tag(tracks.map { track -> track.id }, source)
        radio.reset()
        load(it, tracks, index)
    }

    fun startRadio(seed: Track, batch: RadioBatch) = withController(ConnectCommand.StartRadio(seed.id)) {
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

    fun enqueue(track: Track, next: Boolean) = withController(ConnectCommand.Enqueue(track.id, next)) {
        known[track.id] = track
        PlaySources.tag(listOf(track.id), "queue")
        signals.choice("trackAddedToQueue", track.id, track.durationSeconds)
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

    fun toggle() = withController(ConnectCommand.SetPlaying(!state.value.playing)) { if (it.playWhenReady) it.pause() else it.play() }

    fun pause() = withController(ConnectCommand.SetPlaying(false)) { it.pause() }

    fun resume() = withController(ConnectCommand.SetPlaying(true)) { it.play() }

    fun playMyRadio(batch: RadioBatch) = withController(ConnectCommand.StartRadio(null)) {
        radio.start(null, batch)
        load(it, batch.tracks.map { recommended -> recommended.track }, 0)
    }

    fun next() = withController(ConnectCommand.Next) { it.seekToNext() }

    fun previous() = withController(ConnectCommand.Previous) {
        val index = if (it.currentPosition > 3_000) it.currentMediaItemIndex else it.previousMediaItemIndex
        if (index in 0 until it.mediaItemCount && (index != it.currentMediaItemIndex || it.currentPosition >= 30_000)) {
            val id = it.getMediaItemAt(index).mediaId
            if (PlaySources.of(id)?.startsWith("radio") == true) {
                known[id]?.let { track -> signals.choice("trackReplayed", id, track.durationSeconds) }
            }
        }
        it.seekToPrevious()
    }

    fun seekTo(positionMs: Long) = withController(ConnectCommand.Seek(positionMs / 1000.0)) { it.seekTo(positionMs) }

    fun skipTo(index: Int) {
        val track = state.value.queue.getOrNull(index) ?: return
        withController(ConnectCommand.Jump(index, track.id)) { it.seekTo(index, 0) }
    }

    fun remove(index: Int) {
        val track = state.value.queue.getOrNull(index) ?: return
        withController(ConnectCommand.Remove(index, track.id)) { if (index in 0 until it.mediaItemCount) it.removeMediaItem(index) }
    }

    fun move(from: Int, to: Int) {
        val track = state.value.queue.getOrNull(from) ?: return
        withController(ConnectCommand.Move(from, to, track.id)) {
        if (from != to && from in 0 until it.mediaItemCount && to in 0 until it.mediaItemCount) {
            PlaySources.tag(listOf(it.getMediaItemAt(from).mediaId), "queue")
            it.moveMediaItem(from, to)
        }
        }
    }

    fun clearUpcoming() {
        withController(ConnectCommand.ClearUpcoming) { it.removeMediaItems(it.currentMediaItemIndex + 1, it.mediaItemCount) }
    }

    fun snapshot(): QueueSnapshot = current.value.let { QueueSnapshot(it.queue, it.index, position, radio.state.value) }

    fun restore(snapshot: QueueSnapshot) = withController(ConnectCommand.Play(
        snapshot.tracks.map { it.id }, snapshot.index, snapshot.positionMs / 1000.0,
        state.value.playing, state.value.shuffle, repeatOf(state.value.repeat),
    )) {
        if (snapshot.tracks.isEmpty()) return@withController
        snapshot.tracks.forEach { track -> known[track.id] = track }
        it.setMediaItems(snapshot.tracks.map { track -> track.toMediaItem(media) }, snapshot.index, snapshot.positionMs)
        it.prepare()
        radio.restore(snapshot.radio)
    }

    fun toggleShuffle() = withController(ConnectCommand.SetShuffle(!state.value.shuffle)) { it.shuffleModeEnabled = !it.shuffleModeEnabled }

    fun setShuffle(enabled: Boolean) = withController(ConnectCommand.SetShuffle(enabled)) { it.shuffleModeEnabled = enabled }

    fun setRepeat(mode: String) = withController(ConnectCommand.SetRepeat(mode)) { it.repeatMode = repeatModeOf(mode) }

    fun setVolume(volume: Float) {
        if (remoteRoute?.invoke(ConnectCommand.SetVolume(volume.toDouble())) == true) return
        audio.setStreamVolume(AudioManager.STREAM_MUSIC, (volume.coerceIn(0f, 1f) * audio.getStreamMaxVolume(AudioManager.STREAM_MUSIC)).toInt(), 0)
        withController { publish(it) }
    }

    fun setMuted(muted: Boolean) {
        if (remoteRoute?.invoke(ConnectCommand.SetMuted(muted)) == true) return
        audio.adjustStreamVolume(AudioManager.STREAM_MUSIC, if (muted) AudioManager.ADJUST_MUTE else AudioManager.ADJUST_UNMUTE, 0)
        withController { publish(it) }
    }

    fun loadRemote(tracks: List<Track>, command: ConnectCommand.Play) = withController {
        radio.reset()
        tracks.forEach { track -> known[track.id] = track }
        PlaySources.tag(tracks.map { track -> track.id }, command.source)
        it.shuffleModeEnabled = command.shuffle
        it.repeatMode = repeatModeOf(command.repeat)
        it.setMediaItems(tracks.map { track -> track.toMediaItem(media) }, command.index, (command.positionSeconds * 1000).toLong())
        it.prepare()
        it.playWhenReady = command.playing
    }

    fun cycleRepeat() = withController(ConnectCommand.SetRepeat(when (state.value.repeat) {
        Player.REPEAT_MODE_OFF -> "all"
        Player.REPEAT_MODE_ALL -> "one"
        else -> "off"
    })) {
        it.repeatMode = when (it.repeatMode) {
            Player.REPEAT_MODE_OFF -> Player.REPEAT_MODE_ALL
            Player.REPEAT_MODE_ALL -> Player.REPEAT_MODE_ONE
            else -> Player.REPEAT_MODE_OFF
        }
    }

    fun stop() = withController(ConnectCommand.Clear) {
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

    private fun withController(command: ConnectCommand? = null, action: (MediaController) -> Unit) {
        if (command != null && remoteRoute?.invoke(command) == true) return
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
        if (remoteSelected?.invoke() == true) return
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
        local = PlayerState(
            queue = queue,
            index = player.currentMediaItemIndex.coerceIn(0, (queue.size - 1).coerceAtLeast(0)),
            playing = player.isPlaying || buffering,
            buffering = buffering,
            durationMs = player.duration.takeIf { it != C.TIME_UNSET } ?: 0,
            shuffle = player.shuffleModeEnabled,
            repeat = player.repeatMode,
            previousIndex = player.previousMediaItemIndex,
            nextIndex = player.nextMediaItemIndex,
            volume = localVolume,
            muted = localMuted,
        )
        if (remotePosition == null) current.value = local
    }
}

internal fun repeatOf(mode: Int): String = when (mode) {
    Player.REPEAT_MODE_ALL -> "all"
    Player.REPEAT_MODE_ONE -> "one"
    else -> "off"
}

internal fun repeatModeOf(mode: String): Int = when (mode) {
    "all" -> Player.REPEAT_MODE_ALL
    "one" -> Player.REPEAT_MODE_ONE
    else -> Player.REPEAT_MODE_OFF
}

fun Track.toMediaItem(media: Media): MediaItem = MediaItem.Builder()
    .setMediaId(id)
    .setMediaMetadata(
        MediaMetadata.Builder()
            .setTitle(title)
            .setArtist(artistsOf(this))
            .setAlbumTitle(albumTitle)
            .setArtworkUri(ArtworkProvider.uriFor(media.cover(albumId, id, hasCover, small = false), albumTitle ?: title))
            .setDurationMs(durationSeconds * 1000L)
            .build(),
    )
    .build()
