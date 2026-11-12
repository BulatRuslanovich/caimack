// SPDX-License-Identifier: AGPL-3.0-only
package app.caimack.playback

import app.caimack.api.*
import java.io.File
import kotlinx.serialization.json.*
import okhttp3.OkHttpClient

/** Artwork and metadata derived from individually downloaded audio. */
class DownloadedCatalog(
    directory: File,
    private val json: Json,
    private val address: () -> String?,
    private val identity: () -> String?,
    private val tracks: () -> List<Track>,
) {
    private val artwork = DownloadedArtwork(directory)
    val revision = artwork.revision

    fun asset(path: String): String? {
        val key = identity() ?: return null
        artwork.asset(key, path)?.let {
            return it
        }
        if (path.startsWith("api/tracks/") && path.endsWith("/cover")) {
            val id = path.split('/').getOrNull(2)
            val album = tracks().firstOrNull { it.id == id }?.albumId ?: return null
            return artwork.asset(key, "api/albums/$album/cover")
        }
        return null
    }

    fun cachedUrl(url: String): String? {
        val server = address() ?: return null
        if (!url.startsWith(server)) return null
        return asset(url.removePrefix(server).substringBefore('?'))
    }

    fun invalidateArtwork(path: String) {
        identity()?.let { artwork.remove(it, path) }
    }

    fun cacheArtwork(paths: List<String>, http: OkHttpClient) {
        val server = address() ?: return
        val key = identity() ?: return
        artwork.cache(server, paths, http, key)
    }

    fun cacheTrackArtwork(tracks: List<Track>, http: OkHttpClient) =
        cacheArtwork(DownloadedArtwork.paths(tracks), http)

    fun localSnapshot(): JsonObject =
        JsonObject(
            snapshot(
                json,
                tracks(),
                knownArtists =
                    tracks()
                        .flatMap { song ->
                            song.artists.orEmpty() + ArtistRef(song.artistId, song.artistName)
                        }
                        .distinctBy { it.id }
                        .map {
                            Artist(
                                it.id,
                                it.name,
                                hasImage = asset("api/artists/${it.id}/image") != null,
                            )
                        },
            ) +
                ("user" to
                    buildJsonObject { put("id", identity()?.substringAfterLast('|').orEmpty()) })
        )

    companion object {
        fun snapshot(
            json: Json,
            tracks: List<Track>,
            playlists: List<PlaylistDetail> = emptyList(),
            knownArtists: List<Artist> = emptyList(),
        ): JsonObject {
            val unique = tracks.distinctBy { it.id }
            val ids = unique.map { it.id }.toSet()
            val albums =
                unique
                    .filter { it.albumId != null }
                    .groupBy { it.albumId!! }
                    .map { (id, songs) ->
                        val lead = songs.first()
                        Album(
                            id,
                            lead.albumTitle.orEmpty(),
                            lead.artistId,
                            lead.artistName,
                            lead.year,
                            songs.size,
                            songs.sumOf { it.durationSeconds },
                            songs.any { it.hasCover },
                        )
                    }
            val artists =
                unique
                    .flatMap { it.artists.orEmpty() + ArtistRef(it.artistId, it.artistName) }
                    .distinctBy { it.id }
                    .map { artist ->
                        Artist(
                            artist.id,
                            artist.name,
                            unique.count {
                                it.artistId == artist.id ||
                                    it.artists.orEmpty().any { a -> a.id == artist.id }
                            },
                            knownArtists.any { it.id == artist.id && it.hasImage },
                        )
                    }
            val lists =
                playlists
                    .map { list ->
                        val members = list.tracks.filter { it.id in ids }
                        list.copy(
                            tracks = members,
                            durationSeconds = members.sumOf { it.durationSeconds },
                            coverTrackId =
                                list.coverTrackId?.takeIf { it in ids }
                                    ?: members.firstOrNull()?.id,
                        )
                    }
                    .filter { it.tracks.isNotEmpty() }
            return buildJsonObject {
                put("tracks", json.encodeToJsonElement(unique))
                put("albums", json.encodeToJsonElement(albums))
                put("artists", json.encodeToJsonElement(artists))
                put("playlists", json.encodeToJsonElement(lists))
                put(
                    "playlistTracks",
                    buildJsonObject {
                        lists.forEach {
                            put(it.id, json.encodeToJsonElement(it.tracks.map(Track::id)))
                        }
                    },
                )
                // Downloading audio never creates shortcuts in the personal library.
                put("savedLibrary", JsonArray(emptyList()))
                put("libraryFolders", JsonArray(emptyList()))
                put(
                    "genres",
                    json.encodeToJsonElement(
                        unique
                            .filter { !it.genreName.isNullOrBlank() }
                            .groupBy { it.genreName!! }
                            .map { (name, songs) ->
                                Genre(
                                    name,
                                    name,
                                    songs.size,
                                    songs.mapNotNull { it.albumId }.distinct().take(4),
                                )
                            }
                    ),
                )
            }
        }
    }
}
