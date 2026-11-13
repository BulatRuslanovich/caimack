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
class DownloadedArtwork(private val directory: File) {
    private val changed = MutableStateFlow(0L)
    val revision: StateFlow<Long> = changed

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

    fun asset(server: String, path: String, account: String = server): String? = entry(record(server, path, account))
        ?.let { File(directory, it.file) }?.takeIf { it.isFile && it.length() > 0 }?.toURI()?.toString()

    @Synchronized
    fun cache(server: String, paths: List<String>, client: OkHttpClient, account: String = server) {
        directory.mkdirs()
        val http = client.newBuilder().callTimeout(5, TimeUnit.SECONDS).build()
        for (path in paths.distinct()) {
            val record = record(server, path, account)
            val old = entry(record)
            val cached = old?.let { File(directory, it.file) }?.takeIf { it.isFile && it.length() > 0 }
            if (cached != null && System.currentTimeMillis() - record.lastModified() < TimeUnit.HOURS.toMillis(1)) continue
            try {
                val request = Request.Builder().url(server + path)
                if (cached != null) old?.etag?.let { request.header("If-None-Match", it) }
                http.newCall(request.build()).execute().use { response ->
                    if (response.code == 304 && cached != null && old != null) {
                        save(record, old)
                        return@use
                    }
                    if (response.code == 401 || response.code >= 500) return
                    if (response.code == 404 && old != null) {
                        record.delete()
                        cached?.delete()
                        changed.value++
                        return@use
                    }
                    if (!response.isSuccessful || !response.header("Content-Type").orEmpty().startsWith("image/")) return@use
                    val temporary = File.createTempFile("artwork-", ".part", directory)
                    try {
                        temporary.outputStream().use { output ->
                            response.body.byteStream().use { it.copyTo(output) }
                            output.fd.sync()
                        }
                        if (temporary.length() == 0L) return@use
                        val target = File(directory, record.nameWithoutExtension + "-" + hash(temporary.readBytes()))
                        Files.move(temporary.toPath(), target.toPath(), StandardCopyOption.ATOMIC_MOVE, StandardCopyOption.REPLACE_EXISTING)
                        save(record, Entry(target.name, response.header("ETag")))
                        if (old?.file != target.name) {
                            changed.value++
                            cached?.delete()
                        }
                    } finally { temporary.delete() }
                }
            } catch (_: IOException) {
                // Retry after reconnect/resume; never block audio or publish a partial image.
                return
            }
        }
    }

    companion object {
        fun paths(tracks: List<Track>): List<String> = buildList {
            tracks.filter { it.hasCover }.forEach {
                add(if (it.albumId != null) "api/albums/${it.albumId}/cover" else "api/tracks/${it.id}/cover")
            }
            tracks.forEach { track ->
                add("api/artists/${track.artistId}/image")
                track.artists.orEmpty().forEach { add("api/artists/${it.id}/image") }
            }
        }.distinct()
    }
}
