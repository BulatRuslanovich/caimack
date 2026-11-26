// SPDX-License-Identifier: AGPL-3.0-only

package app.caimack.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.selection.toggleable
import androidx.compose.material3.Checkbox
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import app.caimack.R
import app.caimack.api.CaimackApi
import app.caimack.api.CreatePlaylistWithTracks
import app.caimack.api.Playlist
import app.caimack.api.PlaylistMembership
import app.caimack.api.PlaylistMembershipChange
import app.caimack.api.Track
import java.util.UUID
import kotlinx.coroutines.delay
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun PlaylistActionSheet(
    title: String,
    busy: Boolean,
    onDismiss: () -> Unit,
    content: @Composable ColumnScope.() -> Unit,
) {
    ModalBottomSheet(
        onDismissRequest = { if (!busy) onDismiss() },
        sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true),
        sheetGesturesEnabled = !busy,
        containerColor = LocalPalette.current.popover,
    ) {
        Column(Modifier.fillMaxWidth().navigationBarsPadding().imePadding().padding(horizontal = 12.dp)) {
            SheetHeading(title)
            content()
        }
    }
}

@Composable
private fun SheetHeading(title: String) {
    Text(title, style = Type.section, modifier = Modifier.padding(horizontal = 12.dp, vertical = 8.dp))
}

@Composable
internal fun SelectionCount(count: Int, modifier: Modifier = Modifier) {
    Text(
        pluralStringResource(R.plurals.playlist_selected_count, count, count),
        style = Type.small,
        color = LocalPalette.current.muted,
        modifier = modifier.semantics { liveRegion = LiveRegionMode.Polite },
    )
}

@Composable
internal fun PlaylistMembershipSheet(track: Track, api: CaimackApi = catalogApi(), onDismiss: () -> Unit) {
    val scope = rememberCoroutineScope()
    val editedPlaylists = remember(track.id) { mutableSetOf<String>() }
    var rows by remember(track.id) { mutableStateOf<List<PlaylistMembership>?>(null) }
    var desired by remember(track.id) { mutableStateOf(emptyMap<String, Boolean>()) }
    var saved by remember(track.id) { mutableStateOf(emptySet<String>()) }
    var failures by remember(track.id) { mutableStateOf(emptySet<String>()) }
    var busy by remember(track.id) { mutableStateOf(false) }
    var loadFailed by remember(track.id) { mutableStateOf(false) }
    var attempt by remember(track.id) { mutableIntStateOf(0) }
    var creationId by remember(track.id) { mutableStateOf<String?>(null) }

    DisposableEffect(track.id) {
        onDispose {
            // A playlist row can host this sheet. Refreshing that playlist after
            // removing the row would close the sheet before the remaining edits.
            editedPlaylists.forEach { Remote.invalidate("playlist:$it") }
            if (editedPlaylists.isNotEmpty()) invalidatePlaylistLists()
        }
    }

    LaunchedEffect(track.id, attempt) {
        loadFailed = false
        playlistResult { api.playlistMemberships(track.id) }
            .onSuccess { rows = it }
            .onFailure { loadFailed = true }
    }

    PlaylistActionSheet(stringResource(R.string.playlist_memberships), busy, onDismiss) {
        Text(track.title, style = Type.body, modifier = Modifier.padding(horizontal = 12.dp))
        if (!busy && rows != null) {
            SheetRow(stringResource(R.string.playlist_new), Lucide.Plus) { creationId = UUID.randomUUID().toString() }
        }
        when {
            loadFailed -> Failure { attempt++ }
            rows == null -> RecordLoading(28.dp)
            else -> LazyColumn(Modifier.weight(1f, fill = false)) {
                items(rows.orEmpty(), key = { it.playlist.id }) { row ->
                    val id = row.playlist.id
                    val checked = desired[id] ?: row.containsTrack
                    val status = when {
                        id in failures -> R.string.playlist_membership_failed
                        row.pendingSync -> R.string.playlist_pending_sync
                        id in saved -> R.string.playlist_membership_saved
                        else -> null
                    }
                    Row(
                        Modifier.fillMaxWidth().clip(Radius.row)
                            .toggleable(checked, enabled = !busy, role = Role.Checkbox) {
                                desired = if (it == row.containsTrack) desired - id else desired + (id to it)
                                failures = failures - id
                            }.padding(horizontal = 12.dp, vertical = 8.dp).heightIn(min = 40.dp),
                        horizontalArrangement = Arrangement.spacedBy(12.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Checkbox(checked, onCheckedChange = null, enabled = !busy)
                        Column(Modifier.weight(1f)) {
                            Text(row.playlist.name, style = Type.body)
                            status?.let { Text(stringResource(it), style = Type.small, color = LocalPalette.current.muted) }
                        }
                    }
                }
            }
        }
        if (failures.isNotEmpty()) {
            Text(
                stringResource(R.string.playlist_membership_partial), style = Type.small,
                modifier = Modifier.padding(horizontal = 12.dp).semantics { liveRegion = LiveRegionMode.Polite },
            )
        }
        TextButton(
            modifier = Modifier.align(Alignment.End),
            enabled = rows != null && !busy,
            onClick = {
                val edits = desired.toList()
                if (edits.isEmpty()) {
                    onDismiss()
                } else {
                    busy = true
                    scope.launch {
                        var queued = false
                        for ((id, checked) in edits) {
                            playlistResult { api.changePlaylistMembership(id, PlaylistMembershipChange(listOf(track.id), checked)) }
                                .onSuccess { result ->
                                    rows = rows.orEmpty().map { row ->
                                        if (row.playlist.id == id) row.copy(containsTrack = checked, pendingSync = result.pendingSync)
                                        else row
                                    }
                                    desired = desired - id
                                    failures = failures - id
                                    saved = saved + id
                                    queued = queued || result.pendingSync
                                    editedPlaylists += id
                                }
                                .onFailure { failures = failures + id }
                        }
                        busy = false
                        if (desired.isEmpty() && !queued) onDismiss()
                    }
                }
            },
        ) { Text(stringResource(if (failures.isEmpty()) R.string.action_done else R.string.action_try_again)) }
    }

    creationId?.let { requestId ->
        PlaylistDialog(title = stringResource(R.string.playlist_new), onDismiss = { creationId = null }) { changes ->
            val created = api.createPlaylistWithTracks(
                CreatePlaylistWithTracks(changes.name, changes.description, changes.isPublic, listOf(track.id), requestId),
            )
            withContext(Dispatchers.Main) {
                rows = rows.orEmpty().filterNot { it.playlist.id == created.id } +
                    PlaylistMembership(created, containsTrack = true, pendingSync = created.pendingSync)
                saved += created.id
                creationId = null
                invalidatePlaylistLists()
            }
        }
    }
}

@Composable
internal fun PlaylistDestinationSheet(
    sourceId: String,
    title: String,
    onDismiss: () -> Unit,
    onPick: suspend (String) -> Unit,
) {
    val api = catalogApi()
    val scope = rememberCoroutineScope()
    var attempt by remember { mutableIntStateOf(0) }
    val playlists by produceState<Result<List<Playlist>>?>(null, attempt) {
        value = null
        value = playlistResult { api.playlists().filterNot { it.id == sourceId } }
    }
    var busy by remember { mutableStateOf(false) }
    var failed by remember { mutableStateOf(false) }
    PlaylistActionSheet(title, busy, onDismiss) {
        when {
            playlists == null || busy -> RecordLoading(28.dp)
            playlists?.isFailure == true -> Failure { attempt++ }
            playlists?.getOrNull().isNullOrEmpty() -> Empty(stringResource(R.string.playlist_no_destination))
            else -> LazyColumn(Modifier.weight(1f, fill = false)) {
                items(playlists?.getOrNull().orEmpty(), key = { it.id }) { playlist ->
                    SheetRow(playlist.name, Lucide.ListMusic) {
                        if (!busy) {
                            busy = true
                            failed = false
                            scope.launch {
                                val result = playlistResult { onPick(playlist.id) }
                                busy = false
                                failed = result.isFailure
                                if (result.isSuccess) onDismiss()
                            }
                        }
                    }
                }
            }
        }
        if (failed) Text(stringResource(R.string.playlist_save_failed), modifier = Modifier.padding(12.dp), style = Type.small)
    }
}

@Composable
internal fun PlaylistCatalogSheet(
    playlistId: String,
    members: Set<String>,
    onDismiss: () -> Unit,
    onAdd: suspend (List<Track>) -> Unit,
) {
    val api = catalogApi()
    val scope = rememberCoroutineScope()
    val showSuggestions = recommendationsEnabled() && !LocalOfflineLibrary.current
    val canRecommend = showSuggestions && members.isNotEmpty()
    var suggestions by remember(playlistId) { mutableStateOf<List<Track>?>(null) }
    var input by remember { mutableStateOf("") }
    val query = input.trim()
    var page by remember(query) { mutableIntStateOf(1) }
    var attempt by remember(query) { mutableIntStateOf(0) }
    var more by remember(query) { mutableStateOf(false) }
    var searching by remember(query) { mutableStateOf(false) }
    var searchFailed by remember(query) { mutableStateOf(false) }
    var results by remember(query) { mutableStateOf(emptyList<Track>()) }
    var selected by remember(playlistId) { mutableStateOf(emptyMap<String, Track>()) }
    var failed by remember { mutableStateOf(false) }
    var busy by remember { mutableStateOf(false) }

    LaunchedEffect(playlistId, canRecommend) {
        suggestions = if (canRecommend) {
            playlistResult { api.playlistSuggestions(playlistId).tracks.map { it.track } }.getOrDefault(emptyList())
        } else emptyList()
    }
    LaunchedEffect(query, page, attempt) {
        if (query.isEmpty()) return@LaunchedEffect
        searching = true
        searchFailed = false
        if (page == 1 && attempt == 0) delay(300)
        playlistResult { api.searchTracks(query, page, 30) }
            .onSuccess {
                results = (results + it.items).distinctBy(Track::id)
                more = it.items.isNotEmpty() && it.page * it.pageSize < it.total
            }
            .onFailure { searchFailed = true }
        searching = false
    }

    PlaylistActionSheet(stringResource(R.string.playlist_add_tracks), busy, onDismiss) {
        SearchInput(input, { input = it }, stringResource(R.string.playlist_search_tracks), Modifier.padding(horizontal = 8.dp))
        val shown = if (query.isEmpty()) suggestions.orEmpty().filterNot { it.id in members } else results
        LazyColumn(Modifier.weight(1f, fill = false)) {
            if (query.isEmpty() && showSuggestions) {
                item { SheetHeading(stringResource(R.string.playlist_suggestions)) }
                when {
                    suggestions == null -> item { RecordLoading(28.dp) }
                    shown.isEmpty() -> item { Empty(stringResource(R.string.playlist_suggestions_empty)) }
                }
            }
            items(shown, key = Track::id) { track ->
                val existing = track.id in members
                TrackRow(
                    track,
                    onClick = {
                        selected = if (track.id in selected) selected - track.id else selected + (track.id to track)
                    },
                    checked = existing || track.id in selected,
                    selectionEnabled = !existing && !busy,
                    selectionNote = if (existing) stringResource(R.string.playlist_already_in) else null,
                )
            }
            if (query.isNotEmpty()) {
                when {
                    searching -> item { RecordLoading(28.dp) }
                    searchFailed -> item { Failure { attempt++ } }
                    results.isEmpty() -> item { Empty(stringResource(R.string.search_nothing_found)) }
                    more -> item { TextButton(onClick = { page++ }) { Text(stringResource(R.string.playlist_more_tracks)) } }
                }
            }
        }
        if (failed) Text(stringResource(R.string.playlist_save_failed), style = Type.small, modifier = Modifier.padding(horizontal = 12.dp))
        val tracks = selected.values.filterNot { it.id in members }
        Row(Modifier.fillMaxWidth().padding(horizontal = 12.dp), verticalAlignment = Alignment.CenterVertically) {
            SelectionCount(tracks.size, Modifier.weight(1f))
            TextButton(enabled = tracks.isNotEmpty() && !busy, onClick = {
                busy = true
                failed = false
                scope.launch {
                    val result = playlistResult { onAdd(tracks) }
                    busy = false
                    failed = result.isFailure
                    if (result.isSuccess) onDismiss()
                }
            }) { Text(stringResource(R.string.playlist_add_tracks)) }
        }
    }
}
