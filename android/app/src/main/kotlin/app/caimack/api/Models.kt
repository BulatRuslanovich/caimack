// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Bulat Ruslanovich

package app.caimack.api

import kotlinx.serialization.Serializable

@Serializable
data class User(val id: String, val username: String)

@Serializable
data class LoginRequest(
    val username: String,
    val password: String,
    val deviceName: String? = null,
    val longLived: Boolean = false,
)

@Serializable
data class Problem(val title: String? = null, val detail: String? = null)

@Serializable
data class ArtistRef(val id: String, val name: String)

@Serializable
data class Track(
    val id: String,
    val title: String,
    val artistId: String,
    val artistName: String,
    val artists: List<ArtistRef>? = null,
    val albumId: String? = null,
    val albumTitle: String? = null,
    val year: Int? = null,
    val durationSeconds: Int,
    val isFavorite: Boolean = false,
    val hasCover: Boolean = false,
    val codec: String? = null,
    val cues: TrackCues? = null,
    val key: MusicalKey? = null,
    val loudness: TrackLoudness? = null,
)

@Serializable
data class MusicalKey(val tonic: String, val minor: Boolean, val camelot: String) {
    val name: String get() = if (minor) "${tonic}m" else tonic
}

@Serializable
data class TasteRuleRequest(val action: String, val targetType: String, val targetId: String)

@Serializable
data class TasteRule(val id: String, val action: String, val name: String)

@Serializable
data class TrackLoudness(val lufs: Double, val truePeak: Double, val range: Double? = null)

@Serializable
data class TrackCues(
    val audioStart: Double,
    val audioEnd: Double,
    val outroStart: Double,
    val bpm: Double? = null,
)

@Serializable
data class Artist(
    val id: String,
    val name: String,
    val trackCount: Int = 0,
    val hasImage: Boolean = false,
)

@Serializable
data class ArtistDetail(
    val id: String,
    val name: String,
    val hasImage: Boolean = false,
    val albums: List<Album>,
    val tracks: Paged<Track>,
)

@Serializable
data class Album(
    val id: String,
    val title: String,
    val artistId: String,
    val artistName: String,
    val year: Int? = null,
    val trackCount: Int = 0,
    val durationSeconds: Int = 0,
    val hasCover: Boolean = false,
)

@Serializable
data class AlbumDetail(
    val id: String,
    val title: String,
    val artistId: String,
    val artistName: String,
    val year: Int? = null,
    val durationSeconds: Int = 0,
    val hasCover: Boolean = false,
    val tracks: List<Track>,
)

@Serializable
data class Genre(val id: String, val name: String, val trackCount: Int = 0, val coverAlbumIds: List<String> = emptyList())

@Serializable
data class Playlist(
    val id: String,
    val name: String,
    val description: String? = null,
    val isPublic: Boolean = false,
    val ownerId: String? = null,
    val ownerName: String = "",
    val trackCount: Int = 0,
    val durationSeconds: Int = 0,
    val hasCover: Boolean = false,
    val coverTrackId: String? = null,
)

@Serializable
data class PlaylistDetail(
    val id: String,
    val name: String,
    val description: String? = null,
    val isPublic: Boolean = false,
    val ownerId: String? = null,
    val ownerName: String = "",
    val durationSeconds: Int = 0,
    val hasCover: Boolean = false,
    val coverTrackId: String? = null,
    val tracks: List<Track>,
)

@Serializable
data class Paged<T>(val items: List<T>, val total: Int, val page: Int, val pageSize: Int)

@Serializable
data class RecommendationReason(val kind: String, val subject: String? = null, val subjectId: String? = null)

@Serializable
data class HomeBlock(
    val key: String,
    val baseKey: String,
    val layout: String,
    val zone: String,
    val reason: RecommendationReason? = null,
    val tracks: List<Track>? = null,
    val albums: List<Album>? = null,
    val artists: List<Artist>? = null,
    val playlists: List<Playlist>? = null,
    val totalCount: Int? = null,
)

@Serializable
data class HomeFeed(val blocks: List<HomeBlock>)

@Serializable
data class HomeMix(val tracks: List<Track>)

@Serializable
data class SearchTopResult(
    val kind: String,
    val artist: Artist? = null,
    val album: Album? = null,
    val track: Track? = null,
    val genre: Genre? = null,
)

@Serializable
data class SearchResults(
    val artists: List<Artist> = emptyList(),
    val albums: List<Album> = emptyList(),
    val tracks: List<Track> = emptyList(),
    val genres: List<Genre> = emptyList(),
    val top: SearchTopResult? = null,
)

@Serializable
data class UserSettings(val quality: String = "Original")

@Serializable
data class LyricLine(val at: Long, val text: String)

@Serializable
data class Waveform(val peaks: List<Int> = emptyList())

@Serializable
data class Lyrics(val plain: String = "", val lines: List<LyricLine> = emptyList())

@Serializable
data class PlaybackSignal(
    val type: String,
    val trackId: String?,
    val durationSeconds: Int,
    val positionSeconds: Int? = null,
    val listenedSeconds: Int? = null,
    val occurredAt: String,
    val sessionId: String,
    val source: String? = null,
)

@Serializable
data class SignalBatch(val events: List<PlaybackSignal>)

@Serializable
data class HistoryEntryRequest(val trackId: String, val playbackPosition: Int)

@Serializable
data class Mood(val key: String, val albumIds: List<String> = emptyList())

@Serializable
data class RadioRequest(val seedTrackId: String?, val exclude: List<String>, val mood: String? = null, val sessionId: String? = null)

@Serializable
data class AddTracksRequest(val trackIds: List<String>)

@Serializable
data class PlaylistChanges(val name: String, val description: String? = null, val isPublic: Boolean = false)

@Serializable
data class QueueSignals(val explore: Boolean = false)

@Serializable
data class RecommendedTrack(val track: Track, val reason: RecommendationReason? = null, val signals: QueueSignals? = null)

@Serializable
data class RadioBatch(val tracks: List<RecommendedTrack> = emptyList(), val seedTrackId: String? = null)

@Serializable
data class SettingsChanges(val quality: String? = null)

@Serializable
data class PlaybackStateReport(
    val deviceId: String,
    val deviceName: String,
    val trackIds: List<String>,
    val index: Int,
    val positionSeconds: Double,
    val isPlaying: Boolean,
    val shuffle: Boolean,
    val repeat: String,
)

@Serializable
data class PlayingElsewhere(
    val deviceId: String,
    val deviceName: String,
    val track: Track,
    val positionSeconds: Double,
    val isPlaying: Boolean,
    val reportedAt: String,
)

@Serializable
data class HandoffRequest(val deviceId: String)

@Serializable
data class PlaybackHandoff(
    val deviceId: String,
    val deviceName: String,
    val tracks: List<Track>,
    val index: Int,
    val positionSeconds: Double,
    val shuffle: Boolean,
    val repeat: String,
)

@Serializable
data class RecapTrack(val track: Track, val plays: Int)

@Serializable
data class RecapArtist(val artist: Artist, val plays: Int, val listenedSeconds: Long)

@Serializable
data class RecapGenre(val id: String, val name: String, val share: Double)

@Serializable
data class RecapMood(val key: String, val share: Double)

@Serializable
data class Recap(
    val year: Int,
    val month: Int,
    val listenedSeconds: Long,
    val plays: Int,
    val distinctTracks: Int,
    val distinctArtists: Int,
    val previousListenedSeconds: Long? = null,
    val topTracks: List<RecapTrack> = emptyList(),
    val topArtists: List<RecapArtist> = emptyList(),
    val topGenre: String? = null,
    val moods: List<RecapMood> = emptyList(),
    val daySeconds: List<Long> = emptyList(),
    val hourSeconds: List<Long> = emptyList(),
    val soundOfMonth: Track? = null,
    val newArtists: Int? = null,
    val newArtistPicks: List<Artist> = emptyList(),
)

@Serializable
data class MapPoint(
    val id: String,
    val x: Float,
    val y: Float,
    val title: String,
    val artist: String,
    val albumId: String? = null,
    val hasCover: Boolean = false,
    val genre: String? = null,
    val plays: Int = 0,
)

@Serializable
data class MapLandmark(val mood: String, val x: Float, val y: Float)

@Serializable
data class LibraryMap(
    val points: List<MapPoint> = emptyList(),
    val landmarks: List<MapLandmark> = emptyList(),
    val totalTracks: Int = 0,
)

@Serializable
data class TrackLookup(val ids: List<String>)
