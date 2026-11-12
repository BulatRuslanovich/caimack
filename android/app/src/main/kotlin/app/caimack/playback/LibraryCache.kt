// SPDX-License-Identifier: AGPL-3.0-only
package app.caimack.playback

import java.io.File
import java.io.IOException
import java.nio.file.Files
import java.nio.file.StandardCopyOption
import java.security.MessageDigest
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.serialization.json.*
import okhttp3.*
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.ResponseBody.Companion.toResponseBody

/** Account-bound metadata cache. Audio availability is checked separately. */
class LibraryCache(
    private val directory: File,
    private val identity: () -> String?,
    private val local: () -> JsonObject,
    private val json: Json,
    private val address: () -> String? = { null },
) {
    val offline = MutableStateFlow(true)
    private var modeFor: String? = null
    private var loadedFor: String? = null
    private var responses = linkedMapOf<String, JsonElement>()

    private fun file(key: String) =
        File(
            directory,
            MessageDigest.getInstance("SHA-256").digest(key.toByteArray()).joinToString("") {
                "%02x".format(it)
            } + ".json",
        )

    @Synchronized
    private fun stored(key: String): Map<String, JsonElement> {
        if (loadedFor != key) {
            responses =
                runCatching { json.parseToJsonElement(file(key).readText()).jsonObject.toMap() }
                    .getOrDefault(emptyMap())
                    .toMap(linkedMapOf())
            loadedFor = key
        }
        return responses.toMap()
    }

    @Synchronized
    private fun remember(key: String, path: String, value: JsonElement) {
        stored(key)
        responses.remove(path)
        responses[path] = value
        directory.mkdirs()
        val temporary = File.createTempFile("library-", ".part", directory)
        try {
            temporary.writeText(JsonObject(responses).toString())
            Files.move(
                temporary.toPath(),
                file(key).toPath(),
                StandardCopyOption.ATOMIC_MOVE,
                StandardCopyOption.REPLACE_EXISTING,
            )
        } finally {
            temporary.delete()
        }
    }

    val interceptor = Interceptor { chain ->
        val request = chain.request()
        val server = address()
        if (server != null && !request.url.toString().startsWith(server))
            return@Interceptor chain.proceed(request)
        val path = request.url.encodedPath.substringAfter("/api/", "")
        val key = identity()
        synchronized(this) {
            if (modeFor != key) {
                modeFor = key
                offline.value = true
            }
        }
        val readable = request.method == "GET" && cacheable(path) && key != null
        fun fallback(): Response? {
            if (!readable || identity() != key) return null
            val data = merge(local(), stored(key))
            val result =
                CachedCatalog.read(path, request.url, buildJsonObject {}, data) ?: return null
            return Response.Builder()
                .request(request)
                .protocol(Protocol.HTTP_1_1)
                .code(result.code)
                .message("Offline library")
                .body(result.value.toString().toResponseBody("application/json".toMediaType()))
                .build()
        }
        if (offline.value && readable)
            fallback()?.let {
                return@Interceptor it
            }
        try {
            val response = chain.proceed(request)
            if (response.code >= 500 && readable && identity() == key) {
                offline.value = true
                fallback()?.let {
                    response.close()
                    return@Interceptor it
                }
            }
            if (response.isSuccessful && identity() == key) {
                if (readable) {
                    val value = runCatching {
                        json.parseToJsonElement(response.peekBody(16L * 1024 * 1024).string())
                    }.getOrNull()
                    if (value != null)
                        runCatching {
                            remember(
                                key,
                                request.url.encodedPath + "?" + request.url.encodedQuery.orEmpty(),
                                value,
                            )
                        }
                }
                if (path == "auth/me" || path == "auth/login" || readable) offline.value = false
            }
            response
        } catch (error: IOException) {
            if (identity() == key && (readable || path == "auth/me")) offline.value = true
            fallback() ?: throw error
        }
    }

    fun availableCollection(kind: String, id: String): Boolean {
        val key = identity() ?: return false
        val downloaded = local()
        val songs = downloaded.objects("tracks")
        return when (kind) {
            "album" -> songs.any { it.string("albumId") == id }
            "artist" ->
                songs.any {
                    it.string("artistId") == id ||
                        it.objects("artists").any { a -> a.string("id") == id }
                }
            "playlist" -> {
                val ids = songs.map { it.string("id") }.toSet()
                val data = merge(downloaded, stored(key))
                (data["playlistTracks"]?.jsonObject?.get(id) as? JsonArray).orEmpty().any {
                    it.jsonPrimitive.content in ids
                }
            }
            else -> false
        }
    }

    companion object {
        fun cacheable(path: String): Boolean =
            path in
                setOf(
                    "me/library",
                    "me/library/folders",
                    "favorites",
                    "history/recent",
                    "genres",
                ) ||
                Regex("(tracks|albums|artists|playlists)(/[^/]+)?(/top-tracks)?").matches(path) ||
                path.startsWith("search")

        fun merge(local: JsonObject, responses: Map<String, JsonElement>): JsonObject {
            fun rows(value: JsonElement?): List<JsonObject> =
                when (value) {
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
            fun add(target: MutableMap<String, JsonObject>, values: List<JsonObject>) {
                values.forEach { if (id(it).isNotEmpty()) target[id(it)] = it }
            }
            add(tracks, rows(local["tracks"]))
            add(albums, rows(local["albums"]))
            add(artists, rows(local["artists"]))
            add(playlists, rows(local["playlists"]))
            for ((url, value) in responses) {
                val path = url.substringBefore('?').removePrefix("/api/")
                val obj = value as? JsonObject
                when {
                    path == "me/library" -> saved = value
                    path == "me/library/folders" -> folders = value
                    path == "tracks" ||
                        path == "search/tracks" ||
                        path == "favorites" ||
                        path == "history/recent" -> {
                        add(tracks, rows(value))
                        if (path == "history/recent")
                            recent = JsonArray(rows(value).map { JsonPrimitive(id(it)) })
                    }
                    path == "albums" || path == "search/albums" -> add(albums, rows(value))
                    path.startsWith("albums/") && obj != null -> {
                        add(albums, listOf(obj))
                        add(tracks, rows(obj["tracks"]))
                    }
                    path == "artists" || path == "search/artists" -> add(artists, rows(value))
                    path.endsWith("/top-tracks") -> add(tracks, rows(value))
                    path.startsWith("artists/") && obj != null -> {
                        add(artists, listOf(obj))
                        add(albums, rows(obj["albums"]))
                        add(tracks, rows(obj["tracks"]))
                    }
                    path == "playlists" || path == "playlists/public" -> add(playlists, rows(value))
                    path.startsWith("playlists/") && obj != null -> {
                        add(
                            playlists,
                            listOf(
                                obj.with("trackCount" to JsonPrimitive(rows(obj["tracks"]).size))
                            ),
                        )
                        add(tracks, rows(obj["tracks"]))
                        membership[id(obj)] =
                            JsonArray(rows(obj["tracks"]).map { JsonPrimitive(id(it)) })
                    }
                    path == "search" && obj != null -> {
                        add(tracks, rows(obj["tracks"]))
                        add(albums, rows(obj["albums"]))
                        add(artists, rows(obj["artists"]))
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
                    "album" ->
                        albums.putIfAbsent(
                            itemId,
                            buildJsonObject {
                                put("id", itemId)
                                put("title", title)
                                put("artistId", "")
                                put("artistName", subtitle)
                                put("hasCover", image)
                            },
                        )
                    "artist" ->
                        artists.putIfAbsent(
                            itemId,
                            buildJsonObject {
                                put("id", itemId)
                                put("name", title)
                                put("hasImage", image)
                            },
                        )
                    "playlist" ->
                        playlists.putIfAbsent(
                            itemId,
                            buildJsonObject {
                                put("id", itemId)
                                put("name", title)
                                put("ownerName", subtitle)
                                put("hasCover", image)
                                put("coverTrackId", item["coverTrackId"] ?: JsonNull)
                            },
                        )
                }
            }
            val mergedSaved =
                rows(saved ?: local["savedLibrary"]).distinctBy { it["kind"] to it["id"] }
            return JsonObject(
                local +
                    mapOf(
                        "tracks" to JsonArray(tracks.values.toList()),
                        "albums" to JsonArray(albums.values.toList()),
                        "artists" to JsonArray(artists.values.toList()),
                        "playlists" to JsonArray(playlists.values.toList()),
                        "playlistTracks" to JsonObject(membership),
                        "savedLibrary" to JsonArray(mergedSaved),
                        "libraryFolders" to folders,
                        "recent" to recent,
                    )
            )
        }
    }
}
