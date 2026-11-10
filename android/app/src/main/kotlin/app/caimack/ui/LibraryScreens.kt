// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

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
import androidx.navigation.NavController
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import app.caimack.R
import app.caimack.api.Genre
import app.caimack.api.Paged
import app.caimack.api.Track
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.launch
import kotlinx.coroutines.Job
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.delay

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
    val pager = remember(key) { Pager(scope, load) }
    LaunchedEffect(pager) { pager.more() }
    DisposableEffect(pager) { onDispose { pager.cancel() } }
    return pager
}

@Composable
fun PageTitle(title: String, subtitle: String? = null, inset: Boolean = true) {
    val palette = LocalPalette.current
    Column(Modifier.fillMaxWidth().padding(horizontal = if (inset) 16.dp else 0.dp, vertical = 12.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Text(title, style = Type.display)
        subtitle?.let { Text(it, style = Type.small, color = palette.muted) }
    }
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
    key: String, title: String, emptyTitle: String, emptyDescription: String?,
    play: (List<Track>, Int) -> Unit,
    shuffle: (suspend () -> List<Track>)? = null,
    toolbar: (@Composable () -> Unit)? = null,
    load: suspend (Int) -> Paged<Track>,
) {
    val pager = rememberPager(key, load)
    val total = pager.total
    val scope = rememberCoroutineScope()
    val snackbar = LocalSnackbar.current
    val failure = stringResource(R.string.error_load)
    var preparing by remember(key) { mutableStateOf(false) }
    var preparation by remember { mutableStateOf<Job?>(null) }
    DisposableEffect(key) { onDispose { preparation?.cancel() } }
    val prepare: (Boolean) -> Unit = { shuffled ->
        if (!preparing) {
            preparing = true
            preparation = scope.launch {
                try {
                    val tracks = if (shuffled && shuffle != null) shuffle()
                        else collectionTracks { withNetworkRetries { load(it) } }.let { if (shuffled) it.shuffled() else it }
                    if (tracks.isNotEmpty()) play(tracks, 0)
                } catch (cancelled: CancellationException) { throw cancelled }
                catch (_: Exception) { snackbar.showSnackbar(failure) }
                finally { preparing = false }
            }
        }
    }
    PagedColumn(pager, emptyTitle, emptyDescription, header = {
        item { PageTitle(title, total?.takeIf { it > 0 }?.let { pluralStringResource(R.plurals.count_tracks, it, it) }) }
        toolbar?.let { item { it() } }
        if (total != null && total > 0) item {
            Column(Modifier.padding(horizontal = 16.dp, vertical = 8.dp)) {
                PlayActions(enabled = !preparing, onPlay = { prepare(false) }, onShuffle = { prepare(true) })
                if (preparing) Text(stringResource(R.string.tracks_preparing), style = Type.small, color = LocalPalette.current.muted)
            }
        }
    }) { index, track -> TrackRow(track, { play(pager.items, index) }) }
}

@Composable
fun TracksScreen(play: (List<Track>, Int) -> Unit) {
    val api = LocalContainer.current.api
    var input by rememberSaveable { mutableStateOf("") }
    var query by rememberSaveable { mutableStateOf("") }
    var sort by rememberSaveable { mutableStateOf("Title") }
    LaunchedEffect(input) { delay(300); query = input.trim() }
    // Keep controls mounted while the paged result reloads.
    TrackPage("tracks:$query:$sort", stringResource(R.string.nav_tracks),
        stringResource(if (query.isBlank()) R.string.tracks_empty else R.string.tracks_no_match), null, play,
        shuffle = { api.shuffleTracks(query.takeIf { it.isNotBlank() }) },
        toolbar = {
            Column(Modifier.padding(horizontal = 16.dp, vertical = 8.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                SearchInput(input, { input = it }, stringResource(R.string.tracks_search))
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
    val api = LocalContainer.current.api
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
    val api = LocalContainer.current.api
    TrackPage(
        "recent",
        stringResource(R.string.nav_recently_played),
        stringResource(R.string.recent_empty_title),
        null,
        play,
    ) { api.recentlyPlayed(it, TRACK_PAGE_SIZE) }
}

@Composable
fun AlbumsScreen(nav: NavController) {
    val container = LocalContainer.current
    val pager = rememberPager("albums") { container.api.albums(it, CARD_PAGE_SIZE) }
    val total = pager.total

    val header: @Composable () -> Unit = {
        Column {
            PageTitle(stringResource(R.string.nav_albums), total?.let { pluralStringResource(R.plurals.count_albums, it, it) }, inset = false)
        }
    }

    PagedGrid(pager, stringResource(R.string.albums_empty), header = {
        item(span = { GridItemSpan(maxLineSpan) }) { header() }
    }) { album ->
        val cover = container.media.albumCover(album, small = true)
        Card(album.title, listOfNotNull(album.artistName, album.year?.toString()).joinToString(", "), { nav.navigate(AlbumRoute(album.id)) }, toneUrl = cover) {
            Cover(cover, album.title, it)
        }
    }
}

@Composable
fun ArtistsScreen(nav: NavController) {
    val container = LocalContainer.current
    val pager = rememberPager("artists") { container.api.artists(it, CARD_PAGE_SIZE) }
    val total = pager.total
    PagedGrid(pager, stringResource(R.string.artists_empty), header = {
        item(span = { GridItemSpan(maxLineSpan) }) { PageTitle(stringResource(R.string.nav_artists), total?.let { pluralStringResource(R.plurals.count_artists, it, it) }, inset = false) }
    }) { artist ->
        val image = container.media.artistImage(artist.id, artist.hasImage, small = true)
        Card(artist.name, pluralStringResource(R.plurals.count_tracks, artist.trackCount, artist.trackCount), { nav.navigate(ArtistRoute(artist.id)) }, round = true, toneUrl = image) {
            Cover(image, artist.name, it, round = true)
        }
    }
}

@Composable
fun GenresScreen(nav: NavController) {
    val container = LocalContainer.current
    Load(
        "genres",
        { container.api.genres() },
        isEmpty = { it.isEmpty() },
        empty = { Column { PageTitle(stringResource(R.string.nav_genres)); Empty(stringResource(R.string.genres_empty)) } },
    ) { genres ->
        LazyColumn(Modifier.fillMaxSize(), contentPadding = playerContentPadding()) {
            item { PageTitle(stringResource(R.string.nav_genres), pluralStringResource(R.plurals.count_genres, genres.size, genres.size)) }
            itemsIndexed(genres) { _, genre -> GenreRow(genre) { nav.navigate(GenreRoute(genre.id, genre.name)) } }
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
fun PlaylistsScreen(nav: NavController) {
    val palette = LocalPalette.current
    val container = LocalContainer.current
    var publicTab by rememberSaveable { mutableStateOf(false) }
    var creating by remember { mutableStateOf(false) }

    if (creating) {
        PlaylistDialog(stringResource(R.string.playlist_new), onDismiss = { creating = false }) { changes ->
            val created = container.api.createPlaylist(changes)
            withContext(Dispatchers.Main) {
                creating = false
                nav.navigate(PlaylistRoute(created.id))
            }
        }
    }

    Column(Modifier.fillMaxSize()) {
        PageTitle(stringResource(R.string.nav_playlists))
        Tabs(
            Modifier.padding(vertical = 4.dp),
            trailing = {
                if (!publicTab) {
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
            { if (publicTab) container.api.publicPlaylists() else container.api.playlists() },
            isEmpty = { it.isEmpty() },
            empty = {
                if (publicTab) Empty(stringResource(R.string.playlists_public_empty_title))
                else Column {
                    Empty(stringResource(R.string.playlists_empty_title), stringResource(R.string.playlists_empty_hint))
                    androidx.compose.material3.TextButton(onClick = { creating = true }, modifier = Modifier.align(Alignment.CenterHorizontally)) {
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
                itemsIndexed(playlists) { _, playlist ->
                    val subtitle = pluralStringResource(R.plurals.count_tracks, playlist.trackCount, playlist.trackCount) +
                        if (publicTab) ", ${playlist.ownerName}" else ""
                    val cover = container.media.playlistCover(playlist.id, playlist.hasCover, playlist.coverTrackId, small = true)
                    Card(playlist.name, subtitle, { nav.navigate(PlaylistRoute(playlist.id)) }, toneUrl = cover) {
                        Cover(cover, playlist.name, it)
                    }
                }
            }
        }
    }
}
