// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

package app.caimack.sync

import java.io.IOException
import java.util.UUID
import kotlinx.serialization.json.*
import okhttp3.HttpUrl
import okhttp3.Interceptor
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.Protocol
import okhttp3.Request
import okhttp3.Response
import okhttp3.ResponseBody.Companion.toResponseBody
import okio.Buffer

/**
 * No recommendation algorithm lives here: radio and mixes are server results. Filtering, sorting
 * and pagination only make the persisted catalog browsable.
 */
class OfflineCatalog(private val store: SyncStore, private val changed: () -> Unit) {
    val interceptor = Interceptor { chain ->
        val request = chain.request()
        val bound = store.boundAddress
        if (
            !store.active ||
                bound == null ||
                !request.url.toString().startsWith(bound) ||
                request.header("X-Caimack-Sync") != null
        )
            return@Interceptor chain.proceed(request)
        val path = request.url.encodedPath.substringAfter("/api/", "")
        val body =
            request.body
                ?.let { Buffer().also(it::writeTo).readUtf8() }
                ?.takeIf { it.startsWith("{") }
                ?.let { store.json.parseToJsonElement(it).jsonObject } ?: buildJsonObject {}
        val snapshot = store.snapshot ?: return@Interceptor chain.proceed(request)
        val mutation = mutation(request.method, path, body, snapshot)
        if (mutation != null) {
            if (!store.enqueue(mutation)) throw IOException("Offline action could not be saved")
            changed()
            return@Interceptor response(
                request,
                mutationResult(mutation, view(snapshot, store.edits())),
            )
        }
        val local = read(path, request.url, body, view(snapshot, store.edits()), request.method)
        if (local != null && path.startsWith("home/mixes/")) store.offlineQueue = true
        if (local != null && path != "auth/me" && path != "config")
            return@Interceptor response(request, local)
        try {
            chain.proceed(request)
        } catch (error: IOException) {
            local?.let { response(request, it) } ?: throw error
        }
    }

    private fun response(request: Request, result: Result): Response =
        Response.Builder()
            .request(request)
            .protocol(Protocol.HTTP_1_1)
            .code(result.code)
            .message("Offline library")
            .body(result.value.toString().toResponseBody("application/json".toMediaType()))
            .build()

    data class Result(val value: JsonElement = JsonNull, val code: Int = 200)

    private fun mutation(
        method: String,
        path: String,
        body: JsonObject,
        snapshot: JsonObject,
    ): SyncAction? {
        if (method == "GET") return null
        val parts = path.split('/')
        fun action(kind: String, id: String? = null, payload: JsonObject = body) =
            SyncAction(kind = kind, entityId = id, payload = payload)
        if (path == "me/library/organize" && method == "POST") {
            val mutation = action("libraryOrganize")
            try { organizeLibrary(view(snapshot, store.edits()), body, mutation.occurredAt) }
            catch (error: IllegalArgumentException) { throw IOException(error.message, error) }
            return mutation
        }
        if (
            parts.size == 3 &&
                parts[0] == "tracks" &&
                parts[2] == "favorite" &&
                method in listOf("POST", "DELETE")
        )
            return action("favorite", parts[1], buildJsonObject { put("value", method == "POST") })
        if (parts.size == 4 && parts.take(2) == listOf("me", "library") && method in listOf("PUT", "DELETE")) {
            if (parts[2] !in listOf("album", "artist", "playlist")) throw IOException("Unknown library item")
            val data = view(snapshot, store.edits())
            if (method == "PUT" && data.objects(parts[2] + "s").none { it.string("id") == parts[3] })
                throw IOException("Library item is unavailable offline")
            return action("library", parts[3], buildJsonObject { put("kind", parts[2]); put("value", method == "PUT") })
        }
        if (path == "history" && method == "POST") return action("history")
        if (path == "recommendations/rules" && method == "POST") return action("tasteRule")
        if (parts.first() != "playlists") return null
        if (parts.size == 1 && method == "POST")
            return action("playlistCreate", UUID.randomUUID().toString())
        if (parts.size < 2) return null
        val id = parts[1]
        val current =
            view(snapshot, store.edits()).objects("playlists").find { it.string("id") == id }
                ?: throw IOException("Playlist is unavailable offline")
        if (current.string("ownerId") != store.boundUser && method != "GET")
            throw IOException("Only the playlist owner can edit it")
        if (parts.size == 2 && method == "DELETE") return action("playlistDelete", id)
        if (parts.size == 2 && method == "PUT") {
            val values =
                mapOf(
                    "name" to (body["name"] ?: JsonPrimitive("")),
                    "description" to (body["description"] ?: JsonNull),
                    "isPublic" to (body["isPublic"] ?: JsonPrimitive(false)),
                )
            val patch =
                JsonObject(values.filter { (key, value) -> (current[key] ?: JsonNull) != value })
            return action("playlistUpdate", id, patch)
        }
        if (parts.size == 3 && parts[2] == "tracks" && method == "POST")
            return action("playlistAdd", id)
        if (parts.size == 4 && parts[2] == "tracks") {
            if (parts[3] == "order" && method == "PUT") return action("playlistOrder", id)
            if (method == "DELETE")
                return action(
                    "playlistRemove",
                    id,
                    buildJsonObject { put("trackIds", JsonArray(listOf(JsonPrimitive(parts[3])))) },
                )
        }
        return null
    }

    private fun mutationResult(action: SyncAction, data: JsonObject): Result =
        when (action.kind) {
            "playlistCreate",
            "playlistUpdate" ->
                Result(data.objects("playlists").first { it.string("id") == action.entityId })
            "tasteRule" ->
                Result(
                    buildJsonObject {
                        put("id", action.id)
                        put("action", action.payload.string("action"))
                        put("name", "")
                    }
                )
            else -> Result(code = 204)
        }

    companion object {
        fun view(snapshot: JsonObject, actions: List<SyncAction>): JsonObject {
            var tracks = snapshot.objects("tracks")
            var playlists = snapshot.objects("playlists")
            var savedLibrary = snapshot.objects("savedLibrary")
            var libraryFolders = snapshot.objects("libraryFolders")
            fun save(kind: String, id: String?, at: String) {
                if (savedLibrary.none { it.string("kind") == kind && it.string("id") == id }) {
                    savedLibrary = savedLibrary + buildJsonObject { put("kind", kind); put("id", id); put("savedAt", at) }
                }
            }
            val membership = (snapshot["playlistTracks"] as? JsonObject).orEmpty().toMutableMap()
            var recent = (snapshot["recent"] as? JsonArray).orEmpty()
            for (action in actions) {
                val p = action.payload
                val id = action.entityId
                when (action.kind) {
                    "libraryOrganize" -> {
                        val current = buildJsonObject {
                            put("savedLibrary", JsonArray(savedLibrary)); put("libraryFolders", JsonArray(libraryFolders))
                        }
                        // A concurrently removed destination must not break offline browsing.
                        val next = try { organizeLibrary(current, p, action.occurredAt) }
                            catch (_: IllegalArgumentException) { current }
                        savedLibrary = next.objects("savedLibrary")
                        libraryFolders = next.objects("libraryFolders")
                    }
                    "library" -> {
                        val kind = p.string("kind")
                        if (p["value"]?.jsonPrimitive?.booleanOrNull == true) save(kind, id, action.occurredAt)
                        else savedLibrary = savedLibrary.filterNot { it.string("kind") == kind && it.string("id") == id }
                    }
                    "favorite" -> tracks = tracks.map {
                            if (it.string("id") == id) it.with("isFavorite" to p.getValue("value"))
                            else it
                        }
                    "history" ->
                        recent =
                            listOf(p.getValue("trackId")) + recent.filter { it != p["trackId"] }
                    "playlistCreate" -> {
                        save("playlist", id, action.occurredAt)
                        playlists =
                            playlists.filter { it.string("id") != id } +
                                p.with(
                                    "id" to JsonPrimitive(id),
                                    "ownerId" to
                                        snapshot.getValue("user").jsonObject.getValue("id"),
                                    "ownerName" to
                                        snapshot.getValue("user").jsonObject.getValue("username"),
                                    "trackCount" to JsonPrimitive(0),
                                    "durationSeconds" to JsonPrimitive(0),
                                )
                    }
                    "playlistUpdate" -> playlists = playlists.map {
                            if (it.string("id") == id) JsonObject(it + p) else it
                        }
                    "playlistDelete" -> {
                        playlists = playlists.filter { it.string("id") != id }
                        membership.remove(id)
                    }
                    "playlistAdd",
                    "playlistRemove",
                    "playlistOrder" -> {
                        val old = (membership[id] as? JsonArray).orEmpty()
                        val wanted = (p["trackIds"] as? JsonArray).orEmpty()
                        val next =
                            when (action.kind) {
                                "playlistAdd" -> (old + wanted).distinct()
                                "playlistRemove" -> old.filter { it !in wanted }
                                else -> wanted.filter { it in old } + old.filter { it !in wanted }
                            }
                        membership[id!!] = JsonArray(next)
                    }
                }
            }
            val byId = tracks.associateBy { it.string("id") }
            playlists = playlists.map { playlist ->
                val members =
                    (membership[playlist.string("id")] as? JsonArray).orEmpty().mapNotNull {
                        byId[it.jsonPrimitive.content]
                    }
                playlist.with(
                    "trackCount" to JsonPrimitive(members.size),
                    "durationSeconds" to
                        JsonPrimitive(
                            members.sumOf { it["durationSeconds"]?.jsonPrimitive?.int ?: 0 }
                        ),
                )
            }
            savedLibrary = savedLibrary.mapNotNull { saved ->
                val kind = saved.string("kind")
                val source = (if (kind == "playlist") playlists else snapshot.objects(kind + "s"))
                    .find { it.string("id") == saved.string("id") } ?: return@mapNotNull null
                saved.with(
                    "title" to (source[if (kind == "album") "title" else "name"] ?: JsonPrimitive("")),
                    "subtitle" to (source[when (kind) { "album" -> "artistName"; "playlist" -> "ownerName"; else -> "" }] ?: JsonPrimitive("")),
                    "hasImage" to (source[if (kind == "artist") "hasImage" else "hasCover"] ?: JsonPrimitive(false)),
                    "coverTrackId" to (source["coverTrackId"] ?: JsonNull),
                )
            }
            return snapshot.with(
                "savedLibrary" to JsonArray(savedLibrary),
                "libraryFolders" to JsonArray(libraryFolders),
                "tracks" to JsonArray(tracks),
                "playlists" to JsonArray(playlists),
                "playlistTracks" to JsonObject(membership),
                "recent" to JsonArray(recent),
            )
        }

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
            fun result(value: JsonElement?) =
                if (value == null) Result(code = 404) else Result(value)
            val playlists = data.objects("playlists")
            return when {
                path == "me/library" -> result(data["savedLibrary"] ?: JsonArray(emptyList()))
                path == "me/library/folders" -> result(data["libraryFolders"] ?: JsonArray(emptyList()))
                path == "auth/me" -> result(data["user"])
                path == "config" ->
                    Result(
                        buildJsonObject {
                            put(
                                "recommendationsEnabled",
                                data["recommendationsEnabled"] ?: JsonPrimitive(false),
                            )
                        }
                    )
                path == "me/settings" -> result(data["settings"])
                path == "home/feed" -> result(data["feed"])
                path.startsWith("home/mixes/") ->
                    result(data["mixes"]?.jsonObject?.get(parts.last().lowercase()))
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
                                    (it["cues"] as? JsonObject)
                                        ?.get("bpm")
                                        ?.jsonPrimitive
                                        ?.doubleOrNull ?: Double.MAX_VALUE
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
                                            (it["key"] as? JsonObject)
                                                ?.string("camelot")
                                                ?.lastOrNull()
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
                parts.size == 3 && parts[0] == "tracks" && parts[2] == "lyrics" ->
                    data["lyrics"]?.jsonObject?.get(id)?.let { Result(it) } ?: Result(code = 204)
                parts.size == 3 && parts[0] == "tracks" && parts[2] == "waveform" ->
                    result(data["waveforms"]?.jsonObject?.get(id))
                path == "albums" || path == "search/albums" -> page(albums)
                parts.size == 2 && parts[0] == "albums" ->
                    result(
                        find(data.objects("albums"), id)
                            ?.with("tracks" to JsonArray(albumTracks(id)))
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
                                    url.queryParameter("limit")?.toIntOrNull()?.coerceIn(1, 50)
                                        ?: 10
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
                                                it.string("id") in artistTracks.map { track -> track.string("albumId") }.toSet()
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
}
