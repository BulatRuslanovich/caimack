// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

package app.caimack.playback

import android.content.Context
import android.os.Bundle
import androidx.annotation.OptIn
import androidx.core.util.readText
import androidx.media3.common.MediaItem
import androidx.media3.common.MediaMetadata
import androidx.media3.common.Player
import androidx.media3.common.util.UnstableApi
import androidx.media3.session.LibraryResult
import androidx.media3.session.MediaConstants
import androidx.media3.session.MediaLibraryService.LibraryParams
import androidx.media3.session.MediaLibraryService.MediaLibrarySession
import androidx.media3.session.MediaSession
import androidx.media3.session.SessionCommand
import androidx.media3.session.SessionError
import androidx.media3.session.SessionResult
import app.caimack.AppContainer
import app.caimack.R
import app.caimack.api.HomeBlock
import app.caimack.api.RadioRequest
import app.caimack.api.Track
import app.caimack.session.SessionState
import app.caimack.ui.Appearance
import app.caimack.ui.reasonText
import com.google.common.collect.ImmutableList
import com.google.common.util.concurrent.Futures
import com.google.common.util.concurrent.ListenableFuture
import com.google.common.util.concurrent.SettableFuture
import java.util.concurrent.ConcurrentHashMap
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

@OptIn(UnstableApi::class)
class LibraryTree(
    context: Context,
    private val container: AppContainer,
    private val resolve: (MediaItem) -> MediaItem,
) : MediaLibrarySession.Callback {
    private val strings = Appearance.localized(context)
    private val lists = ConcurrentHashMap<String, List<Track>>()

    override fun onConnect(session: MediaSession, controller: MediaSession.ControllerInfo): MediaSession.ConnectionResult =
        MediaSession.ConnectionResult.accept(
            MediaSession.ConnectionResult.DEFAULT_SESSION_AND_LIBRARY_COMMANDS.buildUpon()
                .add(SessionCommand(FAVORITE, Bundle.EMPTY))
                .add(SessionCommand(SHUFFLE, Bundle.EMPTY))
                .add(SessionCommand(REPEAT, Bundle.EMPTY))
                .build(),
            MediaSession.ConnectionResult.DEFAULT_PLAYER_COMMANDS,
        )

    override fun onCustomCommand(
        session: MediaSession,
        controller: MediaSession.ControllerInfo,
        customCommand: SessionCommand,
        args: Bundle,
    ): ListenableFuture<SessionResult> {
        val player = session.player
        when (customCommand.customAction) {
            FAVORITE -> {
                val track = player.currentMediaItem?.mediaId?.let { container.tracks[it] }
                    ?: return Futures.immediateFuture(SessionResult(SessionError.ERROR_NOT_SUPPORTED))
                container.favorites.toggle(track)
            }
            SHUFFLE -> player.shuffleModeEnabled = !player.shuffleModeEnabled
            REPEAT -> player.repeatMode = when (player.repeatMode) {
                Player.REPEAT_MODE_OFF -> Player.REPEAT_MODE_ALL
                Player.REPEAT_MODE_ALL -> Player.REPEAT_MODE_ONE
                else -> Player.REPEAT_MODE_OFF
            }
            else -> return Futures.immediateFuture(SessionResult(SessionError.ERROR_NOT_SUPPORTED))
        }
        return Futures.immediateFuture(SessionResult(SessionResult.RESULT_SUCCESS))
    }

    override fun onGetLibraryRoot(
        session: MediaLibrarySession,
        browser: MediaSession.ControllerInfo,
        params: LibraryParams?,
    ): ListenableFuture<LibraryResult<MediaItem>> {
        container.scope.launch { if (signedIn()) runCatching { container.settings.value = container.api.settings() } }
        return Futures.immediateFuture(LibraryResult.ofItem(folder(ROOT, strings.getString(R.string.app_name)), params))
    }

    override fun onGetChildren(
        session: MediaLibrarySession,
        browser: MediaSession.ControllerInfo,
        parentId: String,
        page: Int,
        pageSize: Int,
        params: LibraryParams?,
    ): ListenableFuture<LibraryResult<ImmutableList<MediaItem>>> = future {
        if (!signedIn()) return@future LibraryResult.ofError(SessionError.ERROR_SESSION_AUTHENTICATION_EXPIRED)

        val items = runCatching {
            when (parentId) {
                ROOT -> listOf(
                    radio(),
                    folder(FOR_YOU, strings.getString(R.string.rec_for_you), grid = true),
                    folder(FAVORITES, strings.getString(R.string.nav_favorites)),
                    folder(LIBRARY, strings.getString(R.string.nav_library)),
                    folder(DOWNLOADS, strings.getString(R.string.downloads_title)),
                )
                LIBRARY -> listOf(
                    folder(PLAYLISTS, strings.getString(R.string.nav_playlists)),
                    folder(ALBUMS, strings.getString(R.string.nav_albums)),
                    folder(RECENT, strings.getString(R.string.nav_recently_played)),
                )
                FOR_YOU -> recommendations()
                PLAYLISTS -> container.api.playlists().map {
                    folder(PLAYLIST + it.id, it.name, it.ownerName, container.media.playlistCover(it.id, it.hasCover, it.coverTrackId, small = true))
                }
                ALBUMS -> container.api.albums(1, LIMIT).items.map {
                    folder(ALBUM + it.id, it.title, it.artistName, container.media.albumCover(it, small = true))
                }
                else -> (lists[parentId]?.takeIf { page > 0 } ?: tracksOf(parentId)).map { playable(parentId, it) }
            }
        }.getOrElse { return@future LibraryResult.ofError(SessionError.ERROR_IO) }

        val from = (page.toLong() * pageSize).coerceAtMost(items.size.toLong()).toInt()
        LibraryResult.ofItemList(items.drop(from).take(pageSize), params)
    }

    override fun onGetItem(
        session: MediaLibrarySession,
        browser: MediaSession.ControllerInfo,
        mediaId: String,
    ): ListenableFuture<LibraryResult<MediaItem>> {
        val (parent, id) = mediaId.split(SEPARATOR, limit = 2).let { it.first() to it.getOrNull(1) }
        val track = id?.let { container.tracks[it] }
            ?: return Futures.immediateFuture(LibraryResult.ofError(SessionError.ERROR_BAD_VALUE))
        return Futures.immediateFuture(LibraryResult.ofItem(playable(parent, track), null))
    }

    override fun onSearch(
        session: MediaLibrarySession,
        browser: MediaSession.ControllerInfo,
        query: String,
        params: LibraryParams?,
    ): ListenableFuture<LibraryResult<Void>> = future {
        val found = runCatching { search(query) }.getOrDefault(emptyList())
        lists[SEARCH] = found
        withContext(Dispatchers.Main) { session.notifySearchResultChanged(browser, query, found.size, params) }
        LibraryResult.ofVoid()
    }

    override fun onGetSearchResult(
        session: MediaLibrarySession,
        browser: MediaSession.ControllerInfo,
        query: String,
        page: Int,
        pageSize: Int,
        params: LibraryParams?,
    ): ListenableFuture<LibraryResult<ImmutableList<MediaItem>>> {
        val found = lists[SEARCH].orEmpty().map { playable(SEARCH, it) }
        val from = (page.toLong() * pageSize).coerceAtMost(found.size.toLong()).toInt()
        return Futures.immediateFuture(LibraryResult.ofItemList(found.drop(from).take(pageSize), params))
    }

    override fun onAddMediaItems(
        mediaSession: MediaSession,
        controller: MediaSession.ControllerInfo,
        mediaItems: MutableList<MediaItem>,
    ): ListenableFuture<MutableList<MediaItem>> {
        val query = mediaItems.singleOrNull()?.requestMetadata?.searchQuery
            ?: return Futures.immediateFuture(mediaItems.map { resolve(hydrate(it)) }.toMutableList())
        return future { runCatching { search(query) }.getOrDefault(emptyList()).map { resolve(it.toMediaItem(container.media)) }.toMutableList() }
    }

    override fun onSetMediaItems(
        mediaSession: MediaSession,
        controller: MediaSession.ControllerInfo,
        mediaItems: MutableList<MediaItem>,
        startIndex: Int,
        startPositionMs: Long,
    ): ListenableFuture<MediaSession.MediaItemsWithStartPosition> {
        val single = mediaItems.singleOrNull()
        val query = single?.requestMetadata?.searchQuery
        val browsed = single?.mediaId?.takeIf { SEPARATOR in it }?.split(SEPARATOR, limit = 2)
        val radio = single?.mediaId == RADIO
        val picked = single?.mediaId?.takeIf { it.startsWith(PICK) }

        if (query == null && browsed == null && !radio && picked == null) {
            return Futures.immediateFuture(
                MediaSession.MediaItemsWithStartPosition(mediaItems.map { resolve(hydrate(it)) }, startIndex, startPositionMs),
            )
        }

        return future {
            container.radio.reset()
            val tracks = runCatching {
                when {
                    radio -> container.radio(RadioRequest(null, emptyList()))
                        .also { container.radio.extend(it) }
                        .tracks.map { it.track }
                        .onEach { container.tracks[it.id] = it }
                    picked != null -> lists[picked] ?: tracksOf(picked)
                    query != null -> search(query)
                    else -> lists[browsed!![0]] ?: tracksOf(browsed[0])
                }
            }.getOrDefault(emptyList())
            val start = browsed?.let { (_, id) -> tracks.indexOfFirst { it.id == id }.coerceAtLeast(0) } ?: 0
            MediaSession.MediaItemsWithStartPosition(
                tracks.map { resolve(it.toMediaItem(container.media)) },
                start,
                if (browsed != null) startPositionMs else 0,
            )
        }
    }

    override fun onPlaybackResumption(
        mediaSession: MediaSession,
        controller: MediaSession.ControllerInfo,
        isForPlayback: Boolean,
    ): ListenableFuture<MediaSession.MediaItemsWithStartPosition> = future { resumption() }

    suspend fun resumption(): MediaSession.MediaItemsWithStartPosition {
        check(signedIn()) { "Signed out" }
        val saved = container.json.decodeFromString(SavedQueue.serializer(), container.queue.readText())
        saved.tracks.forEach { container.tracks[it.id] = it }
        return MediaSession.MediaItemsWithStartPosition(
            saved.tracks.map { resolve(it.toMediaItem(container.media)) },
            saved.index,
            saved.positionMs,
        )
    }

    private suspend fun search(query: String): List<Track> {
        val tracks = if (query.isBlank()) container.api.homeMix(DAILY).tracks else container.api.search(query, SEARCH_LIMIT).tracks
        tracks.forEach { container.tracks[it.id] = it }
        return tracks
    }

    private suspend fun tracksOf(parentId: String): List<Track> {
        val tracks = when {
            parentId == MIX -> container.api.homeMix(DAILY).tracks
            parentId.startsWith(PICK_MIX) -> container.api.homeMix(parentId.removePrefix(PICK_MIX)).tracks
            parentId.startsWith(PICK_SHELF) -> container.api.homeFeed().blocks
                .firstOrNull { it.key == parentId.removePrefix(PICK_SHELF) }?.tracks.orEmpty()
            parentId == FAVORITES -> container.api.favorites(1, LIMIT).items
            parentId == RECENT -> container.api.recentlyPlayed(1, LIMIT).items
            parentId == DOWNLOADS -> container.downloads.tracks()
            parentId.startsWith(PLAYLIST) -> container.api.playlist(parentId.removePrefix(PLAYLIST)).tracks
            parentId.startsWith(ALBUM) -> container.api.album(parentId.removePrefix(ALBUM)).tracks
            else -> emptyList()
        }
        tracks.forEach { container.tracks[it.id] = it }
        lists[parentId] = tracks
        return tracks
    }

    private fun hydrate(item: MediaItem): MediaItem {
        val id = item.mediaId.substringAfter(SEPARATOR)
        if (id == item.mediaId && item.mediaMetadata.title != null) return item
        return container.tracks[id]?.toMediaItem(container.media) ?: item.buildUpon().setMediaId(id).build()
    }

    private suspend fun signedIn() = container.session.state.first { it !is SessionState.Restoring } is SessionState.SignedIn

    private fun folder(id: String, title: String, subtitle: String? = null, artwork: String? = null, grid: Boolean = false) = MediaItem.Builder()
        .setMediaId(id)
        .setMediaMetadata(
            MediaMetadata.Builder()
                .setTitle(title)
                .setSubtitle(subtitle)
                .setArtworkUri(ArtworkProvider.uriFor(artwork))
                .setIsBrowsable(true)
                .setIsPlayable(false)
                .setMediaType(MediaMetadata.MEDIA_TYPE_FOLDER_MIXED)
                .apply {
                    if (grid) setExtras(Bundle().apply { putInt(MediaConstants.EXTRAS_KEY_CONTENT_STYLE_PLAYABLE, MediaConstants.EXTRAS_VALUE_CONTENT_STYLE_GRID_ITEM) })
                }
                .build(),
        )
        .build()

    private suspend fun recommendations(): List<MediaItem> = coroutineScope {
        val mixes = listOf(
            DAILY to R.string.home_daily_mix,
            NEW to R.string.home_new_arrivals,
            TOP to R.string.home_top_this_week,
        ).map { (kind, title) -> async { kind to title to runCatching { container.api.homeMix(kind).tracks }.getOrDefault(emptyList()) } }
        val feed = async { runCatching { container.api.homeFeed().blocks }.getOrDefault(emptyList()) }

        val picks = mixes.awaitAll().mapNotNull { (mix, tracks) -> pick(PICK_MIX + mix.first, strings.getString(mix.second), tracks) }
        val shelves = feed.await()
            .filter { it.baseKey in SHELVES && it.albums.isNullOrEmpty() && it.artists.isNullOrEmpty() && it.playlists.isNullOrEmpty() }
            .mapNotNull { block -> pick(PICK_SHELF + block.key, shelfTitle(block), block.tracks.orEmpty()) }

        picks + shelves
    }

    private fun pick(id: String, title: String, tracks: List<Track>): MediaItem? {
        if (tracks.size < MIN_PICK) return null
        tracks.forEach { container.tracks[it.id] = it }
        lists[id] = tracks

        val artists = tracks.map { it.artistName }.distinct()
        val cover = tracks.firstOrNull { it.hasCover }?.let { container.media.cover(it.albumId, it.id, it.hasCover, small = true) }
        return MediaItem.Builder()
            .setMediaId(id)
            .setMediaMetadata(
                MediaMetadata.Builder()
                    .setTitle(title)
                    .setSubtitle(artists.take(PICK_ARTISTS).joinToString(", ") + if (artists.size > PICK_ARTISTS) "…" else "")
                    .setArtworkUri(ArtworkProvider.uriFor(cover))
                    .setIsBrowsable(false)
                    .setIsPlayable(true)
                    .setMediaType(MediaMetadata.MEDIA_TYPE_PLAYLIST)
                    .build(),
            )
            .build()
    }

    private fun shelfTitle(block: HomeBlock): String {
        val subject = block.reason?.subject
        return when {
            block.baseKey == "becauseYouListened" && subject != null -> strings.getString(R.string.rec_because_you_listened, subject)
            block.baseKey == "discover" -> strings.getString(R.string.rec_discover)
            else -> block.reason?.let { reasonText(it, strings.resources) } ?: strings.getString(R.string.rec_for_you)
        }
    }

    private fun radio() = MediaItem.Builder()
        .setMediaId(RADIO)
        .setMediaMetadata(
            MediaMetadata.Builder()
                .setTitle(strings.getString(R.string.radio_mine))
                .setIsBrowsable(false)
                .setIsPlayable(true)
                .setMediaType(MediaMetadata.MEDIA_TYPE_RADIO_STATION)
                .build(),
        )
        .build()

    private fun playable(parentId: String, track: Track): MediaItem {
        val item = track.toMediaItem(container.media)
        return item.buildUpon()
            .setMediaId(parentId + SEPARATOR + track.id)
            .setMediaMetadata(
                item.mediaMetadata.buildUpon()
                    .setArtworkUri(ArtworkProvider.uriFor(container.media.cover(track.albumId, track.id, track.hasCover, small = true)))
                    .setIsBrowsable(false)
                    .setIsPlayable(true)
                    .setMediaType(MediaMetadata.MEDIA_TYPE_MUSIC)
                    .build(),
            )
            .build()
    }

    private fun <T> future(block: suspend () -> T): ListenableFuture<T> {
        val result = SettableFuture.create<T>()
        container.scope.launch {
            try {
                result.set(block())
            } catch (failure: Throwable) {
                result.setException(failure)
            }
        }
        return result
    }

    companion object {
        const val FAVORITE = "app.caimack.FAVORITE"
        const val SHUFFLE = "app.caimack.SHUFFLE"
        const val REPEAT = "app.caimack.REPEAT"

        private const val SEPARATOR = "|"
        private const val ROOT = "root"
        private const val RADIO = "radio"
        private const val MIX = "mix"
        private const val FOR_YOU = "for-you"
        private const val PICK = "pick:"
        private const val PICK_MIX = "pick:mix:"
        private const val PICK_SHELF = "pick:shelf:"
        private val SHELVES = setOf("forYou", "becauseYouListened", "discover")
        private const val MIN_PICK = 4
        private const val PICK_ARTISTS = 3
        private const val FAVORITES = "favorites"
        private const val LIBRARY = "library"
        private const val DOWNLOADS = "downloads"
        private const val PLAYLISTS = "playlists"
        private const val ALBUMS = "albums"
        private const val RECENT = "recent"
        private const val SEARCH = "search"
        private const val PLAYLIST = "playlist:"
        private const val ALBUM = "album:"
        private const val DAILY = "daily"
        private const val NEW = "new"
        private const val TOP = "top"
        private const val LIMIT = 200
        private const val SEARCH_LIMIT = 25
    }
}
