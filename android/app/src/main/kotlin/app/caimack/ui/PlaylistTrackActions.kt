// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

package app.caimack.ui

import app.caimack.api.AddTracksRequest
import app.caimack.api.CaimackApi
import app.caimack.api.PlaylistDetail
import app.caimack.api.Track
import retrofit2.HttpException

internal class PlaylistTrackActions(private val api: CaimackApi) {
    suspend fun remove(playlistId: String, trackId: String) {
        val response = api.removeFromPlaylist(playlistId, trackId)
        if (!response.isSuccessful) throw HttpException(response)
    }

    suspend fun restore(playlistId: String, trackId: String, originalOrder: List<String>): PlaylistDetail {
        api.addToPlaylist(playlistId, AddTracksRequest(listOf(trackId)))
        val latest = api.playlist(playlistId)
        check(latest.tracks.any { it.id == trackId }) { "The restored track is missing from the playlist" }
        val ordered = restoreTrackOrder(latest.tracks, trackId, originalOrder)
        if (ordered != latest.tracks) {
            val response = api.reorderPlaylist(playlistId, AddTracksRequest(ordered.map { it.id }))
            if (!response.isSuccessful) throw HttpException(response)
        }
        return latest.copy(tracks = ordered)
    }
}

internal fun restoreTrackOrder(current: List<Track>, trackId: String, originalOrder: List<String>): List<Track> {
    val track = current.firstOrNull { it.id == trackId } ?: return current
    val remaining = current.filterNot { it.id == trackId }.toMutableList()
    val originalIndex = originalOrder.indexOf(trackId)
    if (originalIndex < 0) return current
    val previous = originalOrder.take(originalIndex).lastOrNull { id -> remaining.any { it.id == id } }
    val next = originalOrder.drop(originalIndex + 1).firstOrNull { id -> remaining.any { it.id == id } }
    val index = when {
        previous != null -> remaining.indexOfFirst { it.id == previous } + 1
        next != null -> remaining.indexOfFirst { it.id == next }
        else -> 0
    }
    remaining.add(index, track)
    return remaining
}
