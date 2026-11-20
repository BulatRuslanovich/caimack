// SPDX-License-Identifier: AGPL-3.0-only
package app.caimack.ui

import androidx.activity.compose.BackHandler
import androidx.compose.animation.core.tween
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.expandVertically
import androidx.compose.animation.shrinkVertically
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.GridItemSpan
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.lazy.LazyListScope
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.input.pointer.PointerEventPass
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.boundsInRoot
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.layout.positionInRoot
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.platform.LocalSoftwareKeyboardController
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.navigation.NavController
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LifecycleEventEffect
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import app.caimack.R
import app.caimack.api.LibraryItem
import app.caimack.api.LibraryFolder
import app.caimack.api.LibraryChange
import app.caimack.audiobooks.Audiobook
import app.caimack.audiobooks.AudiobookCatalog
import java.time.Instant
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock

internal const val SAVED_LIBRARY = "saved-library"
internal val libraryMutation = Mutex()

@Composable
fun LibraryScreen(nav: NavController, initialFilter: String = "all") {
    val api = LocalContainer.current.api
    Load(LIBRARY_FOLDERS, { api.libraryFolders() }) { folders ->
        Load(LIBRARY_ORDER, { api.libraryOrder() }) { order -> LibraryBrowser(nav, folders, order, initialFilter) }
    }
}

@Composable
@OptIn(ExperimentalLayoutApi::class)
internal fun LibraryBrowser(nav: NavController, folders: List<LibraryFolder>, order: Map<String, List<String>>, initialFilter: String = "all") {
    val container = LocalContainer.current
    val local = LocalOfflineLibrary.current
    val api = catalogApi()
    val palette = LocalPalette.current
    var selectedFilter by rememberSaveable { mutableStateOf(initialFilter) }
    val audiobookCatalog by container.audiobookStore.state.collectAsStateWithLifecycle()
    val audiobooksEnabled by container.audiobooksEnabled.collectAsStateWithLifecycle()
    val filter = if (!audiobooksEnabled && selectedFilter == "audiobook") "all" else selectedFilter
    val savedBooks = if (audiobooksEnabled) audiobookCatalog.books.filter { it.saved } else emptyList()
    var downloadedOnly by rememberSaveable { mutableStateOf(false) }
    val available = LocalAvailableCollections.current
    val availableTracks = LocalAvailableTracks.current
    var search by rememberSaveable { mutableStateOf("") }
    var searchExpanded by rememberSaveable { mutableStateOf(false) }
    var searchFocused by remember { mutableStateOf(false) }
    val searchFocus = remember { FocusRequester() }
    val focus = LocalFocusManager.current
    val keyboard = LocalSoftwareKeyboardController.current
    var searchBounds by remember { mutableStateOf<Rect?>(null) }
    var searchButtonBounds by remember { mutableStateOf<Rect?>(null) }
    var libraryOrigin by remember { mutableStateOf(Offset.Zero) }
    val dismissSearch by rememberUpdatedState { point: Offset ->
        if (searchExpanded && searchBounds?.contains(point + libraryOrigin) != true &&
            searchButtonBounds?.contains(point + libraryOrigin) != true) {
            focus.clearFocus()
            if (search.isBlank()) { search = ""; searchExpanded = false; keyboard?.hide() }
        }
    }
    val imeVisible = WindowInsets.isImeVisible
    var keyboardWasVisible by remember { mutableStateOf(false) }
    LaunchedEffect(imeVisible, searchExpanded) {
        if (!searchExpanded) keyboardWasVisible = false
        else if (imeVisible) keyboardWasVisible = true
        else if (keyboardWasVisible) {
            keyboardWasVisible = false
            focus.clearFocus()
            if (search.isBlank()) { search = ""; searchExpanded = false }
        }
    }
    var favoriteCount by remember(local) { mutableStateOf<Int?>(null) }
    LaunchedEffect(local, downloadedOnly, availableTracks) {
        favoriteCount = null
        try {
            favoriteCount = if (downloadedOnly) collectionTracks { api.favorites(it, TRACK_PAGE_SIZE) }.count { it.id in availableTracks }
                else api.favorites(1, 1).total
        }
        catch (error: Exception) { if (error is CancellationException) throw error }
    }
    var sort by rememberSaveable { mutableStateOf("manual") }
    val alphabetical = sort == "name"
    var organizing by remember { mutableStateOf(false) }
    val snackbar = LocalSnackbar.current
    val failure = stringResource(R.string.collection_failed)
    var grid by rememberSaveable { mutableStateOf(false) }
    var creating by remember { mutableStateOf(false) }
    var createMenu by remember { mutableStateOf(false) }
    var creatingFolder by remember { mutableStateOf(false) }
    var selectedFolder by rememberSaveable { mutableStateOf<String?>(null) }
    val currentFolder = folders.find { it.id == selectedFolder }
    val folderId = currentFolder?.id
    BackHandler(currentFolder != null) { selectedFolder = currentFolder?.parentId }
    BackHandler(searchExpanded && search.isBlank() && !imeVisible) {
        focus.clearFocus(); search = ""; searchExpanded = false
    }
    val scope = rememberCoroutineScope()
    val query = search.trim()
    val downloadsTitle = stringResource(R.string.downloads_title)
    val showFavorites = (!downloadedOnly || (favoriteCount ?: 0) > 0) && folderId == null && (filter == "all" || filter == "playlist") && stringResource(R.string.nav_favorites).contains(query, ignoreCase = true)
    LifecycleEventEffect(Lifecycle.Event.ON_RESUME) {
        if (!local) scope.launch {
            libraryMutation.withLock {
                try {
                    refreshLibrary(container.api)
                } catch (error: Exception) {
                    if (error is CancellationException) throw error
                    // Load retains cached content and exposes retry on the initial failure.
                }
            }
        }
    }
    if (creating) PlaylistDialog(stringResource(R.string.playlist_new), onDismiss = { creating = false }) { changes ->
        val created = container.api.createPlaylist(changes)
        if (folderId != null) container.api.organizeLibrary(LibraryChange("moveItem", created.id, kind = "playlist", folderId = folderId))
        Remote.cache.remove("playlists:mine")
        Remote.cache.remove(SAVED_LIBRARY)
        withContext(Dispatchers.Main) {
            creating = false
            nav.navigate(PlaylistRoute(created.id))
        }
    }
    if (creatingFolder) LibraryFolderEditor(parentId = folderId) { creatingFolder = false }
    Column(Modifier.fillMaxSize().onGloballyPositioned { libraryOrigin = it.positionInRoot() }
        .pointerInput(Unit) {
            awaitEachGesture {
                val down = awaitFirstDown(requireUnconsumed = false, pass = PointerEventPass.Initial)
                dismissSearch(down.position)
            }
        }) {
        Row(Modifier.fillMaxWidth().padding(horizontal = 20.dp, vertical = 12.dp), verticalAlignment = Alignment.CenterVertically) {
            if (currentFolder != null) IconButton(onClick = { selectedFolder = currentFolder.parentId }) { Icon(Lucide.ArrowLeft, stringResource(R.string.folders_up)) }
            Text(currentFolder?.name ?: stringResource(R.string.nav_library), style = Type.title, modifier = Modifier.weight(1f), maxLines = 2, overflow = TextOverflow.Ellipsis)
            if (currentFolder != null) LibraryFolderMenu(currentFolder, folders)
            IconButton(
                onClick = {
                    if (searchExpanded && search.isBlank()) {
                        focus.clearFocus(); keyboard?.hide(); search = ""; searchExpanded = false
                    } else if (searchExpanded) { searchFocus.requestFocus(); keyboard?.show() }
                    else searchExpanded = true
                },
                modifier = Modifier.onGloballyPositioned { searchButtonBounds = it.boundsInRoot() }
                    .semantics { selected = searchExpanded },
            ) { Icon(Lucide.Search, stringResource(R.string.collection_search), tint = if (searchExpanded) palette.primary else palette.foreground) }
            if (!local) Box {
                IconButton(onClick = { createMenu = true }) { Icon(Lucide.Plus, stringResource(R.string.folders_create)) }
                DropdownMenu(createMenu, onDismissRequest = { createMenu = false }) {
                    DropdownMenuItem(text = { Text(stringResource(R.string.playlist_new)) }, onClick = { createMenu = false; creating = true })
                    DropdownMenuItem(text = { Text(stringResource(R.string.folders_new)) }, leadingIcon = { Icon(Lucide.Folder, null) }, onClick = { createMenu = false; creatingFolder = true })
                }
            }
        }
        AnimatedVisibility(searchExpanded,
            enter = expandVertically(tween(220)) + fadeIn(tween(160)),
            exit = shrinkVertically(tween(180)) + fadeOut(tween(120)),
        ) {
            var hadFocus by remember { mutableStateOf(false) }
            LaunchedEffect(searchExpanded) {
                if (searchExpanded) { searchFocus.requestFocus(); keyboard?.show() }
            }
            Box(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp)
                .onGloballyPositioned { searchBounds = it.boundsInRoot() }) {
                SearchInput(search, {
                    search = it
                    if (it.isBlank() && !searchFocused) { search = ""; searchExpanded = false }
                }, stringResource(R.string.collection_search),
                    focusRequester = searchFocus,
                    onFocusChange = { focused ->
                        searchFocused = focused
                        if (focused) hadFocus = true
                        else if (hadFocus && search.isBlank()) { search = ""; searchExpanded = false }
                    },
                )
            }
        }
        LibraryFilters(filter, downloadedOnly, audiobooksEnabled, { selectedFilter = it }, { downloadedOnly = it })
        Row(Modifier.fillMaxWidth().padding(horizontal = 12.dp), verticalAlignment = Alignment.CenterVertically) {
            TextButton(onClick = { sort = when (sort) { "manual" -> "recent"; "recent" -> "name"; else -> "manual" } }, modifier = Modifier.weight(1f)) { Text(stringResource(when (sort) { "name" -> R.string.collection_name; "recent" -> R.string.collection_recent; else -> R.string.collection_manual }), maxLines = 1, overflow = TextOverflow.Ellipsis) }
            TextButton(onClick = { nav.navigate(RecentRoute) }) {
                Icon(Lucide.History, null, modifier = Modifier.size(20.dp))
                Spacer(Modifier.width(4.dp))
                Text(stringResource(R.string.nav_recently_played))
            }
            IconButton(onClick = { grid = !grid }) { Icon(if (grid) Lucide.List else Lucide.LayoutGrid, stringResource(if (grid) R.string.collection_list else R.string.collection_grid)) }
        }
        Load(SAVED_LIBRARY, { api.savedLibrary() }) { library ->
            val eligible = if (downloadedOnly) library.filter { (it.kind to it.id) in available } else library
            val availableFolders = remember(eligible, folders) { libraryFolderAncestors(eligible, folders) }
            val shown = eligible.filter { (query.isNotEmpty() || it.folderId == folderId) && (filter == "all" || it.kind == filter) && "${it.title} ${it.subtitle}".contains(query, ignoreCase = true) }
            val shownBooks = if ((filter == "all" || filter == "audiobook") && (folderId == null || query.isNotEmpty())) {
                savedBooks.filter { !downloadedOnly || it.id in audiobookCatalog.downloaded }.matchingAudiobooks(query)
            } else emptyList()
            val shownFolders = folders.filter { filter != "audiobook" && (!downloadedOnly || it.id in availableFolders) }.filter { if (query.isEmpty()) it.parentId == folderId else it.name.contains(query, ignoreCase = true) }
                .let { if (alphabetical) it.sortedBy { folder -> folder.name.lowercase() } else it.sortedByDescending { folder -> folder.createdAt } }
            val defaultKeys = buildList {
                if (folderId == null) add("favorites")
                addAll(folders.filter { it.parentId == folderId }.sortedByDescending { it.createdAt }.map { "folder:${it.id}" })
                addAll(libraryItemKeys(library.filter { it.folderId == folderId }, savedBooks.takeIf { folderId == null }.orEmpty(), false))
                if (folderId == null) add("downloads")
            }
            val fullOrder = orderedLibraryKeys(defaultKeys, order[folderId ?: "root"].orEmpty())
            val ranks = fullOrder.withIndex().associate { it.value to it.index }
            val visibleKeys = buildList {
                if (showFavorites) add("favorites")
                addAll(shownFolders.map { "folder:${it.id}" })
                addAll(libraryItemKeys(shown, shownBooks, alphabetical))
                if (folderId == null && filter != "audiobook" && downloadsTitle.contains(query, ignoreCase = true)) add("downloads")
            }.let { keys -> if (sort == "manual" && query.isEmpty()) keys.sortedBy { ranks[it] ?: Int.MAX_VALUE } else keys }
            suspend fun change(request: LibraryChange) {
                if (organizing) return
                organizing = true
                val previousSort = sort
                when (request.operation) {
                    "reorder" -> {
                        Remote.update(LIBRARY_ORDER, order + ((folderId ?: "root") to request.order.orEmpty()))
                        sort = "manual"
                    }
                    "moveItem" -> Remote.update(SAVED_LIBRARY, library.map {
                        if (it.id == request.id && it.kind == request.kind) it.copy(folderId = request.folderId) else it
                    })
                    "moveFolder" -> Remote.update(LIBRARY_FOLDERS, folders.map {
                        if (it.id == request.id) it.copy(parentId = request.folderId) else it
                    })
                }
                run {
                    var committed = false
                    try {
                        libraryMutation.withLock {
                            container.api.organizeLibrary(request)
                            committed = true
                            refreshLibrary(container.api)
                        }
                    } catch (error: Exception) {
                        if (error is CancellationException) throw error
                        if (!committed) {
                            when (request.operation) {
                                "reorder" -> { Remote.update(LIBRARY_ORDER, order); sort = previousSort }
                                "moveItem" -> Remote.update(SAVED_LIBRARY, library)
                                "moveFolder" -> Remote.update(LIBRARY_FOLDERS, folders)
                            }
                        }
                        snackbar.showSnackbar(failure)
                    } finally { organizing = false }
                }
            }
            LibraryDragGrid(
                keys = (if (currentFolder != null && query.isEmpty()) listOf("up") else emptyList()) + visibleKeys,
                grid = grid, enabled = !local && !organizing && query.isEmpty(), scopeKey = "${folderId}:${filter}:${downloadedOnly}:${query}:${grid}",
                canDrop = { moving, target ->
                    val destination = if (target == "up") currentFolder?.parentId else target.removePrefix("folder:")
                    moving !in listOf("favorites", "downloads") &&
                        !moving.startsWith("audiobook:") &&
                        (target == "up" || target.startsWith("folder:")) &&
                        (!moving.startsWith("folder:") || folderTrail(folders, destination).none { "folder:${it.id}" == moving })
                },
                onFolder = { moving, target ->
                    val kind = moving.substringBefore(':')
                    val destination = if (target == "up") currentFolder?.parentId else target.substringAfter(':')
                    change(LibraryChange(if (kind == "folder") "moveFolder" else "moveItem", moving.substringAfter(':'),
                        kind = kind.takeIf { it != "folder" }, folderId = destination))
                },
                onOrder = { moved ->
                    val base = if (sort == "manual") fullOrder else orderedLibraryKeys(defaultKeys, visibleKeys)
                    change(LibraryChange("reorder", folderId = folderId, order = mergeVisibleLibraryOrder(base, moved)))
                },
                empty = {
                    if (showFavorites) Text(stringResource(R.string.collection_hint), style = Type.small, color = LocalPalette.current.muted, modifier = Modifier.padding(24.dp))
                    else Empty(stringResource(when {
                        query.isNotEmpty() -> R.string.collection_no_results
                        currentFolder != null -> R.string.collection_empty
                        filter == "album" -> R.string.collection_empty_albums
                        filter == "artist" -> R.string.collection_empty_artists
                        filter == "playlist" -> R.string.collection_empty_playlists
                        filter == "audiobook" -> R.string.audiobook_empty_saved
                        else -> R.string.collection_empty
                    }), stringResource(if (currentFolder != null) R.string.folders_empty_hint else R.string.collection_hint))
                },
            ) { key ->
                when (key) {
                    "up" -> TextButton(onClick = { selectedFolder = currentFolder?.parentId }, modifier = Modifier.fillMaxWidth()) {
                        Icon(Lucide.ArrowLeft, null); Text(stringResource(R.string.folders_up))
                    }
                    "favorites" -> LibraryEntry(stringResource(R.string.nav_favorites), stringResource(R.string.playlists_kind), Lucide.Heart,
                        grid = grid, details = favoriteCount?.let { pluralStringResource(R.plurals.count_tracks, it, it) },
                    ) { nav.navigate(FavoritesRoute) }
                    "downloads" -> {
                        val count = LocalAvailableTracks.current.size
                        LibraryEntry(downloadsTitle, pluralStringResource(R.plurals.count_tracks, count, count), Lucide.Download, grid = grid) { nav.navigate(DownloadsRoute) }
                    }
                    else -> if (key.startsWith("folder:")) {
                        folders.find { "folder:${it.id}" == key }?.let { folder ->
                            LibraryFolderView(folder, folders, eligible.count { it.folderId == folder.id } + folders.count { it.parentId == folder.id && (!downloadedOnly || it.id in availableFolders) }, grid) { selectedFolder = folder.id }
                        }
                    } else if (key.startsWith("audiobook:")) {
                        shownBooks.find { it.id == key.substringAfter(':') }?.let { book ->
                            LibraryAudiobookCard(book, audiobookCatalog, grid) { nav.navigate(AudiobookRoute(book.id)) }
                        }
                    } else library.find { "${it.kind}:${it.id}" == key }?.let { item -> LibraryItemView(item, library, folders, nav, grid) }
                }
            }
        }
    }
}

private data class LibraryEntryOrder(val key: String, val title: String, val savedAtMs: Long)

private fun libraryItemKeys(items: List<LibraryItem>, books: List<Audiobook>, alphabetical: Boolean): List<String> {
    val entries = items.map { LibraryEntryOrder("${it.kind}:${it.id}", it.title, Instant.parse(it.savedAt).toEpochMilli()) } +
        books.map { LibraryEntryOrder("audiobook:${it.id}", it.title, it.savedAtMs ?: 0L) }
    return (if (alphabetical) entries.sortedBy { it.title.lowercase() } else entries.sortedByDescending { it.savedAtMs })
        .map { it.key }
}

@Composable
private fun LibraryAudiobookCard(book: Audiobook, catalog: AudiobookCatalog, grid: Boolean, open: () -> Unit) {
    val cover = LocalContainer.current.audiobookStore.cover(book)
    val subtitle = listOfNotNull(
        stringResource(R.string.audiobook_kind), book.author,
        book.narrator?.let { stringResource(R.string.audiobook_narrator, it) },
    ).joinToString(" · ")
    Card(book.title, subtitle, open, toneUrl = cover, list = !grid, details = bookTime(book.durationMs),
        menu = { BookMenu(book, catalog) },
    ) { Cover(cover, book.title, it) }
}

@Composable
private fun LibraryItemView(item: LibraryItem, library: List<LibraryItem>, folders: List<LibraryFolder>, nav: NavController, grid: Boolean, modifier: Modifier = Modifier) {
    val local = LocalOfflineLibrary.current
    val container = LocalContainer.current
    val hasAudio = (item.kind to item.id) in LocalAvailableCollections.current
    val availability = Modifier.alpha(if (local && !hasAudio) 0.45f else 1f)
    val media = container.media
    val url = when (item.kind) {
        "album" -> media.cover(item.id, null, item.hasImage, small = true)
        "artist" -> media.artistImage(item.id, item.hasImage, small = true)
        else -> media.playlistCover(item.id, item.hasImage, item.coverTrackId, true)
    }
    val kind = stringResource(when (item.kind) { "album" -> R.string.albums_kind; "artist" -> R.string.artists_kind; else -> R.string.playlists_kind })
    val open = { when (item.kind) { "album" -> nav.navigate(AlbumRoute(item.id)); "artist" -> nav.navigate(ArtistRoute(item.id)); else -> nav.navigate(PlaylistRoute(item.id)) } }
    val details = listOfNotNull(
        item.trackCount?.let { pluralStringResource(R.plurals.count_tracks, it, it) },
        item.albumCount?.takeIf { item.kind == "artist" }?.let { pluralStringResource(R.plurals.count_albums, it, it) },
        item.durationSeconds?.takeIf { item.kind != "artist" && it > 0 }?.let { durationOf(it) },
    ).joinToString(" · ")
    Card(item.title, listOfNotNull(kind, item.subtitle.takeIf { it.isNotBlank() }, item.year?.toString()).joinToString(" · "), open,
        modifier = modifier.then(availability), round = item.kind == "artist", toneUrl = url,
        list = !grid, details = details,
        menu = if (local) null else { { LibraryItemMenu(item, library, folders) } },
    ) { Cover(url, item.title, it, round = item.kind == "artist") }

}

@Composable
private fun LibraryItemMenu(item: LibraryItem, library: List<LibraryItem>, folders: List<LibraryFolder>) {
    var expanded by remember(item.id) { mutableStateOf(false) }
    var moving by remember(item.id) { mutableStateOf(false) }
    if (moving) LibraryMoveDialog(item.id, item.kind, item.folderId, folders) { moving = false }
    Box {
        IconButton(onClick = { expanded = true }) {
            Icon(Lucide.EllipsisVertical, stringResource(R.string.menu_more), tint = LocalPalette.current.muted)
        }
        DropdownMenu(expanded = expanded, onDismissRequest = { expanded = false }) {
            DropdownMenuItem(text = { Text(stringResource(R.string.folders_move)) }, leadingIcon = { Icon(Lucide.Folder, null) }, onClick = { expanded = false; moving = true })
            LibraryToggle(item.kind, item.id, library, menu = true, onChanged = { expanded = false })
        }
    }
}

@Composable
internal fun LibrarySaveButton(kind: String, id: String) {
    if (LocalOfflineLibrary.current) return
    val api = LocalContainer.current.api
    @Suppress("UNCHECKED_CAST")
    var library by remember { mutableStateOf(Remote.cache[SAVED_LIBRARY] as? List<LibraryItem>) }
    var failed by remember { mutableStateOf(false) }
    var attempt by remember { mutableIntStateOf(0) }
    LaunchedEffect(Unit) {
        Remote.updates.collect { (key, value) ->
            if (key == SAVED_LIBRARY) {
                @Suppress("UNCHECKED_CAST")
                library = value as List<LibraryItem>
            }
        }
    }
    LaunchedEffect(attempt) {
        failed = false
        try {
            libraryMutation.withLock { Remote.update(SAVED_LIBRARY, api.savedLibrary()) }
        } catch (error: Exception) {
            if (error is CancellationException) throw error
            failed = true
        }
    }
    val loaded = library
    if (loaded != null) LibraryToggle(kind, id, loaded)
    else IconButton(onClick = { attempt++ }, enabled = failed) {
        Icon(Lucide.CirclePlus, stringResource(if (failed) R.string.action_try_again else R.string.collection_add), tint = LocalPalette.current.faint)
    }
}

@Composable
private fun LibraryToggle(kind: String, id: String, library: List<LibraryItem>, modifier: Modifier = Modifier, menu: Boolean = false, onChanged: () -> Unit = {}) {
    val container = LocalContainer.current
    val scope = rememberCoroutineScope()
    val snackbar = LocalSnackbar.current
    var pending by remember(kind, id) { mutableStateOf(false) }
    val saved = library.any { it.kind == kind && it.id == id }
    val failure = stringResource(R.string.collection_failed)
    val label = stringResource(if (saved) R.string.collection_remove else R.string.collection_add)
    val toggle = {
        scope.launch {
            pending = true
            try {
                libraryMutation.withLock {
                    if (saved) container.api.removeLibraryItem(kind, id) else container.api.saveLibraryItem(kind, id)
                    Remote.update(SAVED_LIBRARY, container.api.savedLibrary())
                    onChanged()
                }
            } catch (error: Exception) {
                if (error is CancellationException) throw error
                snackbar.showSnackbar(failure)
            } finally { pending = false }
        }
        Unit
    }
    val icon: @Composable () -> Unit = { LibrarySaveIcon(saved, label) }
    if (menu) DropdownMenuItem(
        text = { Text(label) }, leadingIcon = icon, enabled = !pending, onClick = toggle,
    ) else IconButton(onClick = toggle, enabled = !pending, modifier = modifier.semantics { selected = saved }) { icon() }
}

@Composable
internal fun LibraryEntry(title: String, hint: String?, icon: ImageVector, grid: Boolean = false, details: String? = null, onClick: () -> Unit) {
    val palette = LocalPalette.current
    Card(title, hint.orEmpty(), onClick, list = !grid, details = details) { modifier ->
        Box(modifier.clip(Radius.cover).background(palette.primarySoft), contentAlignment = Alignment.Center) {
            Icon(icon, null, tint = palette.primary, modifier = Modifier.size(if (grid) 34.dp else 24.dp))
        }
    }
}

@Composable
internal fun LibraryFilters(filter: String, downloadedOnly: Boolean, audiobooksEnabled: Boolean, onFilter: (String) -> Unit, onDownloaded: (Boolean) -> Unit) {
    val downloadedChip: LazyListScope.() -> Unit = {
        item(key = "downloaded") {
            CategoryFilter(R.string.collection_downloaded, downloadedOnly, Modifier.animateItem()) { onDownloaded(!downloadedOnly) }
        }
    }
    CategoryFilterRow(filter to downloadedOnly, filter != "all" || downloadedOnly, { onFilter("all"); onDownloaded(false) }) {
        if (downloadedOnly) downloadedChip()
        val categories = listOf(
            "audiobook" to R.string.nav_audiobooks, "playlist" to R.string.nav_playlists,
            "album" to R.string.nav_albums, "artist" to R.string.nav_artists,
        )
        items(categories.filter { (filter == "all" || it.first == filter) && (audiobooksEnabled || it.first != "audiobook") }, key = { it.first }) { (kind, label) ->
            CategoryFilter(label, filter == kind) { onFilter(if (filter == kind) "all" else kind) }
        }
        if (!downloadedOnly) downloadedChip()
    }
}
