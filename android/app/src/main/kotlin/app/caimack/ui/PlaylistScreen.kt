// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

package app.caimack.ui

import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import android.widget.Toast
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectDragGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.material3.SnackbarDuration
import androidx.compose.material3.SnackbarResult
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalResources
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.zIndex
import app.caimack.R
import app.caimack.api.AddTracksRequest
import app.caimack.api.PlaylistDetail
import app.caimack.api.Track
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext

@Composable
fun PlaylistScreen(id: String, play: (List<Track>, Int) -> Unit, onDeleted: () -> Unit) {
    val container = LocalContainer.current
    Load("playlist:$id", { container.api.playlist(id) }) { loaded ->
        PlaylistContent(loaded, play, onDeleted)
    }
}

private enum class Editing { None, Manage, Details, Delete, Order }

@Composable
private fun PlaylistContent(loaded: PlaylistDetail, play: (List<Track>, Int) -> Unit, onDeleted: () -> Unit) {
    val container = LocalContainer.current
    val context = LocalContext.current
    val resources = LocalResources.current
    val snackbar = LocalSnackbar.current
    val actions = remember(container.api) { PlaylistTrackActions(container.api) }
    val mutations = remember(loaded.id) { Mutex() }
    val removing = remember(loaded.id) { mutableStateListOf<String>() }
    val me = currentUserId()
    var playlist by remember(loaded) { mutableStateOf(loaded) }
    var editing by remember { mutableStateOf(Editing.None) }
    val owner = me != null && playlist.ownerId == me
    val say = { message: String -> Toast.makeText(context, message, Toast.LENGTH_SHORT).show() }

    fun background(work: suspend () -> Unit) {
        container.scope.launch {
            runCatching { work() }.onFailure { withContext(Dispatchers.Main) { say(resources.getString(R.string.playlist_save_failed)) } }
        }
    }

    val pickCover = rememberLauncherForActivityResult(ActivityResultContracts.PickVisualMedia()) { uri ->
        if (uri == null) return@rememberLauncherForActivityResult
        background {
            val part = coverPart(context, uri) ?: error("unreadable image")
            val updated = container.api.uploadPlaylistCover(playlist.id, part)
            container.media.markChanged(container.media.playlistCoverPath(playlist.id))
            withContext(Dispatchers.Main) { playlist = playlist.copy(hasCover = updated.hasCover) }
        }
    }

    fun updateTracks(tracks: List<Track>, latest: PlaylistDetail = playlist) {
        playlist = latest.copy(tracks = tracks)
        Remote.update("playlist:${loaded.id}", playlist)
        Remote.cache.remove("playlists:mine")
        Remote.cache.remove("playlists:public")
    }

    fun removeTrack(track: Track) {
        if (track.id in removing) return
        removing += track.id
        val originalOrder = playlist.tracks.map { it.id }
        container.scope.launch {
            try {
                mutations.withLock { actions.remove(loaded.id, track.id) }
                withContext(Dispatchers.Main) {
                    updateTracks(playlist.tracks.filterNot { it.id == track.id })
                    removing -= track.id
                }
                val result = withContext(Dispatchers.Main) {
                    snackbar.currentSnackbarData?.dismiss()
                    snackbar.showSnackbar(
                        message = resources.getString(R.string.playlist_track_removed, track.title),
                        actionLabel = resources.getString(R.string.action_undo),
                        withDismissAction = true,
                        duration = SnackbarDuration.Long,
                    )
                }
                if (result == SnackbarResult.ActionPerformed) {
                    try {
                        val restored = mutations.withLock { actions.restore(loaded.id, track.id, originalOrder) }
                        withContext(Dispatchers.Main) { updateTracks(restored.tracks, restored) }
                    } catch (error: Exception) {
                        if (error is CancellationException) throw error
                        // Adding may have succeeded even if restoring the order failed.
                        val latest = runCatching { container.api.playlist(loaded.id) }.getOrNull()
                        withContext(Dispatchers.Main) {
                            Remote.cache.remove("playlist:${loaded.id}")
                            if (latest != null) updateTracks(latest.tracks, latest)
                            say(resources.getString(R.string.playlist_restore_failed))
                        }
                    }
                }
            } catch (error: Exception) {
                if (error is CancellationException) throw error
                withContext(Dispatchers.Main) { say(resources.getString(R.string.playlist_save_failed)) }
            } finally {
                withContext(Dispatchers.Main) { removing -= track.id }
            }
        }
    }

    when (editing) {
        Editing.Manage -> ManageSheet(
            hasCover = playlist.hasCover,
            canReorder = playlist.tracks.size > 1,
            onDismiss = { editing = Editing.None },
            onDetails = { editing = Editing.Details },
            onCover = {
                editing = Editing.None
                pickCover.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly))
            },
            onRemoveCover = {
                editing = Editing.None
                background {
                    container.api.deletePlaylistCover(playlist.id)
                    container.media.markChanged(container.media.playlistCoverPath(playlist.id))
                    withContext(Dispatchers.Main) { playlist = playlist.copy(hasCover = false) }
                }
            },
            onOrder = { editing = Editing.Order },
            onDelete = { editing = Editing.Delete },
        )
        Editing.Details -> PlaylistDialog(
            title = stringResource(R.string.playlist_edit),
            initial = app.caimack.api.PlaylistChanges(playlist.name, playlist.description, playlist.isPublic),
            onDismiss = { editing = Editing.None },
        ) { changes ->
            val updated = container.api.updatePlaylist(playlist.id, changes)
            withContext(Dispatchers.Main) {
                playlist = playlist.copy(name = updated.name, description = updated.description, isPublic = updated.isPublic)
                editing = Editing.None
            }
        }
        Editing.Delete -> ConfirmDialog(
            stringResource(R.string.playlist_delete_confirm, playlist.name),
            stringResource(R.string.playlist_delete),
            onDismiss = { editing = Editing.None },
        ) {
            editing = Editing.None
            background {
                container.api.deletePlaylist(playlist.id)
                withContext(Dispatchers.Main) { onDeleted() }
            }
        }
        else -> Unit
    }

    if (editing == Editing.Order) {
        Reorder(playlist.tracks, onCancel = { editing = Editing.None }) { ordered ->
            editing = Editing.None
            val previous = playlist.tracks
            playlist = playlist.copy(tracks = ordered)
            container.scope.launch {
                val saved = runCatching { container.api.reorderPlaylist(playlist.id, AddTracksRequest(ordered.map { it.id })).isSuccessful }.getOrDefault(false)
                if (!saved) withContext(Dispatchers.Main) {
                    playlist = playlist.copy(tracks = previous)
                    say(resources.getString(R.string.playlist_save_failed))
                }
            }
        }
        return
    }

    val cover = { small: Boolean -> container.media.playlistCover(playlist.id, playlist.hasCover, playlist.coverTrackId, small) }

    LazyColumn(Modifier.fillMaxSize(), contentPadding = playerContentPadding(bottom = 24.dp)) {
        item {
            DetailHeader(
                kind = stringResource(if (playlist.isPublic) R.string.playlist_kind_public else R.string.playlists_kind),
                title = playlist.name,
                description = playlist.description,
                facts = listOf(
                    stringResource(R.string.playlists_by, playlist.ownerName),
                    pluralStringResource(R.plurals.count_tracks, playlist.tracks.size, playlist.tracks.size),
                ),
                backdrop = cover(true),
            ) { Cover(cover(false), playlist.name, it) }
        }
        item { Actions(playlist.tracks, play, onMore = if (owner) ({ editing = Editing.Manage }) else null, libraryAction = { LibrarySaveButton("playlist", playlist.id) }) }
        if (playlist.tracks.isEmpty()) {
            item { Empty(stringResource(R.string.playlists_empty_playlist_title)) }
        } else {
            itemsIndexed(playlist.tracks, key = { _, track -> track.id }) { index, track ->
                TrackRow(
                    track,
                    { play(playlist.tracks, index) },
                    onRemoveFromPlaylist = if (owner) ({ removeTrack(track) }) else null,
                )
            }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun ManageSheet(
    hasCover: Boolean,
    canReorder: Boolean,
    onDismiss: () -> Unit,
    onDetails: () -> Unit,
    onCover: () -> Unit,
    onRemoveCover: () -> Unit,
    onOrder: () -> Unit,
    onDelete: () -> Unit,
) {
    val palette = LocalPalette.current
    ModalBottomSheet(onDismissRequest = onDismiss, containerColor = palette.card) {
        Column(Modifier.navigationBarsPadding().padding(horizontal = 12.dp, vertical = 8.dp)) {
            SheetRow(stringResource(R.string.playlist_edit), Lucide.Pencil, onDetails)
            SheetRow(stringResource(if (hasCover) R.string.playlist_change_cover else R.string.playlist_add_cover), Lucide.Image, onCover)
            if (hasCover) SheetRow(stringResource(R.string.playlist_remove_cover), Lucide.X, onRemoveCover)
            if (canReorder) SheetRow(stringResource(R.string.playlist_reorder), Lucide.GripVertical, onOrder)
            HorizontalDivider(Modifier.padding(vertical = 8.dp), color = palette.border)
            SheetRow(stringResource(R.string.playlist_delete), Lucide.Trash2, onDelete)
        }
    }
}

@Composable
private fun Reorder(tracks: List<Track>, onCancel: () -> Unit, onDone: (List<Track>) -> Unit) {
    val palette = LocalPalette.current
    var order by remember(tracks) { mutableStateOf(tracks.indices.toList()) }
    var dragged by remember { mutableStateOf<Int?>(null) }
    var offset by remember { mutableFloatStateOf(0f) }
    val list = rememberLazyListState()
    val haptics = LocalHapticFeedback.current

    Column(Modifier.fillMaxSize()) {
        Row(Modifier.fillMaxWidth().padding(horizontal = 8.dp, vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
            Text(
                stringResource(R.string.action_cancel),
                style = Type.small.copy(fontWeight = FontWeight.Medium),
                color = palette.muted,
                modifier = Modifier.clip(CircleShape).clickable(onClick = onCancel).padding(horizontal = 12.dp, vertical = 10.dp),
            )
            Text(stringResource(R.string.playlist_reorder), style = Type.section, modifier = Modifier.weight(1f).padding(horizontal = 8.dp))
            Text(
                stringResource(R.string.action_done),
                style = Type.small.copy(fontWeight = FontWeight.SemiBold),
                color = palette.primary,
                modifier = Modifier.clip(CircleShape).clickable { onDone(order.map { tracks[it] }) }.padding(horizontal = 12.dp, vertical = 10.dp),
            )
        }
        HorizontalDivider(color = palette.border)

        LazyColumn(Modifier.fillMaxSize(), state = list, contentPadding = PaddingValues(vertical = 8.dp)) {
            items(order, key = { it }) { index ->
                val track = tracks[index]
                val lifted = dragged == index
                Row(
                    (if (lifted) Modifier.zIndex(1f).graphicsLayer { translationY = offset }.shadow(8.dp, Radius.row) else Modifier.animateItem())
                        .fillMaxWidth()
                        .background(if (lifted) palette.raised else palette.background)
                        .padding(start = 16.dp, top = 6.dp, bottom = 6.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(12.dp),
                ) {
                    Cover(trackCover(track), track.albumTitle ?: track.title, Modifier.size(40.dp))
                    Column(Modifier.weight(1f)) {
                        Text(track.title, style = Type.small.copy(fontWeight = FontWeight.Medium), maxLines = 1, overflow = TextOverflow.Ellipsis)
                        Text(artistsOf(track), style = Type.small, color = palette.muted, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    }
                    Box(
                        Modifier.size(48.dp).pointerInput(index) {
                            detectDragGestures(
                                onDragStart = {
                                    dragged = index
                                    offset = 0f
                                    haptics.performHapticFeedback(HapticFeedbackType.GestureThresholdActivate)
                                },
                                onDragEnd = {
                                    dragged = null
                                    offset = 0f
                                },
                                onDragCancel = {
                                    dragged = null
                                    offset = 0f
                                },
                            ) { change, amount ->
                                change.consume()
                                offset += amount.y
                                val (target, shift) = swapTarget(list, index, offset) ?: return@detectDragGestures
                                order = order.toMutableList().apply { add(indexOf(target), removeAt(indexOf(index))) }
                                offset -= shift
                                haptics.performHapticFeedback(HapticFeedbackType.SegmentFrequentTick)
                            }
                        },
                        contentAlignment = Alignment.Center,
                    ) {
                        Icon(Lucide.GripVertical, stringResource(R.string.playlist_drag), tint = palette.faint, modifier = Modifier.size(18.dp))
                    }
                }
            }
        }
    }
}
