// SPDX-License-Identifier: AGPL-3.0-only
package app.caimack.playback

import app.caimack.api.PlaylistDetail
import app.caimack.api.Track
import kotlinx.serialization.json.*

data class LocalLibrary(
    val account: String? = null,
    val trackIds: Set<String> = emptySet(),
    val syncedTracks: List<Track> = emptyList(),
    val collections: Set<Pair<String, String>> = emptySet(),
    val syncedBytes: Long = 0,
)

/** Build once per catalog change; rows only need constant-time membership lookups. */
internal fun collectionAvailability(tracks: List<Track>, playlists: List<PlaylistDetail>,
    syncedMembership: JsonObject?): Set<Pair<String, String>> = buildSet {
    val ids = tracks.mapTo(hashSetOf()) { it.id }
    tracks.forEach { track ->
        track.albumId?.let { add("album" to it) }
        add("artist" to track.artistId)
        track.artists.orEmpty().forEach { add("artist" to it.id) }
    }
    playlists.forEach { if (it.tracks.any { track -> track.id in ids }) add("playlist" to it.id) }
    syncedMembership.orEmpty().forEach { (id, members) ->
        if ((members as? JsonArray).orEmpty().any { it.jsonPrimitive.content in ids }) add("playlist" to id)
    }
}
