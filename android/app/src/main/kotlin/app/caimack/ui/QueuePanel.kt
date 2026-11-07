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
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
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

private sealed interface QueueLine {
    val key: Any

    data class Section(val label: String) : QueueLine {
        override val key: Any get() = "section:$label"
    }

    data class Entry(val index: Int, val track: Track) : QueueLine {
        override val key: Any get() = index
    }
}

@Composable
fun QueuePanel(state: PlayerState, onUndoable: (String, QueueSnapshot) -> Unit) {
    val palette = LocalPalette.current
    val container = LocalContainer.current
    val player = container.player
    val radio by container.radio.state.collectAsState()
    val autoplay by container.radio.autoplay.collectAsState()
    if (state.queue.isEmpty()) return Empty(stringResource(R.string.queue_empty))

    var showHistory by rememberSaveable { mutableStateOf(false) }
    var order by remember(state.queue) { mutableStateOf(state.queue.indices.toList()) }
    var dragged by remember { mutableStateOf<Int?>(null) }
    var dragOffset by remember { mutableFloatStateOf(0f) }

    val current = order.indexOf(state.index).coerceAtLeast(0)
    val firstShown = if (showHistory) 0 else current
    val seedTitle = state.queue.firstOrNull { it.id == radio.seedTrackId }?.title
    val radioLabel = seedTitle?.let { stringResource(R.string.queue_radio_from, it) }
        ?: stringResource(R.string.queue_similar)
    val upNextLabel = stringResource(R.string.queue_up_next)

    val lines = buildList {
        var radioStarted = false
        for (position in firstShown until order.size) {
            val index = order[position]
            val track = state.queue[index]
            val fromRadio = position > current && track.id in radio.notes
            when {
                fromRadio && !radioStarted -> add(QueueLine.Section(radioLabel))
                position == current + 1 -> add(QueueLine.Section(upNextLabel))
            }
            if (fromRadio) radioStarted = true
            add(QueueLine.Entry(index, track))
        }
    }

    val historyRows = if (current > 0) 1 else 0
    val list = rememberLazyListState(
        initialFirstVisibleItemIndex = historyRows + lines.indexOfFirst { it is QueueLine.Entry && it.index == state.index }.coerceAtLeast(0),
    )
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
            Modifier.fillMaxWidth().clip(Radius.row).clickable { container.radio.setAutoplay(!autoplay) }.padding(vertical = 6.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(stringResource(R.string.queue_autoplay), style = Type.small, color = palette.muted, modifier = Modifier.weight(1f))
            Toggle(autoplay) { container.radio.setAutoplay(it) }
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
                        val isDragged = dragged == line.index
                        val isCurrent = line.index == state.index
                        val next = order.getOrNull(current + 1) == line.index
                        QueueRow(
                            track = line.track,
                            current = isCurrent,
                            playing = isCurrent && state.playing,
                            note = if (isCurrent || next) radio.notes[line.track.id] else null,
                            modifier = (if (isDragged) Modifier.zIndex(1f).graphicsLayer { translationY = dragOffset } else Modifier.animateItem()),
                            lifted = isDragged,
                            onPlay = { player.skipTo(line.index) },
                            onRemove = {
                                val snapshot = player.snapshot()
                                player.remove(line.index)
                                onUndoable(resources.getString(R.string.queue_removed, line.track.title), snapshot)
                            },
                            handle = Modifier.pointerInput(line.index) {
                                detectDragGestures(
                                    onDragStart = {
                                        dragged = line.index
                                        dragOffset = 0f
                                    },
                                    onDragEnd = {
                                        val from = dragged
                                        dragged = null
                                        dragOffset = 0f
                                        if (from != null) player.move(from, order.indexOf(from))
                                    },
                                    onDragCancel = {
                                        dragged = null
                                        dragOffset = 0f
                                        order = state.queue.indices.toList()
                                    },
                                ) { change, amount ->
                                    change.consume()
                                    dragOffset += amount.y
                                    val swap = swapTarget(list, line.index, dragOffset) ?: return@detectDragGestures
                                    val (target, shift) = swap
                                    order = order.toMutableList().apply { add(indexOf(target), removeAt(indexOf(line.index))) }
                                    dragOffset -= shift
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
