// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

package app.caimack.playback

import android.content.Context
import android.os.SystemClock
import android.widget.Toast
import app.caimack.AppContainer
import app.caimack.R
import app.caimack.api.*
import app.caimack.session.SessionState
import java.io.IOException
import java.time.Instant
import java.util.UUID
import java.util.concurrent.TimeUnit
import kotlinx.coroutines.*
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import okhttp3.Call
import okhttp3.Request

data class ConnectUiState(
    val devices: List<ConnectDevice> = emptyList(),
    val selectedId: String? = null,
    val selectedNameHint: String? = null,
    val connected: Boolean = false,
    val playback: ConnectState? = null,
    val pending: Boolean = false,
) {
    val available: Boolean get() = connected && (selectedId == null || devices.any { it.id == selectedId })
    val selectedName: String? get() = devices.find { it.id == selectedId }?.name ?: selectedNameHint
}

/** The UI observes the renderer, while only the renderer owns audio and listening signals. */
class ConnectPlayback(private val context: Context, private val container: AppContainer) {
    private val current = MutableStateFlow(ConnectUiState())
    val state: StateFlow<ConnectUiState> = current
    val isRemote: Boolean get() = current.value.selectedId != null
    private val client = container.http.newBuilder().readTimeout(0, TimeUnit.MILLISECONDS).build()
    private var observing: Job? = null
    private var stream: Job? = null
    private var reporting: Job? = null
    private var changed: Job? = null
    @Volatile private var call: Call? = null
    private var connectionId: String? = null
    private var account: String? = null
    private var generation = 0L
    private var selection = 0L
    private var snapshot = ConnectSnapshot()
    private var wantsLocal = false
    private var receivedAt = 0L
    private var remoteTracks = emptyList<Track>()
    private val sending = Mutex()
    private val reports = Mutex()
    private data class Outbound(val target: String, val selection: Long, val command: ConnectCommand, val revision: Long?)
    private val outbound = Channel<Outbound>(32)
    private val executed = LinkedHashSet<String>()
    private var renderer: (suspend (ConnectCommand) -> Unit)? = null
    private var rendererState: (() -> ConnectState)? = null

    init {
        container.scope.launch(Dispatchers.Main) {
            for (item in outbound) {
                if (item.selection != selection || item.target != current.value.selectedId) continue
                try { send(item.target, item.command, item.revision) }
                catch (cancelled: CancellationException) { throw cancelled }
                catch (_: Exception) {
                    failure()
                    while (outbound.tryReceive().isSuccess) { /* Discard stale queued controls. */ }
                }
            }
        }
    }

    fun start() {
        if (observing != null) return
        observing = container.scope.launch(Dispatchers.Main) {
            container.session.state.collect { session ->
                val key = (session as? SessionState.SignedIn)?.let { "${container.server.url.value}|${it.user.id}" }
                if (key == account) return@collect
                val previousAccount = account
                account = key
                generation++
                call?.cancel()
                stream?.cancel()
                reporting?.cancel()
                connectionId = null
                selection++
                snapshot = ConnectSnapshot()
                current.value = ConnectUiState()
                remoteTracks = emptyList()
                wantsLocal = false
                executed.clear()
                container.player.showLocal()
                if (previousAccount != null) {
                    container.signals.tracker.discard()
                    renderer?.invoke(ConnectCommand.Clear)
                }
                if (key == null) {
                    container.player.pauseLocal()
                    return@collect
                }
                container.player.connect()
                val epoch = generation
                stream = container.scope.launch(Dispatchers.IO) { watch(epoch) }
                reporting = container.scope.launch(Dispatchers.Main) {
                    var beats = 0
                    while (isActive && epoch == generation) {
                        try {
                            if (beats++ % 5 == 0) connectionId?.let { container.api.connectHeartbeat(ConnectHeartbeat(container.deviceId, it)) }
                            report()
                        }
                        catch (cancelled: CancellationException) { throw cancelled }
                        catch (_: Exception) { }
                        delay(2_000)
                    }
                }
            }
        }
    }

    fun attach(state: () -> ConnectState, execute: suspend (ConnectCommand) -> Unit) {
        rendererState = state
        renderer = execute
    }

    fun detach() {
        renderer = null
        rendererState = null
    }

    fun displaced() { wantsLocal = false }

    fun changed() {
        if (isRemote || account == null) return
        changed?.cancel()
        changed = container.scope.launch(Dispatchers.Main) {
            delay(50)
            try { report() }
            catch (cancelled: CancellationException) { throw cancelled }
            catch (_: Exception) { }
        }
    }

    private suspend fun watch(epoch: Long) {
        while (currentCoroutineContext().isActive && epoch == generation) {
            try {
                val url = container.server.resolve("api/playback/connect/events")?.newBuilder()
                    ?.addQueryParameter("deviceId", container.deviceId)
                    ?.addQueryParameter("deviceName", container.deviceName)
                    ?.addQueryParameter("deviceKind", "android")?.build() ?: return
                val next = client.newCall(Request.Builder().url(url).header("Accept", "text/event-stream").build())
                call = next
                if (epoch != generation) { next.cancel(); return }
                next.execute().use { response ->
                    if (!response.isSuccessful) throw IOException("Playback connection unavailable")
                    val source = response.body.source()
                    var event = ""
                    val data = StringBuilder()
                    while (currentCoroutineContext().isActive && epoch == generation) {
                        val line = source.readUtf8Line() ?: break
                        when {
                            line.isEmpty() -> {
                                if (data.isNotEmpty()) {
                                    val payload = data.toString()
                                    withContext(Dispatchers.Main) {
                                        if (epoch == generation) when (event) {
                                            "snapshot" -> accept(container.json.decodeFromString<ConnectSnapshot>(payload), transport = true)
                                            "command" -> execute(container.json.decodeFromString<ConnectEnvelope>(payload))
                                        }
                                    }
                                }
                                event = ""
                                data.clear()
                            }
                            line.startsWith("event:") -> event = line.substringAfter(':').trim()
                            line.startsWith("data:") -> {
                                if (data.isNotEmpty()) data.append('\n')
                                data.append(line.substringAfter(':').trimStart())
                                check(data.length <= 1_000_000) { "Playback event is too large" }
                            }
                        }
                    }
                }
            } catch (cancelled: CancellationException) { throw cancelled }
            catch (_: Exception) { }
            withContext(Dispatchers.Main) {
                if (epoch == generation) {
                    connectionId = null
                    current.value = current.value.copy(connected = false)
                }
            }
            delay(1_500)
        }
    }

    private suspend fun accept(next: ConnectSnapshot, transport: Boolean = false) {
        if (next.epoch == snapshot.epoch && next.version < snapshot.version) return
        snapshot = next
        connectionId = next.devices.find { it.id == container.deviceId }?.connectionId
        current.value = current.value.copy(devices = next.devices, connected = transport || current.value.connected,
            selectedNameHint = next.devices.find { it.id == current.value.selectedId }?.name ?: current.value.selectedName)
        val active = next.playback ?: return
        if (active.deviceId == container.deviceId) return
        if (!isRemote && !container.player.localState.playing && !wantsLocal) {
            current.value = current.value.copy(selectedId = active.deviceId, selectedNameHint = next.devices.find { it.id == active.deviceId }?.name)
            container.player.pauseLocal()
        }
        if (current.value.selectedId != active.deviceId) return
        val tracks = lookup(active.trackIds)
        if (snapshot.playback?.reportedAt != active.reportedAt || current.value.selectedId != active.deviceId) return
        if (current.value.playback?.reportedAt != active.reportedAt) receivedAt = SystemClock.elapsedRealtime()
        remoteTracks = tracks
        current.value = current.value.copy(playback = active)
        display()
    }

    private fun display() {
        val active = current.value.playback ?: return
        if (!isRemote) return
        val orderPosition = active.order.indexOf(active.index)
        val next = active.order.getOrNull(orderPosition + 1)
            ?: if (active.repeat == "all") active.order.firstOrNull() else null
        container.player.showRemote(PlayerState(
            queue = remoteTracks, index = active.index, playing = active.isPlaying,
            buffering = active.buffering, durationMs = (remoteTracks.getOrNull(active.index)?.durationSeconds ?: 0) * 1000L,
            shuffle = active.shuffle, repeat = repeatModeOf(active.repeat),
            previousIndex = active.order.getOrNull(orderPosition - 1) ?: -1, nextIndex = next ?: -1,
            volume = active.volume.toFloat(), muted = active.muted,
        ), ::position)
    }

    fun position(): Long {
        val active = current.value.playback ?: return 0
        val elapsed = if (current.value.available && active.isPlaying && !active.buffering)
            (SystemClock.elapsedRealtime() - receivedAt).coerceAtLeast(0) else 0
        val duration = (remoteTracks.getOrNull(active.index)?.durationSeconds ?: 0) * 1000L
        return ((active.positionSeconds * 1000).toLong() + elapsed).coerceIn(0, duration.coerceAtLeast(0))
    }

    suspend fun lookup(ids: List<String>): List<Track> {
        val missing = ids.distinct().filter { it !in container.tracks }
        for (part in missing.chunked(200)) {
            for (track in container.api.lookupTracks(TrackLookup(part))) container.tracks[track.id] = track
        }
        return ids.map { container.tracks[it] ?: error("A track is no longer available") }
    }

    fun route(command: ConnectCommand): Boolean {
        val target = current.value.selectedId ?: return false
        val revision = when (command) {
            is ConnectCommand.Remove, is ConnectCommand.Move, is ConnectCommand.Jump -> current.value.playback?.queueRevision
            else -> null
        }
        if (!current.value.available || outbound.trySend(Outbound(target, selection, command, revision)).isFailure) failure()
        return true
    }

    suspend fun command(command: ConnectCommand, revision: Long? = null) {
        val target = current.value.selectedId ?: error("No playback device selected")
        send(target, command, revision)
    }

    private suspend fun send(target: String, command: ConnectCommand, revision: Long? = null) = sending.withLock {
        check(current.value.connected && current.value.devices.any { it.id == target }) { "Playback device is offline" }
        val epoch = generation
        current.value = current.value.copy(pending = true)
        try {
            val next = withTimeout(12_000) { container.api.connectCommand(ConnectRequest(UUID.randomUUID().toString(), target, command, revision)) }
            if (epoch == generation) accept(next)
        } finally { current.value = current.value.copy(pending = false) }
    }

    suspend fun select(device: String?) {
        val target = device?.takeUnless { it == container.deviceId }
        if (target == current.value.selectedId) return
        selection++
        val old = current.value.playback
        val local = rendererState?.invoke()
        val source = if (isRemote) old else local
        val command = source?.takeIf { it.trackIds.isNotEmpty() }?.let {
            ConnectCommand.Play(it.trackIds, it.index, if (isRemote) position() / 1000.0 else it.positionSeconds,
                it.isPlaying, it.shuffle, it.repeat, order = it.order, radio = it.radio)
        }
        if (target == null) {
            wantsLocal = true
            current.value = current.value.copy(selectedId = null, playback = null)
            container.player.showLocal()
            if (command != null) renderer?.invoke(command)
            return
        }
        check(current.value.devices.any { it.id == target }) { "Playback device is offline" }
        wantsLocal = false
        current.value = current.value.copy(selectedId = target, selectedNameHint = current.value.devices.find { it.id == target }?.name)
        container.player.pauseLocal()
        if (snapshot.playback?.deviceId == target) accept(snapshot)
        else if (command != null) {
            remoteTracks = lookup(command.trackIds)
            receivedAt = SystemClock.elapsedRealtime()
            current.value = current.value.copy(playback = source.copy(deviceId = target))
            display()
            send(target, command)
        }
    }

    private suspend fun execute(envelope: ConnectEnvelope) {
        if (envelope.connectionId != connectionId) return
        var failure: String? = null
        try {
            val remaining = Instant.parse(envelope.expiresAt).toEpochMilli() - System.currentTimeMillis()
            check(remaining > 0) { "Playback command expired" }
            if (envelope.id !in executed) withTimeout(remaining) {
                if (envelope.queueRevision != null) report()
                check(envelope.queueRevision == null || snapshot.playback?.queueRevision == envelope.queueRevision) { "Playback queue changed" }
                if (envelope.command is ConnectCommand.Play || envelope.command is ConnectCommand.StartRadio) {
                    wantsLocal = true
                    current.value = current.value.copy(selectedId = null, playback = null)
                    container.player.showLocal()
                }
                container.player.connect()
                while (renderer == null) delay(20)
                renderer!!.invoke(envelope.command)
                executed.add(envelope.id)
                if (executed.size > 128) executed.remove(executed.first())
                // A new renderer may still be claiming the exclusive playback session.
                var last: Exception? = null
                repeat(10) {
                    try { report(); last = null; return@withTimeout }
                    catch (cancelled: CancellationException) { throw cancelled }
                    catch (error: Exception) { last = error; delay(100) }
                }
                last?.let { throw it }
            }
        } catch (cancelled: CancellationException) {
            if (cancelled !is TimeoutCancellationException) throw cancelled
            failure = "Playback command expired"
        } catch (error: Exception) { failure = error.message ?: "Playback command failed" }
        runCatching { container.api.connectAck(envelope.id, ConnectAck(container.deviceId, envelope.connectionId, failure)) }
    }

    suspend fun report() = reports.withLock {
        val id = connectionId ?: return@withLock
        if (isRemote) return@withLock
        val value = rendererState?.invoke() ?: return@withLock
        if (value.trackIds.isEmpty() && snapshot.playback?.deviceId != container.deviceId) return@withLock
        val next = container.api.connectReport(ConnectReport(container.deviceId, id, value))
        if (id == connectionId && !isRemote) accept(next)
    }

    private fun failure() {
        Toast.makeText(context, R.string.connect_failed, Toast.LENGTH_LONG).show()
    }
}
