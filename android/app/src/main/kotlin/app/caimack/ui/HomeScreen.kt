// SPDX-License-Identifier: AGPL-3.0-only

package app.caimack.ui

import android.util.Log
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.animation.animateColorAsState
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.selection.toggleable
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.draw.clip
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.Dp
import androidx.navigation.NavController
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import app.caimack.R
import app.caimack.api.HomeBlock
import app.caimack.api.SearchResults
import app.caimack.playback.LocalLibrary
import app.caimack.api.Track
import app.caimack.audiobooks.AudiobookCatalog
import app.caimack.playback.matchesCollection
import java.io.IOException
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import retrofit2.HttpException

private const val HERO_PREVIEW = 3
private const val MOBILE_UP_NEXT = 2
private const val RECENT_LIMIT = 4
private const val MIN_DISTINCT = 3

@Composable
internal fun HomeScreen(
    nav: NavController,
    category: String,
    downloads: Boolean,
    account: @Composable () -> Unit,
    onFilterChange: (category: String, downloads: Boolean) -> Unit,
) {
    val container = LocalContainer.current
    val enabled by container.audiobooksEnabled.collectAsStateWithLifecycle()
    val catalog = browsingAudiobooks()
    val selected = if (category == "audiobooks" && !enabled) "all" else category
    fun select(category: String) {
        onFilterChange(if (category == selected) "all" else category, false)
    }
    val toggleDownloads = { onFilterChange(category, !downloads) }
    // Keep motion and the horizontal position as the selected feed changes its LazyColumn.
    val scroll = rememberLazyListState()
    val duration = if (systemMotionEnabled()) 240 else 0
    val music by animateFloatAsState(if (selected == "music") 1f else 0f, tween(duration), label = "music category")
    val books by animateFloatAsState(if (selected == "audiobooks") 1f else 0f, tween(duration), label = "book category")
    val emphasis by animateFloatAsState(if (downloads) 1f else 0f, tween(duration), label = "downloads selection")
    LaunchedEffect(selected) {
        val index = when (selected) {
            "music" -> 1
            "audiobooks" -> 2
            else -> 0
        }
        if (duration == 0) scroll.scrollToItem(index) else scroll.animateScrollToItem(index)
    }
    val filters: @Composable () -> Unit = {
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            CategoryFilterRow(selected, false, {}, modifier = Modifier.weight(1f), scroll = scroll, autoReset = false) {
                item("all") { CategoryFilter(R.string.home_filter_all, selected == "all") { select("all") } }
                item("music") {
                    HomeCategory(R.string.home_filter_music, selected == "music", downloads, music, emphasis, { select("music") }, toggleDownloads)
                }
                if (enabled) item("audiobooks") {
                    HomeCategory(R.string.nav_audiobooks, selected == "audiobooks", downloads, books, emphasis, { select("audiobooks") }, toggleDownloads)
                }
            }
            account()
        }
    }
    when {
        selected == "audiobooks" -> AudiobookBrowse(downloads, filters)
        selected == "music" && downloads -> DownloadedMusicHome(filters)
        else -> MusicHome(nav, catalog.takeIf { enabled && selected == "all" }, filters)
    }
}

@Composable
private fun DownloadedMusicHome(filters: (@Composable () -> Unit)?, fallback: Boolean = false, audiobooks: AudiobookCatalog? = null) {
    val container = LocalContainer.current
    val library by container.localLibrary.collectAsStateWithLifecycle()
    val tracks = library.takeIf { it.account == container.accountKey }?.availableTracks.orEmpty()
    LazyColumn(Modifier.fillMaxSize(), contentPadding = playerContentPadding(top = 16.dp, bottom = 16.dp)) {
        if (filters != null) item("home-filters") { filters() }
        if (fallback && tracks.isNotEmpty()) item("personal-radio") { RadioHero(tracks) }
        if (fallback && tracks.isNotEmpty()) item {
            Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp), verticalAlignment = Alignment.CenterVertically) {
                Text(stringResource(R.string.home_downloaded), Modifier.weight(1f), style = Type.section)
                CollectionPlayButton(tracks.map { it.id }) { container.player.play(tracks, 0, "home:downloads") }
            }
        }
        if (audiobooks != null) homeAudiobook(audiobooks)
        if (tracks.isEmpty()) item { Empty(stringResource(if (fallback) R.string.home_empty_downloads else R.string.downloads_empty_title)) }
        itemsIndexed(tracks, key = { _, track -> track.id }) { index, track ->
            TrackRow(track, onClick = { container.player.play(tracks, index, "home:downloads") }, playbackInTitle = true)
        }
    }
}

@Composable
private fun MusicHome(nav: NavController, audiobooks: AudiobookCatalog?, filters: (@Composable () -> Unit)?) {
    val container = LocalContainer.current
    val offline = LocalOfflineLibrary.current
    val library by container.localLibrary.collectAsStateWithLifecycle()
    Load(
        key = "home",
        load = {
            if (!offline) {
                container.flushSignals()
                coroutineScope {
                    val popular = async {
                        try {
                            container.api.searchPopular()
                        } catch (error: IOException) {
                            Log.w("Caimack", "Loading popular music failed", error)
                            SearchResults()
                        } catch (error: HttpException) {
                            Log.w("Caimack", "Loading popular music failed", error)
                            SearchResults()
                        }
                    }
                    withPopularMusic(container.api.homeFeed().blocks, popular.await())
                }
            } else container.api.homeFeed().blocks.filterNot { it.baseKey == "topTracks" }.map { block ->
                val truncated = (block.totalCount ?: 0) > block.tracks.orEmpty().size
                if (block.baseKey == "dailyMix" && truncated) {
                    val mix = container.api.homeMix("daily")
                    block.copy(tracks = mix.tracks.ifEmpty { block.tracks.orEmpty() })
                } else block
            }
        },
        error = { retry ->
            if (offline) DownloadedMusicHome(filters, fallback = true, audiobooks = audiobooks)
            else HomeFeed(emptyList(), nav, audiobooks, filters) { Failure(retry) }
        },
        loading = {
            HomeFeed(emptyList(), nav, audiobooks, filters) {
                Box(Modifier.fillMaxWidth().padding(vertical = 64.dp), contentAlignment = Alignment.Center) { RecordLoading(44.dp) }
            }
        },
    ) { blocks ->
        val visible = remember(blocks, offline, library, container.accountKey) {
            val sections = blocks.filterNot { it.baseKey == "newAlbums" }
            if (offline) offlineHomeBlocks(sections, library.takeIf { it.account == container.accountKey } ?: LocalLibrary()) else sections
        }
        if (offline && visible.isEmpty()) DownloadedMusicHome(filters, fallback = true, audiobooks = audiobooks)
        else HomeFeed(visible, nav, audiobooks, filters, if (visible.isEmpty()) {
            { Empty(stringResource(R.string.home_empty_title)) }
        } else null)
    }
}

private fun withPopularMusic(blocks: List<HomeBlock>, popular: SearchResults): List<HomeBlock> {
    val sections = listOfNotNull(
        popular.tracks.takeIf { it.isNotEmpty() }?.let {
            HomeBlock("popularTracks", "popularTracks", "TrackList", "Browse", tracks = it)
        },
        popular.albums.takeIf { it.isNotEmpty() }?.let {
            HomeBlock("popularAlbums", "popularAlbums", "Shelf", "Browse", albums = it)
        },
        popular.artists.takeIf { it.isNotEmpty() }?.let {
            HomeBlock("popularArtists", "popularArtists", "Shelf", "Browse", artists = it)
        },
    )
    val weeklyTop = blocks.indexOfFirst { it.baseKey == "topTracks" }
    if (weeklyTop < 0) return blocks + sections
    return blocks.take(weeklyTop) + sections + blocks.drop(weeklyTop + 1)
}

private fun offlineHomeBlocks(blocks: List<HomeBlock>, library: LocalLibrary): List<HomeBlock> = blocks.mapNotNull { block ->
    if (block.zone == "Quick" && block.baseKey != "quickTiles") return@mapNotNull null
    val tracks = block.tracks?.filter { it.id in library.trackIds }.orEmpty()
    val visible = block.copy(
        tracks = tracks,
        albums = block.albums?.filter { ("album" to it.id) in library.collections },
        artists = block.artists?.filter { ("artist" to it.id) in library.collections },
        playlists = if (block.zone == "Quick") null else block.playlists?.filter { ("playlist" to it.id) in library.collections },
    )
    visible.takeUnless { it.tracks.isNullOrEmpty() && it.albums.isNullOrEmpty() && it.artists.isNullOrEmpty() && it.playlists.isNullOrEmpty() }
}

@Composable
private fun HomeFeed(
    blocks: List<HomeBlock>,
    nav: NavController,
    audiobooks: AudiobookCatalog?,
    filters: (@Composable () -> Unit)?,
    status: (@Composable () -> Unit)?,
) {
    val container = LocalContainer.current
    val offline = LocalOfflineLibrary.current
    val recommendations = !offline && recommendationsEnabled()
    val library by container.localLibrary.collectAsStateWithLifecycle()
    val localTracks = library.takeIf { it.account == container.accountKey }?.availableTracks.orEmpty()
    val showRadio = recommendations || (offline && localTracks.isNotEmpty())
    val shown = blocks
        .filter { it.zone != "Browse" && it.layout != "Tile" }
        .flatMap { if (it.layout == "Hero") it.tracks.orEmpty().take(HERO_PREVIEW) else it.tracks.orEmpty() }
        .map { it.id }
        .toSet()

    val seen = remember { mutableSetOf<String>() }

    LazyColumn(
        Modifier.fillMaxSize(),
        contentPadding = playerContentPadding(top = 16.dp, bottom = 16.dp),
        verticalArrangement = Arrangement.spacedBy(20.dp),
    ) {
        if (filters != null) item("home-filters") { filters() }
        if (showRadio && status == null) item("personal-radio") { RadioHero(if (offline) localTracks else blocks.flatMap { it.tracks.orEmpty() }) }

        blocks.firstOrNull { it.baseKey == "quickTiles" && (!it.tracks.isNullOrEmpty() || !it.albums.isNullOrEmpty()) }?.let { quick ->
            item("quick") {
                Shown("home:quickTiles", seen)
                QuickTiles(quick, nav)
            }
        }

        blocks.filter { it.zone == "Lead" }.forEach { block -> item(block.key) { Block(block, nav, shown, seen) } }

        if (recommendations && status == null) item("recap") { RecapBanner() }
        val browse = blocks.filter { it.zone == "Browse" }
        val audiobookAnchor = browse.firstOrNull { it.baseKey == "newArrivals" }
        if (audiobookAnchor == null) audiobooks?.let { homeAudiobook(it) }
        if (status != null) item("music-status") { status() }
        browse.forEach { block ->
            item(block.key) { Block(block, nav, shown, seen) }
            if (block == audiobookAnchor) audiobooks?.let { homeAudiobook(it) }
        }
    }
}

@Composable
private fun Block(block: HomeBlock, nav: NavController, shown: Set<String>, seen: MutableSet<String>) {
    val source = "home:${block.baseKey}"
    val container = LocalContainer.current
    val play: (List<Track>, Int) -> Unit = { tracks, index -> container.playable(tracks).takeIf { it.isNotEmpty() }?.let { ready -> container.player.play(ready, ready.indexOfFirst { it.id == tracks.getOrNull(index)?.id }.coerceAtLeast(0), source) }; Unit }
    Shown(source, seen)
    val title = blockTitle(block)
    val note = when {
        block.baseKey in setOf("forYou", "artistsForYou") -> block.reason?.let { reasonLabel(it) }
        else -> null
    }
    val seeAll = blockLink(block)?.let { route -> { nav.navigate(route) } }
    val tracks = block.tracks.orEmpty()

    when (block.layout) {
        "Hero" -> DailyMix(tracks, block.totalCount ?: tracks.size, title, play) { nav.navigate(MixRoute("daily")) }
        "Grid" -> Column(verticalArrangement = Arrangement.spacedBy(16.dp)) {
            val playback by container.player.state.collectAsStateWithLifecycle()
            SectionHeader(title, note, seeAll)
            val fresh = onePerAlbum(tracks.filter { it.id !in shown })
            val cards = (if (fresh.size >= MIN_DISTINCT) fresh else onePerAlbum(tracks)).take(4)
            Column(Modifier.padding(horizontal = 16.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
                cards.chunked(2).forEach { pair ->
                    Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                        pair.forEach { track ->
                            Card(track.title, artistsOf(track), { play(tracks, tracks.indexOf(track)) }, Modifier.weight(1f),
                                playing = playback.soundingTrack?.id == track.id) {
                                Cover(trackCover(track, small = false), track.albumTitle ?: track.title, it)
                            }
                        }
                        if (pair.size == 1) Box(Modifier.weight(1f))
                    }
                }
            }
        }
        "TrackList" -> Column(
            Modifier.fillMaxWidth(),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            SectionHeader(title, note, seeAll)
            Column {
                tracks.forEachIndexed { index, track ->
                    TrackRow(track, { play(tracks, index) }, playbackInTitle = true)
                }
            }
        }
        else -> Column(verticalArrangement = Arrangement.spacedBy(16.dp)) {
            SectionHeader(title, note, seeAll)
            Shelf(block, nav, play)
        }
    }
}

@Composable
private fun Shelf(block: HomeBlock, nav: NavController, play: (List<Track>, Int) -> Unit) {
    val container = LocalContainer.current
    val media = container.media
    val playback by container.player.state.collectAsStateWithLifecycle()
    val width = Modifier.width(LocalLibraryDensity.current.shelfWidth)

    LazyRow(contentPadding = PaddingValues(horizontal = 16.dp, vertical = 8.dp), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
        when {
            !block.artists.isNullOrEmpty() -> items(block.artists, key = { it.id }) { artist ->
                val image = media.artistImage(artist.id, artist.hasImage, small = true)
                Card(artist.name, pluralStringResource(R.plurals.count_tracks, artist.trackCount, artist.trackCount), { nav.navigate(ArtistRoute(artist.id)) }, width, round = true, toneUrl = image) {
                    Cover(image, artist.name, it, round = true)
                }
            }
            !block.albums.isNullOrEmpty() -> items(block.albums, key = { it.id }) { album ->
                val cover = media.albumCover(album, small = true)
                Card(album.title, listOfNotNull(album.artistName, album.year?.toString()).joinToString(", "), { nav.navigate(AlbumRoute(album.id)) }, width, toneUrl = cover,
                    playing = playback.soundingTrack?.albumId == album.id) {
                    Cover(cover, album.title, it)
                }
            }
            !block.playlists.isNullOrEmpty() -> items(block.playlists, key = { it.id }) { playlist ->
                val cover = media.playlistCover(playlist.id, playlist.hasCover, playlist.coverTrackId, small = true)
                Card(playlist.name, pluralStringResource(R.plurals.count_tracks, playlist.trackCount, playlist.trackCount), { nav.navigate(PlaylistRoute(playlist.id)) }, width, toneUrl = cover) {
                    PlaylistArtwork(cover, playlist.coverTracks.takeUnless { playlist.hasCover }, playlist.name, it)
                }
            }
            else -> {
                val tracks = block.tracks.orEmpty()
                items(tracks, key = { it.id }) { track ->
                    val cover = trackCover(track)
                    Card(track.title, artistsOf(track), { play(tracks, tracks.indexOf(track)) }, width, toneUrl = cover,
                        playing = playback.soundingTrack?.id == track.id) {
                        Cover(cover, track.albumTitle ?: track.title, it)
                    }
                }
            }
        }
    }
}

@Composable
private fun DailyMix(tracks: List<Track>, total: Int, title: String, play: (List<Track>, Int) -> Unit, seeAll: () -> Unit) {
    val palette = LocalPalette.current
    val lead = tracks.firstOrNull() ?: return
    val collage = tracks.distinctBy { it.albumId ?: it.id }.take(4)
    Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Box(Modifier.padding(horizontal = 16.dp).fillMaxWidth().height(1.dp).background(palette.border))
        Column(
            Modifier.fillMaxWidth().clickable(role = Role.Button, onClick = seeAll).padding(horizontal = 16.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                Collage(collage, lead, Modifier.size(44.dp).clip(Radius.cover))
                Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
                    Text(title, style = Type.section, maxLines = 2, overflow = TextOverflow.Ellipsis)
                    Text(pluralStringResource(R.plurals.count_tracks, total, total), style = Type.tiny, color = palette.muted)
                }
                CollectionPlayButton(tracks.map { it.id }, size = 48.dp, iconSize = 20.dp) { play(tracks, 0) }
            }
            Text(tracks.map { artistsOf(it) }.distinct().take(3).joinToString(" · "),
                style = Type.small, color = palette.muted, maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
        Column {
            tracks.take(MOBILE_UP_NEXT).forEachIndexed { index, track -> TrackRow(track, { play(tracks, index) }, playbackInTitle = true) }
        }
        Row(Modifier.padding(horizontal = 16.dp).heightIn(min = 48.dp).clickable(onClick = seeAll),
            verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
            Text(stringResource(R.string.action_see_all), style = Type.small, color = palette.muted)
            Icon(Lucide.ChevronRight, null, tint = palette.muted, modifier = Modifier.size(16.dp))
        }
    }
}

@Composable
private fun Collage(collage: List<Track>, lead: Track, modifier: Modifier) {
    Box(modifier) {
        if (collage.size == 4) {
            Column(Modifier.fillMaxSize()) {
                collage.chunked(2).forEach { pair ->
                    Row(Modifier.weight(1f)) {
                        pair.forEach { Cover(trackCover(it), it.albumTitle ?: it.title, Modifier.weight(1f).fillMaxSize()) }
                    }
                }
            }
        } else {
            Cover(trackCover(lead, small = false), lead.albumTitle ?: lead.title, Modifier.fillMaxSize())
        }
    }
}

@Composable
internal fun CollectionPlayButton(trackIds: List<String>, enabled: Boolean = true, size: Dp = 52.dp, iconSize: Dp = 22.dp, onPlay: () -> Unit) {
    val player = LocalContainer.current.player
    val state by player.state.collectAsStateWithLifecycle()
    val available = LocalAvailableTracks.current
    val collection = if (LocalOfflineLibrary.current) trackIds.filter { it in available } else trackIds
    val automatic = displayedRadio().notes.keys
    val active = matchesCollection(collection, state.queue.map { it.id }, state.current?.id, automatic)
    CollectionTransportButton(active && state.playing, enabled, size, iconSize) {
        if (active) player.toggle() else onPlay()
    }
}

@Composable
internal fun CollectionTransportButton(
    playing: Boolean,
    enabled: Boolean,
    size: Dp = 52.dp,
    iconSize: Dp = 22.dp,
    onClick: () -> Unit,
) {
    val palette = LocalPalette.current
    Box(
        Modifier.size(size).clip(CircleShape).background(palette.action).clickable(enabled = enabled, role = Role.Button, onClick = onClick),
        contentAlignment = Alignment.Center,
    ) {
        Icon(if (playing) Lucide.Pause else Lucide.Play,
            stringResource(if (playing) R.string.action_pause else R.string.action_play),
            tint = palette.onAction, modifier = Modifier.size(iconSize))
    }
}

@Composable
fun PlayActions(modifier: Modifier = Modifier, enabled: Boolean = true, trackIds: List<String> = emptyList(), onPlay: () -> Unit) {
    Row(modifier, horizontalArrangement = Arrangement.spacedBy(10.dp), verticalAlignment = Alignment.CenterVertically) {
        CollectionPlayButton(trackIds, enabled = enabled, onPlay = onPlay)
        CollectionShuffleButton(enabled)
    }
}

@Composable
internal fun CollectionShuffleButton(enabled: Boolean, compact: Boolean = false) {
    val palette = LocalPalette.current
    val player = LocalContainer.current.player
    val state by player.state.collectAsStateWithLifecycle()
    val label = stringResource(R.string.action_shuffle)
    val toggle = Modifier.clip(CircleShape)
        .toggleable(value = state.shuffle, enabled = enabled, role = Role.Checkbox, onValueChange = player::setShuffle)
    if (compact) {
        Box(Modifier.size(48.dp).then(toggle), contentAlignment = Alignment.Center) {
            Icon(Lucide.Shuffle, label, tint = if (state.shuffle) palette.primary else palette.muted)
        }
        return
    }

    val background by animateColorAsState(if (state.shuffle) palette.primary else palette.background, label = "shuffle background")
    val foreground by animateColorAsState(if (state.shuffle) palette.onPrimary else palette.foreground, label = "shuffle foreground")
    Row(
        Modifier.heightIn(min = 48.dp).clip(CircleShape).background(background)
            .border(1.dp, if (state.shuffle) palette.primary else palette.controlBorder, CircleShape)
            .then(toggle).padding(horizontal = 20.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Icon(Lucide.Shuffle, null, tint = foreground, modifier = Modifier.size(16.dp))
        Text(label, color = foreground, style = Type.small.copy(fontWeight = FontWeight.Medium))
    }
}

@Composable
internal fun QuickTiles(block: HomeBlock, nav: NavController) {
    val container = LocalContainer.current
    val playback by container.player.state.collectAsStateWithLifecycle()
    val current = playback.current
    val albums = block.albums.orEmpty().take(RECENT_LIMIT)
    val tracks = block.tracks.orEmpty()
    val recentTracks = tracks.take(RECENT_LIMIT - albums.size)
    val count = albums.size + recentTracks.size
    if (count == 0) return

    Column(Modifier.testTag("home-recent"), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        SectionHeader(stringResource(R.string.home_quick_picks), onSeeAll = { nav.navigate(RecentRoute) })
        BoxWithConstraints(Modifier.fillMaxWidth().padding(horizontal = 16.dp)) {
            val gap = 8.dp
            val share = (maxWidth - gap * (count - 1)) / count
            val minWidth = 176.dp * LocalDensity.current.fontScale.coerceAtLeast(1f)
            val fits = share >= minWidth
            Row(if (fits) Modifier.fillMaxWidth() else Modifier.horizontalScroll(rememberScrollState()),
                horizontalArrangement = Arrangement.spacedBy(gap)) {
                val card = if (fits) Modifier.weight(1f) else Modifier.width(minWidth)
                albums.forEach { album ->
                    val cover = container.media.albumCover(album, small = true)
                    Tile(album.title, album.artistName, card, cover, playback.soundingTrack?.albumId == album.id,
                        onClick = { nav.navigate(AlbumRoute(album.id)) }) {
                        Cover(cover, album.title, Modifier.fillMaxSize())
                    }
                }
                recentTracks.forEach { track ->
                    val cover = trackCover(track)
                    Tile(track.title, artistsOf(track), card, cover, playback.soundingTrack?.id == track.id,
                        onClick = {
                            if (current?.id == track.id) container.player.toggle()
                            else {
                                val ready = container.playable(tracks)
                                val index = ready.indexOfFirst { it.id == track.id }
                                if (index >= 0) container.player.play(ready, index, "home:quickTiles")
                            }
                        }) {
                        Cover(cover, track.albumTitle ?: track.title, Modifier.fillMaxSize())
                    }
                }
            }
        }
    }
}

@Composable
private fun Tile(
    label: String, sublabel: String, modifier: Modifier, toneUrl: String?, playing: Boolean,
    onClick: () -> Unit, art: @Composable () -> Unit,
) {
    val palette = LocalPalette.current
    val tone = rememberToneColor(toneUrl)
    Row(
        modifier.heightIn(min = 64.dp)
            .clip(Radius.tile)
            .background(palette.card)
            .background(Brush.horizontalGradient(0f to tone.copy(alpha = tone.alpha * 0.3f), 0.55f to Color.Transparent))
            .clickable(onClick = onClick)
            .padding(horizontal = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(Modifier.size(48.dp)) { art() }
        Column(Modifier.weight(1f).padding(horizontal = 8.dp, vertical = 4.dp)) {
            PlaybackTitle(label, playing, Type.small.copy(fontWeight = FontWeight.Medium))
            Text(sublabel, style = Type.tiny, color = palette.muted, maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
    }
}

private fun onePerAlbum(tracks: List<Track>): List<Track> {
    val seen = mutableSetOf<String>()
    val distinct = tracks.filter { track -> track.albumId?.let { seen.add(it) } ?: true }
    return if (distinct.size >= MIN_DISTINCT) distinct else tracks
}

@Composable
private fun blockTitle(block: HomeBlock): String {
    val subject = block.reason?.subject
    return when (block.baseKey) {
        "dailyMix" -> stringResource(R.string.home_daily_mix)
        "favorites" -> stringResource(R.string.home_liked_songs)
        "quickTiles" -> stringResource(R.string.home_quick_picks)
        "newArrivals" -> stringResource(R.string.home_new_arrivals)
        "popularTracks" -> stringResource(R.string.home_popular_tracks)
        "popularAlbums" -> stringResource(R.string.home_popular_albums)
        "popularArtists" -> stringResource(R.string.home_popular_artists)
        "yourPlaylists" -> stringResource(R.string.home_your_playlists)
        "becauseYouListened" -> if (subject != null) stringResource(R.string.rec_because_you_listened, subject) else stringResource(R.string.rec_for_you)
        "discover" -> stringResource(R.string.rec_discover)
        "artistsForYou" -> stringResource(R.string.rec_artists_for_you)
        else -> stringResource(R.string.rec_for_you)
    }
}

private fun blockLink(block: HomeBlock): Any? = when (block.baseKey) {
    "dailyMix" -> MixRoute("daily")
    "favorites" -> FavoritesRoute
    "quickTiles" -> RecentRoute
    "newArrivals" -> MixRoute("new")
    "yourPlaylists" -> SearchRoute(SearchCategory.Playlists)
    "artistsForYou" -> SearchRoute(SearchCategory.Artists)
    else -> null
}

@Composable
private fun Shown(source: String, seen: MutableSet<String>) {
    val container = LocalContainer.current
    LaunchedEffect(source) {
        if (seen.add(source)) container.shelfShown(source)
    }
}
