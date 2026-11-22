// SPDX-License-Identifier: AGPL-3.0-only
package app.caimack.playback

import app.caimack.api.Track
import java.io.File
import java.io.IOException
import java.nio.file.Files
import java.nio.file.StandardCopyOption
import java.security.MessageDigest
import java.util.concurrent.TimeUnit
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import okhttp3.OkHttpClient
import okhttp3.Request

/** Persistent artwork, separate from the evictable image loader cache. */
class DownloadedArtwork(private val directory: File, private val legacyDirectory: File? = null) {
    private val changed = MutableStateFlow(0L)
    val revision: StateFlow<Long> = changed
    private val refreshLock = Any()
    private var invalidationRevision = 0L

    @Serializable private data class Entry(val file: String, val etag: String? = null)
    private fun hash(bytes: ByteArray) = MessageDigest.getInstance("SHA-256").digest(bytes).joinToString("") { "%02x".format(it) }
    private fun record(server: String, path: String, account: String) = File(directory, hash("$account\n$server\n$path".toByteArray()) + ".json")
    private fun entry(record: File): Entry? = runCatching { Json.decodeFromString<Entry>(record.readText()) }.getOrNull()
        ?.takeIf { it.file.startsWith(record.nameWithoutExtension + "-") && it.file.matches(Regex("[a-f0-9-]+")) }

    private fun save(record: File, entry: Entry) {
        val temporary = File.createTempFile("artwork-index-", ".part", directory)
        try {
            temporary.outputStream().use { it.write(Json.encodeToString(entry).toByteArray()); it.fd.sync() }
            Files.move(temporary.toPath(), record.toPath(), StandardCopyOption.ATOMIC_MOVE, StandardCopyOption.REPLACE_EXISTING)
        } finally { temporary.delete() }
    }

    @Synchronized
    fun asset(server: String, path: String, account: String = server): String? {
        val record = record(server, path, account)
        val cached = entry(record)?.let { File(directory, it.file) }?.takeIf { it.isFile && it.length() > 0 }
        if (cached != null) return cached.toURI().toString()
        // The local fork used an account-bound flat cache. Import it without a
        // network request so upgrades keep previously downloaded artwork offline.
        val legacy = legacyDirectory?.let { File(it, hash((account + path).toByteArray())) }
            ?.takeIf { it.isFile && it.length() > 0 } ?: return null
        return try {
            directory.mkdirs()
            val temporary = File.createTempFile("artwork-migrate-", ".part", directory)
            try {
                temporary.outputStream().use { output -> legacy.inputStream().use { it.copyTo(output) }; output.fd.sync() }
                val target = File(directory, record.nameWithoutExtension + "-" + hash(temporary.readBytes()))
                Files.move(temporary.toPath(), target.toPath(), StandardCopyOption.ATOMIC_MOVE, StandardCopyOption.REPLACE_EXISTING)
                save(record, Entry(target.name))
                legacy.delete()
                target.toURI().toString()
            } finally { temporary.delete() }
        } catch (_: IOException) {
            legacy.toURI().toString()
        }
    }

    @Synchronized
    fun invalidate(server: String, path: String, account: String = server) {
        asset(server, path, account)
        record(server, path, account).setLastModified(0)
        invalidationRevision++
    }

    fun cache(server: String, paths: List<String>, client: OkHttpClient, account: String = server) {
        // Serialize refreshes without holding the lock used by offline artwork reads.
        synchronized(refreshLock) {
            directory.mkdirs()
            val http = client.newBuilder().callTimeout(5, TimeUnit.SECONDS).build()
            for (path in paths.distinct()) {
                try {
                    refresh(server, path, http, account)
                } catch (_: IOException) {
                    // Retry after reconnect/resume. An interrupted transfer leaves the offline copy intact.
                    return
                }
            }
        }
    }

    private fun refresh(server: String, path: String, http: OkHttpClient, account: String) {
        val record = record(server, path, account)
        val (old, cached, revision) = synchronized(this) {
            asset(server, path, account)
            val entry = entry(record)
            val file = entry?.let { File(directory, it.file) }?.takeIf { it.isFile && it.length() > 0 }
            if (file != null && System.currentTimeMillis() - record.lastModified() < TimeUnit.HOURS.toMillis(1)) return
            Triple(entry, file, invalidationRevision)
        }
        val request = Request.Builder().url(server + path)
        if (cached != null) old?.etag?.let { request.header("If-None-Match", it) }
        http.newCall(request.build()).execute().use { response ->
            if (response.code == 401 || response.code >= 500) throw IOException("Artwork server unavailable")
            if (response.code == 304 && cached != null && old != null) {
                synchronized(this) { if (revision == invalidationRevision) save(record, old) }
                return
            }
            if (response.code == 404 && old != null) {
                synchronized(this) {
                    if (revision == invalidationRevision) {
                        record.delete()
                        cached?.delete()
                        changed.value++
                    }
                }
                return
            }
            if (!response.isSuccessful || !response.header("Content-Type").orEmpty().startsWith("image/")) return
            val temporary = File.createTempFile("artwork-", ".part", directory)
            try {
                temporary.outputStream().use { output ->
                    response.body.byteStream().use { it.copyTo(output) }
                    output.fd.sync()
                }
                if (temporary.length() == 0L) return
                val target = File(directory, record.nameWithoutExtension + "-" + hash(temporary.readBytes()))
                synchronized(this) {
                    if (revision != invalidationRevision) return
                    Files.move(temporary.toPath(), target.toPath(), StandardCopyOption.ATOMIC_MOVE, StandardCopyOption.REPLACE_EXISTING)
                    save(record, Entry(target.name, response.header("ETag")))
                    if (old?.file != target.name) {
                        changed.value++
                        cached?.delete()
                    }
                }
            } finally { temporary.delete() }
        }
    }

    companion object {
        fun paths(tracks: List<Track>): List<String> = buildList {
            tracks.filter { it.hasCover }.forEach {
                add(if (it.albumId != null && it.coverRevision == null) "api/albums/${it.albumId}/cover" else "api/tracks/${it.id}/cover")
            }
            tracks.forEach { track ->
                add("api/artists/${track.artistId}/image")
                track.artists.orEmpty().forEach { add("api/artists/${it.id}/image") }
            }
        }.distinct()
    }
}
