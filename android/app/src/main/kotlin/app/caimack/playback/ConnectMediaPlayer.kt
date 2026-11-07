// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

package app.caimack.playback

import android.os.Looper
import androidx.media3.common.C
import androidx.media3.common.DeviceInfo
import androidx.media3.common.MediaItem
import androidx.media3.common.Player
import androidx.media3.common.SimpleBasePlayer
import androidx.media3.common.util.UnstableApi
import app.caimack.AppContainer
import app.caimack.api.ConnectCommand
import com.google.common.util.concurrent.Futures
import com.google.common.util.concurrent.ListenableFuture
import com.google.common.util.concurrent.MoreExecutors
import com.google.common.util.concurrent.SettableFuture
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.combine

/** A real Media3 player for the remote output, including notification and media keys. */
@androidx.annotation.OptIn(UnstableApi::class)
class ConnectMediaPlayer(private val container: AppContainer) : SimpleBasePlayer(Looper.getMainLooper()) {
    private val observation = container.scope.launch(Dispatchers.Main) {
        combine(container.connect.state, container.player.state) { _, _ -> Unit }.collect { invalidateState() }
    }

    override fun getState(): State {
        val connect = container.connect.state.value
        val playback = connect.playback
        val displayed = container.player.state.value
        val tracks = if (connect.selectedId != null && playback != null) displayed.queue else emptyList()
        val commands = Player.Commands.Builder().addAll(
            Player.COMMAND_GET_CURRENT_MEDIA_ITEM, Player.COMMAND_GET_TIMELINE, Player.COMMAND_GET_METADATA,
            Player.COMMAND_GET_VOLUME, Player.COMMAND_GET_DEVICE_VOLUME, Player.COMMAND_RELEASE,
        )
        if (connect.available) commands.addAll(
            Player.COMMAND_PLAY_PAUSE, Player.COMMAND_PREPARE, Player.COMMAND_STOP,
            Player.COMMAND_SET_MEDIA_ITEM, Player.COMMAND_SET_REPEAT_MODE, Player.COMMAND_SET_SHUFFLE_MODE,
            Player.COMMAND_SET_VOLUME, Player.COMMAND_SET_DEVICE_VOLUME_WITH_FLAGS, Player.COMMAND_ADJUST_DEVICE_VOLUME_WITH_FLAGS,
        )
        if (connect.available && tracks.isNotEmpty()) commands.addAll(
            Player.COMMAND_SEEK_IN_CURRENT_MEDIA_ITEM, Player.COMMAND_SEEK_TO_MEDIA_ITEM,
            Player.COMMAND_SEEK_TO_NEXT, Player.COMMAND_SEEK_TO_NEXT_MEDIA_ITEM,
            Player.COMMAND_SEEK_TO_PREVIOUS, Player.COMMAND_SEEK_TO_PREVIOUS_MEDIA_ITEM,
        )
        val playlist = tracks.mapIndexed { index, track ->
            MediaItemData.Builder("$index:${track.id}").setMediaItem(track.toMediaItem(container.media))
                .setDurationUs(track.durationSeconds * 1_000_000L).setIsSeekable(true).build()
        }
        return State.Builder().setAvailableCommands(commands.build())
            .setPlaylist(playlist).setCurrentMediaItemIndex(if (tracks.isEmpty()) C.INDEX_UNSET else displayed.index)
            .setPlaybackState(when {
                tracks.isEmpty() -> Player.STATE_IDLE
                displayed.buffering -> Player.STATE_BUFFERING
                else -> Player.STATE_READY
            })
            .setPlayWhenReady(displayed.playing && connect.available && tracks.isNotEmpty(), Player.PLAY_WHEN_READY_CHANGE_REASON_USER_REQUEST)
            .setContentPositionMs(PositionSupplier { container.connect.position() })
            .setShuffleModeEnabled(displayed.shuffle).setRepeatMode(displayed.repeat)
            .setVolume(displayed.volume)
            .setDeviceInfo(DeviceInfo.Builder(DeviceInfo.PLAYBACK_TYPE_REMOTE).setMaxVolume(100).build())
            .setDeviceVolume((displayed.volume * 100).toInt()).setIsDeviceMuted(displayed.muted)
            .build()
    }

    private fun submit(command: ConnectCommand, revision: Long? = null): ListenableFuture<Void> {
        val future = SettableFuture.create<Void>()
        val job = container.scope.launch(Dispatchers.Main) {
            try { container.connect.command(command, revision); future.set(null) }
            catch (cancelled: CancellationException) { future.cancel(false); throw cancelled }
            catch (error: Exception) { future.setException(error) }
        }
        future.addListener({ if (future.isCancelled) job.cancel() }, MoreExecutors.directExecutor())
        return future
    }

    override fun handleSetPlayWhenReady(playWhenReady: Boolean) = submit(ConnectCommand.SetPlaying(playWhenReady))
    override fun handlePrepare(): ListenableFuture<*> = Futures.immediateVoidFuture()
    override fun handleStop() = submit(ConnectCommand.SetPlaying(false))
    override fun handleSetRepeatMode(repeatMode: Int) = submit(ConnectCommand.SetRepeat(repeatOf(repeatMode)))
    override fun handleSetShuffleModeEnabled(shuffleModeEnabled: Boolean) = submit(ConnectCommand.SetShuffle(shuffleModeEnabled))
    override fun handleSetVolume(volume: Float, volumeOperationType: Int) = when (volumeOperationType) {
        C.VOLUME_OPERATION_TYPE_MUTE -> submit(ConnectCommand.SetMuted(true))
        C.VOLUME_OPERATION_TYPE_UNMUTE -> submit(ConnectCommand.SetMuted(false))
        else -> submit(ConnectCommand.SetVolume(volume.toDouble()))
    }
    override fun handleSetDeviceVolume(deviceVolume: Int, flags: Int) = submit(ConnectCommand.SetVolume((deviceVolume / 100.0).coerceIn(0.0, 1.0)))
    override fun handleIncreaseDeviceVolume(flags: Int) = submit(ConnectCommand.SetVolume((container.player.state.value.volume + 0.05).coerceIn(0.0, 1.0)))
    override fun handleDecreaseDeviceVolume(flags: Int) = submit(ConnectCommand.SetVolume((container.player.state.value.volume - 0.05).coerceIn(0.0, 1.0)))
    override fun handleSetDeviceMuted(muted: Boolean, flags: Int) = submit(ConnectCommand.SetMuted(muted))
    override fun handleSeek(mediaItemIndex: Int, positionMs: Long, seekCommand: Int): ListenableFuture<*> {
        val state = container.player.state.value
        return when (seekCommand) {
            Player.COMMAND_SEEK_TO_NEXT, Player.COMMAND_SEEK_TO_NEXT_MEDIA_ITEM -> submit(ConnectCommand.Next)
            Player.COMMAND_SEEK_TO_PREVIOUS, Player.COMMAND_SEEK_TO_PREVIOUS_MEDIA_ITEM -> submit(ConnectCommand.Previous)
            else -> if (mediaItemIndex != state.index) {
                val track = state.queue.getOrNull(mediaItemIndex) ?: return Futures.immediateVoidFuture()
                submit(ConnectCommand.Jump(mediaItemIndex, track.id), container.connect.state.value.playback?.queueRevision)
            } else submit(ConnectCommand.Seek(positionMs.coerceAtLeast(0) / 1000.0))
        }
    }

    override fun handleSetMediaItems(mediaItems: List<MediaItem>, startIndex: Int, startPositionMs: Long): ListenableFuture<*> {
        if (mediaItems.isEmpty()) return submit(ConnectCommand.Clear)
        val state = container.player.state.value
        return submit(ConnectCommand.Play(mediaItems.map { it.mediaId }, startIndex.coerceAtLeast(0),
            startPositionMs.coerceAtLeast(0) / 1000.0, true, state.shuffle, repeatOf(state.repeat)))
    }

    override fun handleRelease(): ListenableFuture<*> { observation.cancel(); return Futures.immediateVoidFuture() }
}
