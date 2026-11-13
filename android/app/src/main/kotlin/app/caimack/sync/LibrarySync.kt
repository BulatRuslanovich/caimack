// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

package app.caimack.sync

import android.content.Context
import android.net.Uri
import android.util.AtomicFile
import app.caimack.R
import app.caimack.session.Server
import java.io.File
import java.io.IOException
import java.security.MessageDigest
import java.util.Base64
import java.util.UUID
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.withContext
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.*
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody

@Serializable
private data class Transfer(
    val id: String,
    val hash: String,
    val uri: String,
    val parent: String,
    val finalName: String,
    val relativePath: String,
    val verified: Boolean = false,
)

class LibrarySync(
    private val context: Context,
    val store: SyncStore,
    private val server: Server,
    private val baseClient: () -> OkHttpClient,
) {
    val network = LocalNetwork(context, server)
    private val running = Mutex()
    private val transferFile = AtomicFile(File(store.directory, "transfer.json"))
    private val creatingFile = AtomicFile(File(store.directory, "creating.json"))
    @Volatile private var stopped = false
    @Volatile private var currentCall: okhttp3.Call? = null

    fun pause() {
        store.paused = true
        stopped = true
        currentCall?.cancel()
        store.status.value =
            store.status.value.copy(message = context.getString(R.string.sync_paused))
    }

    suspend fun run() =
        withContext(Dispatchers.IO) {
            if (!store.active || store.paused || !running.tryLock()) return@withContext
            stopped = false
            var client: OkHttpClient? = null
            store.status.value =
                store.status.value.copy(running = true, message = null, bytes = 0, totalBytes = 0)
            try {
                client = network.client(baseClient())
                checkActive()
                val rootUri =
                    store.folder?.let(Uri::parse)
                        ?: throw IOException(context.getString(R.string.sync_choose_folder))
                val folder = MusicFolder(context, rootUri)
                recoverCreation(folder)
                clean(folder)
                uploadActions(client)
                val snapshot = getJson(client, "api/sync/snapshot").jsonObject
                checkActive()
                store.accept(snapshot)
                val identity =
                    "Caimack-${snapshot.string("serverId").take(8)}-${store.boundUser?.take(8)}"
                val root = folder.directory(folder.root, identity)
                val service = folder.directory(root, ".caimack")
                // Files in this namespace are managed only via recorded document URIs.
                // A full, validated manifest is accepted before deletions are considered.
                export(
                    folder,
                    service,
                    "library.json",
                    snapshot.toString().toByteArray(),
                    "application/json",
                    "catalog",
                )
                val vectors = snapshot.string("vectorVersion")
                val vectorFile = store.index.exports["vectors"]
                if (
                    store.index.vectorVersion != vectors ||
                        vectorFile == null ||
                        !folder.exists(Uri.parse(vectorFile))
                ) {
                    val value = getJson(client, "api/sync/vectors")
                    export(
                        folder,
                        service,
                        "vectors.json",
                        value.toString().toByteArray(),
                        "application/json",
                        "vectors",
                    )
                    store.updateIndex { it.copy(vectorVersion = vectors) }
                }
                syncAssets(client, snapshot)
                val tracks = snapshot.objects("tracks").associateBy { it.string("id") }
                val files = snapshot.objects("files")
                val wanted = files.map { it.string("id") }.toSet()
                val stale = store.index.files.filterKeys { it !in wanted }.values
                store.updateIndex { index ->
                    index.copy(
                        files = index.files.filterKeys { it in wanted },
                        garbage = index.garbage + stale.flatMap { listOf(it.uri) + it.companions },
                    )
                }
                clean(folder)
                for ((position, file) in files.withIndex()) {
                    checkActive()
                    val id = file.string("id")
                    val track = tracks.getValue(id)
                    store.status.value =
                        store.status.value.copy(
                            message =
                                "${position+1}/${files.size} · ${track.string("artistName")} — ${track.string("title")}"
                        )
                    val previous = store.index.files[id]
                    val exists = previous != null && folder.exists(Uri.parse(previous.uri))
                    var saved = previous
                    if (
                        exists &&
                            previous != null &&
                            previous.fileHash == file.string("fileHash") &&
                            previous.audioVersion != file.string("audioVersion")
                    ) {
                        saved = previous.copy(audioVersion = file.string("audioVersion"))
                        val updated = saved
                        store.updateIndex { it.copy(files = it.files + (id to updated)) }
                    }
                    if (!exists || previous?.fileHash != file.string("fileHash")) {
                        val tags =
                            getJson(client, "api/sync/tracks/$id/tags", file.string("fileHash"))
                                .jsonObject
                        require(
                            tags.string("audioVersion") == file.string("audioVersion") &&
                                tags.string("fileHash") == file.string("fileHash")
                        ) {
                            "Audio version changed"
                        }
                        val artistName = MusicFolder.safeName(track.string("artistName"))
                        val albumName =
                            MusicFolder.safeName(track.string("albumTitle").ifEmpty { "Singles" })
                        val artist = folder.directory(root, artistName)
                        val album = folder.directory(artist, albumName)
                        val relative = "$identity/$artistName/$albumName"
                        val transfer = transfer(folder, album, relative, file, track)
                        if (!transfer.verified) {
                            if (
                                exists &&
                                    previous != null &&
                                    previous.audioVersion == file.string("audioVersion")
                            ) {
                                patch(folder, previous, transfer, tags)
                            } else download(client, folder, transfer, file)
                            try {
                                verify(folder, Uri.parse(transfer.uri), file.string("fileHash"))
                            } catch (error: IOException) {
                                if (previous != null)
                                    store.updateIndex { index ->
                                        index.copy(
                                            files =
                                                index.files +
                                                    (id to
                                                        previous.copy(
                                                            audioVersion =
                                                                "repair:${previous.audioVersion}"
                                                        ))
                                        )
                                    }
                                throw error
                            }
                            saveTransfer(transfer.copy(verified = true))
                        }
                        val finalized = finishTransfer(folder, loadTransfer() ?: transfer)
                        val prefix = Base64.getDecoder().decode(tags.string("prefix")).size.toLong()
                        val suffix = Base64.getDecoder().decode(tags.string("suffix")).size.toLong()
                        saved =
                            SyncedFile(
                                finalized.uri,
                                finalized.relativePath,
                                file.string("audioVersion"),
                                file.string("fileHash"),
                                prefix,
                                suffix,
                                tags.getValue("payloadSize").jsonPrimitive.long,
                            )
                        store.updateIndex { index ->
                            index.copy(
                                files = index.files + (id to saved),
                                garbage =
                                    index.garbage +
                                        listOfNotNull(previous?.uri) +
                                        previous?.companions.orEmpty(),
                            )
                        }
                        transferFile.delete()
                        clean(folder)
                    }
                    if (saved != null)
                        syncCompanions(folder, root, identity, snapshot, track, saved)
                }
                exportPlaylists(folder, root, snapshot)
                if (store.pending().isNotEmpty()) {
                    uploadActions(client)
                    val refreshed = getJson(client, "api/sync/snapshot").jsonObject
                    checkActive()
                    store.accept(refreshed)
                    export(
                        folder,
                        service,
                        "library.json",
                        refreshed.toString().toByteArray(),
                        "application/json",
                        "catalog",
                    )
                    exportPlaylists(folder, root, refreshed)
                }
                checkActive()
                store.finish()
            } catch (error: CancellationException) {
                store.status.value =
                    store.status.value.copy(message = context.getString(R.string.sync_paused))
                throw error
            } catch (error: Exception) {
                android.util.Log.w("CaimackSync", "Synchronization paused", error)
                store.status.value =
                    store.status.value.copy(
                        message =
                            if (stopped) context.getString(R.string.sync_paused)
                            else error.message ?: error.javaClass.simpleName
                    )
            } finally {
                currentCall?.cancel()
                currentCall = null
                client?.connectionPool?.evictAll()
                store.status.value = store.status.value.copy(running = false)
                running.unlock()
            }
        }

    private suspend fun checkActive() {
        currentCoroutineContext().ensureActive()
        if (stopped || !store.active) throw CancellationException("Sync stopped")
    }

    private fun url(path: String, version: String? = null) =
        (server.resolve(path) ?: throw IOException("No server address"))
            .newBuilder()
            .apply { version?.let { addQueryParameter("version", it) } }
            .build()

    private fun execute(client: OkHttpClient, request: Request): okhttp3.Response {
        if (stopped || !store.active) throw IOException("Sync stopped")
        val call = client.newCall(request)
        currentCall = call
        val response = call.execute()
        if (!response.isSuccessful) {
            val code = response.code
            response.close()
            throw IOException(
                if (code == 401) context.getString(R.string.sync_sign_in_again)
                else "Sync HTTP $code"
            )
        }
        return response
    }

    private fun getJson(client: OkHttpClient, path: String, version: String? = null): JsonElement =
        execute(client, Request.Builder().url(url(path, version)).build()).use { response ->
            store.json.parseToJsonElement(response.body.string())
        }

    private suspend fun uploadActions(client: OkHttpClient) {
        if (store.snapshot == null) return
        while (true) {
            checkActive()
            val batch = store.pending().take(100)
            if (batch.isEmpty()) return
            val payload = buildJsonObject {
                put("serverId", store.snapshot!!.string("serverId"))
                put("userId", store.boundUser)
                put("actions", store.json.encodeToJsonElement(batch))
            }
            val result =
                execute(
                        client,
                        Request.Builder()
                            .url(url("api/sync/actions"))
                            .post(
                                payload.toString().toRequestBody("application/json".toMediaType())
                            )
                            .build(),
                    )
                    .use {
                        store.json
                            .parseToJsonElement(it.body.string())
                            .jsonObject
                            .objects("results")
                    }
            if (result.map { it.string("id") }.toSet() != batch.map { it.id }.toSet())
                throw IOException("Incomplete sync acknowledgement")
            store.acknowledge(result)
        }
    }

    private suspend fun syncAssets(client: OkHttpClient, snapshot: JsonObject) {
        val desired = snapshot.objects("assets")
        for (asset in desired) {
            checkActive()
            val path = asset.string("path")
            val version = asset.string("version")
            val target = File(store.directory, "asset-${sha256(path.toByteArray())}-$version")
            if (store.index.assets[path] == version && target.isFile) continue
            val atomic = AtomicFile(target)
            execute(client, Request.Builder().url(url(path)).build()).use { response ->
                val output = atomic.startWrite()
                try {
                    response.body.byteStream().use { it.copyTo(output) }
                    atomic.finishWrite(output)
                } catch (error: Throwable) {
                    atomic.failWrite(output)
                    throw error
                }
            }
            val old = store.index.assets[path]
            store.updateIndex { it.copy(assets = it.assets + (path to version)) }
            old?.takeIf { it != version }
                ?.let { File(store.directory, "asset-${sha256(path.toByteArray())}-$it").delete() }
        }
        val keys = desired.map { it.string("path") }.toSet()
        val old = store.index.assets.filterKeys { it !in keys }
        store.updateIndex { it.copy(assets = it.assets.filterKeys { it in keys }) }
        old.forEach { (path, version) ->
            File(store.directory, "asset-${sha256(path.toByteArray())}-$version").delete()
        }
    }

    private fun transfer(
        folder: MusicFolder,
        parent: Uri,
        relative: String,
        file: JsonObject,
        track: JsonObject,
    ): Transfer {
        val saved = loadTransfer()
        if (
            saved != null && saved.id == file.string("id") && saved.hash == file.string("fileHash")
        ) {
            if (folder.exists(Uri.parse(saved.uri))) return saved
            if (saved.verified) {
                folder.children(Uri.parse(saved.parent))[saved.finalName]?.let { uri ->
                    verify(folder, uri, saved.hash)
                    return saved.copy(uri = uri.toString()).also(::saveTransfer)
                }
            }
        }
        if (saved != null) {
            if (folder.exists(Uri.parse(saved.uri))) folder.delete(Uri.parse(saved.uri))
            transferFile.delete()
        }
        val name =
            "${MusicFolder.safeName(track.string("title"))} [${file.string("id").take(8)}-${UUID.randomUUID().toString().take(6)}].${file.string("extension")}"
        val uri = createOwned(folder, parent, ".$name.part", "application/octet-stream")
        return Transfer(
                file.string("id"),
                file.string("fileHash"),
                uri.toString(),
                parent.toString(),
                name,
                "$relative/$name",
            )
            .also(::saveTransfer)
    }

    private suspend fun download(
        client: OkHttpClient,
        folder: MusicFolder,
        transfer: Transfer,
        file: JsonObject,
    ) {
        val uri = Uri.parse(transfer.uri)
        val total = file.getValue("size").jsonPrimitive.long
        var offset = folder.size(uri).coerceAtLeast(0)
        if (offset > total) {
            folder.output(uri).close()
            offset = 0
        }
        if (offset == total) return
        val builder =
            Request.Builder().url(url("api/sync/tracks/${transfer.id}/audio", transfer.hash))
        if (offset > 0) builder.header("Range", "bytes=$offset-")
        execute(client, builder.build()).use { response ->
            if (response.header("ETag") != "\"${transfer.hash}\"")
                throw IOException("Audio version changed during download")
            val append =
                offset > 0 &&
                    response.code == 206 &&
                    response.header("Content-Range")?.startsWith("bytes $offset-") == true
            if (!append) offset = 0
            var downloaded = offset
            folder.output(uri, append).use { output ->
                response.body.byteStream().use { input ->
                    val buffer = ByteArray(128 * 1024)
                    while (true) {
                        checkActive()
                        val count = input.read(buffer)
                        if (count < 0) break
                        output.write(buffer, 0, count)
                        downloaded += count
                        store.status.value =
                            store.status.value.copy(bytes = downloaded, totalBytes = total)
                    }
                }
            }
            if (downloaded != total)
                throw IOException("Incomplete audio download ($downloaded/$total)")
        }
    }

    private suspend fun patch(
        folder: MusicFolder,
        previous: SyncedFile,
        transfer: Transfer,
        tags: JsonObject,
    ) {
        val prefix = Base64.getDecoder().decode(tags.string("prefix"))
        val suffix = Base64.getDecoder().decode(tags.string("suffix"))
        if (previous.payloadSize != tags.getValue("payloadSize").jsonPrimitive.long)
            throw IOException("Audio identity changed; refresh the server library")
        folder.input(Uri.parse(previous.uri)).use { input ->
            folder.output(Uri.parse(transfer.uri)).use { output ->
                var skip = previous.prefixBytes
                while (skip > 0) {
                    val count = input.skip(skip)
                    if (count > 0) skip -= count
                    else {
                        if (input.read() < 0)
                            throw IOException("The local audio file is incomplete")
                        skip--
                    }
                }
                output.write(prefix)
                var remaining = previous.payloadSize
                val buffer = ByteArray(128 * 1024)
                while (remaining > 0) {
                    checkActive()
                    val count =
                        input.read(buffer, 0, minOf(remaining, buffer.size.toLong()).toInt())
                    if (count <= 0) throw IOException("The local audio file is incomplete")
                    output.write(buffer, 0, count)
                    remaining -= count
                }
                output.write(suffix)
            }
        }
    }

    private fun verify(folder: MusicFolder, uri: Uri, hash: String) {
        val digest = MessageDigest.getInstance("SHA-256")
        folder.input(uri).use { input ->
            val buffer = ByteArray(128 * 1024)
            while (true) {
                val count = input.read(buffer)
                if (count < 0) break
                digest.update(buffer, 0, count)
            }
        }
        if (digest.digest().joinToString("") { "%02x".format(it) } != hash) {
            // Keep the previous complete file; start this partial transfer fresh.
            folder.output(uri).close()
            throw IOException("Audio checksum mismatch; the next sync will retry")
        }
    }

    private fun finishTransfer(folder: MusicFolder, transfer: Transfer): Transfer {
        val existing = folder.children(Uri.parse(transfer.parent))[transfer.finalName]
        if (existing?.toString() == transfer.uri) return transfer
        val uri = folder.rename(Uri.parse(transfer.uri), transfer.finalName)
        return transfer.copy(uri = uri.toString(), verified = true).also(::saveTransfer)
    }

    private fun loadTransfer(): Transfer? =
        if (transferFile.baseFile.exists())
            store.json.decodeFromString<Transfer>(
                transferFile.openRead().bufferedReader().use { it.readText() }
            )
        else null

    private fun saveTransfer(value: Transfer) {
        val stream = transferFile.startWrite()
        try {
            stream.write(store.json.encodeToString(value).toByteArray())
            transferFile.finishWrite(stream)
        } catch (error: Throwable) {
            transferFile.failWrite(stream)
            throw error
        }
    }

    private fun clean(folder: MusicFolder) {
        for (uri in store.index.garbage.distinct()) {
            if (loadTransfer()?.uri == uri) continue
            if (
                store.index.files.values.any { it.uri == uri || uri in it.companions } ||
                    uri in store.index.exports.values
            )
                continue
            folder.delete(Uri.parse(uri))
            store.updateIndex { it.copy(garbage = it.garbage - uri) }
        }
    }

    private fun export(
        folder: MusicFolder,
        parent: Uri,
        name: String,
        bytes: ByteArray,
        mime: String,
        key: String,
    ): String {
        val old = store.index.exports[key]
        // Give the provider an unambiguous name before writing. No overwrite of
        // an arbitrary file in the user-selected directory is ever permitted.
        val temp =
            createOwned(
                folder,
                parent,
                ".${UUID.randomUUID()}-$name.part",
                "application/octet-stream",
            )
        folder.output(temp).use { it.write(bytes) }
        if (old != null && folder.exists(Uri.parse(old))) folder.delete(Uri.parse(old))
        val target =
            if (folder.children(parent).containsKey(name))
                "$name-${UUID.randomUUID().toString().take(6)}"
            else name
        val result = folder.rename(temp, target).toString()
        store.updateIndex {
            it.copy(exports = it.exports + (key to result), garbage = it.garbage - temp.toString())
        }
        return result
    }

    private fun syncCompanions(
        folder: MusicFolder,
        root: Uri,
        identity: String,
        snapshot: JsonObject,
        track: JsonObject,
        saved: SyncedFile,
    ) {
        val id = track.string("id")
        val lyrics = snapshot["lyrics"]?.jsonObject?.get(id) as? JsonObject
        val cover = store.asset("api/tracks/$id/cover")
        val key = sha256("${lyrics ?: ""}:$cover".toByteArray())
        if (saved.metadataKey == key && saved.companions.all { folder.exists(Uri.parse(it)) })
            return
        val parts = saved.relativePath.removePrefix("$identity/").split('/')
        var parent = root
        for (part in parts.dropLast(1)) parent = folder.directory(parent, part)
        val stem = parts.last().substringBeforeLast('.')
        val companions = mutableListOf<String>()
        for (uri in saved.companions) if (folder.exists(Uri.parse(uri)))
            folder.delete(Uri.parse(uri))
        fun companion(name: String, bytes: ByteArray, mime: String) {
            // Recovery for a companion written by an earlier version/process
            // before its index commit. Reuse only byte-for-byte identical data.
            folder.children(parent)[name]?.let { existing ->
                if (folder.input(existing).use { sha256(it.readBytes()) } == sha256(bytes)) {
                    companions += existing.toString()
                    return
                }
                // Preserve an untracked partial/user file rather than overwrite it.
                folder.rename(existing, ".$name.recovered-${UUID.randomUUID().toString().take(8)}")
            }
            val uri = createOwned(folder, parent, name, mime)
            folder.output(uri).use { it.write(bytes) }
            companions += uri.toString()
        }
        if (lyrics != null) {
            val lines = lyrics.objects("lines")
            val timed = lines.isNotEmpty()
            val text =
                if (timed)
                    lines.joinToString("\n") {
                        val ms = it.getValue("at").jsonPrimitive.long
                        "[%02d:%02d.%02d]%s"
                            .format(
                                java.util.Locale.ROOT,
                                ms / 60000,
                                (ms / 1000) % 60,
                                (ms / 10) % 100,
                                it.string("text"),
                            )
                    }
                else lyrics.string("plain")
            companion("$stem.${if(timed) "lrc" else "txt"}", text.toByteArray(), "text/plain")
        }
        if (cover != null) {
            val bitmap = android.graphics.BitmapFactory.decodeFile(Uri.parse(cover).path)
            if (bitmap != null) {
                val bytes =
                    java.io.ByteArrayOutputStream().use { output ->
                        bitmap.compress(android.graphics.Bitmap.CompressFormat.JPEG, 92, output)
                        output.toByteArray()
                    }
                bitmap.recycle()
                companion("$stem.jpg", bytes, "image/jpeg")
            }
        }
        store.updateIndex { index ->
            index.copy(
                files =
                    index.files + (id to saved.copy(metadataKey = key, companions = companions)),
                garbage = index.garbage - companions.toSet(),
            )
        }
    }

    private fun createOwned(folder: MusicFolder, parent: Uri, name: String, mime: String): Uri {
        if (folder.children(parent).containsKey(name))
            throw IOException("A file named $name already exists")
        val stream = creatingFile.startWrite()
        try {
            stream.write(
                buildJsonObject {
                    put("parent", parent.toString())
                    put("name", name)
                }
                    .toString()
                    .toByteArray()
            )
            creatingFile.finishWrite(stream)
        } catch (error: Throwable) {
            creatingFile.failWrite(stream)
            throw error
        }
        val uri = folder.create(parent, name, mime)
        store.updateIndex { it.copy(garbage = it.garbage + uri.toString()) }
        creatingFile.delete()
        return uri
    }

    private fun recoverCreation(folder: MusicFolder) {
        if (!creatingFile.baseFile.exists()) return
        val intent =
            store.json
                .parseToJsonElement(creatingFile.openRead().bufferedReader().use { it.readText() })
                .jsonObject
        folder.children(Uri.parse(intent.string("parent")))[intent.string("name")]?.let { uri ->
            store.updateIndex { it.copy(garbage = (it.garbage + uri.toString()).distinct()) }
        }
        creatingFile.delete()
    }

    private fun exportPlaylists(folder: MusicFolder, root: Uri, snapshot: JsonObject) {
        val wanted = mutableSetOf<String>()
        fun playlist(key: String, name: String, ids: List<String>) {
            wanted += key
            val text =
                "#EXTM3U\n" +
                    ids.mapNotNull {
                            store.index.files[it]?.relativePath?.substringAfter('/')?.let { path ->
                                "./$path"
                            }
                        }
                        .joinToString("\n") +
                    "\n"
            export(folder, root, name, text.toByteArray(), "audio/x-mpegurl", key)
        }
        for (p in snapshot.objects("playlists")) {
            val id = p.string("id")
            val ids =
                (snapshot["playlistTracks"]?.jsonObject?.get(id) as? JsonArray).orEmpty().map {
                    it.jsonPrimitive.content
                }
            playlist(
                "playlist:$id",
                "${MusicFolder.safeName(p.string("name"))} [${id.take(8)}].m3u8",
                ids,
            )
        }
        (snapshot["mixes"] as? JsonObject).orEmpty().forEach { (kind, mix) ->
            playlist(
                "mix:$kind",
                "Caimack $kind.m3u8",
                mix.jsonObject.objects("tracks").map { it.string("id") },
            )
        }
        val radio =
            snapshot["radio"]?.jsonObject?.objects("tracks").orEmpty().map {
                it.getValue("track").jsonObject.string("id")
            }
        playlist("station:radio", "Caimack Radio.m3u8", radio)
        val stale =
            store.index.exports.filter { (key, _) ->
                (key.startsWith("playlist:") ||
                    key.startsWith("mix:") ||
                    key.startsWith("station:")) && key !in wanted
            }
        store.updateIndex {
            it.copy(exports = it.exports - stale.keys, garbage = it.garbage + stale.values)
        }
        clean(folder)
    }
}
