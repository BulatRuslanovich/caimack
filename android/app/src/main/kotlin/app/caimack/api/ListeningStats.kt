// SPDX-License-Identifier: AGPL-3.0-only
package app.caimack.api

import kotlinx.serialization.Serializable

@Serializable
data class ListeningOverview(
    val updatedAt: String? = null,
    val timeZone: String,
    val retentionDays: Int,
    val weeks: List<ListeningWeek>,
)

@Serializable
data class ListeningWeek(
    val startDate: String,
    val endDate: String,
    val current: Boolean,
    val listenedSeconds: Long,
    val plays: Int,
    val distinctTracks: Int,
    val distinctArtists: Int,
    val previousListenedSeconds: Long? = null,
    val daySeconds: List<Long>,
    val topTracks: List<ListeningTrack>,
    val topArtists: List<ListeningArtist>,
    val decade: Int? = null,
    val decadeShare: Int? = null,
    val artistShare: Int? = null,
)

@Serializable
data class ListeningTrack(
    val track: Track,
    val plays: Int,
    val listenedSeconds: Long,
    val previousRank: Int? = null,
    val weeksInTop5: Int,
)

@Serializable
data class ListeningArtist(
    val artist: Artist,
    val plays: Int,
    val listenedSeconds: Long,
    val previousRank: Int? = null,
    val weeksInTop5: Int,
)
