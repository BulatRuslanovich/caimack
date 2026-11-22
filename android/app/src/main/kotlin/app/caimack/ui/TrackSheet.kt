// SPDX-License-Identifier: AGPL-3.0-only

package app.caimack.ui

import android.net.Uri
import android.widget.Toast
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import app.caimack.session.SessionState
import androidx.compose.foundation.gestures.Orientation
import androidx.compose.foundation.gestures.rememberScrollableState
import androidx.compose.foundation.gestures.scrollable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.BottomSheetDefaults
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.input.nestedscroll.NestedScrollConnection
import androidx.compose.ui.input.nestedscroll.nestedScroll
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalResources
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Velocity
import androidx.compose.ui.unit.dp
import app.caimack.R
import app.caimack.api.AddTracksRequest
import app.caimack.api.Playlist
import app.caimack.api.RadioRequest
import app.caimack.api.TasteRuleRequest
import app.caimack.api.Track
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlin.math.roundToInt

val LocalNavigate = staticCompositionLocalOf<(Any) -> Unit> { {} }

private val trackSheetScrollConnection = object : NestedScrollConnection {
    // Material3 starts a spring even at the expanded anchor when it receives leftover velocity.
    // The sheet can still use pre-fling to expand from a partially dragged position.
    override suspend fun onPostFling(consumed: Velocity, available: Velocity): Velocity =
        Velocity(0f, available.y.coerceAtMost(0f))
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun TrackSheet(track: Track, onRemoveFromPlaylist: (() -> Unit)? = null, positionMs: Long = 0, onDismiss: () -> Unit) {
    val palette = LocalPalette.current
    val container = LocalContainer.current
    val navigate = LocalNavigate.current
    val context = LocalContext.current
    val resources = LocalResources.current
    var choosingPlaylist by remember { mutableStateOf(false) }
    var creating by remember { mutableStateOf(false) }
    var showingInfo by androidx.compose.runtime.saveable.rememberSaveable(track.id) { mutableStateOf(false) }
    var sharing by remember { mutableStateOf(false) }
    container.favorites.state.collectAsState().value
    val liked = container.favorites.isFavorite(track)

    val say = { message: String -> Toast.makeText(context, message, Toast.LENGTH_SHORT).show() }
    val neverSuggest = { targetType: String, targetId: String ->
        onDismiss()
        container.scope.launch {
            val rule = runCatching { container.api.addTasteRule(TasteRuleRequest("block", targetType, targetId)) }.getOrNull()
            withContext(Dispatchers.Main) {
                say(when {
                    rule == null -> resources.getString(R.string.rules_failed)
                    rule.name.isBlank() -> resources.getString(R.string.rules_saved_for_sync)
                    else -> resources.getString(R.string.rules_blocked, rule.name)
                })
            }
        }
    }

    if (showingInfo) {
        TrackInfoSheet(track) { showingInfo = false; onDismiss() }
        return
    }

    if (sharing) {
        ShareSheet(track, positionMs) {
            sharing = false
            onDismiss()
        }
        return
    }

    ModalBottomSheet(
        onDismissRequest = onDismiss,
        sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true),
        containerColor = palette.card,
        dragHandle = {
            // Route drags on the handle through the same nested scroll path as the list.
            BottomSheetDefaults.DragHandle(
                Modifier.nestedScroll(trackSheetScrollConnection)
                    .scrollable(rememberScrollableState { 0f }, Orientation.Vertical),
            )
        },
    ) {
        Column(
            Modifier.navigationBarsPadding()
                .nestedScroll(trackSheetScrollConnection)
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 12.dp, vertical = 8.dp),
        ) {
            Row(
                Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 8.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                Cover(trackCover(track), track.albumTitle ?: track.title, Modifier.size(44.dp))
                Column(Modifier.weight(1f)) {
                    Text(track.title, style = Type.small.copy(fontWeight = FontWeight.Medium), maxLines = 1, overflow = TextOverflow.Ellipsis)
                    Text(artistsOf(track), style = Type.small, color = palette.muted, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    soundOf(track)?.let { Text(it, style = Type.small, color = palette.muted, maxLines = 1) }
                }
            }
            HorizontalDivider(Modifier.padding(vertical = 8.dp), color = palette.border)

            if (choosingPlaylist) {
                val me = currentUserId()
                val playlists by produceState<List<Playlist>?>(null) {
                    value = runCatching { container.api.playlists() }.getOrDefault(emptyList()).filter { me == null || it.ownerId == null || it.ownerId == me }
                }
                if (creating) {
                    PlaylistDialog(
                        title = stringResource(R.string.playlist_new),
                        onDismiss = { creating = false },
                    ) { changes ->
                        val created = container.api.createPlaylist(changes)
                        container.api.addToPlaylist(created.id, AddTracksRequest(listOf(track.id)))
                        withContext(Dispatchers.Main) {
                            say(resources.getString(R.string.menu_added_to_playlist, created.name))
                            onDismiss()
                        }
                    }
                }
                SheetRow(stringResource(R.string.playlist_new), Lucide.Plus) { creating = true }
                when {
                    playlists == null -> RecordLoading(28.dp)
                    playlists!!.isEmpty() -> Unit
                    else -> playlists!!.forEach { playlist ->
                        SheetRow(playlist.name, Lucide.ListMusic) {
                            onDismiss()
                            container.scope.launch {
                                val added = runCatching { container.api.addToPlaylist(playlist.id, AddTracksRequest(listOf(track.id))) }.isSuccess
                                withContext(Dispatchers.Main) {
                                    say(
                                        if (added) resources.getString(R.string.menu_added_to_playlist, playlist.name)
                                        else resources.getString(R.string.error_load),
                                    )
                                }
                            }
                        }
                    }
                }
                return@Column
            }

            SheetRow(stringResource(R.string.menu_play_next), Lucide.CornerDownRight) {
                container.player.enqueue(track, next = true)
                say(resources.getString(R.string.menu_playing_next, track.title))
                onDismiss()
            }
            SheetRow(stringResource(R.string.menu_add_to_queue), Lucide.ListVideo) {
                container.player.enqueue(track, next = false)
                say(resources.getString(R.string.menu_added_to_queue, track.title))
                onDismiss()
            }
            TrackDownloadAction(track, onDismiss)
            if (recommendationsEnabled()) SheetRow(stringResource(R.string.menu_radio), Lucide.Radio) {
                onDismiss()
                container.scope.launch {
                    val radio = runCatching { container.radio(RadioRequest(track.id, emptyList())) }.getOrNull()
                    withContext(Dispatchers.Main) {
                        if (radio == null) say(resources.getString(R.string.radio_failed))
                        else container.player.startRadio(track, radio)
                    }
                }
            }

            HorizontalDivider(Modifier.padding(vertical = 8.dp), color = palette.border)

            SheetRow(
                stringResource(if (liked) R.string.menu_unlike else R.string.menu_like),
                if (liked) Lucide.HeartFilled else Lucide.Heart,
            ) {
                container.favorites.toggle(track)
                onDismiss()
            }
            if (recommendationsEnabled()) SheetRow(stringResource(R.string.rules_block_track), Lucide.EyeOff) {
                neverSuggest("track", track.id)
            }
            if (recommendationsEnabled()) SheetRow(stringResource(R.string.rules_block_artist, track.artistName), Lucide.EyeOff) {
                neverSuggest("artist", track.artistId)
            }
            SheetRow(stringResource(R.string.menu_add_to_playlist), Lucide.Plus) { choosingPlaylist = true }
            val session by container.session.state.collectAsState()
            if (!LocalOfflineLibrary.current && (session as? SessionState.SignedIn)?.user?.isAdmin == true) {
                TrackCoverActions(track, onDismiss)
            }
            SheetRow(stringResource(R.string.track_info_title), Lucide.Info) { showingInfo = true }
            SheetRow(stringResource(R.string.share_card), Lucide.Share2) { sharing = true }
            onRemoveFromPlaylist?.let { remove ->
                SheetRow(stringResource(R.string.playlist_remove_track), Lucide.Trash2) {
                    onDismiss()
                    remove()
                }
            }

            HorizontalDivider(Modifier.padding(vertical = 8.dp), color = palette.border)

            track.albumId?.let { albumId ->
                SheetRow(stringResource(R.string.menu_go_to_album), Lucide.Disc3) {
                    onDismiss()
                    navigate(AlbumRoute(albumId))
                }
            }
            SheetRow(stringResource(R.string.menu_go_to_artist), Lucide.UsersRound) {
                onDismiss()
                navigate(ArtistRoute(track.artistId))
            }
        }
    }
}

@Composable
private fun soundOf(track: Track): String? {
    val parts = listOfNotNull(
        track.cues?.bpm?.let { stringResource(R.string.track_bpm, it.roundToInt()) },
        track.key?.let { "${it.name} (${it.camelot})" },
        track.loudness?.let { stringResource(R.string.track_lufs, it.lufs.roundToInt()) },
    )
    return parts.takeIf { it.isNotEmpty() }?.joinToString(" · ")
}

@Composable
private fun TrackCoverActions(track: Track, onDismiss: () -> Unit) {
    val container = LocalContainer.current
    val context = LocalContext.current
    val resources = LocalResources.current

    fun save(uri: Uri?) {
        onDismiss()
        container.scope.launch {
            val saved = runCatching {
                if (uri == null) container.api.removeTrackCover(track.id)
                else container.api.uploadTrackCover(track.id, requireNotNull(coverPart(context, uri)))
            }.isSuccess
            withContext(Dispatchers.Main) {
                if (saved) {
                    container.media.markChanged("api/tracks/${track.id}/cover")
                    Remote.trackArtworkChanged()
                }
                Toast.makeText(context, resources.getString(if (saved) R.string.track_cover_saved else R.string.track_cover_failed), Toast.LENGTH_SHORT).show()
            }
        }
    }

    val picker = rememberLauncherForActivityResult(ActivityResultContracts.PickVisualMedia()) { uri ->
        if (uri != null) save(uri)
    }
    SheetRow(stringResource(if (track.hasCover) R.string.playlist_change_cover else R.string.playlist_add_cover), Lucide.Image) {
        picker.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly))
    }
    if (track.coverRevision != null) {
        SheetRow(stringResource(R.string.playlist_remove_cover), Lucide.Trash2) { save(null) }
    }
}
