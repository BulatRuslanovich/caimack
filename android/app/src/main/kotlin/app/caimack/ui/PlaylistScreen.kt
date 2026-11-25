// SPDX-License-Identifier: AGPL-3.0-only

package app.caimack.ui

import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import android.widget.Toast
import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectDragGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.RadioButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.SnackbarDuration
import androidx.compose.material3.SnackbarResult
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
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
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.zIndex
import app.caimack.R
import app.caimack.api.AddTracksRequest
import app.caimack.api.CopyPlaylistTracks
import app.caimack.api.PlaylistCoverTrack
import app.caimack.api.PlaylistDetail
import app.caimack.api.PlaylistMembershipChange
import app.caimack.api.RadioRequest
import app.caimack.api.Track
import app.caimack.api.TrackLookup
import java.time.Instant
import java.util.UUID
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext

@Composable
internal fun PlaylistScreen(id: String, play: (List<Track>, Int) -> Unit, onBack: () -> Unit, account: @Composable () -> Unit) {
    val container = LocalContainer.current
    val api = catalogApi()
    val local = LocalOfflineLibrary.current
    LoadCollection("playlist:$id", {
        api.playlist(id).also { playlist ->
            if (!local) kotlinx.coroutines.withContext(Dispatchers.IO) { container.downloadedCatalog.remember(playlist) }
        }
    }, onBack, account) { loaded ->
        PlaylistContent(loaded, play, onBack, account)
    }
}

private enum class Editing { None, Manage, Details, Delete, Order, Sort, Catalog, CopySelected, CopyAll }

@Composable
private fun PlaylistContent(loaded: PlaylistDetail, play: (List<Track>, Int) -> Unit, onBack: () -> Unit, account: @Composable () -> Unit) {
    val container = LocalContainer.current
    val scope = rememberCoroutineScope()
    val context = LocalContext.current
    val resources = LocalResources.current
    val snackbar = LocalSnackbar.current
    val actions = remember(container.api) { PlaylistTrackActions(container.api) }
    val mutations = remember(loaded.id) { Mutex() }
    val removing = remember(loaded.id) { mutableStateListOf<String>() }
    val me = currentUserId()
    var playlist by remember(loaded) { mutableStateOf(loaded) }
    var editing by remember(loaded.id) { mutableStateOf(Editing.None) }
    var sort by rememberSaveable(loaded.id) { mutableStateOf(PlaylistSort.Manual) }
    var selection by remember(loaded.id) { mutableStateOf<Set<String>?>(null) }
    var busy by remember(loaded.id) { mutableStateOf(false) }
    var radioLoading by remember(loaded.id) { mutableStateOf(false) }
    val displayed = remember(playlist, sort) { sort.tracks(playlist) }
    val selected = displayed.filter { it.id in selection.orEmpty() }
    val local = LocalOfflineLibrary.current
    val available = LocalAvailableTracks.current
    val owner = me != null && playlist.ownerId == me
    val canEditTracks = owner && (!local || container.syncStore.active && container.syncStore.snapshot != null)
    val canManage = owner && !local
    val canRecommend = recommendationsEnabled() && !local
    val say = { message: String -> Toast.makeText(context, message, Toast.LENGTH_SHORT).show() }

    BackHandler(selection != null && editing == Editing.None && !busy) { selection = null }

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

    fun updatePlaylist(updated: PlaylistDetail) {
        playlist = updated
        Remote.update("playlist:${loaded.id}", updated)
        invalidatePlaylistLists()
    }

    fun updateTracks(tracks: List<Track>, latest: PlaylistDetail = playlist) {
        val ids = tracks.mapTo(hashSetOf(), Track::id)
        updatePlaylist(latest.copy(
            tracks = tracks,
            durationSeconds = tracks.sumOf(Track::durationSeconds),
            trackAddedAt = latest.trackAddedAt.filterKeys { it in ids },
        ))
    }

    suspend fun changeTracks(tracks: List<Track>, present: Boolean) = mutations.withLock {
        val ids = tracks.map(Track::id)
        val result = container.api.changePlaylistMembership(loaded.id, PlaylistMembershipChange(ids, present))
        val latest = playlistResult { container.api.playlist(loaded.id) }.getOrNull()
        val latestIds = latest?.tracks.orEmpty().mapTo(hashSetOf(), Track::id)
        if (latest != null && (!container.libraryCache.offline.value || ids.all { (it in latestIds) == present })) {
            updatePlaylist(latest)
        } else if (present) {
            val existing = playlist.tracks.mapTo(hashSetOf(), Track::id)
            val added = tracks.filterNot { it.id in existing }
            val timestamp = Instant.now().toString()
            updateTracks(playlist.tracks + added, playlist.copy(trackAddedAt = playlist.trackAddedAt + added.associate { it.id to timestamp }))
        } else {
            val removed = ids.toHashSet()
            updateTracks(playlist.tracks.filterNot { it.id in removed })
        }
        if (result.pendingSync) say(resources.getString(R.string.playlist_pending_sync))
    }

    fun actOnSelection(action: suspend () -> Unit) {
        busy = true
        scope.launch {
            playlistResult { action() }
                .onSuccess { selection = null }
                .onFailure { say(resources.getString(R.string.playlist_save_failed)) }
            busy = false
        }
    }

    fun startRadio() {
        editing = Editing.None
        radioLoading = true
        val sameDevice = container.connect.captureSelection()
        scope.launch {
            val sessionId = UUID.randomUUID().toString()
            playlistResult { container.radio(RadioRequest(null, emptyList(), sessionId = sessionId, playlistId = loaded.id)) }
                .onSuccess { batch ->
                    val seed = batch.seedTrackId?.takeIf { batch.playlistSeedCount == 1 }?.let { id ->
                        playlist.tracks.find { it.id == id } ?:
                            playlistResult { container.api.lookupTracks(TrackLookup(listOf(id))).firstOrNull() }.getOrNull()
                    }
                    if (!sameDevice()) return@onSuccess
                    when {
                        batch.playlistSeedCount == 0 -> say(resources.getString(R.string.playlist_radio_no_audio))
                        seed == null && batch.tracks.isEmpty() -> say(resources.getString(R.string.playlist_radio_empty))
                        else -> container.player.startPlaylistRadio(loaded.id, sessionId, seed, batch)
                    }
                }
                .onFailure { say(resources.getString(R.string.radio_failed)) }
            radioLoading = false
        }
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
            canManage = canManage,
            canCopy = playlist.tracks.isNotEmpty(),
            canRecommend = canRecommend && !radioLoading,
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
            onCopy = { editing = Editing.CopyAll },
            onRadio = ::startRadio,
        )
        Editing.Sort -> PlaylistActionSheet(stringResource(R.string.playlist_sort), false, { editing = Editing.None }) {
            PlaylistSort.entries.forEach { option ->
                Row(
                    Modifier.fillMaxWidth().clip(Radius.row)
                        .selectable(sort == option, role = Role.RadioButton) { sort = option; editing = Editing.None }
                        .heightIn(min = 48.dp)
                        .padding(horizontal = 12.dp, vertical = 4.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    RadioButton(sort == option, onClick = null, modifier = Modifier.padding(end = 12.dp))
                    Text(stringResource(option.label), style = Type.body)
                }
            }
        }
        Editing.Catalog -> PlaylistCatalogSheet(
            playlist.id, playlist.tracks.mapTo(hashSetOf(), Track::id), { editing = Editing.None },
        ) { tracks -> changeTracks(tracks, present = true) }
        Editing.CopySelected, Editing.CopyAll -> {
            val copyAll = editing == Editing.CopyAll
            PlaylistDestinationSheet(
                sourceId = playlist.id,
                title = stringResource(if (copyAll) R.string.playlist_copy_all else R.string.playlist_copy_selected),
                onDismiss = { editing = Editing.None },
            ) { destination ->
                val result = if (copyAll) {
                    container.api.copyPlaylistTracks(loaded.id, CopyPlaylistTracks(destination))
                } else {
                    container.api.changePlaylistMembership(destination, PlaylistMembershipChange(selected.map(Track::id), present = true))
                }
                Remote.invalidate("playlist:$destination")
                invalidatePlaylistLists()
                val message = if (result.pendingSync) R.string.playlist_copy_pending else R.string.playlist_copy_result
                say(resources.getString(message, result.changed, result.unchanged))
                if (!copyAll) selection = null
            }
        }
        Editing.Details -> PlaylistDialog(
            title = stringResource(R.string.playlist_edit),
            initial = app.caimack.api.PlaylistChanges(playlist.name, playlist.description, playlist.isPublic),
            onDismiss = { editing = Editing.None },
        ) { changes ->
            val updated = container.api.updatePlaylist(playlist.id, changes)
            withContext(Dispatchers.Main) {
                updatePlaylist(playlist.copy(name = updated.name, description = updated.description, isPublic = updated.isPublic))
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
                withContext(Dispatchers.Main) { onBack() }
            }
        }
        else -> Unit
    }

    if (editing == Editing.Order) {
        Reorder(playlist.tracks, onCancel = { editing = Editing.None }) { ordered ->
            editing = Editing.None
            busy = true
            scope.launch {
                playlistResult {
                    mutations.withLock {
                        val ids = ordered.map(Track::id)
                        check(container.api.reorderPlaylist(loaded.id, AddTracksRequest(ids)).isSuccessful)
                        val latest = playlistResult { container.api.playlist(loaded.id) }.getOrNull()
                        if (latest != null) updatePlaylist(latest) else updateTracks(ordered)
                    }
                }.onFailure { say(resources.getString(R.string.playlist_save_failed)) }
                busy = false
            }
        }
        return
    }

    val coverTracks = remember(playlist.tracks, playlist.hasCover) {
        if (playlist.hasCover) null
        else playlist.tracks.asSequence().filter { it.hasCover }.distinctBy { it.albumId ?: it.id }
            .take(4).map { PlaylistCoverTrack(it.id, it.title, it.albumId, it.albumTitle, it.hasCover) }.toList()
    }
    val cover = container.media.playlistCover(playlist.id, playlist.hasCover, null, small = false)
    val backdrop = if (playlist.hasCover) container.media.playlistCover(playlist.id, true, null, small = true)
    else coverTracks?.firstOrNull()?.let { container.media.cover(it.albumId, it.id, it.hasCover, small = true) }

    CollectionPage(
        kind = stringResource(if (playlist.isPublic) R.string.playlist_kind_public else R.string.playlists_kind),
        title = playlist.name,
        description = playlist.description,
        facts = listOf(
            stringResource(R.string.playlists_by, playlist.ownerName),
            pluralStringResource(R.plurals.count_tracks, playlist.tracks.size, playlist.tracks.size),
        ),
        backdrop = backdrop,
        onBack = onBack,
        account = account,
        selectionBar = {
            if (selection != null) {
                Column(Modifier.fillMaxWidth().padding(horizontal = 16.dp)) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        SelectionCount(selected.size, Modifier.weight(1f))
                        TextButton(enabled = !busy, onClick = { selection = null }) { Text(stringResource(R.string.action_cancel)) }
                    }
                    FlowRow {
                        TextButton(enabled = selected.isNotEmpty() && !busy, onClick = { editing = Editing.CopySelected }) {
                            Text(stringResource(R.string.playlist_copy_selected))
                        }
                        TextButton(
                            enabled = selected.isNotEmpty() && !busy && (!local || selected.all { it.id in available }),
                            onClick = { actOnSelection { container.connect.enqueueTracks(selected) } },
                        ) { Text(stringResource(R.string.playlist_queue_selected)) }
                        if (canEditTracks) TextButton(enabled = selected.isNotEmpty() && !busy, onClick = {
                            actOnSelection { changeTracks(selected, present = false) }
                        }) { Text(stringResource(R.string.playlist_remove_selected)) }
                    }
                }
            }
        },
        cover = { PlaylistArtwork(cover, coverTracks, playlist.name, it) },
        actions = {
            Actions(
                displayed, play,
                onMore = if (!busy && (canManage || displayed.isNotEmpty() || canRecommend && !radioLoading)) {
                    { editing = Editing.Manage }
                } else null,
                libraryAction = { LibrarySaveButton("playlist", playlist.id) },
                prominentPlay = true,
                beforeDownload = {
                    container.downloadedCatalog.remember(playlist)
                    if (playlist.hasCover) container.downloadedCatalog.cacheArtwork(
                        listOf("api/playlists/${playlist.id}/cover"), container.http,
                    )
                },
            )
        },
    ) {
        if (canEditTracks || displayed.isNotEmpty()) {
            item {
                val palette = LocalPalette.current
                Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp), verticalAlignment = Alignment.CenterVertically) {
                    Box(Modifier.weight(1f)) {
                        if (canEditTracks) TextButton(enabled = !busy, onClick = { editing = Editing.Catalog }) {
                            Icon(Lucide.Plus, null, modifier = Modifier.padding(end = 6.dp).size(16.dp))
                            Text(stringResource(R.string.playlist_add_tracks))
                        }
                    }
                    if (displayed.isNotEmpty()) {
                        val sortOrder = stringResource(sort.label)
                        IconButton(enabled = !busy, onClick = { editing = Editing.Sort }, modifier = Modifier.semantics { stateDescription = sortOrder }) {
                            Icon(Lucide.ListFilter, stringResource(R.string.playlist_sort), tint = palette.muted)
                        }
                        if (selection == null) IconButton(enabled = !busy, onClick = { selection = emptySet() }) {
                            Icon(Lucide.ListChecks, stringResource(R.string.playlist_select_tracks), tint = palette.muted)
                        }
                    }
                }
            }
        }
        if (displayed.isEmpty()) {
            item { Empty(stringResource(R.string.playlists_empty_playlist_title)) }
        } else {
            itemsIndexed(displayed, key = { _, track -> track.id }) { index, track ->
                TrackRow(
                    track,
                    {
                        val current = selection
                        if (current == null) play(displayed, index)
                        else selection = if (track.id in current) current - track.id else current + track.id
                    },
                    onRemoveFromPlaylist = if (canManage) ({ removeTrack(track) }) else null,
                    checked = selection?.let { track.id in it },
                    selectionEnabled = !busy,
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
    canManage: Boolean,
    canCopy: Boolean,
    canRecommend: Boolean,
    onDismiss: () -> Unit,
    onDetails: () -> Unit,
    onCover: () -> Unit,
    onRemoveCover: () -> Unit,
    onOrder: () -> Unit,
    onDelete: () -> Unit,
    onCopy: () -> Unit,
    onRadio: () -> Unit,
) {
    val palette = LocalPalette.current
    ModalBottomSheet(onDismissRequest = onDismiss, containerColor = palette.card) {
        Column(Modifier.navigationBarsPadding().padding(horizontal = 12.dp, vertical = 8.dp)) {
            if (canCopy) SheetRow(stringResource(R.string.playlist_copy_all), Lucide.ListMusic, onCopy)
            if (canRecommend) SheetRow(stringResource(R.string.playlist_radio), Lucide.Radio, onRadio)
            if (canManage) {
                if (canCopy || canRecommend) HorizontalDivider(Modifier.padding(vertical = 8.dp), color = palette.border)
                SheetRow(stringResource(R.string.playlist_edit), Lucide.Pencil, onDetails)
                SheetRow(stringResource(if (hasCover) R.string.playlist_change_cover else R.string.playlist_add_cover), Lucide.Image, onCover)
                if (hasCover) SheetRow(stringResource(R.string.playlist_remove_cover), Lucide.X, onRemoveCover)
                if (canReorder) SheetRow(stringResource(R.string.playlist_reorder), Lucide.GripVertical, onOrder)
                HorizontalDivider(Modifier.padding(vertical = 8.dp), color = palette.border)
                SheetRow(stringResource(R.string.playlist_delete), Lucide.Trash2, onDelete)
            }
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
