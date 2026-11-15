// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

package app.caimack.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectDragGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyListState
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.Icon
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.TextButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalResources
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.zIndex
import app.caimack.R
import app.caimack.api.Track
import app.caimack.playback.PlayerState
import app.caimack.playback.QueueSnapshot
import app.caimack.playback.RadioNote
import kotlinx.coroutines.delay

private sealed interface QueueLine {
    val key: Any

    data class Section(val label: String) : QueueLine {
        override val key: Any get() = "section:$label"
    }

    data class Entry(val entry: QueueEntry, val position: Int) : QueueLine {
        override val key: Any get() = entry.key
    }
}

@Composable
fun QueuePanel(state: PlayerState, onUndoable: (String, QueueSnapshot) -> Unit) {
    val palette = LocalPalette.current
    val container = LocalContainer.current
    val player = container.player
    val radio = displayedRadio()
    val connect by container.connect.state.collectAsState()
    val localAutoplay by container.radio.autoplay.collectAsState()
    val autoplay = if (connect.selectedId != null) connect.playback?.autoplay ?: localAutoplay else localAutoplay
    val setAutoplay: (Boolean) -> Unit = { enabled ->
        if (!container.connect.route(app.caimack.api.ConnectCommand.SetAutoplay(enabled))) container.radio.setAutoplay(enabled)
    }
    if (state.queue.isEmpty()) return Empty(stringResource(R.string.queue_empty))

    var showHistory by rememberSaveable { mutableStateOf(false) }
    var editing by rememberSaveable { mutableStateOf(false) }
    val order = remember { QueueOrderState(state.queue) }
    order.sync(state.queue)
    val list = rememberLazyListState(
        initialFirstVisibleItemIndex = when {
            state.index <= 0 -> 0
            showHistory -> state.index + 1
            else -> 1
        },
    )
    val drag = rememberQueueDragState(list, order::move)
    LaunchedEffect(order.revision) { drag.finish() }
    LaunchedEffect(order.pending) {
        if (order.pending != null) {
            delay(12_500)
            order.cancel()
        }
    }
    val dragged = drag.dragged

    val entries = order.entries
    val current = entries.indexOfFirst { order.sourceIndex(it.key) == state.index }.coerceAtLeast(0)
    // Do not dispose the active handle when it crosses the current track.
    val held = dragged ?: drag.landed
    val firstShown = if (showHistory) 0 else minOf(current, entries.indexOfFirst { it.key == held }.takeIf { it >= 0 } ?: current)
    val seedTitle = state.queue.firstOrNull { it.id == radio.seedTrackId }?.title
    val radioLabel = seedTitle?.let { stringResource(R.string.queue_radio_from, it) }
        ?: stringResource(R.string.queue_similar)
    val upNextLabel = stringResource(R.string.queue_up_next)

    val lines = buildList {
        var radioStarted = false
        for (position in firstShown until entries.size) {
            val entry = entries[position]
            val track = entry.track
            val fromRadio = position > current && track.id in radio.notes
            when {
                fromRadio && !radioStarted -> add(QueueLine.Section(radioLabel))
                position == current + 1 -> add(QueueLine.Section(upNextLabel))
            }
            if (fromRadio) radioStarted = true
            add(QueueLine.Entry(entry, position))
        }
    }

    val resources = LocalResources.current
    fun moveEntry(key: Int, target: Int) {
        order.move(key, target)
        order.commit(key)?.let { (source, destination) -> player.move(source, destination) }
    }

    Column(Modifier.fillMaxSize()) {
        Row(Modifier.fillMaxWidth().padding(top = 8.dp), verticalAlignment = Alignment.CenterVertically) {
            Text(
                pluralStringResource(R.plurals.count_tracks, state.queue.size, state.queue.size),
                style = Type.small,
                color = palette.muted,
                modifier = Modifier.weight(1f),
            )
            TextButton(onClick = { editing = !editing }) {
                Text(stringResource(if (editing) R.string.action_done else R.string.queue_edit), style = Type.small)
            }
            if (state.index < state.queue.size - 1) {
                Text(
                    stringResource(R.string.queue_clear),
                    style = Type.small.copy(fontWeight = FontWeight.Medium),
                    color = palette.muted,
                    modifier = Modifier.clip(CircleShape).clickable {
                        val snapshot = player.snapshot()
                        player.clearUpcoming()
                        onUndoable(resources.getString(R.string.queue_cleared), snapshot)
                    }.padding(horizontal = 12.dp, vertical = 10.dp),
                )
            }
        }
        if (recommendationsEnabled()) Row(
            Modifier.fillMaxWidth().clip(Radius.row).clickable { setAutoplay(!autoplay) }.padding(vertical = 6.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(stringResource(R.string.queue_autoplay), style = Type.small, color = palette.muted, modifier = Modifier.weight(1f))
            Toggle(autoplay) { setAutoplay(it) }
        }

        // Native scrolling already shows the list boundary. A mask obscures the
        // current track and is unnecessary for a queue, including short lists.
        LazyColumn(Modifier.fillMaxSize(), state = list) {
            if (current > 0) {
                item(key = "history") {
                    Row(
                        Modifier.fillMaxWidth().clip(Radius.row).clickable { showHistory = !showHistory }.padding(vertical = 10.dp),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(6.dp),
                    ) {
                        Icon(Lucide.ChevronRight, null, tint = palette.muted, modifier = Modifier.size(14.dp).rotate(if (showHistory) 90f else 0f))
                        Text(stringResource(R.string.queue_history, current), style = Type.tiny, color = palette.muted)
                    }
                }
            }

            items(lines, key = { it.key }) { line ->
                when (line) {
                    is QueueLine.Section -> Text(
                        line.label,
                        style = Type.tiny,
                        color = palette.muted,
                        modifier = Modifier.padding(top = 12.dp, bottom = 4.dp).animateItem(),
                    )
                    is QueueLine.Entry -> {
                        val key = line.entry.key
                        val track = line.entry.track
                        val isDragged = dragged == key
                        val isCurrent = order.sourceIndex(key) == state.index
                        val next = entries.getOrNull(current + 1)?.key == key
                        QueueRow(
                            track = track,
                            current = isCurrent,
                            playing = isCurrent && state.playing,
                            editing = editing,
                            enabled = order.pending == null,
                            note = if (isCurrent || next) radio.notes[track.id] else null,
                            modifier = (if (isDragged || drag.landed == key) Modifier.zIndex(if (isDragged) 1f else 0f).graphicsLayer { translationY = drag.translation(key) } else Modifier.animateItem()),
                            lifted = isDragged,
                            onPlay = { player.skipTo(order.sourceIndex(key)) },
                            onRemove = {
                                val snapshot = player.snapshot()
                                player.remove(order.sourceIndex(key))
                                onUndoable(resources.getString(R.string.queue_removed, track.title), snapshot)
                            },
                            onMoveUp = entries.getOrNull(line.position - 1)?.let { target ->
                                { moveEntry(key, target.key) }
                            },
                            onMoveDown = entries.getOrNull(line.position + 1)?.let { target ->
                                { moveEntry(key, target.key) }
                            },
                            handle = Modifier.pointerInput(key, order.pending) {
                                if (order.pending != null) return@pointerInput
                                detectDragGestures(
                                    onDragStart = {
                                        drag.start(key)
                                    },
                                    onDragEnd = {
                                        val from = drag.finish()
                                        if (from != null) order.commit(from)?.let { (source, target) -> player.move(source, target) }
                                    },
                                    onDragCancel = {
                                        drag.cancel()
                                        order.cancel()
                                    },
                                ) { change, amount ->
                                    change.consume()
                                    drag.dragBy(amount.y)
                                }
                            },
                        )
                    }
                }
            }
        }
    }
}

internal fun swapTarget(list: LazyListState, dragged: Int, offset: Float): Pair<Int, Int>? {
    val rows = list.layoutInfo.visibleItemsInfo
    val source = rows.firstOrNull { it.key == dragged } ?: return null
    val center = source.offset + offset + source.size / 2f
    val target = rows.firstOrNull { it.key is Int && it.key != dragged && center.toInt() in it.offset until it.offset + it.size } ?: return null
    val shift = if (target.offset > source.offset) target.offset + target.size - source.offset - source.size else target.offset - source.offset
    return target.key as Int to shift
}

@Composable
internal fun QueueRow(
    track: Track,
    current: Boolean,
    playing: Boolean,
    editing: Boolean,
    enabled: Boolean,
    note: RadioNote?,
    lifted: Boolean,
    onPlay: () -> Unit,
    onRemove: () -> Unit,
    onMoveUp: (() -> Unit)?,
    onMoveDown: (() -> Unit)?,
    handle: Modifier,
    modifier: Modifier = Modifier,
) {
    val palette = LocalPalette.current
    var menu by remember { mutableStateOf(false) }
    val playbackLabel = stringResource(if (playing) R.string.queue_current_playing else R.string.queue_current_paused)
    Row(
        modifier
            .fillMaxWidth()
            .heightIn(min = 64.dp)
            .then(if (lifted) Modifier.shadow(12.dp, Radius.row) else Modifier)
            .clip(Radius.row)
            .background(when { lifted -> palette.raised; current -> palette.primarySoft; else -> Color.Transparent })
            .semantics {
                selected = current
                if (current) stateDescription = playbackLabel
            }
            .clickable(onClick = onPlay),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(Modifier.width(3.dp).heightIn(min = 40.dp).background(if (current) palette.primary else Color.Transparent))
        if (editing) Box(
            (if (enabled) handle else Modifier).size(48.dp),
            contentAlignment = Alignment.Center,
        ) {
            Icon(Lucide.GripVertical, stringResource(R.string.queue_reorder, track.title), tint = palette.faint, modifier = Modifier.size(20.dp))
        }
        Box(Modifier.size(40.dp), contentAlignment = Alignment.Center) {
            Cover(trackCover(track), track.albumTitle ?: track.title, Modifier.fillMaxSize())
            if (current) {
                Box(Modifier.fillMaxSize().clip(Radius.cover).background(Color.Black.copy(alpha = 0.55f)), contentAlignment = Alignment.Center) {
                    if (playing) NowPlayingBars(Color.White)
                    else Icon(Lucide.Pause, null, tint = Color.White, modifier = Modifier.size(18.dp))
                }
            }
        }
        Column(Modifier.weight(1f).padding(horizontal = 12.dp, vertical = 6.dp)) {
            Text(
                track.title,
                style = Type.body.copy(fontWeight = FontWeight.Medium),
                color = if (current) palette.primary else palette.foreground,
                maxLines = 2,
                overflow = TextOverflow.Ellipsis,
            )
            Text(artistsOf(track), style = Type.tiny, color = palette.muted, maxLines = 1, overflow = TextOverflow.Ellipsis)
            note?.let { RadioNoteLine(it) }
        }
        if (editing) {
            TextButton(onClick = onRemove, enabled = enabled, contentPadding = androidx.compose.foundation.layout.PaddingValues(0.dp), modifier = Modifier.size(48.dp)) {
                Icon(Lucide.Trash2, stringResource(R.string.queue_remove, track.title), tint = palette.muted, modifier = Modifier.size(20.dp))
            }
        } else Box {
            IconAction(Lucide.EllipsisVertical, stringResource(R.string.queue_more, track.title), tint = palette.muted) { menu = true }
            DropdownMenu(expanded = menu, onDismissRequest = { menu = false }) {
                DropdownMenuItem(
                    text = { Text(stringResource(R.string.queue_move_up)) },
                    enabled = enabled && onMoveUp != null,
                    onClick = { menu = false; onMoveUp?.invoke() },
                )
                DropdownMenuItem(
                    text = { Text(stringResource(R.string.queue_move_down)) },
                    enabled = enabled && onMoveDown != null,
                    onClick = { menu = false; onMoveDown?.invoke() },
                )
                DropdownMenuItem(
                    text = { Text(stringResource(R.string.queue_remove, track.title)) },
                    enabled = enabled,
                    onClick = { menu = false; onRemove() },
                )
            }
        }
    }
}

@Composable
fun RadioNoteLine(note: RadioNote, modifier: Modifier = Modifier) {
    val palette = LocalPalette.current
    val label = reasonLabel(note.reason) ?: return
    Row(modifier, verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
        if (note.explore) {
            Text(
                stringResource(R.string.queue_explore),
                style = Type.micro.copy(fontWeight = FontWeight.Medium),
                color = palette.primary,
                modifier = Modifier.clip(CircleShape).background(palette.raised).padding(horizontal = 6.dp, vertical = 1.dp),
            )
        }
        Text(label, style = Type.micro, color = palette.faint, maxLines = 1, overflow = TextOverflow.Ellipsis)
    }
}
