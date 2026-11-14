// SPDX-License-Identifier: AGPL-3.0-only
package app.caimack.playback

import app.caimack.sync.OfflineCatalog
import java.io.File
import java.io.IOException
import java.nio.file.Files
import java.nio.file.StandardCopyOption
import java.security.MessageDigest
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicLong
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.serialization.json.*
import okhttp3.*
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.ResponseBody.Companion.toResponseBody

/** Account-bound metadata cache. Audio availability is checked separately. */
class LibraryCache(private val directory: File, private val identity: () -> String?,
    private val local: () -> JsonObject, private val json: Json,
    private val limits: LibraryCacheLimits = LibraryCacheLimits(),
    private val clock: () -> Long = { System.nanoTime() / 1_000_000 }) {
    val offline = MutableStateFlow(true)
    private var loadedFor: String? = null
    private data class Entry(val value: JsonElement, val bytes: Long)
    private val responses = linkedMapOf<String, Entry>()
    private var lastWrite = 0L
    private var lastAccountUse = 0L
    private val probing = AtomicBoolean()
    private val retryAt = AtomicLong(clock() + limits.retryAfterMs)

    private fun hash(key: String) = MessageDigest.getInstance("SHA-256")
        .digest(key.toByteArray()).joinToString("") { "%02x".format(it) }
    private fun folder(key: String) = File(directory, hash(key))
    private fun file(key: String, path: String) = File(folder(key), hash(path) + ".json")

    @Synchronized private fun stored(key: String): Map<String, JsonElement> {
        if (loadedFor != key) {
            responses.clear()
            loadedFor = key
            val folder = folder(key)
            folder.mkdirs()
            lastWrite = 0L
            folder.listFiles()?.filter { it.extension == "json" }?.sortedBy { it.lastModified() }?.forEach { file ->
                lastWrite = maxOf(lastWrite, file.lastModified())
                if (file.length() > limits.maxEntryBytes) { file.delete(); return@forEach }
                val entry = runCatching { json.parseToJsonElement(file.readText()).jsonObject }.getOrNull()
                val path = entry?.get("path")?.jsonPrimitive?.contentOrNull
                val value = entry?.get("value")
                if (path != null && value != null && file.name == hash(path) + ".json")
                    responses[path] = Entry(value, file.length())
                else file.delete()
            }
            trim(key)
            // Migrate the previous single-file cache once; subsequent writes touch one response.
            val legacy = File(directory, hash(key) + ".json")
            if (legacy.isFile) {
                val old = runCatching { json.parseToJsonElement(legacy.readText()).jsonObject }.getOrNull()
                old?.forEach { (path, value) -> if (path !in responses) save(key, path, value) }
                legacy.delete()
            }
            touch(key)
            pruneAccounts(key)
        }
        return responses.mapValues { it.value.value }
    }

    @Synchronized private fun remember(key: String, path: String, value: JsonElement) {
        stored(key)
        save(key, path, value)
        touch(key)
    }

    private fun touch(key: String) {
        lastAccountUse = maxOf(System.currentTimeMillis(), lastAccountUse + 1)
        folder(key).setLastModified(lastAccountUse)
    }

    private fun save(key: String, path: String, value: JsonElement) {
        val data = buildJsonObject { put("path", path); put("value", value) }.toString().toByteArray()
        if (data.size > limits.maxEntryBytes || data.size > limits.maxBytes) return
        val folder = folder(key).apply { mkdirs() }
        val temporary = File.createTempFile("response-", ".part", folder)
        try {
            temporary.writeBytes(data)
            Files.move(temporary.toPath(), file(key, path).toPath(), StandardCopyOption.ATOMIC_MOVE, StandardCopyOption.REPLACE_EXISTING)
            lastWrite = maxOf(System.currentTimeMillis(), lastWrite + 1)
            file(key, path).setLastModified(lastWrite)
        } finally { temporary.delete() }
        responses.remove(path)
        responses[path] = Entry(value, data.size.toLong())
        trim(key)
    }

    private fun pruneAccounts(key: String) {
        val active = hash(key)
        val accounts = directory.listFiles().orEmpty().filter {
            it.name.removeSuffix(".json").matches(Regex("[a-f0-9]{64}"))
        }.groupBy { it.name.removeSuffix(".json") }
        val others = accounts.filterKeys { it != active }.values.sortedByDescending { group -> group.maxOf { it.lastModified() } }
        var retained = 1
        others.forEach { group ->
            val bytes = group.sumOf { item ->
                if (item.isFile) item.length() else item.listFiles().orEmpty().sumOf { it.length() }
            }
            if (retained >= limits.maxAccounts || bytes > limits.maxBytes) group.forEach { it.deleteRecursively() }
            else retained++
        }
    }

    private fun trim(key: String) {
        var bytes = responses.values.sumOf { it.bytes }
        while (responses.size > limits.maxEntries || bytes > limits.maxBytes) {
            val oldest = responses.entries.first()
            bytes -= oldest.value.bytes
            file(key, oldest.key).delete()
            responses.remove(oldest.key)
        }
    }

    private fun disconnected() {
        retryAt.set(clock() + limits.retryAfterMs)
        offline.value = true
    }

    val interceptor = Interceptor { chain ->
        val request = chain.request()
        val path = request.url.encodedPath.substringAfter("/api/", "")
        val key = identity()
        val readable = request.method == "GET" && cacheable(path) && key != null
        fun fallback(): Response? {
            if (!readable || identity() != key) return null
            val data = merge(local(), stored(key))
            val result = OfflineCatalog.read(path, request.url, buildJsonObject {}, data) ?: return null
            return Response.Builder().request(request).protocol(Protocol.HTTP_1_1).code(result.code)
                .message("Offline library").body(result.value.toString().toResponseBody("application/json".toMediaType())).build()
        }
        var probe = false
        if (offline.value && readable) {
            fallback()?.let { cached ->
                if (clock() < retryAt.get() || !probing.compareAndSet(false, true)) return@Interceptor cached
                probe = true
                cached.close()
            }
        }
        try {
            val network = if (probe) chain.withConnectTimeout(2, java.util.concurrent.TimeUnit.SECONDS)
                .withReadTimeout(3, java.util.concurrent.TimeUnit.SECONDS) else chain
            val response = network.proceed(request)
            if (response.code >= 500 && readable) {
                disconnected()
                fallback()?.let { response.close(); return@Interceptor it }
            }
            if (response.isSuccessful) {
                if (readable) {
                    val value = runCatching { json.parseToJsonElement(response.peekBody(16L * 1024 * 1024).string()) }.getOrNull()
                    if (value != null) runCatching { remember(key, request.url.encodedPath + "?" + request.url.encodedQuery.orEmpty(), value) }
                }
                if (path == "auth/me" || path == "auth/login" || readable) offline.value = false
            }
            response
        } catch (error: IOException) {
            if (readable || path == "auth/me") disconnected()
            fallback() ?: throw error
        } finally {
            if (probe) probing.set(false)
        }
    }

    companion object {
        fun cacheable(path: String): Boolean = path in setOf("me/library", "me/library/folders", "favorites", "history/recent", "genres") ||
            Regex("(tracks|albums|artists|playlists)(/[^/]+)?(/top-tracks)?").matches(path) || path.startsWith("search")

        fun merge(local: JsonObject, responses: Map<String, JsonElement>): JsonObject {
            fun rows(value: JsonElement?): List<JsonObject> = when (value) {
                is JsonArray -> value.mapNotNull { it as? JsonObject }
                is JsonObject -> rows(value["items"])
                else -> emptyList()
            }
            fun id(value: JsonObject) = value["id"]?.jsonPrimitive?.content.orEmpty()
            val tracks = linkedMapOf<String, JsonObject>()
            val albums = linkedMapOf<String, JsonObject>()
            val artists = linkedMapOf<String, JsonObject>()
            val playlists = linkedMapOf<String, JsonObject>()
            val membership = (local["playlistTracks"] as? JsonObject).orEmpty().toMutableMap()
            var saved: JsonElement? = null
            var folders = local["libraryFolders"] ?: JsonArray(emptyList())
            var recent = local["recent"] ?: JsonArray(emptyList())
            fun add(target: MutableMap<String, JsonObject>, values: List<JsonObject>) { values.forEach { if (id(it).isNotEmpty()) target[id(it)] = it } }
            add(tracks, rows(local["tracks"])); add(albums, rows(local["albums"])); add(artists, rows(local["artists"])); add(playlists, rows(local["playlists"]))
            for ((url, value) in responses) {
                val path = url.substringBefore('?').removePrefix("/api/")
                val obj = value as? JsonObject
                when {
                    path == "me/library" -> saved = value
                    path == "me/library/folders" -> folders = value
                    path == "tracks" || path == "search/tracks" || path == "favorites" || path == "history/recent" -> {
                        add(tracks, rows(value))
                        if (path == "history/recent") recent = JsonArray(rows(value).map { JsonPrimitive(id(it)) })
                    }
                    path == "albums" -> add(albums, rows(value))
                    path.startsWith("albums/") && obj != null -> { add(albums, listOf(obj)); add(tracks, rows(obj["tracks"])) }
                    path == "artists" -> add(artists, rows(value))
                    path.endsWith("/top-tracks") -> add(tracks, rows(value))
                    path.startsWith("artists/") && obj != null -> {
                        add(artists, listOf(obj)); add(albums, rows(obj["albums"])); add(tracks, rows(obj["tracks"]))
                    }
                    path == "playlists" || path == "playlists/public" -> add(playlists, rows(value))
                    path.startsWith("playlists/") && obj != null -> {
                        add(playlists, listOf(obj)); add(tracks, rows(obj["tracks"]))
                        membership[id(obj)] = JsonArray(rows(obj["tracks"]).map { JsonPrimitive(id(it)) })
                    }
                    path == "search" && obj != null -> {
                        add(tracks, rows(obj["tracks"])); add(albums, rows(obj["albums"])); add(artists, rows(obj["artists"]))
                    }
                }
            }
            // Library shortcuts carry enough metadata to remain visible even if their
            // detail page has never been visited. Do not discard unavailable collections.
            for (item in rows(saved)) {
                val itemId = id(item)
                val kind = item["kind"]?.jsonPrimitive?.content
                val title = item["title"] ?: JsonPrimitive("")
                val subtitle = item["subtitle"] ?: JsonPrimitive("")
                val image = item["hasImage"] ?: JsonPrimitive(false)
                when (kind) {
                    "album" -> albums.putIfAbsent(itemId, buildJsonObject {
                        put("id", itemId); put("title", title); put("artistId", ""); put("artistName", subtitle); put("hasCover", image)
                        listOf("trackCount", "durationSeconds", "year").forEach { key -> item[key]?.let { put(key, it) } }
                    })
                    "artist" -> artists.putIfAbsent(itemId, buildJsonObject {
                        put("id", itemId); put("name", title); put("hasImage", image)
                        listOf("trackCount", "albumCount").forEach { key -> item[key]?.let { put(key, it) } }
                    })
                    "playlist" -> playlists.putIfAbsent(itemId, buildJsonObject {
                        put("id", itemId); put("name", title); put("ownerName", subtitle); put("hasCover", image)
                        put("coverTrackId", item["coverTrackId"] ?: JsonNull)
                        listOf("trackCount", "durationSeconds").forEach { key -> item[key]?.let { put(key, it) } }
                    })
                }
            }
            val mergedSaved = rows(saved ?: local["savedLibrary"]).distinctBy { it["kind"] to it["id"] }
            return OfflineCatalog.view(JsonObject(local + mapOf(
                "tracks" to JsonArray(tracks.values.toList()), "albums" to JsonArray(albums.values.toList()),
                "artists" to JsonArray(artists.values.toList()), "playlists" to JsonArray(playlists.values.toList()),
                "playlistTracks" to JsonObject(membership), "savedLibrary" to JsonArray(mergedSaved),
                "libraryFolders" to folders, "recent" to recent,
            )), emptyList())
        }
    }
}

data class LibraryCacheLimits(
    val maxEntries: Int = 128,
    val maxBytes: Long = 16L * 1024 * 1024,
    val maxEntryBytes: Long = 4L * 1024 * 1024,
    val maxAccounts: Int = 4,
    val retryAfterMs: Long = 5_000,
) {
    init {
        require(maxEntries > 0 && maxBytes > 0 && maxEntryBytes > 0 && retryAfterMs >= 0)
        require(maxAccounts > 0)
    }
}
