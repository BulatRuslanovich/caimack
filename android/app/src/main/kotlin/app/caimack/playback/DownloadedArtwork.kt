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
import okhttp3.OkHttpClient
import okhttp3.Request

/** Persistent artwork, separate from the evictable image loader cache. */
class DownloadedArtwork(private val directory: File) {
    private val changed = MutableStateFlow(0L)
    val revision: StateFlow<Long> = changed

    private fun file(server: String, path: String) = File(directory,
        MessageDigest.getInstance("SHA-256").digest((server + path).toByteArray()).joinToString("") { "%02x".format(it) })

    fun asset(server: String, path: String): String? = file(server, path)
        .takeIf { it.isFile && it.length() > 0 }?.toURI()?.toString()

    @Synchronized
    fun cache(server: String, paths: List<String>, client: OkHttpClient) {
        directory.mkdirs()
        val http = client.newBuilder().callTimeout(5, TimeUnit.SECONDS).build()
        for (path in paths.distinct()) {
            if (asset(server, path) != null) continue
            try {
                http.newCall(Request.Builder().url(server + path).build()).execute().use { response ->
                    if (response.code == 401 || response.code >= 500) return
                    if (!response.isSuccessful || !response.header("Content-Type").orEmpty().startsWith("image/")) return@use
                    val temporary = File.createTempFile("artwork-", ".part", directory)
                    try {
                        temporary.outputStream().use { output ->
                            response.body.byteStream().use { it.copyTo(output) }
                            output.fd.sync()
                        }
                        if (temporary.length() == 0L) return@use
                        Files.move(temporary.toPath(), file(server, path).toPath(), StandardCopyOption.ATOMIC_MOVE, StandardCopyOption.REPLACE_EXISTING)
                        changed.value++
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
