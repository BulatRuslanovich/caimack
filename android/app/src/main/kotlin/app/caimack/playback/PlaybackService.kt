// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

package app.caimack.playback

import android.app.PendingIntent
import android.content.Intent
import android.net.ConnectivityManager
import android.net.Network
import android.media.audiofx.DynamicsProcessing
import android.util.Log
import kotlin.math.sqrt
import android.os.Bundle
import android.os.PowerManager
import android.os.Handler
import android.os.Looper
import android.widget.Toast
import androidx.annotation.OptIn
import androidx.core.net.toUri
import androidx.core.util.writeText
import androidx.media3.common.AudioAttributes
import androidx.media3.common.C
import androidx.media3.common.MediaItem
import androidx.media3.common.MimeTypes
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.common.util.UnstableApi
import androidx.media3.datasource.DataSourceBitmapLoader
import androidx.media3.datasource.DefaultDataSource
import androidx.media3.datasource.HttpDataSource
import androidx.media3.datasource.okhttp.OkHttpDataSource
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.DefaultLoadControl
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory
import androidx.media3.exoplayer.source.ShuffleOrder.DefaultShuffleOrder
import androidx.media3.exoplayer.upstream.DefaultLoadErrorHandlingPolicy
import androidx.media3.exoplayer.upstream.LoadErrorHandlingPolicy
import androidx.media3.session.CacheBitmapLoader
import androidx.media3.session.CommandButton
import androidx.media3.session.MediaLibraryService
import androidx.media3.session.MediaSession
import androidx.media3.session.SessionCommand
import app.caimack.AppContainer
import app.caimack.CaimackApp
import app.caimack.MainActivity
import app.caimack.R
import app.caimack.widget.NowPlayingWidget
import app.caimack.api.PlaybackStateReport
import app.caimack.api.RadioRequest
import app.caimack.api.Track
import app.caimack.api.ConnectCommand
import app.caimack.api.ConnectState
import app.caimack.api.ConnectRadio
import app.caimack.api.ConnectSleep
import app.caimack.ui.Appearance
import app.caimack.ui.withNetworkRetries
import kotlinx.coroutines.Job
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.collectLatest
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.drop
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import okhttp3.Request
import kotlinx.serialization.Serializable

@Serializable
data class SavedQueue(val tracks: List<Track>, val index: Int, val positionMs: Long)

@OptIn(UnstableApi::class)
class PlaybackService : MediaLibraryService() {
    private var session: MediaLibrarySession? = null
    private val fellBack = mutableSetOf<String>()
    private val ticks = Handler(Looper.getMainLooper())
    private var radioSeed: String? = null
    private var radioRequest: Job? = null
    private var radioReactions: Job? = null
    private var radioRefresh: Job? = null
    private var listening: String? = null
    private var failures = 0
    private var reportTicks = 0
    private val saving = Dispatchers.IO.limitedParallelism(1)
    private lateinit var signals: Signals
    private lateinit var exclusive: ExclusiveSession
    private var playbackLease = false
    private var outputPlayer: ExoPlayer? = null
    private var connectPlayer: ConnectMediaPlayer? = null
    private var connectSession: Job? = null
    private var heart: Job? = null
    private var tone: Job? = null
    private var sleep: Job? = null
    private var leveling: Job? = null
    private var qualityChanges: Job? = null
    private var equalizer: DynamicsProcessing? = null
    private var normalization = 1f
    private var sleepLevel = 1f
    private var networkRecovery: Job? = null
    private var bufferingRecovery: Job? = null
    private var networkAttempts = 0
    private var networkCallback: ConnectivityManager.NetworkCallback? = null
    private val reduced = mutableSetOf<String>()
    private val networkNotified = mutableSetOf<String>()

    override fun onCreate() {
        super.onCreate()
        val container = (application as CaimackApp).container
        val data = OkHttpDataSource.Factory(container.http)

        val player = ExoPlayer.Builder(this)
            .setLoadControl(DefaultLoadControl.Builder()
                .setBufferDurationsMs(60_000, 180_000, 1500, 5000)
                .setPrioritizeTimeOverSizeThresholds(true)
                .build())
            .setMediaSourceFactory(
                DefaultMediaSourceFactory(container.downloads.playback).setLoadErrorHandlingPolicy(
                    object : DefaultLoadErrorHandlingPolicy(NETWORK_RETRIES) {
                        override fun getRetryDelayMsFor(info: LoadErrorHandlingPolicy.LoadErrorInfo): Long =
                            if (statusOf(info.exception) in 400..499) C.TIME_UNSET else super.getRetryDelayMsFor(info)
                    },
                ),
            )
            .setAudioAttributes(
                AudioAttributes.Builder().setUsage(C.USAGE_MEDIA).setContentType(C.AUDIO_CONTENT_TYPE_MUSIC).build(),
                true,
            )
            .setHandleAudioBecomingNoisy(true)
            .setWakeMode(C.WAKE_MODE_NETWORK)
            .build()

        signals = container.signals
        outputPlayer = player
        radioReactions = container.scope.launch(Dispatchers.Main) {
            val progressed = mutableSetOf<String>()
            signals.reactions.collect { event ->
                if (container.connect.isRemote) return@collect
                if (!RadioPolicy.reactsTo(event.type, event.listenedSeconds)) return@collect
                if (event.type == "trackPlayed" && !progressed.add(event.trackId.orEmpty())) return@collect
                if (container.radio.state.value.notes.isEmpty()) return@collect
                radioRefresh?.cancel()
                radioRefresh = container.scope.launch(Dispatchers.Main) {
                    delay(350)
                    continueWithRadio(container, player, refresh = true)
                }
            }
        }
        exclusive = ExclusiveSession(
            container.http,
            container.server,
            container.deviceId,
            container.deviceName,
            container.scope,
            onClaimed = { report(container, player) },
        ) { byDevice ->
            playbackLease = false
            container.connect.displaced()
            player.pause()
            val message = byDevice?.let { getString(R.string.player_playing_on, it) } ?: getString(R.string.player_playing_elsewhere)
            Toast.makeText(this, message, Toast.LENGTH_LONG).show()
        }

        val tick = object : Runnable {
            override fun run() {
                player.currentMediaItem?.let { signals.progress(it.mediaId, secondsOf(it), player.currentPosition / 1000.0) }
                if (++reportTicks % REPORT_EVERY_TICKS == 0) report(container, player)
                if (reportTicks % WIDGET_EVERY_TICKS == 0 && player.isPlaying && getSystemService(PowerManager::class.java).isInteractive) {
                    NowPlayingWidget.progress(this@PlaybackService, player.currentPosition, player.duration)
                }
                ticks.postDelayed(this, TICK_MS)
            }
        }

        player.addListener(object : Player.Listener {
            override fun onShuffleModeEnabledChanged(shuffleModeEnabled: Boolean) = showButtons(container)

            override fun onPositionDiscontinuity(oldPosition: Player.PositionInfo, newPosition: Player.PositionInfo, reason: Int) {
                if (reason == Player.DISCONTINUITY_REASON_SEEK) {
                    if (oldPosition.mediaItem?.mediaId == newPosition.mediaItem?.mediaId) {
                        signals.tracker.reposition(newPosition.positionMs / 1000.0)
                    }
                    NowPlayingWidget.progress(this@PlaybackService, player.currentPosition, player.duration)
                }
            }

            override fun onRepeatModeChanged(repeatMode: Int) = showButtons(container)

            override fun onMediaItemTransition(mediaItem: MediaItem?, reason: Int) {
                networkRecovery?.cancel()
                bufferingRecovery?.cancel()
                networkAttempts = 0
                normalize(container, player)
                if (player.playbackState == Player.STATE_IDLE && player.playerError != null) player.prepare()
                save(container, player)
                if (player.playWhenReady) report(container, player)

                val fallback = reason == Player.MEDIA_ITEM_TRANSITION_REASON_PLAYLIST_CHANGED &&
                    mediaItem?.mediaId == listening
                if (fallback) return

                val natural = reason == Player.MEDIA_ITEM_TRANSITION_REASON_AUTO || reason == Player.MEDIA_ITEM_TRANSITION_REASON_REPEAT
                signals.tracker.finish(if (natural) ListeningTracker.COMPLETED else ListeningTracker.SKIPPED)
                listening = null
                if (player.playWhenReady) listen(player)
                continueWithRadio(container, player)
                showButtons(container)
                NowPlayingWidget.show(this@PlaybackService, mediaItem?.mediaId?.let { container.tracks[it] }, player.isPlaying, player.currentPosition, player.duration)
            }

            override fun onAudioSessionIdChanged(audioSessionId: Int) {
                equalizer?.release()
                equalizer = null
                shapeSound(audioSessionId, container.equalizer.state.value)
            }

            override fun onPlayWhenReadyChanged(playWhenReady: Boolean, reason: Int) {
                if (!playWhenReady) {
                    networkRecovery?.cancel()
                    bufferingRecovery?.cancel()
                } else if (player.playerError != null) player.prepare()
                if (reason == Player.PLAY_WHEN_READY_CHANGE_REASON_END_OF_MEDIA_ITEM) container.sleepTimer.cancel()
            }

            override fun onPlaybackStateChanged(playbackState: Int) {
                bufferingRecovery?.cancel()
                if (playbackState == Player.STATE_READY) {
                    networkRecovery?.cancel()
                    networkAttempts = 0
                }
                if (playbackState == Player.STATE_BUFFERING && player.playWhenReady) {
                    bufferingRecovery = container.scope.launch(Dispatchers.Main) {
                        delay(4000)
                        var retryDelay = 5000L
                        while (player.playWhenReady && player.playbackState == Player.STATE_BUFFERING) {
                            if (tryLighterStream(container, player)) break
                            delay(retryDelay + kotlin.random.Random.nextLong(1000))
                            retryDelay = (retryDelay * 2).coerceAtMost(60_000L)
                        }
                    }
                }
                if (playbackState == Player.STATE_ENDED) signals.tracker.finish(ListeningTracker.COMPLETED)
            }

            override fun onEvents(ignored: Player, events: Player.Events) {
                container.connect.changed()
                if (player.mediaItemCount == 0) {
                    playbackLease = false
                    exclusive.release()
                }
                val item = player.currentMediaItem ?: run {
                    container.playbackDelivery.value = null
                    return
                }
                val adaptive = item.localConfiguration?.mimeType == MimeTypes.APPLICATION_M3U8
                val offline = container.downloads.completed(item.mediaId) != null
                container.playbackDelivery.value = PlaybackDelivery(
                    item.mediaId, adaptive,
                    player.audioFormat?.bitrate?.takeIf { it > 0 }?.div(1000),
                    when {
                        player.playerError != null && networkRecovery?.isActive == true -> "waiting"
                        adaptive && offline && container.settings.value.quality == ORIGINAL -> "download"
                        adaptive && item.mediaId in reduced -> "network"
                        else -> null
                    },
                )
            }

            override fun onIsPlayingChanged(isPlaying: Boolean) {
                ticks.removeCallbacks(tick)
                NowPlayingWidget.show(this@PlaybackService, player.currentMediaItem?.mediaId?.let { container.tracks[it] }, isPlaying, player.currentPosition, player.duration)
                if (isPlaying) {
                    playbackLease = true
                    failures = 0
                    listen(player)
                    ticks.post(tick)
                    exclusive.hold()
                } else {
                    if (playbackLease && !container.connect.isRemote) exclusive.hold() else exclusive.release()
                    signals.flush()
                    save(container, player)
                    if (!player.playWhenReady) report(container, player)
                }
            }

            override fun onPlayerError(error: PlaybackException) {
                val item = player.currentMediaItem ?: return
                val offline = error.errorCode == PlaybackException.ERROR_CODE_IO_NETWORK_CONNECTION_FAILED ||
                    error.errorCode == PlaybackException.ERROR_CODE_IO_NETWORK_CONNECTION_TIMEOUT ||
                    error.errorCode == PlaybackException.ERROR_CODE_IO_UNSPECIFIED
                if (statusOf(error.cause) == UNAUTHORIZED) return
                if (offline || (statusOf(error.cause) ?: 0) >= 500 || statusOf(error.cause) in listOf(408, 429)) {
                    networkRecovery?.cancel()
                    if (networkNotified.add(item.mediaId)) {
                        Toast.makeText(this@PlaybackService, Appearance.localized(this@PlaybackService).getString(R.string.player_network_waiting), Toast.LENGTH_LONG).show()
                    }
                    networkRecovery = container.scope.launch(Dispatchers.Main) {
                        delay((1000L shl networkAttempts.coerceAtMost(5)).coerceAtMost(30_000L))
                        networkAttempts++
                        if (player.currentMediaItem?.mediaId != item.mediaId || !player.playWhenReady) return@launch
                        if (!tryLighterStream(container, player)) player.prepare()
                    }
                    return
                }

                if (item.localConfiguration?.mimeType == MimeTypes.APPLICATION_M3U8 && fellBack.add(item.mediaId)) {
                    val index = player.currentMediaItemIndex
                    val position = player.currentPosition
                    player.replaceMediaItem(index, item.buildUpon().setUri(original(container, item.mediaId)).setMimeType(null).build())
                    player.seekTo(index, position)
                    player.prepare()
                    return
                }

                signals.tracker.discard()
                listening = null
                if (player.hasNextMediaItem() && failures++ < MAX_SKIPS) {
                    val title = item.mediaMetadata.title?.toString().orEmpty()
                    Toast.makeText(this@PlaybackService, Appearance.localized(this@PlaybackService).getString(R.string.player_skipped_unplayable, title), Toast.LENGTH_SHORT).show()
                    player.seekToNextMediaItem()
                }
            }
        })

        networkCallback = object : ConnectivityManager.NetworkCallback() {
            override fun onAvailable(network: Network) {
                ticks.post {
                    if (player.playWhenReady && player.playerError != null) {
                        networkRecovery?.cancel()
                        networkAttempts = 0
                        player.prepare()
                    }
                }
            }
        }.also { getSystemService(ConnectivityManager::class.java).registerDefaultNetworkCallback(it) }

        val tree = LibraryTree(this, container) { resolve(container, it) }
        container.scope.launch {
            val saved = runCatching { tree.resumption() }.getOrNull() ?: return@launch
            withContext(Dispatchers.Main) {
                if (session != null && player.mediaItemCount == 0) {
                    player.setMediaItems(saved.mediaItems, saved.startIndex, saved.startPositionMs)
                }
            }
        }

        session = MediaLibrarySession.Builder(this, player, tree)
            .setBitmapLoader(
                CacheBitmapLoader(
                    DataSourceBitmapLoader.Builder(this).setDataSourceFactory(DefaultDataSource.Factory(this, data)).build(),
                ),
            )
            .setSessionActivity(
                PendingIntent.getActivity(
                    this,
                    0,
                    Intent(this, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP),
                    PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
                ),
            )
            .build()

        heart = container.scope.launch(Dispatchers.Main) {
            container.connect.attach(
                state = { connectState(container, player) },
                execute = { command -> executeConnect(container, player, command) },
            )
            val remote = ConnectMediaPlayer(container)
            connectPlayer = remote
            connectSession = container.scope.launch(Dispatchers.Main) {
                container.connect.state.map { it.selectedId }.distinctUntilChanged().collect { selected ->
                    if (selected != null) {
                        playbackLease = false
                        exclusive.release()
                        player.pause()
                        session?.setPlayer(remote)
                    } else session?.setPlayer(player)
                }
            }
            container.favorites.state.collect {
                showButtons(container)
                val track = player.currentMediaItem?.mediaId?.let { id -> container.tracks[id] }
                if (track != null) NowPlayingWidget.show(this@PlaybackService, track, player.isPlaying, player.currentPosition, player.duration)
            }
        }
        tone = container.scope.launch(Dispatchers.Main) { container.equalizer.state.collect { shapeSound(player.audioSessionId, it) } }
        sleep = container.scope.launch(Dispatchers.Main) { container.sleepTimer.state.collectLatest { fallAsleep(container, player, it) } }
        leveling = container.scope.launch(Dispatchers.Main) { container.playbackPrefs.normalizeVolume.collect { normalize(container, player) } }
        qualityChanges = container.scope.launch(Dispatchers.Main) {
            container.settings.map { it.quality }.distinctUntilChanged().drop(1).collect {
                networkRecovery?.cancel()
                bufferingRecovery?.cancel()
                fellBack.clear()
                reduced.clear()
                val index = player.currentMediaItemIndex
                val position = player.currentPosition
                val items = (0 until player.mediaItemCount).map { resolve(container, player.getMediaItemAt(it)) }
                items.forEachIndexed { slot, item -> player.replaceMediaItem(slot, item) }
                if (items.isNotEmpty()) {
                    player.seekTo(index, position)
                    player.prepare()
                }
            }
        }

        setMediaNotificationProvider(PlaybackNotificationProvider(this, container.appearance))
    }

    override fun onGetSession(controllerInfo: MediaSession.ControllerInfo): MediaLibrarySession? = session

    override fun onDestroy() {
        (application as CaimackApp).container.connect.detach()
        connectSession?.cancel()
        connectPlayer?.release()
        radioReactions?.cancel()
        radioRefresh?.cancel()
        radioRequest?.cancel()
        heart?.cancel()
        tone?.cancel()
        sleep?.cancel()
        leveling?.cancel()
        qualityChanges?.cancel()
        networkCallback?.let { getSystemService(ConnectivityManager::class.java).unregisterNetworkCallback(it) }
        networkCallback = null
        networkRecovery?.cancel()
        bufferingRecovery?.cancel()
        equalizer?.release()
        equalizer = null
        ticks.removeCallbacksAndMessages(null)
        exclusive.release()
        signals.tracker.discard()
        signals.flush()
        outputPlayer?.let { player ->
            save((application as CaimackApp).container, player)
            NowPlayingWidget.show(this@PlaybackService, player.currentMediaItem?.mediaId?.let { (application as CaimackApp).container.tracks[it] }, false)
            player.release()
        }
        session?.release()
        outputPlayer = null
        session = null
        super.onDestroy()
    }

    private fun resolve(container: AppContainer, item: MediaItem): MediaItem = trimSilence(container, source(container, item))

    private suspend fun tryLighterStream(container: AppContainer, player: ExoPlayer): Boolean {
        // A LAN server can work without validated Internet access, so only test for a network.
        if (getSystemService(ConnectivityManager::class.java).activeNetwork == null) return false
        val item = player.currentMediaItem ?: return false
        if (container.settings.value.quality != ORIGINAL ||
            item.localConfiguration?.mimeType == MimeTypes.APPLICATION_M3U8 ||
            container.downloads.completed(item.mediaId) != null || item.mediaId in fellBack) return false
        val master = container.server.resolve("api/tracks/${item.mediaId}/hls/master.m3u8")
            ?.newBuilder()?.addQueryParameter("maxQuality", NORMAL)?.build() ?: return false
        // Keep the original and its buffer until a compatible rendition actually exists.
        val ready = withContext(Dispatchers.IO) {
            runCatching {
                container.http.newCall(Request.Builder().url(master).build()).execute().use { it.code == 200 }
            }.getOrDefault(false)
        }
        if (!ready || player.currentMediaItem != item || !player.playWhenReady ||
            container.settings.value.quality != ORIGINAL || player.playbackState == Player.STATE_READY) return false
        val index = player.currentMediaItemIndex
        val position = player.currentPosition
        reduced.add(item.mediaId)
        player.replaceMediaItem(index, item.buildUpon().setUri(master.toString().toUri()).setMimeType(MimeTypes.APPLICATION_M3U8).build())
        player.seekTo(index, position)
        player.prepare()
        Toast.makeText(this, Appearance.localized(this).getString(R.string.player_quality_reduced), Toast.LENGTH_LONG).show()
        return true
    }

    private fun source(container: AppContainer, item: MediaItem): MediaItem {
        container.downloads.completed(item.mediaId)?.request?.let { request ->
            return item.buildUpon()
                .setUri(request.uri)
                .setMimeType(request.mimeType)
                .setCustomCacheKey(request.customCacheKey)
                .setStreamKeys(request.streamKeys)
                .build()
        }

        val quality = container.settings.value.quality
        val adaptive = quality != ORIGINAL

        if (!adaptive || item.mediaId in fellBack) {
            return item.buildUpon().setUri(original(container, item.mediaId)).setMimeType(null).build()
        }

        val cap = if (quality == ORIGINAL) NORMAL else quality
        val master = container.server.resolve("api/tracks/${item.mediaId}/hls/master.m3u8")
            ?.newBuilder()?.addQueryParameter("maxQuality", cap)?.build().toString()
        return item.buildUpon().setUri(master.toUri()).setMimeType(MimeTypes.APPLICATION_M3U8).build()
    }

    private fun trimSilence(container: AppContainer, item: MediaItem): MediaItem {
        if (!container.playbackPrefs.smartTransitions.value) return item
        val track = container.tracks[item.mediaId] ?: return item
        val cues = track.cues ?: return item

        val start = cues.audioStart.takeIf { it >= MIN_TRIM_SECONDS && it < track.durationSeconds / 2.0 } ?: 0.0
        val end = cues.audioEnd.takeIf { track.durationSeconds - it >= MIN_TRIM_SECONDS && it > start + MIN_TRIM_SECONDS }
        if (start == 0.0 && end == null) return item

        val clipping = MediaItem.ClippingConfiguration.Builder().setStartPositionMs((start * 1000).toLong())
        end?.let { clipping.setEndPositionMs((it * 1000).toLong()) }
        return item.buildUpon().setClippingConfiguration(clipping.build()).build()
    }

    private fun normalize(container: AppContainer, player: ExoPlayer) {
        val track = player.currentMediaItem?.mediaId?.let { container.tracks[it] }
        normalization = Loudness.gain(track, container.playbackPrefs.normalizeVolume.value)
        player.volume = normalization * sleepLevel
    }

    private fun setSleepLevel(player: ExoPlayer, level: Float) {
        sleepLevel = level
        player.volume = normalization * sleepLevel
    }

    private suspend fun fallAsleep(container: AppContainer, player: ExoPlayer, timer: SleepTimerState?) {
        setSleepLevel(player, 1f)
        player.pauseAtEndOfMediaItems = timer is SleepTimerState.TrackEnd
        if (timer !is SleepTimerState.Minutes) return

        delay((timer.remainingMs - SleepTimer.FADE_MS).coerceAtLeast(0))
        while (timer.remainingMs > 0) {
            setSleepLevel(player, timer.remainingMs.toFloat() / SleepTimer.FADE_MS)
            delay(SLEEP_FADE_TICK_MS)
        }

        player.pause()
        setSleepLevel(player, 1f)
        container.sleepTimer.cancel()
    }

    private fun continueWithRadio(container: AppContainer, player: ExoPlayer, refresh: Boolean = false) {
        if (container.connect.isRemote) return
        if (!container.radio.autoplay.value || player.repeatMode != Player.REPEAT_MODE_OFF || player.mediaItemCount == 0) return
        val queued = idsOf(player)
        val shuffled = player.shuffleModeEnabled
        val order = buildList {
            var index = player.currentMediaItemIndex
            // Use Media3's traversal order to protect history and the next item.
            addAll(0 until player.mediaItemCount)
            if (player.shuffleModeEnabled) {
                clear()
                val previous = mutableListOf<Int>()
                while (index != C.INDEX_UNSET) {
                    previous.add(index)
                    index = player.currentTimeline.getPreviousWindowIndex(index, Player.REPEAT_MODE_OFF, true)
                }
                addAll(previous.reversed())
                index = player.currentMediaItemIndex
                while (index != C.INDEX_UNSET) {
                    index = player.currentTimeline.getNextWindowIndex(index, Player.REPEAT_MODE_OFF, true)
                    if (index != C.INDEX_UNSET) add(index)
                }
            }
        }
        if (!refresh && order.size - 1 - order.indexOf(player.currentMediaItemIndex) > RADIO_PREFETCH_AT) return
        val seed = player.currentMediaItem?.mediaId ?: return
        if (!refresh && (seed == radioSeed || radioRequest?.isActive == true)) return
        if (!container.recommendationsEnabled.value) return
        radioRequest?.cancel()
        radioSeed = seed
        val state = container.radio.state.value
        val notes = state.notes
        val retained = if (refresh) RadioPolicy.retained(order, player.currentMediaItemIndex) { index ->
            queued[index] in notes && PlaySources.of(queued[index]) != "queue"
        } else queued.indices.toSet()
        val excluded = RadioPolicy.exclusions(order, player.currentMediaItemIndex, retained).map { queued[it] }
        radioRequest = container.scope.launch(Dispatchers.Main) {
            val batch = runCatching { withNetworkRetries { container.radio(RadioRequest(seed, excluded, focus = state.focus)) } }.getOrNull()
                ?: run { radioSeed = null; return@launch }
            val fresh = batch.tracks.map { it.track }.filter { it.id !in excluded }
            if (fresh.isEmpty()) return@launch

            fresh.forEach { container.tracks[it.id] = it }
            withContext(Dispatchers.Main) {
                if (container.radio.state.value.generation != state.generation ||
                    !container.radio.autoplay.value || player.repeatMode != Player.REPEAT_MODE_OFF) return@withContext
                if (idsOf(player) != queued || player.currentMediaItem?.mediaId != seed || player.shuffleModeEnabled != shuffled) {
                    radioSeed = null
                    radioRefresh?.cancel()
                    radioRefresh = container.scope.launch(Dispatchers.Main) {
                        delay(350)
                        continueWithRadio(container, player, refresh = true)
                    }
                    return@withContext
                }
                if (refresh) {
                    queued.indices.reversed().filter { it !in retained }.forEach { player.removeMediaItem(it) }
                }
                container.radio.extend(batch)
                player.addMediaItems(fresh.map { resolve(container, it.toMediaItem(container.media)) })
            }
        }
    }

    private fun shapeSound(audioSessionId: Int, state: EqualizerState) {
        if (audioSessionId == C.AUDIO_SESSION_ID_UNSET) return
        if (!state.enabled) {
            equalizer?.enabled = false
            return
        }

        val effect = equalizer ?: runCatching {
            val config = DynamicsProcessing.Config.Builder(
                DynamicsProcessing.VARIANT_FAVOR_FREQUENCY_RESOLUTION,
                2, true, EqualizerState.BANDS_HZ.size, false, 0, false, 0, false,
            ).setPreferredFrameDuration(40f).build()
            DynamicsProcessing(0, audioSessionId, config)
        }.onFailure { Log.w("Equalizer", "Cannot attach dynamics processing", it) }
            .getOrNull()?.also { equalizer = it } ?: return

        runCatching {
            effect.setInputGainAllChannelsTo(state.effectivePreampDb.toFloat())
            EqualizerState.BANDS_HZ.forEachIndexed { index, hz ->
                // DynamicsProcessing expects the upper edge of each band, not its centre.
                val upper = EqualizerState.BANDS_HZ.getOrNull(index + 1)
                    ?.let { sqrt(hz.toDouble() * it).toFloat() } ?: 24_000f
                effect.setPreEqBandAllChannelsTo(index, DynamicsProcessing.EqBand(true, upper, state.gains[index].toFloat()))
            }
            effect.enabled = true
        }.onFailure {
            runCatching { effect.enabled = false }
            Log.w("Equalizer", "Cannot update dynamics processing", it)
        }
    }

    private fun showButtons(container: AppContainer) {
        val session = session ?: return
        val player = session.player
        val strings = Appearance.localized(this)
        val track = player.currentMediaItem?.mediaId?.let { container.tracks[it] }
        val liked = track != null && container.favorites.isFavorite(track)
        val repeat = player.repeatMode
        session.setMediaButtonPreferences(
            listOf(
                CommandButton.Builder(if (liked) CommandButton.ICON_HEART_FILLED else CommandButton.ICON_HEART_UNFILLED)
                    .setDisplayName(strings.getString(if (liked) R.string.menu_unlike else R.string.menu_like))
                    .setSessionCommand(SessionCommand(LibraryTree.FAVORITE, Bundle.EMPTY))
                    .setSlots(CommandButton.SLOT_OVERFLOW)
                    .build(),
                CommandButton.Builder(if (player.shuffleModeEnabled) CommandButton.ICON_SHUFFLE_ON else CommandButton.ICON_SHUFFLE_OFF)
                    .setDisplayName(strings.getString(R.string.player_shuffle))
                    .setSessionCommand(SessionCommand(LibraryTree.SHUFFLE, Bundle.EMPTY))
                    .setSlots(CommandButton.SLOT_OVERFLOW)
                    .build(),
                CommandButton.Builder(
                    when (repeat) {
                        Player.REPEAT_MODE_ONE -> CommandButton.ICON_REPEAT_ONE
                        Player.REPEAT_MODE_ALL -> CommandButton.ICON_REPEAT_ALL
                        else -> CommandButton.ICON_REPEAT_OFF
                    },
                )
                    .setDisplayName(strings.getString(R.string.player_repeat))
                    .setSessionCommand(SessionCommand(LibraryTree.REPEAT, Bundle.EMPTY))
                    .setSlots(CommandButton.SLOT_OVERFLOW)
                    .build(),
            ),
        )
    }

    private fun listen(player: Player) {
        val item = player.currentMediaItem ?: return
        if (item.mediaId == listening) return
        listening = item.mediaId
        signals.begin(item.mediaId, secondsOf(item))
        signals.tracker.reposition(player.currentPosition / 1000.0)
    }

    private fun save(container: AppContainer, player: Player) {
        val ids = idsOf(player)
        val tracks = ids.mapNotNull { container.tracks[it] }
        val saved = SavedQueue(tracks, player.currentMediaItemIndex, player.currentPosition).takeIf { ids.isNotEmpty() && tracks.size == ids.size }
        container.scope.launch(saving) {
            if (saved == null) container.queue.delete() else container.queue.writeText(container.json.encodeToString(SavedQueue.serializer(), saved))
        }
    }

    private fun report(container: AppContainer, player: Player) {
        if (container.connect.isRemote) return
        val ids = idsOf(player)
        if (ids.isEmpty()) return
        val current = player.currentMediaItemIndex.coerceIn(0, ids.size - 1)
        val from = (current - 100).coerceAtLeast(0)

        val report = PlaybackStateReport(
            deviceId = container.deviceId,
            deviceName = container.deviceName,
            trackIds = ids.subList(from, (current + 401).coerceAtMost(ids.size)),
            index = current - from,
            positionSeconds = player.currentPosition / 1000.0,
            isPlaying = player.playWhenReady,
            shuffle = player.shuffleModeEnabled,
            repeat = when (player.repeatMode) {
                Player.REPEAT_MODE_ALL -> "all"
                Player.REPEAT_MODE_ONE -> "one"
                else -> "off"
            },
        )
        container.scope.launch { runCatching { container.api.reportPlayback(report) } }
    }

    private fun idsOf(player: Player) = (0 until player.mediaItemCount).map { player.getMediaItemAt(it).mediaId }

    private fun connectState(container: AppContainer, player: Player): ConnectState {
        val ids = idsOf(player)
        val order = buildList {
            var index = player.currentTimeline.getFirstWindowIndex(player.shuffleModeEnabled)
            while (index != C.INDEX_UNSET) {
                add(index)
                index = player.currentTimeline.getNextWindowIndex(index, Player.REPEAT_MODE_OFF, player.shuffleModeEnabled)
            }
        }
        val radio = container.radio.state.value
        val sleep = when (val timer = container.sleepTimer.state.value) {
            is SleepTimerState.Minutes -> ConnectSleep("minutes", timer.minutes, System.currentTimeMillis() + timer.remainingMs)
            SleepTimerState.TrackEnd -> ConnectSleep("trackEnd")
            null -> null
        }
        return ConnectState(
            trackIds = ids, index = player.currentMediaItemIndex.coerceAtLeast(0), order = order,
            positionSeconds = (player.currentPosition / 1000.0).coerceAtLeast(0.0),
            isPlaying = player.playWhenReady, buffering = player.playbackState == Player.STATE_BUFFERING,
            volume = container.player.localVolume.toDouble(), muted = container.player.localMuted,
            shuffle = player.shuffleModeEnabled, repeat = repeatOf(player.repeatMode),
            radio = if (radio.active) ConnectRadio(radio.seedTrackId, radio.focus, radio.notes.mapValues { it.value.reason }) else null,
            smartTransitions = container.playbackPrefs.smartTransitions.value,
            normalizeVolume = container.playbackPrefs.normalizeVolume.value, autoplay = container.radio.autoplay.value,
            sleepTimer = sleep,
        )
    }

    private suspend fun executeConnect(container: AppContainer, player: ExoPlayer, command: ConnectCommand) {
        fun checkIndex(index: Int, id: String) {
            check(index in 0 until player.mediaItemCount && player.getMediaItemAt(index).mediaId == id) { "Playback queue changed" }
        }
        fun item(track: Track): MediaItem {
            container.tracks[track.id] = track
            return resolve(container, track.toMediaItem(container.media))
        }
        when (command) {
            is ConnectCommand.SetPlaying -> {
                check(!command.playing || player.mediaItemCount > 0) { "Playback queue is empty" }
                if (command.playing && player.playbackState == Player.STATE_IDLE) player.prepare()
                player.playWhenReady = command.playing
            }
            ConnectCommand.Next -> player.seekToNext()
            ConnectCommand.Previous -> player.seekToPrevious()
            is ConnectCommand.Seek -> player.seekTo((command.positionSeconds * 1000).toLong())
            is ConnectCommand.SetVolume -> container.player.executeLocal { container.player.setVolume(command.volume.toFloat()) }
            is ConnectCommand.SetMuted -> container.player.executeLocal { container.player.setMuted(command.muted) }
            is ConnectCommand.SetShuffle -> player.shuffleModeEnabled = command.shuffle
            is ConnectCommand.SetRepeat -> player.repeatMode = repeatModeOf(command.repeat)
            is ConnectCommand.Play -> {
                val tracks = container.connect.lookup(command.trackIds)
                container.radio.reset()
                PlaySources.tag(command.trackIds, command.source)
                player.shuffleModeEnabled = command.shuffle
                player.repeatMode = repeatModeOf(command.repeat)
                player.setMediaItems(tracks.map(::item), command.index, (command.positionSeconds * 1000).toLong())
                command.order?.let { player.setShuffleOrder(DefaultShuffleOrder(it.toIntArray(), 0L)) }
                command.radio?.let { radio ->
                    container.radio.restore(RadioState(seedTrackId = radio.seedTrackId,
                        notes = radio.reasons.mapValues { RadioNote(it.value, false) }, active = true, focus = radio.focus))
                    PlaySources.tag(radio.reasons.keys.toList(), PlaySources.radio(seeded = radio.seedTrackId != null))
                }
                player.prepare()
                playbackLease = true
                exclusive.hold()
                player.playWhenReady = command.playing
            }
            is ConnectCommand.Enqueue -> {
                val track = container.connect.lookup(listOf(command.trackId)).single()
                PlaySources.tag(listOf(track.id), "queue")
                container.signals.choice("trackAddedToQueue", track.id, track.durationSeconds)
                val at = if (command.next) (player.currentMediaItemIndex + 1).coerceAtLeast(0) else player.mediaItemCount
                player.addMediaItem(at, item(track))
            }
            is ConnectCommand.Remove -> { checkIndex(command.index, command.trackId); player.removeMediaItem(command.index) }
            is ConnectCommand.Jump -> { checkIndex(command.index, command.trackId); player.seekTo(command.index, 0); player.play() }
            is ConnectCommand.Move -> {
                checkIndex(command.from, command.trackId)
                check(command.to in 0 until player.mediaItemCount)
                player.moveMediaItem(command.from, command.to)
            }
            ConnectCommand.Clear -> { container.radio.reset(); player.pause(); player.stop(); player.clearMediaItems() }
            ConnectCommand.ClearUpcoming -> {
                val upcoming = mutableListOf<Int>()
                var index = player.currentTimeline.getNextWindowIndex(player.currentMediaItemIndex, Player.REPEAT_MODE_OFF, player.shuffleModeEnabled)
                while (index != C.INDEX_UNSET) {
                    upcoming.add(index)
                    index = player.currentTimeline.getNextWindowIndex(index, Player.REPEAT_MODE_OFF, player.shuffleModeEnabled)
                }
                upcoming.sortedDescending().forEach { player.removeMediaItem(it) }
            }
            is ConnectCommand.StartRadio -> {
                val seed = command.seedTrackId?.let { container.connect.lookup(listOf(it)).single() }
                val batch = container.radio(RadioRequest(command.seedTrackId, emptyList()))
                val tracks = listOfNotNull(seed) + batch.tracks.map { it.track }.filter { it.id != seed?.id }
                check(tracks.isNotEmpty()) { "The radio is empty" }
                container.radio.start(command.seedTrackId, batch)
                player.setMediaItems(tracks.map(::item), 0, 0)
                player.prepare()
                player.play()
            }
            is ConnectCommand.SetRadioFocus -> {
                container.radio.restore(container.radio.state.value.copy(focus = command.focus))
                continueWithRadio(container, player, refresh = true)
            }
            is ConnectCommand.SetCrossfade -> check(command.seconds == 0.0) { "Crossfade is not supported by this device" }
            is ConnectCommand.SetSmartTransitions -> container.playbackPrefs.setSmartTransitions(command.enabled)
            is ConnectCommand.SetNormalizeVolume -> container.playbackPrefs.setNormalizeVolume(command.enabled)
            is ConnectCommand.SetAutoplay -> container.radio.setAutoplay(command.enabled)
            is ConnectCommand.SetSleepTimer -> when {
                command.trackEnd -> container.sleepTimer.untilTrackEnd()
                command.minutes != null -> container.sleepTimer.set(command.minutes)
                else -> container.sleepTimer.cancel()
            }
        }
    }

    private fun statusOf(error: Throwable?) = (error as? HttpDataSource.InvalidResponseCodeException)?.responseCode

    private fun secondsOf(item: MediaItem) = ((item.mediaMetadata.durationMs ?: 0L) / 1000).toInt()

    private fun original(container: AppContainer, trackId: String) =
        container.server.resolve("api/tracks/$trackId/stream").toString().toUri()

    companion object {

        private const val ORIGINAL = "Original"
        private const val NORMAL = "Normal"
        private const val TICK_MS = 1_000L
        private const val REPORT_EVERY_TICKS = 10
        private const val WIDGET_EVERY_TICKS = 15
        private const val RADIO_PREFETCH_AT = 2
        private const val NETWORK_RETRIES = 10
        private const val MAX_SKIPS = 3
        private const val UNAUTHORIZED = 401
        private const val MIN_TRIM_SECONDS = 0.3
        private const val SLEEP_FADE_TICK_MS = 200L
    }
}
