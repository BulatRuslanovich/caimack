// SPDX-License-Identifier: AGPL-3.0-only

package app.caimack.playback

import android.content.Context
import androidx.annotation.OptIn
import androidx.media3.common.C
import androidx.media3.common.MediaItem
import androidx.media3.common.Player
import androidx.media3.common.Timeline
import androidx.media3.common.util.UnstableApi
import androidx.media3.exoplayer.DefaultLoadControl
import androidx.media3.exoplayer.LoadControl
import androidx.media3.exoplayer.source.preload.DefaultPreloadManager
import androidx.media3.exoplayer.source.preload.PreloadException
import androidx.media3.exoplayer.source.preload.PreloadManagerListener
import androidx.media3.exoplayer.upstream.DefaultAllocator
import androidx.media3.exoplayer.upstream.DefaultLoadErrorHandlingPolicy
import androidx.media3.exoplayer.upstream.LoadErrorHandlingPolicy
import java.io.InterruptedIOException
import okhttp3.Dispatcher
import okhttp3.OkHttpClient

@OptIn(UnstableApi::class)
internal class NextTrackPreload(
    context: Context,
    private val streams: StreamCache,
    private val http: OkHttpClient,
    private val isRemote: () -> Boolean,
) : AutoCloseable {
    private data class Target(val current: Any, val next: Any, val item: MediaItem)

    private class Transfer(http: OkHttpClient) {
        @Volatile var isCancelled = false
            private set
        private val dispatcher = Dispatcher()
        val client = http.newBuilder().dispatcher(dispatcher).addInterceptor { chain ->
            if (isCancelled) throw InterruptedIOException()
            chain.proceed(chain.request())
        }.build()

        fun cancel() {
            isCancelled = true
            dispatcher.cancelAll()
        }
    }

    private val managerDelegate = lazy {
        DefaultPreloadManager.Builder(context) {
            DefaultPreloadManager.PreloadStatus.specifiedRangeLoaded(PRELOAD_MS)
        }.build().apply {
            addListener(object : PreloadManagerListener {
                override fun onCompleted(mediaItem: MediaItem) = finish(mediaItem)
                override fun onError(exception: PreloadException) = finish(exception.mediaItem)
            })
        }
    }
    private val manager by managerDelegate
    private val errors = object : DefaultLoadErrorHandlingPolicy(0) {
        override fun getRetryDelayMsFor(info: LoadErrorHandlingPolicy.LoadErrorInfo): Long = C.TIME_UNSET
    }
    private val window = Timeline.Window()
    private var target: Target? = null
    private var finished: Target? = null
    private var closed = false
    @Volatile private var quietWindow: Any? = null
    @Volatile private var transfer: Transfer? = null

    fun loadControl(): LoadControl = object : DefaultLoadControl(
        DefaultAllocator(true, C.DEFAULT_BUFFER_SEGMENT_SIZE),
        60_000, 60_000, 180_000, 180_000, 1_500, 1_500, 5_000, 5_000,
        C.LENGTH_UNSET, true, true, DefaultLoadControl.DEFAULT_BACK_BUFFER_DURATION_MS,
        DefaultLoadControl.DEFAULT_RETAIN_BACK_BUFFER_FROM_KEYFRAME,
    ) {
        private val period = Timeline.Period()
        private val loadingWindow = Timeline.Window()
        private var yielded: Any? = null

        override fun shouldContinueLoading(parameters: LoadControl.Parameters): Boolean {
            val reserved = quietWindow
            if (reserved != null) {
                val timeline = parameters.timeline
                val index = timeline.getIndexOfPeriod(parameters.mediaPeriodId.periodUid)
                if (index != C.INDEX_UNSET && timeline.getWindow(timeline.getPeriod(index, period).windowIndex, loadingWindow).uid == reserved) {
                    // Let playback build a reserve first, then give one preload a chance before
                    // filling the rest of the normal buffer. Refill has priority below the floor.
                    val threshold = if (yielded == reserved) MIN_BUFFER_MS else YIELD_BUFFER_MS
                    if (parameters.bufferedDurationUs >= threshold * 1_000) {
                        yielded = reserved
                        return false
                    }
                }
            }
            yielded = null
            if (!super.shouldContinueLoading(parameters)) return false
            transfer?.cancel()
            return true
        }
    }

    fun update(player: Player) {
        if (closed) return
        val next = nextTrack(player)
        if (next != target) {
            stop()
            target = next
            finished = null
        }
        val eligible = player.isPlaying && !isRemote() && next != finished
        quietWindow = if (eligible) next?.current else null
        if (!eligible || next == null || player.isLoading ||
            player.bufferedPosition - player.currentPosition < MIN_BUFFER_MS) {
            stopTransfer()
            return
        }
        if (transfer != null) return
        val request = Transfer(http)
        transfer = request
        manager.add(streams.preloadSource(next.item, request.client, errors), 0)
        manager.invalidate()
    }

    private fun nextTrack(player: Player): Target? {
        val timeline = player.currentTimeline
        if (timeline.isEmpty) return null
        val current = player.currentMediaItemIndex
        val next = timeline.getNextWindowIndex(current, player.repeatMode, player.shuffleModeEnabled)
        if (next == C.INDEX_UNSET || next == current) return null
        val item = player.getMediaItemAt(next)
        if (!streams.canPreload(item)) return null
        return Target(timeline.getWindow(current, window).uid, timeline.getWindow(next, window).uid, item)
    }

    private fun finish(item: MediaItem) {
        val current = target?.takeIf { it.item == item } ?: return
        // A foreground load can cancel the HTTP call before the player event reaches us.
        if (transfer?.isCancelled == false) {
            finished = current
            quietWindow = null
        }
        stopTransfer()
    }

    fun stop() {
        quietWindow = null
        stopTransfer()
        target = null
    }

    private fun stopTransfer() {
        val request = transfer ?: return
        transfer = null
        request.cancel()
        target?.let { manager.remove(it.item) }
    }

    override fun close() {
        closed = true
        stop()
        if (managerDelegate.isInitialized()) manager.release()
    }

    private companion object {
        const val PRELOAD_MS = 12_000L
        const val YIELD_BUFFER_MS = 30_000L
        const val MIN_BUFFER_MS = 20_000L
    }
}
