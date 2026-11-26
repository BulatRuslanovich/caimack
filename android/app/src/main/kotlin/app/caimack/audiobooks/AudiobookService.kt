// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

package app.caimack.audiobooks

import android.app.PendingIntent
import android.content.Intent
import android.os.SystemClock
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
import androidx.media3.session.SessionError
import androidx.media3.session.SessionResult
import app.caimack.CaimackApp
import app.caimack.MainActivity
import app.caimack.R
import app.caimack.playback.PlaybackNotificationProvider
import app.caimack.playback.SleepTimerState
import com.google.common.util.concurrent.Futures
import com.google.common.util.concurrent.ListenableFuture
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.collectLatest
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.launch

@OptIn(UnstableApi::class)
class AudiobookService : MediaSessionService() {
    private lateinit var player: ExoPlayer
    private var session: MediaSession? = null
    private val container get() = (application as CaimackApp).container
    private var owner: AudiobookAccount? = null
    private var accounts: Job? = null
    private var syncing: Job? = null
    private var ticking: Job? = null
    private var sleeping: Job? = null
    private var last: AudiobookPlaybackState? = null
    private var selection: Long? = null
    private var version = 0L
    private var activated = false
    private var recorded: AudiobookProgress? = null
    private var applying: AudiobookProgress? = null
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
        val sleepTimer = container.audiobookPlayback.sleepTimer
        player.addListener(object : Player.Listener {
            override fun onPositionDiscontinuity(oldPosition: PositionInfo, newPosition: PositionInfo, reason: Int) {
                val previous = last?.takeIf { oldPosition.mediaItem?.mediaId == it.chapterId } ?: return
                val next = newPosition.mediaItem
                val nextSelection = next?.mediaMetadata?.extras?.getLong(AudiobookPlayback.SELECTION)
                if (next == null || nextSelection != selection) {
                    if (previous.playing) checkpoint(previous.copy(positionMs = oldPosition.positionMs))
                    return
                }
                val remoteSeek = applying
                applying = null
                val operation = reason == Player.DISCONTINUITY_REASON_SEEK
                if (remoteSeek?.chapterId == next.mediaId && operation) return
                if (!operation && reason != Player.DISCONTINUITY_REASON_AUTO_TRANSITION) return
                checkpoint(previous.copy(chapterId = next.mediaId, positionMs = newPosition.positionMs), explicitSeek = operation)
            }

            override fun onEvents(player: Player, events: Player.Events) {
                val previousBook = last?.bookId
                publish()
                val current = last
                if (current?.bookId != previousBook || player.playbackState == Player.STATE_ENDED) {
                    sleepTimer.cancel()
                }
                val extras = player.currentMediaItem?.mediaMetadata?.extras
                val incoming = extras?.getLong(AudiobookPlayback.SELECTION)
                if (incoming != selection) {
                    selection = incoming
                    version = extras?.getLong(AudiobookPlayback.RESUME_VERSION) ?: 0
                    activated = false
                    recorded = null
                    applying = null
                }
                if (current == null) return
                when {
                    current.playing && !activated -> {
                        activated = true
                        checkpoint(current)
                    }
                    activated && events.contains(Player.EVENT_PLAYBACK_STATE_CHANGED) && player.playbackState == Player.STATE_ENDED ->
                        checkpoint(current, completed = true)
                    activated && events.contains(Player.EVENT_PLAY_WHEN_READY_CHANGED) && !player.playWhenReady ->
                        checkpoint(current)
                }
                alignPausedPosition()
            }

            override fun onPlayWhenReadyChanged(playWhenReady: Boolean, reason: Int) {
                if (playWhenReady) container.player.pauseLocal()
                if (reason == Player.PLAY_WHEN_READY_CHANGE_REASON_END_OF_MEDIA_ITEM) sleepTimer.cancel()
            }
        })
        sleeping = container.scope.launch(Dispatchers.Main) {
            sleepTimer.state.collectLatest { timer ->
                player.volume = 1f
                player.pauseAtEndOfMediaItems = timer is SleepTimerState.TrackEnd
                if (timer is SleepTimerState.Minutes) {
                    timer.fade { player.volume = it }
                    player.pause()
                    sleepTimer.cancel()
                }
            }
        }
        accounts = container.scope.launch(Dispatchers.Main) {
            container.audiobookAccounts.distinctUntilChanged().collect { account ->
                if (account == owner) return@collect
                player.stop()
                player.clearMediaItems()
                owner = account
            }
        }
        syncing = container.scope.launch(Dispatchers.Main) {
            container.audiobookStore.state.collect { alignPausedPosition() }
        }
        ticking = container.scope.launch(Dispatchers.Main) {
            var lastPausedRefresh = 0L
            while (true) {
                delay(1_000)
                val now = SystemClock.elapsedRealtime()
                if (player.isPlaying) {
                    publish()
                    if (now - lastCheckpointTime >= 8_000) last?.let { checkpoint(it) }
                } else if (!player.playWhenReady && now - lastPausedRefresh >= pausedRefreshInterval()) {
                    val account = owner ?: continue
                    val paused = last ?: continue
                    lastPausedRefresh = now
                    container.audiobookStore.refreshForPlayback(account, paused.bookId)
                }
            }
        }

        val callback = object : MediaSession.Callback {
            @Suppress("OVERRIDE_DEPRECATION")
            override fun onPlayerCommandRequest(
                session: MediaSession,
                controller: MediaSession.ControllerInfo,
                playerCommand: Int,
            ): Int {
                // System UI can send STOP when replacing the remote music card with the local book.
                // Pause and dismissal of a paused book remain available from the notification.
                if (playerCommand == Player.COMMAND_STOP && player.playWhenReady && container.connect.isRemote &&
                    (controller.packageName == "com.android.systemui" || session.isMediaNotificationController(controller))) {
                    return SessionError.ERROR_INVALID_STATE
                }
                return SessionResult.RESULT_SUCCESS
            }

            override fun onAddMediaItems(
                mediaSession: MediaSession,
                controller: MediaSession.ControllerInfo,
                mediaItems: MutableList<MediaItem>,
            ): ListenableFuture<MutableList<MediaItem>> {
                val account = owner?.takeIf { it == container.audiobookAccount() }
                    ?: return Futures.immediateFuture(mutableListOf())
                val catalog = container.audiobookStore.state.value.books
                return Futures.immediateFuture(mediaItems.mapNotNull { item ->
                    val extras = item.mediaMetadata.extras ?: return@mapNotNull null
                    val id = extras.getString(AudiobookPlayback.BOOK_ID) ?: return@mapNotNull null
                    val book = catalog.firstOrNull { it.id == id } ?: return@mapNotNull null
                    val chapter = book.chapters.firstOrNull { it.id == item.mediaId } ?: return@mapNotNull null
                    container.audiobookPlayback.mediaItem(account, book, chapter, extras)
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

    override fun onGetSession(controllerInfo: MediaSession.ControllerInfo): MediaSession? =
        session.takeIf { container.audiobooksEnabled.value }

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

    private fun alignPausedPosition() {
        if (!activated || player.playWhenReady || owner != container.audiobookAccount()) return
        val active = last ?: return
        val latest = progressOf(active.bookId)?.takeIf { it.updatedAtMs > version } ?: return
        val index = (0 until player.mediaItemCount).firstOrNull { player.getMediaItemAt(it).mediaId == latest.chapterId } ?: return
        version = latest.updatedAtMs
        recorded = latest
        if (player.currentMediaItemIndex == index && player.currentPosition == latest.positionMs) return
        applying = latest
        player.seekTo(index, latest.positionMs)
    }

    private fun progressOf(bookId: String) = container.audiobookStore.state.value.books.firstOrNull { it.id == bookId }?.progress

    private fun pausedRefreshInterval(): Long = if (container.audiobookStore.state.value.online) 8_000 else 30_000

    private fun checkpoint(state: AudiobookPlaybackState, completed: Boolean = false, explicitSeek: Boolean = false) {
        val account = owner ?: return
        lastCheckpointTime = SystemClock.elapsedRealtime()
        if (recorded?.let { it.chapterId == state.chapterId && it.positionMs == state.positionMs && it.completed == completed } == true) return
        val known = progressOf(state.bookId)?.updatedAtMs ?: 0
        val basedOn = if (explicitSeek) maxOf(version, known) else version
        if (known > basedOn) return
        val progress = AudiobookProgress(state.chapterId, state.positionMs, container.audiobookStore.checkpointTime(account, basedOn), completed)
        version = progress.updatedAtMs
        recorded = progress
        container.audiobookPlayback.recordProgress(account, state.bookId, progress, basedOn)
    }

    override fun onDestroy() {
        if (player.isPlaying) {
            publish()
            last?.let { checkpoint(it) }
        }
        accounts?.cancel()
        syncing?.cancel()
        ticking?.cancel()
        sleeping?.cancel()
        container.audiobookPlayback.sleepTimer.cancel()
        session?.release()
        player.release()
        container.audiobookPlayback.publish(null)
        super.onDestroy()
    }
}
