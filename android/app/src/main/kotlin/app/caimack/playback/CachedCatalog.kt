// SPDX-License-Identifier: AGPL-3.0-only
package app.caimack.playback

import kotlinx.serialization.json.*
import okhttp3.HttpUrl

/** Read-only views of metadata already cached by this device. No downloads or mutations. */
internal object CachedCatalog {
    data class Result(val value: JsonElement = JsonNull, val code: Int = 200)

    fun read(
        path: String,
        url: HttpUrl,
        body: JsonObject,
        data: JsonObject,
        method: String = "GET",
    ): Result? {
        if (method != "GET" && !(method == "POST" && path == "tracks/lookup")) return null
        val parts = path.split('/')
        val id = parts.getOrNull(1)
        val query = url.queryParameter("q").orEmpty().lowercase().trim()
        val tracks = data.objects("tracks")
        fun matches(value: JsonObject) =
            query.isEmpty() ||
                listOf("title", "name", "artistName", "albumTitle").any {
                    value.string(it).lowercase().contains(query)
                }
        val ordered =
            tracks
                .filter(::matches)
                .sortedWith(
                    compareBy<JsonObject> { it.string("title").lowercase() }
                        .thenBy { it.string("id") }
                )
        val albums = data.objects("albums").filter(::matches)
        val artists = data.objects("artists").filter(::matches)
        fun page(items: List<JsonElement>): Result {
            val size = (url.queryParameter("pageSize")?.toIntOrNull() ?: 50).coerceIn(1, 10_000)
            val page = (url.queryParameter("page")?.toIntOrNull() ?: 1).coerceAtLeast(1)
            val start = ((page.toLong() - 1) * size).coerceAtMost(items.size.toLong()).toInt()
            return Result(
                buildJsonObject {
                    put("items", JsonArray(items.drop(start).take(size)))
                    put("total", items.size)
                    put("page", page)
                    put("pageSize", size)
                }
            )
        }
        fun albumTracks(id: String?) =
            tracks
                .filter { it.string("albumId") == id }
                .sortedWith(
                    compareBy<JsonObject> {
                            it["discNumber"]?.jsonPrimitive?.intOrNull ?: 0
                        }
                        .thenBy { it["trackNumber"]?.jsonPrimitive?.intOrNull ?: 0 }
                        .thenBy { it.string("title") }
                )
        fun find(items: List<JsonObject>, id: String?) = items.firstOrNull {
            it.string("id") == id
        }
        fun result(value: JsonElement?) = if (value == null) Result(code = 404) else Result(value)
        val playlists = data.objects("playlists")
        return when {
            path == "me/library" -> result(data["savedLibrary"] ?: JsonArray(emptyList()))
            path == "me/library/folders" -> result(data["libraryFolders"] ?: JsonArray(emptyList()))
            path == "tracks" || path == "search/tracks" -> {
                val sort = url.queryParameter("sort").orEmpty().lowercase()
                page(
                    when (sort) {
                        "recent",
                        "1" -> ordered.sortedByDescending { it.string("createdAt") }
                        "artist",
                        "2" -> ordered.sortedBy { it.string("artistName").lowercase() }
                        "album",
                        "3" -> ordered.sortedBy { it.string("albumTitle").lowercase() }
                        "bpm",
                        "4" ->
                            ordered.sortedBy {
                                (it["cues"] as? JsonObject)?.get("bpm")?.jsonPrimitive?.doubleOrNull
                                    ?: Double.MAX_VALUE
                            }
                        "key",
                        "5" ->
                            ordered.sortedWith(
                                compareBy<JsonObject> {
                                        (it["key"] as? JsonObject)
                                            ?.string("camelot")
                                            ?.dropLast(1)
                                            ?.toIntOrNull() ?: Int.MAX_VALUE
                                    }
                                    .thenBy {
                                        (it["key"] as? JsonObject)?.string("camelot")?.lastOrNull()
                                    }
                            )
                        "loudness",
                        "6" ->
                            ordered.sortedByDescending {
                                (it["loudness"] as? JsonObject)
                                    ?.get("lufs")
                                    ?.jsonPrimitive
                                    ?.doubleOrNull ?: -Double.MAX_VALUE
                            }
                        else -> ordered
                    }
                )
            }
            path == "tracks/shuffle" -> Result(JsonArray(ordered.shuffled().take(200)))
            path == "tracks/lookup" -> {
                val byId = tracks.associateBy { it.string("id") }
                Result(
                    JsonArray(
                        (body["ids"] as? JsonArray).orEmpty().mapNotNull {
                            byId[it.jsonPrimitive.content]
                        }
                    )
                )
            }
            path == "albums" || path == "search/albums" -> page(albums)
            parts.size == 2 && parts[0] == "albums" ->
                result(
                    find(data.objects("albums"), id)?.with("tracks" to JsonArray(albumTracks(id)))
                )
            path == "artists" || path == "search/artists" -> page(artists)
            parts.size >= 2 && parts[0] == "artists" -> {
                val artistTracks = tracks.filter {
                    it.string("artistId") == id ||
                        it.objects("artists").any { a -> a.string("id") == id }
                }
                if (parts.last() == "top-tracks")
                    Result(
                        JsonArray(
                            artistTracks.take(
                                url.queryParameter("limit")?.toIntOrNull()?.coerceIn(1, 50) ?: 10
                            )
                        )
                    )
                else
                    result(
                        find(data.objects("artists"), id)
                            ?.with(
                                "tracks" to page(artistTracks).value,
                                "albums" to
                                    JsonArray(
                                        data.objects("albums").filter {
                                            it.string("id") in
                                                artistTracks
                                                    .map { track -> track.string("albumId") }
                                                    .toSet()
                                        }
                                    ),
                            )
                    )
            }
            path == "genres" -> result(data["genres"])
            parts.size == 3 && parts[0] == "genres" && parts[2] == "tracks" -> {
                val name = find(data.objects("genres"), id)?.string("name")
                page(ordered.filter { it.string("genreName") == name })
            }
            path == "favorites" ->
                page(ordered.filter { it["isFavorite"]?.jsonPrimitive?.booleanOrNull == true })
            path == "history/recent" -> {
                val byId = tracks.associateBy { it.string("id") }
                page(
                    (data["recent"] as? JsonArray).orEmpty().mapNotNull {
                        byId[it.jsonPrimitive.content]
                    }
                )
            }
            path == "playlists" ->
                Result(
                    JsonArray(
                        playlists.filter {
                            it.string("ownerId") == data["user"]?.jsonObject?.string("id")
                        }
                    )
                )
            path == "playlists/public" ->
                Result(
                    JsonArray(
                        playlists.filter {
                            it["isPublic"]?.jsonPrimitive?.booleanOrNull == true
                        }
                    )
                )
            parts.size == 2 && parts[0] == "playlists" -> {
                val byId = tracks.associateBy { it.string("id") }
                val members =
                    (data["playlistTracks"]?.jsonObject?.get(id) as? JsonArray)
                        .orEmpty()
                        .mapNotNull { byId[it.jsonPrimitive.content] }
                result(find(playlists, id)?.with("tracks" to JsonArray(members)))
            }
            path == "search" ->
                Result(
                    buildJsonObject {
                        val limit =
                            (url.queryParameter("limit")?.toIntOrNull() ?: 8).coerceIn(1, 100)
                        put("tracks", JsonArray(ordered.take(limit)))
                        put("albums", JsonArray(albums.take(limit)))
                        put("artists", JsonArray(artists.take(limit)))
                        put(
                            "genres",
                            JsonArray(data.objects("genres").filter(::matches).take(limit)),
                        )
                    }
                )
            else -> null
        }
    }
}

internal fun JsonObject.string(key: String): String =
    (get(key) as? JsonPrimitive)?.contentOrNull.orEmpty()

internal fun JsonObject.objects(key: String): List<JsonObject> =
    (get(key) as? JsonArray).orEmpty().mapNotNull { it as? JsonObject }

internal fun JsonObject.with(vararg values: Pair<String, JsonElement>): JsonObject =
    JsonObject(this + values)
