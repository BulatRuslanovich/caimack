// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

package app.caimack.api

import okhttp3.MultipartBody
import retrofit2.Response
import retrofit2.http.Body
import retrofit2.http.DELETE
import retrofit2.http.GET
import retrofit2.http.Multipart
import retrofit2.http.POST
import retrofit2.http.Part
import retrofit2.http.PUT
import retrofit2.http.Path
import retrofit2.http.Query

interface CaimackApi {
    @POST("api/auth/login")
    suspend fun login(@Body request: LoginRequest): User

    @POST("api/auth/logout")
    suspend fun logout()

    @GET("api/auth/me")
    suspend fun me(): User

    @GET("api/tracks/{id}/lyrics")
    suspend fun lyrics(@Path("id") id: String): Response<Lyrics>

    @GET("api/tracks/{id}/waveform")
    suspend fun waveform(@Path("id") id: String): Response<Waveform>

    @POST("api/playback/signals")
    suspend fun signals(@Body batch: SignalBatch)

    @POST("api/history")
    suspend fun recordPlay(@Body entry: HistoryEntryRequest)

    @PUT("api/playback/state")
    suspend fun reportPlayback(@Body report: PlaybackStateReport): Response<Unit>

    @GET("api/playback/now")
    suspend fun playingElsewhere(@Query("deviceId") deviceId: String): Response<PlayingElsewhere>

    @POST("api/playback/handoff")
    suspend fun handoff(@Body request: HandoffRequest): PlaybackHandoff

    @POST("api/recommendations/radio")
    suspend fun radio(@Body request: RadioRequest): RadioBatch

    @POST("api/recommendations/rules")
    suspend fun addTasteRule(@Body request: TasteRuleRequest): TasteRule

    @GET("api/recommendations/moods")
    suspend fun moods(): List<Mood>

    @GET("api/recap")
    suspend fun recap(): Response<Recap>

    @GET("api/me/settings")
    suspend fun settings(): UserSettings

    @PUT("api/me/settings")
    suspend fun updateSettings(@Body changes: SettingsChanges): UserSettings

    @GET("api/home/feed")
    suspend fun homeFeed(@Query("sectionSize") sectionSize: Int = 12): HomeFeed

    @GET("api/home/mixes/{kind}")
    suspend fun homeMix(@Path("kind") kind: String): HomeMix

    @GET("api/tracks")
    suspend fun tracks(@Query("page") page: Int, @Query("pageSize") pageSize: Int, @Query("sort") sort: String = "Title"): Paged<Track>

    @GET("api/albums")
    suspend fun albums(@Query("page") page: Int, @Query("pageSize") pageSize: Int): Paged<Album>

    @GET("api/albums/{id}")
    suspend fun album(@Path("id") id: String): AlbumDetail

    @GET("api/artists")
    suspend fun artists(@Query("page") page: Int, @Query("pageSize") pageSize: Int): Paged<Artist>

    @GET("api/artists/{id}")
    suspend fun artist(@Path("id") id: String, @Query("page") page: Int = 1, @Query("pageSize") pageSize: Int = 50): ArtistDetail

    @GET("api/artists/{id}/top-tracks")
    suspend fun artistTopTracks(@Path("id") id: String, @Query("limit") limit: Int = 10): List<Track>

    @GET("api/genres")
    suspend fun genres(): List<Genre>

    @GET("api/genres/{id}/tracks")
    suspend fun genreTracks(@Path("id") id: String, @Query("page") page: Int, @Query("pageSize") pageSize: Int): Paged<Track>

    @GET("api/playlists")
    suspend fun playlists(): List<Playlist>

    @POST("api/playlists")
    suspend fun createPlaylist(@Body changes: PlaylistChanges): Playlist

    @PUT("api/playlists/{id}")
    suspend fun updatePlaylist(@Path("id") id: String, @Body changes: PlaylistChanges): Playlist

    @DELETE("api/playlists/{id}")
    suspend fun deletePlaylist(@Path("id") id: String): Response<Unit>

    @DELETE("api/playlists/{id}/tracks/{trackId}")
    suspend fun removeFromPlaylist(@Path("id") id: String, @Path("trackId") trackId: String): Response<Unit>

    @PUT("api/playlists/{id}/tracks/order")
    suspend fun reorderPlaylist(@Path("id") id: String, @Body order: AddTracksRequest): Response<Unit>

    @Multipart
    @POST("api/playlists/{id}/cover")
    suspend fun uploadPlaylistCover(@Path("id") id: String, @Part file: MultipartBody.Part): Playlist

    @DELETE("api/playlists/{id}/cover")
    suspend fun deletePlaylistCover(@Path("id") id: String): Response<Unit>

    @GET("api/library/map")
    suspend fun libraryMap(): LibraryMap

    @POST("api/tracks/lookup")
    suspend fun lookupTracks(@Body request: TrackLookup): List<Track>

    @GET("api/playlists/public")
    suspend fun publicPlaylists(): List<Playlist>

    @GET("api/playlists/{id}")
    suspend fun playlist(@Path("id") id: String): PlaylistDetail

    @POST("api/playlists/{id}/tracks")
    suspend fun addToPlaylist(@Path("id") id: String, @Body request: AddTracksRequest)

    @POST("api/tracks/{id}/favorite")
    suspend fun like(@Path("id") id: String)

    @DELETE("api/tracks/{id}/favorite")
    suspend fun unlike(@Path("id") id: String)

    @GET("api/favorites")
    suspend fun favorites(@Query("page") page: Int, @Query("pageSize") pageSize: Int): Paged<Track>

    @GET("api/history/recent")
    suspend fun recentlyPlayed(@Query("page") page: Int, @Query("pageSize") pageSize: Int): Paged<Track>

    @GET("api/search")
    suspend fun search(@Query("q") query: String, @Query("limit") limit: Int = 8): SearchResults

    @GET("api/search/tracks")
    suspend fun searchTracks(@Query("q") query: String, @Query("page") page: Int, @Query("pageSize") pageSize: Int): Paged<Track>

    @GET("api/search/albums")
    suspend fun searchAlbums(@Query("q") query: String, @Query("page") page: Int, @Query("pageSize") pageSize: Int): Paged<Album>

    @GET("api/search/artists")
    suspend fun searchArtists(@Query("q") query: String, @Query("page") page: Int, @Query("pageSize") pageSize: Int): Paged<Artist>
}
