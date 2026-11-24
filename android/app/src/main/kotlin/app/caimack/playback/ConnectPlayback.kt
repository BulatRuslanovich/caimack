// SPDX-License-Identifier: AGPL-3.0-only

package app.caimack.playback

import android.content.Context
import android.net.ConnectivityManager
import android.net.Network
import android.os.SystemClock
import android.widget.Toast
import app.caimack.AppContainer
import app.caimack.R
import app.caimack.api.*
import app.caimack.audiobooks.AudiobookAccount
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
import okhttp3.ConnectionPool
import okhttp3.Request

private const val DEVICE_FALLBACK_DELAY_MS = 30_000L

data class ConnectUiState(
    val devices: List<ConnectDevice> = emptyList(),
    val selectedId: String? = null,
    val bookDeviceId: String? = null,
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
    internal val hasPeer: Boolean get() = connectionId != null && snapshot.devices.size > 1
    // The server sends a snapshot at least every 15 seconds. Bound the read when a socket goes silent.
    private val client = container.http.newBuilder().readTimeout(25, TimeUnit.SECONDS)
        .connectionPool(ConnectionPool(0, 1, TimeUnit.SECONDS)).build()
    private var observing: Job? = null
    private var stream: Job? = null
    private var reporting: Job? = null
    private var changed: Job? = null
    private var fallback: Job? = null
    private var defaultNetwork: Network? = null
    private var call: Call? = null
    private var sentBook: app.caimack.api.ConnectBook? = null
    private var sentBookSession: Long? = null
    private var sentBookConnection: String? = null
    private var bookReceivedAt = 0L
    private val bookReports = Mutex()
    private var connectionId: String? = null
    private var account: String? = null
    private var generation = 0L
    private var selection = 0L
    private var fallenBackFrom: Long? = null
    private var snapshot = ConnectSnapshot()
    private var wantsLocal = false
    private var receivedAt = 0L
    private var disconnectedAt: Long? = null
    private var remoteTracks = emptyList<Track>()
    private val sending = Mutex()
    private val reports = Mutex()
    private data class Outbound(
        val target: String,
        val selection: Long,
        val command: ConnectCommand,
        val revision: Long?,
        val musicHandoff: (() -> Unit)?,
    )
    private val outbound = Channel<Outbound>(32)
    private val executed = LinkedHashSet<String>()
    private var renderer: (suspend (ConnectCommand) -> Unit)? = null
    private var rendererState: (() -> ConnectState)? = null

    init {
        container.scope.launch(Dispatchers.Main) {
            for (item in outbound) {
                if (item.selection != selection && !fellBack(item.selection)) continue
                try { send(item.target, item.command, item.revision, item.musicHandoff, item.selection) }
                catch (error: Exception) {
                    if (error is CancellationException && error !is TimeoutCancellationException) throw error
                    if (item.selection == selection) {
                        failure()
                        while (outbound.tryReceive().isSuccess) { /* Discard stale queued controls. */ }
                    }
                }
            }
        }
    }

    fun start() {
        if (observing != null) return
        val connectivity = context.getSystemService(ConnectivityManager::class.java)
        defaultNetwork = connectivity.activeNetwork
        connectivity.registerDefaultNetworkCallback(object : ConnectivityManager.NetworkCallback() {
            override fun onAvailable(network: Network) {
                container.scope.launch(Dispatchers.Main) { networkChanged(network) }
            }

            override fun onLost(network: Network) {
                container.scope.launch(Dispatchers.Main) {
                    if (defaultNetwork == network) networkChanged(null)
                }
            }
        })
        observing = container.scope.launch(Dispatchers.Main) {
            container.session.state.collect { session ->
                val key = (session as? SessionState.SignedIn)?.let { "${container.server.url.value}|${it.user.id}" }
                if (key == account) return@collect
                val previousAccount = account
                account = key
                generation++
                stopStream()
                reporting?.cancel()
                cancelFallback()
                connectionId = null
                selection++
                snapshot = ConnectSnapshot()
                sentBook = null
                sentBookSession = null
                container.audiobookPlayback.showRemote(null)
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
                stream = container.scope.launch(Dispatchers.Main) { watch() }
                reporting = container.scope.launch(Dispatchers.Main) {
                    var beats = 0
                    while (isActive && epoch == generation) {
                        try {
                            if (beats++ % 5 == 0) connectionId?.let { container.api.connectHeartbeat(ConnectHeartbeat(container.deviceId, it)) }
                            reportBook()
                            if (hasPeer) report()
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
        if (isRemote || !hasPeer) return
        changed?.cancel()
        changed = container.scope.launch(Dispatchers.Main) {
            delay(50)
            try { report() }
            catch (cancelled: CancellationException) { throw cancelled }
            catch (_: Exception) { }
        }
    }

    private fun networkChanged(network: Network?) {
        if (defaultNetwork == network) return
        defaultNetwork = network
        if (account == null) return
        stopStream()
        transportLost()
        stream = container.scope.launch(Dispatchers.Main) { watch() }
    }

    private fun stopStream() {
        stream?.cancel()
        call?.cancel()
        call = null
    }

    private fun transportLost() {
        connectionId = null
        container.audiobookPlayback.showRemote(snapshot.audiobook?.takeIf { container.audiobooksEnabled.value }?.copy(playing = false))
        current.value = current.value.copy(devices = emptyList(), bookDeviceId = null, connected = false, pending = false)
        updateFallback()
    }

    private fun cancelFallback() {
        fallback?.cancel()
        fallback = null
        disconnectedAt = null
    }

    private fun updateFallback() {
        if (!isRemote || current.value.available) {
            cancelFallback()
            return
        }
        if (fallback != null) return
        disconnectedAt = SystemClock.elapsedRealtime()
        val expectedSelection = selection
        fallback = container.scope.launch(Dispatchers.Main) {
            delay(DEVICE_FALLBACK_DELAY_MS)
            fallback = null
            if (expectedSelection == selection && !current.value.available) {
                returnToPhone(offline = !current.value.connected)
            }
        }
    }

    private suspend fun watch() {
        while (currentCoroutineContext().isActive) {
            try {
                val owner = container.audiobookAccount() ?: return
                val url = owner.server.newBuilder()
                    .addPathSegments("api/playback/connect/events")
                    .addQueryParameter("deviceId", container.deviceId)
                    .addQueryParameter("deviceName", container.deviceName)
                    .addQueryParameter("audiobooks", "true")
                    .addQueryParameter("audiobookExperiment", "true")
                    .addQueryParameter("deviceKind", "android").build()
                val next = client.newCall(Request.Builder().url(url).header("Accept", "text/event-stream").build())
                call = next
                withContext(Dispatchers.IO) { readEvents(next, owner) }
            } catch (cancelled: CancellationException) { throw cancelled }
            catch (_: Exception) { }
            transportLost()
            delay(1_500)
        }
    }

    private suspend fun readEvents(call: Call, owner: AudiobookAccount) {
        call.execute().use { response ->
            if (!response.isSuccessful) throw IOException("Playback connection unavailable")
            val source = response.body.source()
            var event = ""
            val data = StringBuilder()
            while (currentCoroutineContext().isActive) {
                val line = source.readUtf8Line() ?: break
                when {
                    line.isEmpty() -> {
                        if (data.isNotEmpty()) {
                            val payload = data.toString()
                            withContext(Dispatchers.Main) {
                                when (event) {
                                    "snapshot" -> accept(container.json.decodeFromString<ConnectSnapshot>(payload), transport = true)
                                    "command" -> execute(container.json.decodeFromString<ConnectEnvelope>(payload))
                                    "audiobook-experiment" -> payload.toBooleanStrictOrNull()?.let { enabled ->
                                        if (container.receiveAudiobookExperiment(owner, enabled)) accept(snapshot)
                                    }
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
    }

    private suspend fun accept(next: ConnectSnapshot, transport: Boolean = false) {
        if (next.epoch == snapshot.epoch && next.version < snapshot.version) return
        val hadPeer = hasPeer
        val previousBook = snapshot.audiobook
        snapshot = next
        connectionId = next.devices.find { it.id == container.deviceId }?.connectionId
        if (!hadPeer && hasPeer) changed()
        val book = next.audiobook?.takeIf { container.audiobooksEnabled.value }
        if (book != previousBook) bookReceivedAt = SystemClock.elapsedRealtime()
        val remoteBook = book?.takeIf { it.deviceId != container.deviceId || container.audiobookPlayback.localState == null }
        if (previousBook?.deviceId == container.deviceId && book?.deviceId != container.deviceId && (book != null || next.playback?.isPlaying == true) &&
            container.audiobookPlayback.localState != null) container.audiobookPlayback.pauseForMusic()
        if (remoteBook != null && previousBook?.deviceId != remoteBook.deviceId && container.player.localState.playing) container.player.pauseLocal()
        container.audiobookPlayback.showRemote(remoteBook)
        val selected = current.value.selectedId
        val selectedDevice = next.devices.find { it.id == selected }
        current.value = current.value.copy(devices = next.devices, bookDeviceId = remoteBook?.deviceId?.takeIf { id -> id != container.deviceId && next.devices.any { it.id == id } }, connected = transport || current.value.connected,
            selectedNameHint = selectedDevice?.name ?: current.value.selectedNameHint)
        updateFallback()
        if (selected != null && !current.value.available) return
        if (book != null) return
        val active = next.playback ?: return
        if (active.deviceId == container.deviceId) return
        val device = next.devices.find { it.id == active.deviceId } ?: return
        if (!isRemote && !container.player.localState.playing && !wantsLocal) {
            selection++
            current.value = current.value.copy(selectedId = device.id, selectedNameHint = device.name)
            container.player.pauseLocal()
        }
        if (current.value.selectedId != device.id) return
        val selectedAtLookup = selection
        val tracks = lookup(active.trackIds)
        if (selection != selectedAtLookup || !current.value.available || snapshot.playback != active) return
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
        val elapsed = if (active.isPlaying && !active.buffering)
            ((disconnectedAt ?: SystemClock.elapsedRealtime()) - receivedAt).coerceAtLeast(0) else 0
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
        if (outbound.trySend(Outbound(target, selection, command, revision, command.musicHandoff())).isFailure) failure()
        return true
    }

    suspend fun command(command: ConnectCommand, revision: Long? = null) {
        val target = current.value.selectedId ?: return
        send(target, command, revision, command.musicHandoff())
    }

    suspend fun enqueueTracks(tracks: List<Track>) {
        val target = current.value.selectedId
        if (target == null) {
            container.player.enqueueAll(tracks)
        } else {
            val selected = selection
            for (track in tracks) {
                send(target, ConnectCommand.Enqueue(track.id, next = false), expectedSelection = selected)
            }
        }
    }

    internal fun captureSelection(): () -> Boolean {
        val expected = selection
        return { selection == expected }
    }

    internal suspend fun pauseForAudiobook() {
        val device = current.value
        val target = device.selectedId
        if (target == null) {
            container.player.pauseLocal()
        } else if (device.available) {
            // Let the remote music session settle before the book takes audio focus.
            withTimeoutOrNull(2_000) {
                try { send(target, ConnectCommand.SetPlaying(false), recover = false) }
                catch (cancelled: CancellationException) { throw cancelled }
                catch (_: Exception) { /* Local playback can still start. */ }
            }
        }
    }

    private fun ConnectCommand.musicHandoff(): (() -> Unit)? {
        val startsMusic = when (this) {
            is ConnectCommand.Play -> playing
            is ConnectCommand.SetPlaying -> playing
            is ConnectCommand.StartRadio -> true
            else -> false
        }
        return if (startsMusic) container.audiobookPlayback.prepareMusicHandoff() else null
    }

    private suspend fun send(
        target: String,
        command: ConnectCommand,
        revision: Long? = null,
        musicHandoff: (() -> Unit)? = null,
        expectedSelection: Long = selection,
        recover: Boolean = true,
        replay: Boolean = true,
    ) = sending.withLock {
        val localCommand = command.takeIf { replay && revision == null }
        if (fellBack(expectedSelection)) {
            if (recover && localCommand != null) replayOnPhone(localCommand, musicHandoff)
            return@withLock
        }
        if (expectedSelection != selection || current.value.selectedId != target) return@withLock
        val connection = checkNotNull(connectionId)
        check(current.value.available)
        current.value = current.value.copy(pending = true)
        try {
            val next = withTimeout(12_000) { container.api.connectCommand(ConnectRequest(UUID.randomUUID().toString(), target, command, revision)) }
            if (expectedSelection == selection && connection == connectionId) {
                if (next.playback?.let { it.deviceId == target && (it.isPlaying || it.buffering) } == true) musicHandoff?.invoke()
                accept(next)
            }
        } catch (error: Exception) {
            if (!recover || (error is CancellationException && error !is TimeoutCancellationException) ||
                !fellBack(expectedSelection)) throw error
            if (localCommand != null) replayOnPhone(localCommand, musicHandoff)
        } finally {
            if (expectedSelection == selection && connection == connectionId) current.value = current.value.copy(pending = false)
        }
    }

    private fun fellBack(previousSelection: Long) =
        fallenBackFrom == previousSelection && selection == previousSelection + 1 && !isRemote

    private suspend fun replayOnPhone(command: ConnectCommand, musicHandoff: (() -> Unit)?) {
        val render = renderer ?: return
        val selected = selection
        val playable = if (command is ConnectCommand.Play && !current.value.connected) command.downloaded() ?: return
            else command
        when (playable) {
            is ConnectCommand.Play -> {
                render(playable.copy(playing = false))
                if (playable.playing && selection == selected) container.player.resume()
            }
            is ConnectCommand.SetPlaying -> if (playable.playing) container.player.resume() else render(playable)
            else -> render(playable)
        }
        if (selection == selected) musicHandoff?.invoke()
    }

    private fun selectPhone() {
        selection++
        cancelFallback()
        wantsLocal = true
        remoteTracks = emptyList()
        current.value = current.value.copy(selectedId = null, selectedNameHint = null, playback = null, pending = false)
        container.player.showLocal()
    }

    private suspend fun returnToPhone(offline: Boolean, automatic: Boolean = true) {
        if (!isRemote) return
        val transfer = current.value.playback?.let { active ->
            val handoff = active.handoff(position() / 1000.0)
            if (offline) handoff?.downloaded() else handoff
        }
        fallenBackFrom = if (automatic) selection else null
        selectPhone()
        val render = renderer ?: return
        if (transfer == null) return
        val phoneSelection = selection
        render(transfer.copy(playing = false))
        // The controller lets Media3 bring the service to the foreground before requesting audio focus.
        if (transfer.playing && snapshot.audiobook == null && selection == phoneSelection) container.player.resume()
    }

    private fun ConnectState.handoff(position: Double) = takeIf { trackIds.isNotEmpty() }?.let {
        ConnectCommand.Play(trackIds, index, position, isPlaying, shuffle, repeat, order = order, radio = radio)
    }

    private fun ConnectCommand.Play.downloaded(): ConnectCommand.Play? {
        val saved = trackIds.indices.filter { container.locallyAvailable(trackIds[it]) }
        val localIndex = saved.indexOf(index)
        if (localIndex < 0) return null
        val positions = saved.withIndex().associate { (new, old) -> old to new }
        return copy(trackIds = saved.map { trackIds[it] }, index = localIndex, order = order?.mapNotNull(positions::get))
    }

    suspend fun select(device: String?) {
        val target = device?.takeUnless { it == container.deviceId }
        if (target == current.value.selectedId) return
        if (target == null) {
            returnToPhone(offline = !current.value.connected, automatic = false)
            return
        }
        check(current.value.connected)
        val targetDevice = checkNotNull(current.value.devices.find { it.id == target })
        val source = if (isRemote) current.value.playback else rendererState?.invoke()
        val command = source?.handoff(if (isRemote) position() / 1000.0 else source.positionSeconds)
        val selectedAtLookup = ++selection
        wantsLocal = false
        current.value = current.value.copy(selectedId = target, selectedNameHint = targetDevice.name, pending = false)
        updateFallback()
        container.player.pauseLocal()
        if (snapshot.playback?.deviceId == target) accept(snapshot)
        else if (command != null) {
            val tracks = lookup(command.trackIds)
            if (selection != selectedAtLookup || !current.value.available) return
            remoteTracks = tracks
            receivedAt = SystemClock.elapsedRealtime()
            current.value = current.value.copy(playback = source.copy(deviceId = target))
            display()
            send(target, command, replay = false)
        }
    }

    private suspend fun reportBook() = bookReports.withLock {
        val connection = connectionId ?: return@withLock
        val player = container.audiobookPlayback
        val local = player.localState?.takeIf { container.audiobooksEnabled.value }
        val value = local?.let { app.caimack.api.ConnectBook(it.bookId, it.chapterId, it.positionMs, it.playing) }
        val claim = value != null && (sentBook == null || sentBookSession != player.sessionId || (value.playing && sentBookConnection != connection))
        if (!claim && value == sentBook && (value == null || sentBookConnection == connection)) return@withLock
        val session = player.sessionId
        container.api.connectBookReport(app.caimack.api.ConnectBookReport(container.deviceId, connection, value, claim))
        sentBook = value
        sentBookSession = session
        sentBookConnection = connection
    }

    fun routeBook(command: ConnectCommand.PlayAudiobook): Boolean {
        val device = current.value.bookDeviceId ?: return false
        if (!current.value.connected || current.value.devices.none { it.id == device }) return false
        container.scope.launch(Dispatchers.Main) {
            try { sendBook(device, command) }
            catch (cancelled: CancellationException) { throw cancelled }
            catch (_: Exception) { failure() }
        }
        return true
    }

    private suspend fun sendBook(device: String, command: ConnectCommand.PlayAudiobook) {
        accept(container.api.connectCommand(ConnectRequest(UUID.randomUUID().toString(), device, command)))
    }

    suspend fun transferAudiobook(target: String?) {
        val player = container.audiobookPlayback
        if (target == current.value.bookDeviceId) return
        val book = snapshot.audiobook
        if (book != null && player.localState == null) {
            val elapsed = if (book.playing) SystemClock.elapsedRealtime() - bookReceivedAt else 0L
            val command = ConnectCommand.PlayAudiobook(book.bookId, book.chapterId, book.positionMs + elapsed, book.playing)
            if (target == null) {
                player.receiveHandoff(command)
                reportBook()
            } else sendBook(target, command)
        } else if (target != null) {
            check(current.value.connected && current.value.devices.any { it.id == target && it.audiobooks })
            player.transfer { command -> sendBook(target, command) }
        }
    }

    private suspend fun execute(envelope: ConnectEnvelope) {
        if (envelope.connectionId != connectionId) return
        var failure: String? = null
        try {
            val remaining = Instant.parse(envelope.expiresAt).toEpochMilli() - System.currentTimeMillis()
            check(remaining > 0) { "Playback command expired" }
            if (envelope.id !in executed) withTimeout(remaining) {
                if (envelope.command is ConnectCommand.PlayAudiobook) {
                    check(container.audiobooksEnabled.value)
                    container.audiobookPlayback.receiveHandoff(envelope.command)
                    reportBook()
                    executed.add(envelope.id)
                    if (executed.size > 128) executed.remove(executed.first())
                    return@withTimeout
                }
                if (envelope.queueRevision != null) report()
                check(envelope.queueRevision == null || snapshot.playback?.queueRevision == envelope.queueRevision) { "Playback queue changed" }
                if (envelope.command is ConnectCommand.Play || envelope.command is ConnectCommand.StartRadio) {
                    selectPhone()
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
        if (isRemote || !hasPeer) return@withLock
        val value = rendererState?.invoke() ?: return@withLock
        if (value.trackIds.isEmpty() && snapshot.playback?.deviceId != container.deviceId) return@withLock
        val next = container.api.connectReport(ConnectReport(container.deviceId, id, value))
        if (id == connectionId && !isRemote) accept(next)
    }

    private fun failure() {
        Toast.makeText(context, R.string.connect_failed, Toast.LENGTH_LONG).show()
    }
}
