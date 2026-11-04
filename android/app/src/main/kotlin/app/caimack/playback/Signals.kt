// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

package app.caimack.playback

import app.caimack.api.CaimackApi
import app.caimack.api.HistoryEntryRequest
import app.caimack.api.PlaybackSignal
import app.caimack.api.SignalBatch
import java.time.Instant
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock

class Signals(private val api: CaimackApi, private val scope: CoroutineScope, private val sessionId: String) {
    private val outbox = mutableListOf<PlaybackSignal>()
    private val sending = Mutex()
    private var timer: Job? = null
    private var recorded: String? = null
    private val changes = MutableSharedFlow<PlaybackSignal>(extraBufferCapacity = 64)
    val reactions = changes.asSharedFlow()

    val tracker = ListeningTracker { event ->
        add(
            PlaybackSignal(
                event.type, event.trackId, event.durationSeconds, event.positionSeconds, event.listenedSeconds,
                Instant.now().toString(), sessionId, event.source,
            ),
        )
    }

    fun add(signal: PlaybackSignal) {
        synchronized(outbox) { outbox += signal }
        changes.tryEmit(signal)
        timer = timer ?: scope.launch {
            delay(FLUSH_INTERVAL_MS)
            timer = null
            flush()
        }
    }

    fun choice(type: String, trackId: String, duration: Int) {
        add(PlaybackSignal(type, trackId, duration, occurredAt = Instant.now().toString(), sessionId = sessionId, source = PlaySources.of(trackId)))
    }

    fun progress(trackId: String, durationSeconds: Int, positionSeconds: Double) {
        tracker.accumulate(positionSeconds)
        if (recorded == trackId || positionSeconds < ListeningTracker.historyThreshold(durationSeconds)) return

        recorded = trackId
        scope.launch { runCatching { api.recordPlay(HistoryEntryRequest(trackId, positionSeconds.toInt())) } }
    }

    fun begin(trackId: String, durationSeconds: Int) {
        if (recorded != trackId) recorded = null
        tracker.begin(trackId, durationSeconds)
    }

    fun flush() {
        scope.launch { send() }
    }

    suspend fun send() {
        sending.withLock {
            val batch = synchronized(outbox) { outbox.toList().also { outbox.clear() } }
            if (batch.isEmpty()) return@withLock
            runCatching { api.signals(SignalBatch(batch)) }
                .onFailure { synchronized(outbox) { outbox.addAll(0, batch) } }
        }
    }

    private companion object {
        const val FLUSH_INTERVAL_MS = 10_000L
    }
}
