// SPDX-License-Identifier: AGPL-3.0-only

package app.caimack.playback

import android.content.ComponentName
import android.os.SystemClock
import android.util.Log
import androidx.annotation.OptIn
import androidx.core.net.toUri
import androidx.media3.common.C
import androidx.media3.common.MediaItem
import androidx.media3.common.MimeTypes
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.common.util.UnstableApi
import androidx.media3.datasource.okhttp.OkHttpDataSource
import androidx.media3.exoplayer.DefaultLoadControl
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.analytics.AnalyticsListener
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory
import androidx.media3.exoplayer.source.ShuffleOrder.DefaultShuffleOrder
import androidx.media3.exoplayer.upstream.DefaultLoadErrorHandlingPolicy
import androidx.media3.session.MediaController
import androidx.media3.session.SessionToken
import androidx.test.platform.app.InstrumentationRegistry
import app.caimack.CaimackApp
import app.caimack.api.Track
import app.caimack.sync.PlaybackSync
import java.io.File
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicLong
import kotlinx.coroutines.runBlocking
import okhttp3.Call
import okhttp3.EventListener
import okhttp3.OkHttpClient
import mockwebserver3.Dispatcher
import mockwebserver3.MockResponse
import mockwebserver3.MockWebServer
import mockwebserver3.RecordedRequest
import mockwebserver3.SocketEffect
import okio.Buffer
import org.junit.Assert.*
import org.junit.Test

@OptIn(UnstableApi::class)
class StreamResilienceDeviceTest {
    private val instrumentation = InstrumentationRegistry.getInstrumentation()
    private val context = instrumentation.targetContext
    private val cancelled = CopyOnWriteArrayList<String>()
    private val http = OkHttpClient.Builder().eventListener(object : EventListener() {
        override fun canceled(call: Call) {
            cancelled += call.request().url.encodedPath
        }
    }).build()
    private val errors = DefaultLoadErrorHandlingPolicy(10)

    @Test fun slowNetworkAndEightSecondOutagesWithAndWithoutCaching() {
        val original = wav(180)
        val songs = listOf("current", "unchosen", "next")
        MockWebServer().use { web ->
            val fixture = Fixture(web) { request ->
                if (request.url.pathSegments.getOrNull(2) in songs) audio(request, original, "audio/wav", slow = true)
                else MockResponse.Builder().code(404).build()
            }
            val baseline = measure(fixture, songs, null)
            withCache(fixture) { cache ->
                val cached = measure(fixture, songs, cache)
                Log.i(TAG, "uncached=$baseline cached=$cached")
                assertTrue("First playback should be comparable: $baseline vs $cached", cached.coldMs < baseline.coldMs + 1_500)
                assertTrue("The disk cache should survive a player restart", cached.reopenMs < baseline.reopenMs / 2)
                assertTrue("The prefetched track should start during the outage", cached.transitionMs < baseline.transitionMs / 2)
                assertTrue("Shorter playback interruptions expected", cached.stalls < baseline.stalls)
            }
        }
    }

    @Test fun hlsUsesCachedByteRangesOnSeekAndScopesThemByAccountServerAndQuality() {
        val segment = instrumentation.context.assets.open("sync/tone.mp3").use { it.readBytes() }
        val original = wav(210)
        val address = "/api/tracks/hls/hls"
        val playlist = buildString {
            appendLine("#EXTM3U")
            appendLine("#EXT-X-VERSION:4")
            appendLine("#EXT-X-TARGETDURATION:2")
            appendLine("#EXT-X-PLAYLIST-TYPE:VOD")
            repeat(8) {
                appendLine("#EXTINF:2,")
                appendLine("#EXT-X-BYTERANGE:${segment.size}@${it * segment.size}")
                appendLine("media.mp3")
            }
            appendLine("#EXT-X-ENDLIST")
        }
        fun reply(request: RecordedRequest): MockResponse = when (request.url.encodedPath) {
            "/api/tracks/current/stream" -> audio(request, original, "audio/wav")
            "$address/master.m3u8" -> MockResponse.Builder().body(
                "#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=64000,CODECS=\"mp4a.40.34\"\nindex.m3u8\n",
            ).build()
            "$address/index.m3u8" -> MockResponse.Builder().body(playlist).build()
            "$address/media.mp3" -> audio(request, segment.repeat(8), "audio/mpeg")
            else -> MockResponse.Builder().code(404).build()
        }

        MockWebServer().use { web ->
            val fixture = Fixture(web, ::reply)
            fun hls(cache: StreamCache, quality: String, server: Fixture): MediaItem {
                val uri = server.web.url("$address/master.m3u8?maxQuality=$quality").toString().toUri()
                return cache.online(MediaItem.Builder().setMediaId("hls").build(), uri, MimeTypes.APPLICATION_M3U8)
            }
            withCache(fixture) { cache ->
                withPlayer(cache) { run ->
                    run.start(listOf(item("current", fixture, cache), hls(cache, "Normal", fixture)))
                    run.awaitAudio()
                    val firstRange = "bytes=0-${segment.lastIndex}"
                    await {
                        fixture.requests.any { it.headers["Range"] == firstRange } && onMain { run.player.isLoading }
                    }
                    fixture.offline = true
                    try {
                        onMain { run.player.seekToNextMediaItem() }
                        await(5_000) { onMain { run.player.currentMediaItem?.mediaId == "hls" && run.player.isPlaying } }
                        assertEquals(1, fixture.requests.count { it.headers["Range"] == firstRange })
                    } finally {
                        fixture.offline = false
                    }
                }
            }
            fixture.requests.clear()
            withCache(fixture) { cache ->
                fun play(quality: String, server: Fixture = fixture) {
                    withPlayer(cache) { run ->
                        run.start(listOf(hls(cache, quality, server)), position = 7_500)
                        run.awaitAudio()
                        assertTrue(onMain { run.player.currentPosition } >= 7_500)
                        onMain { run.player.seekTo(1_000) }
                        await { onMain { run.player.isPlaying && run.player.currentPosition in 1_001..3_000 } }
                        await { onMain { run.player.bufferedPosition >= 15_900 } }
                    }
                }
                play("Normal")
                val ranges = fixture.requests.filter { it.url.encodedPath.endsWith("media.mp3") }.mapNotNull { it.headers["Range"] }
                assertTrue(ranges.any { it.startsWith("bytes=${segment.size * 3}-") })
                assertTrue(ranges.any { it.startsWith("bytes=0-") })
                val initial = fixture.requests.size
                fixture.offline = true
                play("Normal")
                assertEquals(initial, fixture.requests.size)

                fixture.offline = false
                play("Low")
                val low = fixture.requests.size
                assertTrue(low > initial)
                fixture.owner = fixture.owner.copy(userId = "another-user")
                play("Normal")
                assertTrue(fixture.requests.size > low)

                MockWebServer().use { otherWeb ->
                    val other = Fixture(otherWeb, ::reply)
                    fixture.owner = other.owner.copy(userId = "another-user")
                    play("Normal", other)
                    assertTrue(other.requests.isNotEmpty())
                }
            }
        }
    }

    @Test fun unavailableCacheLeavesOnlinePlaybackWorking() {
        MockWebServer().use { web ->
            val sample = wav(3)
            val fixture = Fixture(web) { audio(it, sample, "audio/wav") }
            val directory = File.createTempFile("stream-cache-blocked-", ".tmp", context.cacheDir)
            try {
                StreamCache(context, http, { fixture.owner }, directory).use { cache ->
                    withPlayer(cache) { run ->
                        run.start(listOf(item("live", fixture, cache)))
                        run.awaitAudio()
                    }
                }
                assertTrue(fixture.requests.isNotEmpty())
            } finally {
                directory.delete()
            }
        }
    }

    @Test fun diskCacheReopensAndEvictsTheLeastRecentlyPlayedTrack() {
        MockWebServer().use { web ->
            val sample = wav(2)
            val fixture = Fixture(web) { audio(it, sample, "audio/wav") }
            val directory = File(context.cacheDir, "stream-lru-${SystemClock.elapsedRealtimeNanos()}")
            fun open() = StreamCache(context, http, { fixture.owner }, directory, capacityBytes = 70 * 1024L)
            fun play(cache: StreamCache, name: String) = withPlayer(cache) { run ->
                run.start(listOf(item(name, fixture, cache)))
                run.awaitAudio()
            }
            try {
                open().use { cache ->
                    play(cache, "a")
                    play(cache, "b")
                }
                fixture.requests.clear()
                open().use { cache ->
                    play(cache, "a")
                    assertTrue("Reopening the disk cache should keep the track", fixture.requests.isEmpty())
                    play(cache, "c")
                    play(cache, "a")
                    play(cache, "b")
                    assertEquals(listOf("/api/tracks/c/stream", "/api/tracks/b/stream"),
                        fixture.requests.map { it.url.encodedPath })
                }
            } finally {
                directory.deleteRecursively()
            }
        }
    }

    @Test fun serviceFallsBackFromPreparingHlsAndResumesAfterTheActiveStreamIsCut() {
        val container = (context.applicationContext as CaimackApp).container
        check(context.packageName.endsWith(".uitest"))
        val oldHttp = container.connectionPreferences.allowLocalHttp.value
        val track = Track("stream-resilience", "Network fixture", "artist", "Artist", durationSeconds = 180)
        val sample = wav(180)
        val interrupted = AtomicBoolean(false)
        val outageStart = AtomicLong(0)
        MockWebServer().use { web ->
            val fixture = Fixture(web) { request ->
                when (request.url.encodedPath) {
                    "/api/auth/login", "/api/auth/me" -> MockResponse.Builder()
                        .body("""{"id":"network-fixture","username":"network-fixture"}""").build()
                    "/api/me/settings" -> MockResponse.Builder().body("""{"quality":"Normal"}""").build()
                    "/api/tracks/${track.id}/hls/master.m3u8" -> MockResponse.Builder().code(202).build()
                    "/api/tracks/${track.id}/stream" -> {
                        if (!interrupted.getAndSet(true)) {
                            MockResponse.Builder()
                                .body(Buffer().write(sample, 0, 64_044))
                                .setHeader("Content-Length", sample.size)
                                .addHeader("Content-Type", "audio/wav")
                                .addHeader("Accept-Ranges", "bytes")
                                .headersDelay(250, TimeUnit.MILLISECONDS)
                                .throttleBody(8_192, 125, TimeUnit.MILLISECONDS)
                                .onResponseEnd(SocketEffect.CloseSocket())
                                .build()
                        } else {
                            val now = SystemClock.elapsedRealtime()
                            outageStart.compareAndSet(0, now)
                            if (now - outageStart.get() < 8_000) MockResponse.Builder()
                                .onResponseStart(SocketEffect.CloseSocket()).build()
                            else audio(request, sample, "audio/wav", slow = true)
                        }
                    }
                    else -> MockResponse.Builder().code(404).build()
                }
            }
            container.connectionPreferences.setAllowLocalHttp(true)
            val connection = onMain {
                MediaController.Builder(context, SessionToken(context, ComponentName(context, PlaybackService::class.java))).buildAsync()
            }
            try {
                runBlocking { check(container.session.login(web.url("/").toString(), "network-fixture", "fixture") == null) }
                val controller = connection.get(10, TimeUnit.SECONDS)
                onMain {
                    container.settings.value = container.settings.value.copy(quality = "Normal")
                    controller.setMediaItem(track.toMediaItem(container.media))
                    controller.prepare()
                    controller.play()
                }
                await { onMain { controller.currentMediaItem?.mediaId == track.id && controller.isPlaying } }
                val audioPaths = fixture.requests.map { it.url.encodedPath }.filter { it.startsWith("/api/tracks/${track.id}/") }
                assertTrue(audioPaths.first().endsWith("master.m3u8"))
                assertTrue(audioPaths.any { it.endsWith("/stream") })
                await {
                    onMain { controller.playbackState == Player.STATE_BUFFERING && controller.currentPosition > 1_500 }
                }
                val interruptedAt = onMain { controller.currentPosition }
                await { onMain { controller.isPlaying && controller.currentPosition in interruptedAt..interruptedAt + 1_000 } }
                assertTrue(fixture.requests.any { it.url.encodedPath.endsWith("/stream") && it.headers["Range"] != null })
                onMain {
                    controller.pause()
                    controller.clearMediaItems()
                }
            } finally {
                onMain { MediaController.releaseFuture(connection) }
                runBlocking { container.session.logout() }
                container.connectionPreferences.setAllowLocalHttp(oldHttp)
            }
        }
    }

    @Test fun cancelsTheUpcomingLoadOnPauseQueueChangeAndRemotePlayback() {
        MockWebServer().use { web ->
            val sample = wav(180)
            val fixture = Fixture(web) { request ->
                if (request.url.encodedPath.endsWith("/current/stream")) audio(request, sample, "audio/wav")
                else MockResponse.Builder().headersDelay(20, TimeUnit.SECONDS).body(Buffer().write(sample)).build()
            }
            val remote = AtomicBoolean(false)
            withCache(fixture) { cache ->
                withPlayer(cache, remote::get) { run ->
                    val items = listOf("current", "next", "replacement").map { item(it, fixture, cache) }
                    val next = "/api/tracks/next/stream"
                    val replacement = "/api/tracks/replacement/stream"

                    run.start(items)
                    run.awaitAudio()
                    await { fixture.requests.count { it.url.encodedPath == next } == 1 }
                    onMain { run.player.pause() }
                    await { cancelled.count { it == next } == 1 }
                    onMain { run.player.play() }
                    await { fixture.requests.count { it.url.encodedPath == next } == 2 }
                    onMain { run.player.removeMediaItem(1) }
                    await { cancelled.count { it == next } == 2 }
                    await { fixture.requests.any { it.url.encodedPath == replacement } }
                    remote.set(true)
                    onMain { run.updatePreload() }
                    await { cancelled.contains(replacement) }
                }
            }
        }
    }

    private fun measure(fixture: Fixture, songs: List<String>, cache: StreamCache?): Measurements {
        fixture.requests.clear()
        val items = songs.map { item(it, fixture, cache) }
        var cold = 0L
        var transition = 0L
        var stalls = 0
        withPlayer(cache) { run ->
            val start = SystemClock.elapsedRealtime()
            run.start(items, shuffle = true)
            cold = run.awaitAudio() - start
            await { onMain { run.player.bufferedPosition - run.player.currentPosition >= 30_000 } }
            if (cache != null) {
                await(25_000) {
                    fixture.requests.any { it.url.encodedPath.endsWith("/next/stream") } && onMain { run.player.isLoading }
                }
                assertFalse("Only the next item in shuffle order is prefetched",
                    fixture.requests.any { it.url.encodedPath.endsWith("/unchosen/stream") })
            }
            var nextStart = 0L
            fixture.outage {
                nextStart = SystemClock.elapsedRealtime()
                onMain { run.player.seekToNextMediaItem() }
                if (cache != null) {
                    await(5_000) { onMain { run.player.currentMediaItem?.mediaId == "next" && run.player.isPlaying } }
                    transition = SystemClock.elapsedRealtime() - nextStart
                    assertEquals("Playback must not request the prefetched start again", 1, fixture.requests.count {
                        it.url.encodedPath.endsWith("/next/stream") && it.headers["Range"] == null
                    })
                }
            }
            if (cache == null) {
                await { onMain { run.player.currentMediaItem?.mediaId == "next" && run.player.isPlaying } }
                transition = SystemClock.elapsedRealtime() - nextStart
            }

            fixture.outage {
                onMain { run.player.seekTo(120_000) }
                await(2_000) { onMain { run.player.playbackState == Player.STATE_BUFFERING } }
                assertEquals(120_000, onMain { run.player.currentPosition }.toInt())
            }
            await { onMain { run.player.isPlaying && run.player.currentPosition in 120_000..122_500 } }
            stalls = run.stalls.count { it >= 1_000 }
        }
        val reopen = withPlayer(cache) { run ->
            var reopened = 0L
            var start = 0L
            fixture.outage {
                start = SystemClock.elapsedRealtime()
                run.start(items.take(1))
                if (cache != null) reopened = run.awaitAudio(5_000) - start
            }
            if (cache != null) reopened else run.awaitAudio() - start
        }
        return Measurements(cold, reopen, transition, stalls)
    }

    private fun item(id: String, fixture: Fixture, cache: StreamCache?): MediaItem {
        val uri = fixture.web.url("/api/tracks/$id/stream").toString().toUri()
        val item = MediaItem.Builder().setMediaId(id).setUri(uri).build()
        return cache?.online(item, uri, null) ?: item
    }

    private fun withCache(fixture: Fixture, test: (StreamCache) -> Unit) {
        val directory = File(context.cacheDir, "stream-test-${SystemClock.elapsedRealtimeNanos()}")
        try {
            StreamCache(context, http, { fixture.owner }, directory).use(test)
        } finally {
            directory.deleteRecursively()
        }
    }

    private fun <T> withPlayer(cache: StreamCache?, remote: () -> Boolean = { false }, test: (Run) -> T): T {
        val upstream = OkHttpDataSource.Factory(http)
        val (run, preload) = onMain {
            val loader = DefaultLoadControl.Builder().setBufferDurationsMs(60_000, 180_000, 1_500, 5_000)
                .setPrioritizeTimeOverSizeThresholds(true).build()
            val preload = cache?.let { NextTrackPreload(context, it, http, remote) }
            val player = ExoPlayer.Builder(context)
                .setLoadControl(preload?.loadControl() ?: loader)
                .setMediaSourceFactory(cache?.playbackFactory(upstream, errors)
                    ?: DefaultMediaSourceFactory(upstream).setLoadErrorHandlingPolicy(errors))
                .build()
            Run(player, preload) to preload
        }
        try {
            return test(run)
        } finally {
            onMain {
                preload?.close()
                run.player.release()
            }
        }
    }

    private inner class Run(val player: ExoPlayer, private val preload: NextTrackPreload?) {
        @Volatile private var audioTime = 0L
        @Volatile private var error: PlaybackException? = null
        private var bufferingSince = 0L
        val stalls = CopyOnWriteArrayList<Long>()

        init {
            player.addAnalyticsListener(object : AnalyticsListener {
                override fun onAudioPositionAdvancing(eventTime: AnalyticsListener.EventTime, playoutStartSystemTimeMs: Long) {
                    if (audioTime == 0L) audioTime = SystemClock.elapsedRealtime()
                }
            })
            player.addListener(object : Player.Listener {
                override fun onEvents(player: Player, events: Player.Events) {
                    updatePreload()
                }

                override fun onPlaybackStateChanged(playbackState: Int) {
                    val now = SystemClock.elapsedRealtime()
                    if (playbackState == Player.STATE_BUFFERING && audioTime != 0L) bufferingSince = now
                    if (playbackState == Player.STATE_READY && bufferingSince != 0L) {
                        stalls += now - bufferingSince
                        bufferingSince = 0
                    }
                }

                override fun onPlayerError(error: PlaybackException) {
                    this@Run.error = error
                }
            })
        }

        fun updatePreload() = preload?.update(player)

        fun start(items: List<MediaItem>, shuffle: Boolean = false, position: Long = 0) = onMain {
            player.setMediaItems(items, 0, position)
            if (shuffle) {
                player.setShuffleOrder(DefaultShuffleOrder(intArrayOf(0, 2, 1), 1))
                player.shuffleModeEnabled = true
            }
            player.prepare()
            player.play()
        }

        fun awaitAudio(timeout: Long = 18_000): Long {
            await(timeout) {
                error?.let { throw AssertionError("Playback failed", it) }
                audioTime != 0L
            }
            return audioTime
        }
    }

    private class Fixture(val web: MockWebServer, reply: (RecordedRequest) -> MockResponse) {
        @Volatile var offline = false
        val requests = CopyOnWriteArrayList<RecordedRequest>()
        @Volatile var owner: PlaybackSync.Owner

        init {
            web.dispatcher = object : Dispatcher() {
                override fun dispatch(request: RecordedRequest): MockResponse {
                    requests += request
                    return if (offline) MockResponse.Builder().onResponseStart(SocketEffect.CloseSocket()).build()
                    else reply(request)
                }
            }
            web.start()
            owner = PlaybackSync.Owner(web.url("/"), "listener")
        }

        fun outage(test: () -> Unit) {
            val until = SystemClock.elapsedRealtime() + 8_000
            offline = true
            try {
                test()
                SystemClock.sleep((until - SystemClock.elapsedRealtime()).coerceAtLeast(0L))
            } finally {
                offline = false
            }
        }
    }

    private data class Measurements(val coldMs: Long, val reopenMs: Long, val transitionMs: Long, val stalls: Int)

    private fun audio(request: RecordedRequest, bytes: ByteArray, mimeType: String, slow: Boolean = false): MockResponse {
        val range = request.headers["Range"]?.removePrefix("bytes=")?.split("-", limit = 2)
        val start = range?.get(0)?.toInt() ?: 0
        val end = range?.get(1)?.toIntOrNull() ?: bytes.lastIndex
        val response = MockResponse.Builder().addHeader("Content-Type", mimeType).addHeader("Accept-Ranges", "bytes")
        if (range != null) response.code(206).addHeader("Content-Range", "bytes $start-$end/${bytes.size}")
        if (slow) response.headersDelay(250, TimeUnit.MILLISECONDS).throttleBody(8_192, 125, TimeUnit.MILLISECONDS)
        return response.body(Buffer().write(bytes, start, end - start + 1)).build()
    }

    private fun wav(seconds: Int): ByteArray {
        val samples = 8_000 * seconds
        return ByteBuffer.allocate(44 + samples * 2).order(ByteOrder.LITTLE_ENDIAN).apply {
            put("RIFF".toByteArray()).putInt(capacity() - 8)
            put("WAVEfmt ".toByteArray()).putInt(16).putShort(1).putShort(1)
            putInt(8_000).putInt(16_000).putShort(2).putShort(16)
            put("data".toByteArray()).putInt(samples * 2)
            repeat(samples) { putShort(if (it % 20 < 10) 3000 else -3000) }
        }.array()
    }

    private fun ByteArray.repeat(count: Int) = ByteArray(size * count).also { bytes ->
        repeat(count) { copyInto(bytes, it * size) }
    }

    private fun await(timeout: Long = 18_000, condition: () -> Boolean) {
        val until = SystemClock.elapsedRealtime() + timeout
        while (!condition()) {
            assertTrue("Condition was not met within ${timeout}ms", SystemClock.elapsedRealtime() < until)
            SystemClock.sleep(25)
        }
    }

    private fun <T> onMain(block: () -> T): T {
        var result: Result<T>? = null
        instrumentation.runOnMainSync { result = runCatching(block) }
        return checkNotNull(result).getOrThrow()
    }

    private companion object {
        const val TAG = "StreamResilienceTest"
    }
}
