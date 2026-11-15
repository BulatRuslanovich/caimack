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
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyListState
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.Icon
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

    data class Entry(val entry: QueueEntry) : QueueLine {
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
            add(QueueLine.Entry(entry))
        }
    }

    val resources = LocalResources.current

    Column(Modifier.fillMaxSize()) {
        Row(Modifier.fillMaxWidth().padding(top = 8.dp), verticalAlignment = Alignment.CenterVertically) {
            Text(
                pluralStringResource(R.plurals.count_tracks, state.queue.size, state.queue.size),
                style = Type.small,
                color = palette.muted,
                modifier = Modifier.weight(1f),
            )
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

        LazyColumn(Modifier.fillMaxSize().fadeEdges(), state = list) {
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
                            note = if (isCurrent || next) radio.notes[track.id] else null,
                            modifier = (if (isDragged || drag.landed == key) Modifier.zIndex(if (isDragged) 1f else 0f).graphicsLayer { translationY = drag.translation(key) } else Modifier.animateItem()),
                            lifted = isDragged,
                            onPlay = { player.skipTo(order.sourceIndex(key)) },
                            onRemove = {
                                val snapshot = player.snapshot()
                                player.remove(order.sourceIndex(key))
                                onUndoable(resources.getString(R.string.queue_removed, track.title), snapshot)
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
private fun QueueRow(
    track: Track,
    current: Boolean,
    playing: Boolean,
    note: RadioNote?,
    lifted: Boolean,
    onPlay: () -> Unit,
    onRemove: () -> Unit,
    handle: Modifier,
    modifier: Modifier = Modifier,
) {
    val palette = LocalPalette.current
    Row(
        modifier
            .fillMaxWidth()
            .then(if (lifted) Modifier.shadow(12.dp, Radius.row) else Modifier)
            .clip(Radius.row)
            .background(if (lifted) palette.raised else Color.Transparent)
            .clickable(onClick = onPlay),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(
            Lucide.GripVertical,
            stringResource(R.string.queue_reorder, track.title),
            tint = palette.faint,
            modifier = handle.padding(start = 2.dp, end = 6.dp, top = 14.dp, bottom = 14.dp).size(16.dp),
        )
        Box(Modifier.size(40.dp), contentAlignment = Alignment.Center) {
            Cover(trackCover(track), track.albumTitle ?: track.title, Modifier.fillMaxSize())
            if (playing) {
                Box(Modifier.fillMaxSize().clip(Radius.cover).background(Color.Black.copy(alpha = 0.55f)), contentAlignment = Alignment.Center) {
                    NowPlayingBars(Color.White)
                }
            }
        }
        Column(Modifier.weight(1f).padding(horizontal = 12.dp, vertical = 6.dp)) {
            Text(
                track.title,
                style = Type.small.copy(fontWeight = FontWeight.Medium),
                color = if (current) palette.primary else palette.foreground,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            Text(artistsOf(track), style = Type.tiny, color = palette.muted, maxLines = 1, overflow = TextOverflow.Ellipsis)
            note?.let { RadioNoteLine(it) }
        }
        Icon(
            Lucide.Trash2,
            stringResource(R.string.queue_remove, track.title),
            tint = palette.faint,
            modifier = Modifier.clip(CircleShape).clickable(onClick = onRemove).padding(15.dp).size(18.dp),
        )
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
