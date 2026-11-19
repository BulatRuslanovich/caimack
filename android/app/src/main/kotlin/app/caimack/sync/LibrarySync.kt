// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

package app.caimack.sync

import android.content.Context
import android.util.AtomicFile
import app.caimack.R
import app.caimack.api.Track
import app.caimack.playback.Downloads
import app.caimack.playback.LibraryAudio
import app.caimack.session.Server
import java.io.IOException
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.job
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.withContext
import kotlinx.serialization.ExperimentalSerializationApi
import kotlinx.serialization.json.*
import okhttp3.Call
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.Response

@OptIn(ExperimentalSerializationApi::class)
class LibrarySync(
    private val context: Context,
    val store: SyncStore,
    private val server: Server,
    private val downloads: () -> Downloads,
    private val baseClient: () -> OkHttpClient,
) {
    val network = LocalNetwork(context, server)
    private val running = Mutex()
    @Volatile private var work: Job? = null
    @Volatile private var currentCall: Call? = null

    fun pause() {
        store.paused = true
        work?.cancel()
        currentCall?.cancel()
        store.status.update { it.copy(message = context.getString(R.string.sync_paused)) }
    }

    suspend fun run() = withContext(Dispatchers.IO) {
        if (!store.active || store.paused || !running.tryLock()) return@withContext
        work = currentCoroutineContext().job
        var client: OkHttpClient? = null
        store.status.update { it.copy(running = true, message = null, bytes = 0, totalBytes = 0) }
        try {
            checkActive()
            val owner = checkNotNull(store.downloadOwner)
            client = network.client(baseClient())
            uploadActions(client)
            syncSnapshot(client, owner)
            if (store.pending().isNotEmpty()) {
                uploadActions(client)
                syncSnapshot(client, owner)
            }
            checkActive()
            store.finish()
        } catch (error: CancellationException) {
            store.status.update { it.copy(message = context.getString(R.string.sync_paused)) }
            throw error
        } catch (error: Exception) {
            android.util.Log.w("CaimackSync", "Synchronization interrupted", error)
            store.status.update {
                it.copy(message = if (store.paused) context.getString(R.string.sync_paused) else error.message ?: error.javaClass.simpleName)
            }
        } finally {
            currentCall?.cancel()
            currentCall = null
            client?.dispatcher?.cancelAll()
            client?.connectionPool?.evictAll()
            work = null
            store.status.update { it.copy(running = false) }
            running.unlock()
        }
    }

    private suspend fun syncSnapshot(client: OkHttpClient, owner: String) {
        val snapshot = execute(client, Request.Builder().url(url("api/sync/snapshot")).build()).use {
            SnapshotJson(store.json).read(it.body.byteStream())
        }
        val tracks = store.json.decodeFromJsonElement<List<Track>>(snapshot.getValue("tracks")).associateBy { it.id }
        val files = snapshot.objects("files").map { file ->
            val id = file.string("id")
            val version = file.string("fileHash")
            val size = file.getValue("size").jsonPrimitive.long
            require(version.isNotEmpty() && size > 0) { "Incomplete audio manifest" }
            val source = url("api/sync/tracks/$id/audio").newBuilder().addQueryParameter("version", version).build()
            LibraryAudio(tracks.getValue(id), source, version, size)
        }
        checkActive()
        store.accept(snapshot)
        store.updateIndex { it.copy(files = it.files.filterKeys { id -> id in tracks }) }
        syncAssets(client, snapshot)
        syncVectors(client, snapshot.string("vectorVersion"))
        val library = withContext(Dispatchers.Main) { downloads().library }
        library.sync(owner, files, client, { store.active && !store.paused && store.downloadOwner == owner }) { count, bytes, total ->
            store.status.update { it.copy(completed = count, bytes = bytes, totalBytes = total) }
        }
        // Existing exports stay in the user's folder. Playback can now use the private copies.
        store.updateIndex { it.copy(files = emptyMap()) }
    }

    private suspend fun checkActive() {
        currentCoroutineContext().ensureActive()
        if (store.paused || !store.active) throw CancellationException("Sync stopped")
    }

    private fun url(path: String) = server.resolve(path) ?: throw IOException("No server address")

    private suspend fun execute(client: OkHttpClient, request: Request): Response {
        checkActive()
        val call = client.newCall(request)
        currentCall = call
        checkActive()
        val response = call.execute()
        if (!response.isSuccessful) {
            val code = response.code
            response.close()
            throw IOException(if (code == 401) context.getString(R.string.sync_sign_in_again) else "Sync HTTP $code")
        }
        return response
    }

    private suspend fun uploadActions(client: OkHttpClient) {
        val snapshot = store.snapshot ?: return
        while (true) {
            checkActive()
            val batch = store.pending().take(100)
            if (batch.isEmpty()) return
            val payload = buildJsonObject {
                put("serverId", snapshot.string("serverId"))
                put("userId", store.boundUser)
                put("actions", store.json.encodeToJsonElement(batch))
            }
            val request = Request.Builder().url(url("api/sync/actions"))
                .post(payload.toString().toRequestBody("application/json".toMediaType())).build()
            val result = execute(client, request).use {
                store.json.decodeFromStream<JsonObject>(it.body.byteStream()).objects("results")
            }
            checkActive()
            if (result.map { it.string("id") }.toSet() != batch.map { it.id }.toSet())
                throw IOException("Incomplete sync acknowledgement")
            store.acknowledge(result)
        }
    }

    private suspend fun syncAssets(client: OkHttpClient, snapshot: JsonObject) {
        val desired = snapshot.objects("assets").associate { it.string("path") to it.string("version") }
        val previous = store.index.assets
        val saved = previous.toMutableMap()
        var changed = false
        try {
            for ((path, version) in desired) {
                checkActive()
                val target = store.assetFile(path, version)
                if (previous[path] == version && target.isFile) continue
                save(client, path, AtomicFile(target))
                saved[path] = version
                changed = true
            }
            saved.keys.retainAll(desired.keys)
        } finally {
            if (saved != previous) {
                store.updateIndex { it.copy(assets = saved) }
                previous.forEach { (path, version) ->
                    if (saved[path] != version) store.assetFile(path, version).delete()
                }
                changed = true
            }
            if (changed) store.artworkRevision.update { it + 1 }
        }
    }

    private suspend fun syncVectors(client: OkHttpClient, version: String) {
        if (version.isEmpty() || (store.index.vectorVersion == version && store.vectorFile.baseFile.isFile)) return
        save(client, "api/sync/vectors", store.vectorFile)
        store.updateIndex { it.copy(vectorVersion = version) }
    }

    private suspend fun save(client: OkHttpClient, path: String, file: AtomicFile) {
        execute(client, Request.Builder().url(url(path)).build()).use { response ->
            val output = file.startWrite()
            try {
                response.body.byteStream().use { input ->
                    val buffer = ByteArray(DEFAULT_BUFFER_SIZE)
                    while (true) {
                        checkActive()
                        val count = input.read(buffer)
                        if (count == -1) break
                        output.write(buffer, 0, count)
                    }
                }
                checkActive()
                file.finishWrite(output)
            } catch (error: Throwable) {
                file.failWrite(output)
                throw error
            }
        }
    }
}
