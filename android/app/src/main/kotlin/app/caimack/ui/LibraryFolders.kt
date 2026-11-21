// SPDX-License-Identifier: AGPL-3.0-only
package app.caimack.ui

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import app.caimack.R
import app.caimack.api.CaimackApi
import app.caimack.api.LibraryChange
import app.caimack.api.LibraryFolder
import app.caimack.api.LibraryItem
import java.util.UUID
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.withLock

internal const val LIBRARY_ORDER = "library-order"
internal const val LIBRARY_FOLDERS = "library-folders"

internal suspend fun refreshLibrary(api: CaimackApi) {
    val items = api.savedLibrary()
    val folders = api.libraryFolders()
    val order = api.libraryOrder()
    Remote.update(LIBRARY_ORDER, order)
    Remote.update(SAVED_LIBRARY, items)
    Remote.update(LIBRARY_FOLDERS, folders)
}

internal fun folderTrail(folders: List<LibraryFolder>, id: String?): List<LibraryFolder> {
    val result = mutableListOf<LibraryFolder>()
    val seen = mutableSetOf<String>()
    var cursor = id
    while (cursor != null && seen.add(cursor)) {
        val folder = folders.find { it.id == cursor } ?: break
        result.add(0, folder)
        cursor = folder.parentId
    }
    return result
}

@Composable
private fun LibraryChangeDialog(title: String, onDismiss: () -> Unit, ready: Boolean = true, confirmLabel: Int = R.string.action_save, change: () -> LibraryChange, content: @Composable () -> Unit) {
    val api = LocalContainer.current.api
    val scope = rememberCoroutineScope()
    var pending by remember { mutableStateOf(false) }
    var failed by remember { mutableStateOf(false) }
    AlertDialog(
        onDismissRequest = { if (!pending) onDismiss() },
        title = { Text(title) },
        text = { Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
            content()
            if (failed) Text(stringResource(R.string.collection_failed), color = LocalPalette.current.destructive)
        } },
        dismissButton = { TextButton(enabled = !pending, onClick = onDismiss) { Text(stringResource(R.string.action_cancel)) } },
        confirmButton = { TextButton(enabled = ready && !pending, onClick = {
            pending = true; failed = false
            val request = change()
            scope.launch {
                try {
                    libraryMutation.withLock { api.organizeLibrary(request); refreshLibrary(api) }
                    onDismiss()
                } catch (error: Exception) {
                    if (error is CancellationException) throw error
                    failed = true
                } finally { pending = false }
            }
        }) { if (pending) CircularProgressIndicator(Modifier.size(20.dp), strokeWidth = 2.dp) else Text(stringResource(confirmLabel)) } },
    )
}

@Composable
internal fun LibraryFolderEditor(folder: LibraryFolder? = null, parentId: String? = null, onDismiss: () -> Unit) {
    var name by remember(folder?.id) { mutableStateOf(folder?.name.orEmpty()) }
    val id = remember { folder?.id ?: UUID.randomUUID().toString() }
    LibraryChangeDialog(stringResource(if (folder == null) R.string.folders_new else R.string.folders_rename), onDismiss, ready = name.isNotBlank(), confirmLabel = if (folder == null) R.string.folders_create else R.string.action_save, change = {
        LibraryChange(if (folder == null) "create" else "rename", id, name = name.trim(), folderId = parentId)
    }) {
        OutlinedTextField(name, { name = it.take(200) }, singleLine = true, label = { Text(stringResource(R.string.folders_name)) })
    }
}

@Composable
internal fun LibraryMoveDialog(id: String, kind: String, currentFolder: String?, folders: List<LibraryFolder>, onDismiss: () -> Unit) {
    var target by remember { mutableStateOf(currentFolder) }
    val choices = folders.filter { kind != "folder" || folderTrail(folders, it.id).none { parent -> parent.id == id } }
        .map { it to folderTrail(folders, it.id).joinToString(" / ") { parent -> parent.name } }.sortedBy { it.second.lowercase() }
    LibraryChangeDialog(stringResource(R.string.folders_move), onDismiss, confirmLabel = R.string.folders_move, change = {
        LibraryChange(if (kind == "folder") "moveFolder" else "moveItem", id, kind = kind.takeIf { it != "folder" }, folderId = target)
    }) {
        LazyColumn(Modifier.heightIn(max = 340.dp)) {
            item { FolderDestination(stringResource(R.string.nav_library), target == null) { target = null } }
            items(choices, key = { it.first.id }) { (folder, path) -> FolderDestination(path, target == folder.id) { target = folder.id } }
        }
    }
}

@Composable
private fun FolderDestination(label: String, selected: Boolean, onClick: () -> Unit) {
    Row(Modifier.fillMaxWidth().clickable(onClick = onClick).padding(vertical = 6.dp), verticalAlignment = Alignment.CenterVertically) {
        RadioButton(selected, onClick)
        Text(label, style = Type.small, maxLines = 3, overflow = TextOverflow.Ellipsis)
    }
}

@Composable
internal fun LibraryFolderMenu(folder: LibraryFolder, folders: List<LibraryFolder>) {
    var expanded by remember { mutableStateOf(false) }
    var action by remember { mutableStateOf<String?>(null) }
    Box {
        IconButton(onClick = { expanded = true }) { Icon(Lucide.EllipsisVertical, stringResource(R.string.menu_more), tint = LocalPalette.current.muted) }
        DropdownMenu(expanded, onDismissRequest = { expanded = false }) {
            listOf("rename" to R.string.folders_rename, "move" to R.string.folders_move, "delete" to R.string.folders_delete).forEach { (key, title) ->
                DropdownMenuItem(text = { Text(stringResource(title)) }, onClick = { expanded = false; action = key })
            }
        }
    }
    when (action) {
        "rename" -> LibraryFolderEditor(folder = folder, onDismiss = { action = null })
        "move" -> LibraryMoveDialog(folder.id, "folder", folder.parentId, folders) { action = null }
        "delete" -> LibraryChangeDialog(stringResource(R.string.folders_delete), { action = null }, confirmLabel = R.string.folders_delete, change = { LibraryChange("delete", folder.id) }) {
            Text(stringResource(R.string.folders_delete_hint))
        }
    }
}

@Composable
internal fun LibraryFolderView(
    folder: LibraryFolder,
    folders: List<LibraryFolder>,
    items: List<LibraryItem>,
    order: List<String>,
    childCount: Int,
    grid: Boolean,
    onOpen: () -> Unit,
) {
    val media = LocalContainer.current.media
    val byKey = items.associateBy { "${it.kind}:${it.id}" }
    val images = orderedLibraryKeys(byKey.keys.toList(), order).asSequence().mapNotNull { key ->
        val item = byKey.getValue(key)
        val url = when (item.kind) {
            "album" -> media.cover(item.id, null, item.hasImage, small = true)
            "artist" -> media.artistImage(item.id, item.hasImage, small = true)
            else -> {
                val lead = item.coverTracks?.firstOrNull { it.hasCover }
                if (!item.hasImage && lead != null) media.cover(lead.albumId, lead.id, true, small = true)
                else media.playlistCover(item.id, item.hasImage, item.coverTrackId, small = true)
            }
        }
        url?.let { CoverTile(it, item.title) }
    }.take(4).toList()
    val tiles = if (images.size in 2..3) (images + images).take(4) else images
    Card(folder.name, stringResource(R.string.folders_items, items.size + childCount), onOpen,
        list = !grid,
        menu = if (LocalOfflineLibrary.current) null else { { LibraryFolderMenu(folder, folders) } },
    ) { size ->
        BadgedCover(Lucide.Folder, tiles.isNotEmpty(), size) {
            if (tiles.isNotEmpty()) CoverMosaic(tiles, Modifier.fillMaxSize())
        }
    }
}
