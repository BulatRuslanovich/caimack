// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

package app.caimack.audiobooks

import android.app.PendingIntent
import android.content.Intent
import androidx.annotation.OptIn
import androidx.media3.common.AudioAttributes
import androidx.media3.common.C
import androidx.media3.common.MediaItem
import androidx.media3.common.Player.PositionInfo
import androidx.media3.common.Player
import androidx.media3.common.util.UnstableApi
import androidx.media3.datasource.DataSourceBitmapLoader
import androidx.media3.datasource.DefaultDataSource
import androidx.media3.datasource.okhttp.OkHttpDataSource
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory
import androidx.media3.session.CacheBitmapLoader
import androidx.media3.session.DefaultMediaNotificationProvider
import androidx.media3.session.MediaSession
import androidx.media3.session.MediaSessionService
import app.caimack.CaimackApp
import app.caimack.MainActivity
import app.caimack.R
import app.caimack.playback.PlaybackNotificationProvider
import com.google.common.util.concurrent.Futures
import com.google.common.util.concurrent.ListenableFuture
import java.io.IOException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.launch

@OptIn(UnstableApi::class)
class AudiobookService : MediaSessionService() {
    private lateinit var player: ExoPlayer
    private var session: MediaSession? = null
    private val container get() = (application as CaimackApp).container
    private var owner: AudiobookAccount? = null
    private var accounts: Job? = null
    private var ticking: Job? = null
    private var last: AudiobookPlaybackState? = null
    private var lastCheckpointTime = 0L

    override fun onCreate() {
        super.onCreate()
        owner = container.audiobookAccount()
        val data = DefaultDataSource.Factory(this, OkHttpDataSource.Factory(container.http))
        player = ExoPlayer.Builder(this)
            .setMediaSourceFactory(DefaultMediaSourceFactory(data))
            .setAudioAttributes(AudioAttributes.Builder().setUsage(C.USAGE_MEDIA).setContentType(C.AUDIO_CONTENT_TYPE_SPEECH).build(), true)
            .setSeekBackIncrementMs(15_000)
            .setSeekForwardIncrementMs(30_000)
            .setHandleAudioBecomingNoisy(true)
            .setWakeMode(C.WAKE_MODE_NETWORK)
            .build()
        player.addListener(object : Player.Listener {
            override fun onPositionDiscontinuity(oldPosition: PositionInfo, newPosition: PositionInfo, reason: Int) {
                val previous = last?.takeIf { oldPosition.mediaItem?.mediaId == it.chapterId } ?: return
                val next = newPosition.mediaItem
                val nextBook = next?.mediaMetadata?.extras?.getString(AudiobookPlayback.BOOK_ID)
                if (previous.bookId != nextBook && previous.playing) {
                    checkpoint(false, previous.copy(positionMs = oldPosition.positionMs))
                } else if (next != null && previous.bookId == nextBook && reason == Player.DISCONTINUITY_REASON_SEEK) {
                    checkpoint(false, previous.copy(chapterId = next.mediaId, positionMs = newPosition.positionMs))
                }
            }

            override fun onEvents(player: Player, events: Player.Events) {
                val previous = last
                publish()
                val current = last
                if (current == null) return
                val ended = player.playbackState == Player.STATE_ENDED
                val seek = events.contains(Player.EVENT_POSITION_DISCONTINUITY)
                if (ended || current.playing && previous?.playing != true ||
                    previous?.playing == true && !current.playing ||
                    seek && (player.playbackState == Player.STATE_READY || previous?.bookId == current.bookId && previous.playing)) {
                    checkpoint(ended)
                }
            }

            override fun onPlayWhenReadyChanged(playWhenReady: Boolean, reason: Int) {
                if (playWhenReady) container.player.pauseLocal()
            }
        })
        accounts = container.scope.launch(Dispatchers.Main) {
            container.audiobookAccounts.distinctUntilChanged().collect { account ->
                if (account == owner) return@collect
                player.stop()
                player.clearMediaItems()
                owner = account
            }
        }
        ticking = container.scope.launch(Dispatchers.Main) {
            while (true) {
                delay(1_000)
                if (!player.isPlaying) continue
                publish()
                if (android.os.SystemClock.elapsedRealtime() - lastCheckpointTime >= 8_000) checkpoint(false)
            }
        }

        val callback = object : MediaSession.Callback {
            override fun onAddMediaItems(
                mediaSession: MediaSession,
                controller: MediaSession.ControllerInfo,
                mediaItems: MutableList<MediaItem>,
            ): ListenableFuture<MutableList<MediaItem>> {
                val account = owner?.takeIf { it == container.audiobookAccount() }
                    ?: return Futures.immediateFuture(mutableListOf())
                val catalog = container.audiobookStore.state.value.books
                return Futures.immediateFuture(mediaItems.mapNotNull { item ->
                    val id = item.mediaMetadata.extras?.getString(AudiobookPlayback.BOOK_ID) ?: return@mapNotNull null
                    val book = catalog.firstOrNull { it.id == id } ?: return@mapNotNull null
                    val chapter = book.chapters.firstOrNull { it.id == item.mediaId } ?: return@mapNotNull null
                    container.audiobookPlayback.mediaItem(account, book, chapter)
                }.toMutableList())
            }
        }

        session = MediaSession.Builder(this, player)
            .setId("audiobooks")
            .setCallback(callback)
            .setBitmapLoader(CacheBitmapLoader(DataSourceBitmapLoader.Builder(this).setDataSourceFactory(data).build()))
            .setSessionActivity(PendingIntent.getActivity(this, 1,
                Intent(this, MainActivity::class.java).setAction(AudiobookPlayback.OPEN).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP),
                PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT))
            .build()
        val notification = DefaultMediaNotificationProvider.Builder(this).setNotificationId(1002).build()
        notification.setSmallIcon(R.drawable.ic_notification)
        setMediaNotificationProvider(PlaybackNotificationProvider(this, container.appearance, notification))
    }

    override fun onGetSession(controllerInfo: MediaSession.ControllerInfo): MediaSession? = session

    private fun publish() {
        val item = player.currentMediaItem
        val book = item?.mediaMetadata?.extras?.getString(AudiobookPlayback.BOOK_ID)
        last = if (item == null || book == null) null else AudiobookPlaybackState(
            book, item.mediaId, player.currentPosition, player.duration.takeIf { it > 0 } ?: 0,
            player.isPlaying, player.playWhenReady && player.playbackState == Player.STATE_BUFFERING,
            player.playerError != null,
        )
        container.audiobookPlayback.publish(last)
    }

    private fun checkpoint(completed: Boolean, playback: AudiobookPlaybackState? = last) {
        val account = owner ?: return
        val state = playback ?: return
        val progress = AudiobookProgress(state.chapterId, state.positionMs, System.currentTimeMillis(), completed)
        lastCheckpointTime = android.os.SystemClock.elapsedRealtime()
        container.scope.launch {
            try { container.audiobookStore.checkpoint(account, state.bookId, progress) }
            catch (error: IOException) { android.util.Log.w("Caimack", "Could not save audiobook progress", error) }
        }
    }

    override fun onDestroy() {
        if (player.isPlaying) {
            publish()
            checkpoint(false)
        }
        accounts?.cancel()
        ticking?.cancel()
        session?.release()
        player.release()
        container.audiobookPlayback.publish(null)
        super.onDestroy()
    }
}
