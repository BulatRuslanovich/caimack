// SPDX-License-Identifier: AGPL-3.0-only
package app.caimack.playback

import app.caimack.api.Lyrics
import java.io.File
import java.io.IOException
import java.nio.file.Files
import java.nio.file.StandardCopyOption
import java.security.MessageDigest
import java.util.concurrent.TimeUnit
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.Serializable
import kotlinx.serialization.SerializationException
import kotlinx.serialization.json.Json
import retrofit2.HttpException
import retrofit2.Response

/** Durable lyrics for individual downloads, independent of the evictable page cache. */
class DownloadedLyrics(
    private val directory: File,
    private val json: Json,
    private val identity: () -> String?,
    private val downloadedIds: () -> Set<String>,
    private val fetch: suspend (String) -> Response<Lyrics>,
    private val clock: () -> Long = System::currentTimeMillis,
) {
    @Serializable
    private data class Entry(val lyrics: Lyrics, val checkedAt: Long)

    private fun hash(value: String) = MessageDigest.getInstance("SHA-256")
        .digest(value.toByteArray()).joinToString("") { "%02x".format(it) }
    private fun file(owner: String, id: String) = File(File(directory, hash(owner)), hash(id) + ".json")
    private fun read(owner: String, id: String): Entry? =
        runCatching { json.decodeFromString<Entry>(file(owner, id).readText()) }.getOrNull()

    private fun available(owner: String?, id: String): Boolean =
        owner != null && identity() == owner && id in downloadedIds()

    @Synchronized
    private fun save(owner: String, id: String, lyrics: Lyrics) {
        if (!available(owner, id)) return
        val target = file(owner, id)
        target.parentFile!!.mkdirs()
        val temporary = File.createTempFile("lyrics-", ".part", target.parentFile)
        try {
            temporary.outputStream().use { output ->
                output.write(json.encodeToString(Entry(lyrics, clock())).toByteArray())
                output.fd.sync()
            }
            Files.move(temporary.toPath(), target.toPath(), StandardCopyOption.ATOMIC_MOVE, StandardCopyOption.REPLACE_EXISTING)
        } finally { temporary.delete() }
    }

    suspend fun load(id: String, offline: Boolean = false): Lyrics = load(id, offline, fallbackOnFailure = true)

    private suspend fun load(id: String, offline: Boolean, fallbackOnFailure: Boolean): Lyrics = withContext(Dispatchers.IO) {
        val owner = identity()
        val cached = if (available(owner, id)) read(owner!!, id)?.lyrics else null
        if (offline && cached != null && available(owner, id)) return@withContext cached
        val response = try {
            fetch(id)
        } catch (error: IOException) {
            if (fallbackOnFailure && cached != null && available(owner, id)) return@withContext cached
            throw error
        }
        if (identity() != owner) throw IOException("Account changed while loading lyrics")
        if (!response.isSuccessful) {
            if (fallbackOnFailure && response.code() >= 500 && cached != null && available(owner, id)) return@withContext cached
            throw HttpException(response)
        }
        val lyrics = response.body() ?: Lyrics()
        if (available(owner, id)) {
            // A failed metadata write must not stop online playback or an audio download.
            try { save(owner!!, id, lyrics) } catch (_: IOException) { }
        }
        lyrics
    }

    /** Backfill existing downloads and retry missing/pending lyrics on reconnect. */
    suspend fun refresh(ids: Collection<String>) = withContext(Dispatchers.IO) {
        val owner = identity() ?: return@withContext
        val folder = File(directory, hash(owner))
        val retained = downloadedIds().mapTo(hashSetOf()) { hash(it) + ".json" }
        if (identity() != owner) return@withContext
        folder.listFiles()?.filter { it.extension == "json" && it.name !in retained }?.forEach { it.delete() }
        for (id in ids.distinct()) {
            if (identity() != owner) return@withContext
            if (!available(owner, id)) continue
            val cached = read(owner, id)
            if (cached != null && (cached.lyrics.plain.isNotBlank() || cached.lyrics.lines.isNotEmpty()) &&
                clock() - cached.checkedAt in 0 until TimeUnit.HOURS.toMillis(1)) continue
            try {
                load(id, offline = false, fallbackOnFailure = false)
            } catch (_: IOException) {
                return@withContext
            } catch (error: HttpException) {
                if (error.code() == 401 || error.code() >= 500) return@withContext
            } catch (_: SerializationException) {
                // A malformed response for one track must not block the remaining downloads.
            }
        }
    }
}
