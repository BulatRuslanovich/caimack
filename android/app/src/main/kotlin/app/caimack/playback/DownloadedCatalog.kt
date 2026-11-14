// SPDX-License-Identifier: AGPL-3.0-only
package app.caimack.playback

import java.io.File
import java.nio.file.Files
import java.nio.file.StandardCopyOption
import java.security.MessageDigest
import app.caimack.api.*
import app.caimack.sync.OfflineCatalog
import kotlinx.serialization.json.*
import okhttp3.*

/** A read-only projection of completed downloads, independent of the server. */
class DownloadedCatalog(private val directory: File, private val json: Json, private val address: () -> String?,
    private val tracks: () -> List<Track>, private val synchronized: () -> JsonObject?,
    private val identity: () -> String?) {
    private val artwork = DownloadedArtwork(File(directory, "artwork"))
    val revision = artwork.revision

    fun asset(path: String): String? {
        val server = address() ?: return null
        val account = identity() ?: return null
        artwork.asset(server, path, account)?.let { return it }
        if (path.startsWith("api/tracks/") && path.endsWith("/cover")) {
            val id = path.split('/').getOrNull(2)
            val album = tracks().firstOrNull { it.id == id }?.albumId ?: return null
            return artwork.asset(server, "api/albums/$album/cover", account)
        }
        return null
    }

    fun cachedUrl(url: String): String? {
        val server = address() ?: return null
        if (!url.startsWith(server)) return null
        return asset(url.removePrefix(server).substringBefore('?'))
    }

    fun cacheArtwork(paths: List<String>, http: OkHttpClient) {
        val server = address() ?: return
        val account = identity() ?: return
        artwork.cache(server, paths, http, account)
    }

    fun cacheTrackArtwork(tracks: List<Track>, http: OkHttpClient) = cacheArtwork(DownloadedArtwork.paths(tracks), http)

    private fun metadataFile(key: String) = File(directory, "metadata-" + MessageDigest.getInstance("SHA-256")
        .digest(key.toByteArray()).joinToString("") { "%02x".format(it) } + ".json")

    private fun metadata(key: String): JsonObject = runCatching {
        json.parseToJsonElement(metadataFile(key).readText()).jsonObject
    }.getOrDefault(buildJsonObject {})

    private fun write(key: String, data: JsonObject) {
        directory.mkdirs()
        val temporary = File.createTempFile("metadata-", ".part", directory)
        try {
            temporary.outputStream().use { it.write(data.toString().toByteArray()); it.fd.sync() }
            Files.move(temporary.toPath(), metadataFile(key).toPath(), StandardCopyOption.ATOMIC_MOVE, StandardCopyOption.REPLACE_EXISTING)
        } finally { temporary.delete() }
    }

    @Synchronized
    fun remember(playlist: PlaylistDetail) {
        val key = identity() ?: return
        val data = metadata(key)
        val all = playlists(key).filterNot { it.id == playlist.id } + playlist
        write(key, JsonObject(data + ("playlists" to json.encodeToJsonElement(all))))
    }

    @Synchronized
    fun remember(artist: ArtistDetail) {
        val key = identity() ?: return
        val data = metadata(key)
        val all = artists(key).filterNot { it.id == artist.id } + Artist(artist.id, artist.name, hasImage = artist.hasImage)
        write(key, JsonObject(data + ("artists" to json.encodeToJsonElement(all))))
    }

    private fun artists(key: String? = identity()): List<Artist> = key?.let { metadata(it)["artists"] }
        ?.let { runCatching { json.decodeFromJsonElement<List<Artist>>(it) }.getOrNull() }.orEmpty()

    private fun playlists(key: String? = identity()): List<PlaylistDetail> = key?.let { metadata(it)["playlists"] }
        ?.let { runCatching { json.decodeFromJsonElement<List<PlaylistDetail>>(it) }.getOrNull() }.orEmpty()

    fun availableCollection(kind: String, id: String): Boolean {
        val available = tracks()
        return when (kind) {
            "album" -> available.any { it.albumId == id }
            "artist" -> available.any { it.artistId == id || it.artists.orEmpty().any { artist -> artist.id == id } }
            "playlist" -> {
                val ids = available.map { it.id }.toSet()
                playlists().firstOrNull { it.id == id }?.tracks?.any { it.id in ids } == true ||
                    (synchronized()?.get("playlistTracks")?.jsonObject?.get(id) as? JsonArray).orEmpty().any { it.jsonPrimitive.content in ids }
            }
            else -> false
        }
    }

    fun localSnapshot(): JsonObject {
        val account = identity()
        val playlists = playlists(account)
        // Retain known playlist members even when their audio is not downloaded.
        val songs = (tracks() + playlists.flatMap { it.tracks }).distinctBy { it.id }
        val portraits = songs.flatMap { it.artists.orEmpty() + ArtistRef(it.artistId, it.artistName) }
            .distinctBy { it.id }.map { Artist(it.id, it.name, hasImage = asset("api/artists/${it.id}/image") != null) }
        val synced = synchronized()
        val data = snapshot(json, songs, playlists, synced, artists(account) + portraits)
        // Downloading is not a library-save operation. Membership comes only from
        // the account's saved library (or the cached server response).
        return JsonObject(data + mapOf(
            "savedLibrary" to (synced?.get("savedLibrary") ?: JsonArray(emptyList())),
            "libraryFolders" to (synced?.get("libraryFolders") ?: JsonArray(emptyList())),
        ))
    }

    companion object {
        fun snapshot(json: Json, tracks: List<Track>, playlists: List<PlaylistDetail>, synced: JsonObject? = null, knownArtists: List<Artist> = emptyList()): JsonObject {
            val unique = tracks.distinctBy { it.id }
            val ids = unique.map { it.id }.toSet()
            val albums = unique.filter { it.albumId != null }.groupBy { it.albumId!! }.map { (id, songs) ->
                val lead = songs.first()
                Album(id, lead.albumTitle.orEmpty(), lead.artistId, lead.artistName, lead.year,
                    songs.size, songs.sumOf { it.durationSeconds }, songs.any { it.hasCover })
            }
            val artists = unique.flatMap { song -> (song.artists.orEmpty() + ArtistRef(song.artistId, song.artistName)) }
                .distinctBy { it.id }.map { artist -> Artist(artist.id, artist.name,
                    unique.count { it.artistId == artist.id || it.artists.orEmpty().any { a -> a.id == artist.id } },
                    knownArtists.any { it.id == artist.id && it.hasImage }) }
            val savedPlaylists = playlists.map { it.copy(tracks = it.tracks.filter { song -> song.id in ids }, coverTrackId = it.coverTrackId?.takeIf { id -> id in ids } ?: it.tracks.firstOrNull { song -> song.id in ids }?.id) }.filter { it.tracks.isNotEmpty() }
            val syncedPlaylists = (synced?.get("playlists") as? JsonArray).orEmpty().map { it.jsonObject }
            val membership = buildJsonObject {
                savedPlaylists.forEach { put(it.id, json.encodeToJsonElement(it.tracks.map(Track::id))) }
                (synced?.get("playlistTracks") as? JsonObject).orEmpty().forEach { (id, members) ->
                    put(id, JsonArray(members.jsonArray.filter { it.jsonPrimitive.content in ids }))
                }
            }
            val lists = (savedPlaylists.map { json.encodeToJsonElement(it).jsonObject } + syncedPlaylists)
                .distinctBy { it["id"] }.filter { membership[it["id"]?.jsonPrimitive?.content]?.jsonArray?.isNotEmpty() == true }
            val saved = buildJsonArray {
                fun entry(kind: String, id: String) { add(buildJsonObject {
                    put("kind", kind); put("id", id); put("savedAt", "1970-01-01T00:00:00Z")
                }) }
                albums.forEach { entry("album", it.id) }
                artists.forEach { entry("artist", it.id) }
                lists.forEach { entry("playlist", it.getValue("id").jsonPrimitive.content) }
            }
            return OfflineCatalog.view(buildJsonObject {
                put("tracks", json.encodeToJsonElement(unique)); put("albums", json.encodeToJsonElement(albums))
                put("artists", json.encodeToJsonElement(artists)); put("playlists", JsonArray(lists))
                put("playlistTracks", membership); put("savedLibrary", saved); put("libraryFolders", JsonArray(emptyList()))
                put("genres", json.encodeToJsonElement(unique.filter { !it.genreName.isNullOrBlank() }.groupBy { it.genreName!! }.map { (name, songs) ->
                    Genre(name, name, songs.size, songs.mapNotNull { it.albumId }.distinct().take(4))
                }))
            }, emptyList())
        }
    }
}
