// SPDX-License-Identifier: AGPL-3.0-only
package app.caimack.ui

import androidx.compose.animation.core.Spring
import androidx.activity.compose.BackHandler
import androidx.compose.animation.core.spring
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.navigation.NavController
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LifecycleEventEffect
import app.caimack.R
import app.caimack.api.LibraryItem
import app.caimack.api.LibraryFolder
import app.caimack.api.LibraryChange
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
fun LibraryScreen(nav: NavController) {
    val api = LocalContainer.current.api
    Load(LIBRARY_FOLDERS, { api.libraryFolders() }) { folders -> LibraryBrowser(nav, folders) }
}

@Composable
private fun LibraryBrowser(nav: NavController, folders: List<LibraryFolder>) {
    val container = LocalContainer.current
    val palette = LocalPalette.current
    var filter by rememberSaveable { mutableStateOf("all") }
    var alphabetical by rememberSaveable { mutableStateOf(false) }
    var grid by rememberSaveable { mutableStateOf(false) }
    var creating by remember { mutableStateOf(false) }
    var createMenu by remember { mutableStateOf(false) }
    var creatingFolder by remember { mutableStateOf(false) }
    var selectedFolder by rememberSaveable { mutableStateOf<String?>(null) }
    val currentFolder = folders.find { it.id == selectedFolder }
    val folderId = currentFolder?.id
    BackHandler(currentFolder != null) { selectedFolder = currentFolder?.parentId }
    var catalog by rememberSaveable { mutableStateOf(false) }
    val scope = rememberCoroutineScope()
    val showFavorites = folderId == null && (filter == "all" || filter == "playlist")
    LifecycleEventEffect(Lifecycle.Event.ON_RESUME) {
        scope.launch {
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
    Column(Modifier.fillMaxSize()) {
        Row(Modifier.fillMaxWidth().padding(horizontal = 20.dp, vertical = 12.dp), verticalAlignment = Alignment.CenterVertically) {
            if (currentFolder != null) IconButton(onClick = { selectedFolder = currentFolder.parentId }) { Icon(Lucide.ArrowLeft, stringResource(R.string.folders_up)) }
            Text(currentFolder?.name ?: stringResource(R.string.nav_library), style = Type.title, modifier = Modifier.weight(1f), maxLines = 2, overflow = TextOverflow.Ellipsis)
            if (currentFolder != null) LibraryFolderMenu(currentFolder, folders)
            Box {
                IconButton(onClick = { createMenu = true }) { Icon(Lucide.Plus, stringResource(R.string.folders_create)) }
                DropdownMenu(createMenu, onDismissRequest = { createMenu = false }) {
                    DropdownMenuItem(text = { Text(stringResource(R.string.playlist_new)) }, onClick = { createMenu = false; creating = true })
                    DropdownMenuItem(text = { Text(stringResource(R.string.folders_new)) }, leadingIcon = { Icon(Lucide.Folder, null) }, onClick = { createMenu = false; creatingFolder = true })
                }
            }
        }
        LazyRow(contentPadding = PaddingValues(horizontal = 16.dp), horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
            if (filter != "all") item(key = "clear") {
                IconButton(
                    onClick = { filter = "all" },
                    modifier = Modifier.animateItem(
                        fadeInSpec = tween(220),
                        placementSpec = spring(dampingRatio = Spring.DampingRatioNoBouncy, stiffness = Spring.StiffnessMediumLow),
                        fadeOutSpec = tween(140),
                    ),
                ) {
                    Icon(Lucide.X, stringResource(R.string.collection_clear_filter), tint = palette.muted)
                }
            }
            items(listOf("playlist" to R.string.nav_playlists, "album" to R.string.nav_albums, "artist" to R.string.nav_artists).filter { filter == "all" || it.first == filter }, key = { it.first }) { (kind, label) ->
                FilterChip(
                    modifier = Modifier.animateItem(
                        fadeInSpec = tween(220),
                        placementSpec = spring(dampingRatio = Spring.DampingRatioNoBouncy, stiffness = Spring.StiffnessMediumLow),
                        fadeOutSpec = tween(140),
                    ),
                    selected = filter == kind,
                    onClick = { filter = if (filter == kind) "all" else kind },
                    label = { Text(stringResource(label)) },
                    shape = CircleShape,
                    border = null,
                    colors = FilterChipDefaults.filterChipColors(
                        containerColor = palette.raised, labelColor = palette.foreground,
                        selectedContainerColor = palette.primary, selectedLabelColor = palette.onPrimary,
                    ),
                )
            }
            item(key = "downloads") { FilterChip(
                modifier = Modifier.animateItem(
                    fadeInSpec = tween(220),
                    placementSpec = spring(dampingRatio = Spring.DampingRatioNoBouncy, stiffness = Spring.StiffnessMediumLow),
                    fadeOutSpec = tween(140),
                ),
                selected = false, onClick = { nav.navigate(DownloadsRoute) },
                label = { Text(stringResource(R.string.downloads_title)) }, shape = CircleShape, border = null,
                colors = FilterChipDefaults.filterChipColors(containerColor = palette.raised, labelColor = palette.foreground),
            ) }
        }
        Row(Modifier.fillMaxWidth().padding(horizontal = 12.dp), verticalAlignment = Alignment.CenterVertically) {
            TextButton(onClick = { alphabetical = !alphabetical }, modifier = Modifier.weight(1f)) { Text(stringResource(if (alphabetical) R.string.collection_name else R.string.collection_recent), maxLines = 1, overflow = TextOverflow.Ellipsis) }
            Box {
                IconButton(onClick = { catalog = true }) { Icon(Lucide.LibraryBig, stringResource(R.string.collection_catalog)) }
                DropdownMenu(expanded = catalog, onDismissRequest = { catalog = false }) {
                    listOf(
                        R.string.nav_tracks to TracksRoute, R.string.nav_albums to AlbumsRoute,
                        R.string.nav_artists to ArtistsRoute, R.string.nav_playlists to PlaylistsRoute,
                        R.string.nav_genres to GenresRoute, R.string.nav_recently_played to RecentRoute,
                    ).forEach { (label, route) ->
                        DropdownMenuItem(text = { Text(stringResource(label)) }, onClick = { catalog = false; nav.navigate(route) })
                    }
                }
            }
            IconButton(onClick = { grid = !grid }) { Icon(if (grid) Lucide.List else Lucide.LayoutGrid, stringResource(if (grid) R.string.collection_list else R.string.collection_grid)) }
        }
        Load(SAVED_LIBRARY, { container.api.savedLibrary() }) { library ->
            val shown = library.filter { it.folderId == folderId && (filter == "all" || it.kind == filter) }
                .let { if (alphabetical) it.sortedBy { item -> item.title.lowercase() } else it.sortedByDescending { item -> Instant.parse(item.savedAt) } }
            val shownFolders = folders.filter { it.parentId == folderId }.let { if (alphabetical) it.sortedBy { folder -> folder.name.lowercase() } else it.sortedByDescending { folder -> folder.createdAt } }
            LazyColumn(Modifier.fillMaxSize(), contentPadding = playerContentPadding(bottom = 24.dp)) {
                if (showFavorites) {
                    item { LibraryEntry(stringResource(R.string.nav_favorites), stringResource(R.string.playlists_kind), Lucide.Heart) { nav.navigate(FavoritesRoute) } }
                }
                if (grid) {
                    items(shownFolders.chunked(2), key = { "folder:" + it.first().id }) { row ->
                        Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp), horizontalArrangement = Arrangement.spacedBy(16.dp)) {
                            row.forEach { folder -> LibraryFolderView(folder, folders, library.count { it.folderId == folder.id } + folders.count { it.parentId == folder.id }, true, Modifier.weight(1f)) { selectedFolder = folder.id } }
                            if (row.size == 1) Spacer(Modifier.weight(1f))
                        }
                    }
                    items(shown.chunked(2), key = { it.first().let { item -> "${item.kind}:${item.id}" } }) { row ->
                        Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp), horizontalArrangement = Arrangement.spacedBy(16.dp)) {
                            row.forEach { item -> LibraryItemView(item, library, folders, nav, true, Modifier.weight(1f)) }
                            if (row.size == 1) Spacer(Modifier.weight(1f))
                        }
                    }
                } else {
                    items(shownFolders, key = { "folder:" + it.id }) { folder -> LibraryFolderView(folder, folders, library.count { it.folderId == folder.id } + folders.count { it.parentId == folder.id }, false) { selectedFolder = folder.id } }
                    items(shown, key = { "${it.kind}:${it.id}" }) { item -> LibraryItemView(item, library, folders, nav, false) }
                }
                if (shown.isEmpty() && shownFolders.isEmpty()) item {
                    if (showFavorites)
                        Text(stringResource(R.string.collection_hint), style = Type.small, color = LocalPalette.current.muted, modifier = Modifier.padding(24.dp))
                    else Empty(stringResource(R.string.collection_empty), stringResource(if (currentFolder != null) R.string.folders_empty_hint else R.string.collection_hint))
                }

            }
        }
    }
}

@Composable
private fun LibraryItemView(item: LibraryItem, library: List<LibraryItem>, folders: List<LibraryFolder>, nav: NavController, grid: Boolean, modifier: Modifier = Modifier) {
    val media = LocalContainer.current.media
    val url = when (item.kind) {
        "album" -> media.cover(item.id, null, item.hasImage, small = true)
        "artist" -> media.artistImage(item.id, item.hasImage, small = true)
        else -> media.playlistCover(item.id, item.hasImage, item.coverTrackId, true)
    }
    val kind = stringResource(when (item.kind) { "album" -> R.string.albums_kind; "artist" -> R.string.artists_kind; else -> R.string.playlists_kind })
    val open = { when (item.kind) { "album" -> nav.navigate(AlbumRoute(item.id)); "artist" -> nav.navigate(ArtistRoute(item.id)); else -> nav.navigate(PlaylistRoute(item.id)) } }
    val text: @Composable () -> Unit = {
        Text(item.title, style = Type.body, maxLines = 1, overflow = TextOverflow.Ellipsis)
        Text(listOf(kind, item.subtitle).filter { it.isNotBlank() }.joinToString(" · "), style = Type.small, color = LocalPalette.current.muted, maxLines = 1, overflow = TextOverflow.Ellipsis)
    }
    if (grid) Column(modifier, verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Cover(url, item.title, Modifier.fillMaxWidth().aspectRatio(1f).clickable(onClick = open), round = item.kind == "artist")
        Row(verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f).clickable(onClick = open)) { text() }
            LibraryItemMenu(item, library, folders)
        }
    } else Row(modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 6.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
        Row(Modifier.weight(1f).clickable(onClick = open), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            Cover(url, item.title, Modifier.size(64.dp), round = item.kind == "artist")
            Column(Modifier.weight(1f)) { text() }
        }
        LibraryItemMenu(item, library, folders)
    }
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
internal fun LibraryEntry(title: String, hint: String?, icon: ImageVector, onClick: () -> Unit) {
    val palette = LocalPalette.current
    Row(
        Modifier.padding(horizontal = 16.dp, vertical = 3.dp).fillMaxWidth()
            .clip(Radius.row).clickable(role = Role.Button, onClick = onClick)
            .heightIn(min = 64.dp).padding(vertical = 10.dp, horizontal = 8.dp),
        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        Box(Modifier.size(44.dp).clip(Radius.cover).background(palette.card), contentAlignment = Alignment.Center) {
            Icon(icon, null, tint = palette.primary, modifier = Modifier.size(22.dp))
        }
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
            Text(title, style = Type.body)
            hint?.let { Text(it, style = Type.small, color = palette.muted) }
        }
        Icon(Lucide.ChevronRight, null, tint = palette.muted, modifier = Modifier.size(18.dp))
    }
}
