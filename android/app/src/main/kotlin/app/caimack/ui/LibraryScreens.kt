// SPDX-License-Identifier: AGPL-3.0-only

package app.caimack.ui

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyListScope
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.GridItemSpan
import androidx.compose.foundation.lazy.grid.LazyGridScope
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.itemsIndexed
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.foundation.background
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import app.caimack.R
import app.caimack.api.Genre
import app.caimack.api.Paged
import app.caimack.api.Playlist
import app.caimack.api.Track
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.launch
import kotlinx.coroutines.Job
import kotlinx.coroutines.CancellationException

const val TRACK_PAGE_SIZE = 50
const val CARD_PAGE_SIZE = 60

class Pager<T : Any>(private val scope: CoroutineScope, private val load: suspend (Int) -> Paged<T>) {
    val items = mutableStateListOf<T>()
    var total by mutableStateOf<Int?>(null)
    var failed by mutableStateOf(false)
    private var page = 0
    private var busy = false
    private var request: Job? = null
    fun cancel() { request?.cancel() }

    fun more() {
        val known = total
        if (busy || (known != null && items.size >= known)) return
        busy = true
        failed = false
        request = scope.launch {
            runCatching { withNetworkRetries { load(page + 1) } }
                .onSuccess {
                    page = it.page
                    items += it.items
                    total = it.total
                }
                .onFailure { if (it is CancellationException) throw it; failed = true }
            busy = false
        }
    }
}

@Composable
fun <T : Any> rememberPager(key: String, load: suspend (Int) -> Paged<T>): Pager<T> {
    val scope = rememberCoroutineScope()
    val local = LocalOfflineLibrary.current
    val artworkRevision = if (local) 0 else Remote.trackArtworkRevision
    val pager = remember(key, local, artworkRevision) { Pager(scope, load) }
    LaunchedEffect(pager) { pager.more() }
    DisposableEffect(pager) { onDispose { pager.cancel() } }
    return pager
}

@Composable
fun PageTitle(title: String, subtitle: String? = null, inset: Boolean = true) {
    val palette = LocalPalette.current
    Column(Modifier.fillMaxWidth().padding(horizontal = if (inset) 16.dp else 0.dp, vertical = 12.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Text(title, style = Type.title)
        subtitle?.let { Text(it, style = Type.small, color = palette.muted) }
    }
}

@Composable
private fun CatalogCount(text: String, inset: Boolean = true) {
    Text(
        text,
        modifier = Modifier.padding(horizontal = if (inset) 16.dp else 0.dp, vertical = 8.dp),
        style = Type.small,
        color = LocalPalette.current.muted,
    )
}

@Composable
fun <T : Any> PagedColumn(
    pager: Pager<T>,
    emptyTitle: String,
    emptyDescription: String? = null,
    header: LazyListScope.() -> Unit,
    row: @Composable (Int, T) -> Unit,
) {
    LazyColumn(Modifier.fillMaxSize(), contentPadding = playerContentPadding(bottom = 16.dp)) {
        header()
        itemsIndexed(pager.items) { index, item ->
            if (index >= pager.items.size - 10) pager.more()
            row(index, item)
        }
        pagerFooter(pager, emptyTitle, emptyDescription)
    }
}

private fun <T : Any> LazyListScope.pagerFooter(pager: Pager<T>, emptyTitle: String, emptyDescription: String?) {
    item {
        when {
            pager.failed -> Failure { pager.more() }
            pager.total == null -> Box(Modifier.fillMaxWidth().padding(vertical = 48.dp), contentAlignment = Alignment.Center) { RecordLoading(44.dp) }
            pager.total == 0 -> Empty(emptyTitle, emptyDescription)
        }
    }
}

@Composable
fun <T : Any> PagedGrid(
    pager: Pager<T>,
    emptyTitle: String,
    header: LazyGridScope.() -> Unit,
    cell: @Composable (T) -> Unit,
) {
    val density = LocalLibraryDensity.current
    LazyVerticalGrid(
        GridCells.Adaptive(density.cardWidth),
        Modifier.fillMaxSize(),
        contentPadding = playerContentPadding(start = 16.dp, end = 16.dp, bottom = 16.dp),
        horizontalArrangement = Arrangement.spacedBy(density.gap),
        verticalArrangement = Arrangement.spacedBy(20.dp),
    ) {
        header()
        itemsIndexed(pager.items) { index, item ->
            if (index >= pager.items.size - 12) pager.more()
            cell(item)
        }
        item(span = { GridItemSpan(maxLineSpan) }) {
            when {
                pager.failed -> Failure { pager.more() }
                pager.total == null -> Box(Modifier.fillMaxWidth().padding(vertical = 48.dp), contentAlignment = Alignment.Center) { RecordLoading(44.dp) }
                pager.total == 0 -> Empty(emptyTitle)
            }
        }
    }
}

@Composable
internal fun TrackPage(
    key: String, title: String?, emptyTitle: String, emptyDescription: String?,
    play: (List<Track>, Int) -> Unit,
    toolbar: (@Composable () -> Unit)? = null,
    load: suspend (Int) -> Paged<Track>,
) {
    val pager = rememberPager(key, load)
    val total = pager.total
    val scope = rememberCoroutineScope()
    val snackbar = LocalSnackbar.current
    val failure = stringResource(R.string.error_load)
    var preparing by remember(key) { mutableStateOf(false) }
    var preparedIds by rememberSaveable(key) { mutableStateOf<List<String>?>(null) }
    var preparation by remember { mutableStateOf<Job?>(null) }
    DisposableEffect(key) { onDispose { preparation?.cancel() } }
    val prepare: () -> Unit = {
        if (!preparing) {
            preparing = true
            preparation = scope.launch {
                try {
                    val tracks = collectionTracks { withNetworkRetries { load(it) } }
                    if (tracks.isNotEmpty()) {
                        preparedIds = tracks.map { it.id }
                        play(tracks, 0)
                    }
                } catch (cancelled: CancellationException) { throw cancelled }
                catch (_: Exception) { snackbar.showSnackbar(failure) }
                finally { preparing = false }
            }
        }
    }
    PagedColumn(pager, emptyTitle, emptyDescription, header = {
        val count = total?.takeIf { it > 0 }
        if (title != null || count != null) item {
            val summary = count?.let { pluralStringResource(R.plurals.count_tracks, it, it) }
            if (title != null) PageTitle(title, summary)
            else if (summary != null) CatalogCount(summary)
        }
        toolbar?.let { item { it() } }
        if (total != null && total > 0) item {
            Column(Modifier.padding(horizontal = 16.dp, vertical = 8.dp)) {
                PlayActions(enabled = !preparing, trackIds = preparedIds ?: pager.items.map { it.id }, onPlay = prepare)
                if (preparing) Text(stringResource(R.string.tracks_preparing), style = Type.small, color = LocalPalette.current.muted)
            }
        }
    }) { index, track -> TrackRow(track, { play(pager.items, index) }) }
}

@Composable
fun TracksScreen(query: String, play: (List<Track>, Int) -> Unit) {
    val api = catalogApi()
    var sort by rememberSaveable { mutableStateOf("Title") }
    // Keep controls mounted while the paged result reloads.
    TrackPage("tracks:$query:$sort", null,
        stringResource(if (query.isBlank()) R.string.tracks_empty else R.string.tracks_no_match), null, play,
        toolbar = {
            Column(Modifier.padding(horizontal = 16.dp, vertical = 8.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                OptionSelector(stringResource(R.string.tracks_sort), sort, listOf(
                    "Title" to stringResource(R.string.sort_title), "Artist" to stringResource(R.string.sort_artist),
                    "Album" to stringResource(R.string.sort_album), "Recent" to stringResource(R.string.sort_recent),
                ), Modifier.fillMaxWidth()) { sort = it }
            }
        },
    ) { api.tracks(it, TRACK_PAGE_SIZE, sort, query.takeIf { it.isNotBlank() }) }
}

@Composable
fun FavoritesScreen(play: (List<Track>, Int) -> Unit) {
    val api = catalogApi()
    TrackPage(
        "favorites",
        stringResource(R.string.nav_favorites),
        stringResource(R.string.favorites_empty_title),
        null,
        play,
    ) { api.favorites(it, TRACK_PAGE_SIZE) }
}

@Composable
fun RecentScreen(play: (List<Track>, Int) -> Unit) {
    val api = catalogApi()
    TrackPage(
        "recent",
        stringResource(R.string.nav_recently_played),
        stringResource(R.string.recent_empty_title),
        null,
        play,
    ) { api.recentlyPlayed(it, TRACK_PAGE_SIZE) }
}

@Composable
fun AlbumsScreen(query: String, open: (Any) -> Unit) {
    val container = LocalContainer.current
    val api = catalogApi()
    val pager = rememberPager("albums:$query") { api.albums(it, CARD_PAGE_SIZE, query.takeIf(String::isNotEmpty)) }
    val total = pager.total

    PagedGrid(pager, stringResource(if (query.isEmpty()) R.string.albums_empty else R.string.search_nothing_found), header = {
        if (total != null) item(span = { GridItemSpan(maxLineSpan) }) {
            CatalogCount(pluralStringResource(R.plurals.count_albums, total, total), inset = false)
        }
    }) { album ->
        val cover = container.media.albumCover(album, small = true)
        Card(album.title, listOfNotNull(album.artistName, album.year?.toString()).joinToString(", "), { open(AlbumRoute(album.id)) }, toneUrl = cover) {
            Cover(cover, album.title, it)
        }
    }
}

@Composable
fun ArtistsScreen(query: String, open: (Any) -> Unit) {
    val container = LocalContainer.current
    val api = catalogApi()
    val artworkRevision = if (LocalOfflineLibrary.current) LocalArtworkRevision.current else 0L
    val pager = rememberPager("artists:$artworkRevision:$query") { api.artists(it, CARD_PAGE_SIZE, query.takeIf(String::isNotEmpty)) }
    val total = pager.total
    PagedGrid(pager, stringResource(if (query.isEmpty()) R.string.artists_empty else R.string.search_nothing_found), header = {
        if (total != null) item(span = { GridItemSpan(maxLineSpan) }) {
            CatalogCount(pluralStringResource(R.plurals.count_artists, total, total), inset = false)
        }
    }) { artist ->
        val image = container.media.artistImage(artist.id, artist.hasImage, small = true)
        Card(artist.name, pluralStringResource(R.plurals.count_tracks, artist.trackCount, artist.trackCount), { open(ArtistRoute(artist.id)) }, round = true, toneUrl = image) {
            Cover(image, artist.name, it, round = true)
        }
    }
}

@Composable
fun GenresScreen(query: String, open: (Any) -> Unit) {
    val api = catalogApi()
    Load(
        "genres",
        { api.genres() },
        isEmpty = { it.isEmpty() },
        empty = { Empty(stringResource(R.string.genres_empty)) },
    ) { genres ->
        val matching = if (query.isEmpty()) genres else genres.filter { genre ->
            genre.name.contains(query, ignoreCase = true) || genreTitle(genre.name).contains(query, ignoreCase = true)
        }
        LazyColumn(Modifier.fillMaxSize(), contentPadding = playerContentPadding()) {
            item { CatalogCount(pluralStringResource(R.plurals.count_genres, matching.size, matching.size)) }
            if (matching.isEmpty()) item { Empty(stringResource(R.string.search_nothing_found)) }
            itemsIndexed(matching, key = { _, genre -> genre.id }) { _, genre -> GenreRow(genre) { open(GenreRoute(genre.id, genre.name)) } }
        }
    }
}

@Composable
fun GenreRow(genre: Genre, onClick: () -> Unit) {
    val palette = LocalPalette.current
    val media = LocalContainer.current.media
    val tone = rememberVividToneColor(genre.coverAlbumIds.map { media.cover(it, null, true, small = true) })
    Row(
        Modifier
            .fillMaxWidth()
            .background(Brush.horizontalGradient(0f to tone.copy(alpha = tone.alpha * 0.22f), 0.5f to Color.Transparent))
            .clickable(onClick = onClick)
            .padding(horizontal = 16.dp, vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        val first = genre.coverAlbumIds.firstOrNull()
        Cover(first?.let { media.cover(it, null, true, small = true) }, genre.name, Modifier.size(48.dp))
        Column(Modifier.weight(1f)) {
            Text(genreTitle(genre.name), style = Type.small.copy(fontWeight = FontWeight.Medium))
            Text(pluralStringResource(R.plurals.count_tracks, genre.trackCount, genre.trackCount), style = Type.small, color = palette.muted)
        }
    }
}

@Composable
fun PlaylistsScreen(query: String, open: (Any) -> Unit) {
    val palette = LocalPalette.current
    val container = LocalContainer.current
    val api = catalogApi()
    var publicTab by rememberSaveable { mutableStateOf(false) }
    var creating by remember { mutableStateOf(false) }
    val matches: (Playlist) -> Boolean = { it.name.contains(query, ignoreCase = true) }

    if (creating) {
        PlaylistDialog(stringResource(R.string.playlist_new), onDismiss = { creating = false }) { changes ->
            val created = api.createPlaylist(changes)
            withContext(Dispatchers.Main) {
                creating = false
                open(PlaylistRoute(created.id))
            }
        }
    }

    Column(Modifier.fillMaxSize()) {
        Tabs(
            Modifier.padding(vertical = 4.dp),
            trailing = {
                if (!publicTab && !LocalOfflineLibrary.current) {
                    Chip(stringResource(R.string.playlist_create_short), active = false, Modifier.padding(start = 12.dp, bottom = 6.dp), icon = Lucide.Plus) { creating = true }
                }
            },
        ) {
            listOf(false to R.string.playlists_mine, true to R.string.playlists_public).forEach { (isPublic, label) ->
                Tab(stringResource(label), publicTab == isPublic) { publicTab = isPublic }
            }
        }
        Load(
            if (publicTab) "playlists:public" else "playlists:mine",
            { if (publicTab) api.publicPlaylists() else api.playlists() },
            isEmpty = { playlists -> playlists.none(matches) },
            empty = {
                if (query.isNotEmpty()) Empty(stringResource(R.string.search_nothing_found))
                else if (publicTab) Empty(stringResource(R.string.playlists_public_empty_title))
                else Column {
                    Empty(stringResource(R.string.playlists_empty_title), stringResource(R.string.playlists_empty_hint))
                    if (!LocalOfflineLibrary.current) androidx.compose.material3.TextButton(onClick = { creating = true }, modifier = Modifier.align(Alignment.CenterHorizontally)) {
                        Text(stringResource(R.string.playlist_create_short), color = palette.primary)
                    }
                }
            },
        ) { playlists ->
            LazyVerticalGrid(
                GridCells.Adaptive(140.dp),
                contentPadding = playerContentPadding(start = 16.dp, top = 16.dp, end = 16.dp, bottom = 16.dp),
                horizontalArrangement = Arrangement.spacedBy(12.dp),
                verticalArrangement = Arrangement.spacedBy(20.dp),
            ) {
                itemsIndexed(playlists.filter(matches), key = { _, playlist -> playlist.id }) { _, playlist ->
                    val subtitle = pluralStringResource(R.plurals.count_tracks, playlist.trackCount, playlist.trackCount) +
                        if (publicTab) ", ${playlist.ownerName}" else ""
                    val cover = container.media.playlistCover(playlist.id, playlist.hasCover, playlist.coverTrackId, small = true)
                    Card(playlist.name, subtitle, { open(PlaylistRoute(playlist.id)) }, toneUrl = cover) {
                        PlaylistArtwork(cover, playlist.coverTracks.takeUnless { playlist.hasCover }, playlist.name, it)
                    }
                }
            }
        }
    }
}
