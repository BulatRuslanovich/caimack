// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Bulat Ruslanovich

package app.caimack.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.repeatOnLifecycle
import app.caimack.R
import app.caimack.api.HandoffRequest
import app.caimack.api.PlayingElsewhere
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

private const val REFRESH_MS = 30_000L

@Composable
fun HandoffBar(playing: Boolean) {
    val palette = LocalPalette.current
    val container = LocalContainer.current
    val lifecycle = LocalLifecycleOwner.current.lifecycle
    val scope = rememberCoroutineScope()
    var elsewhere by remember { mutableStateOf<PlayingElsewhere?>(null) }
    var dismissed by rememberSaveable { mutableStateOf<String?>(null) }
    var taking by remember { mutableStateOf(false) }

    LaunchedEffect(playing) {
        if (playing) {
            elsewhere = null
            return@LaunchedEffect
        }
        lifecycle.repeatOnLifecycle(Lifecycle.State.RESUMED) {
            while (true) {
                elsewhere = runCatching { container.api.playingElsewhere(container.deviceId).body() }.getOrNull()
                delay(REFRESH_MS)
            }
        }
    }

    val shown = elsewhere ?: return
    val key = "${shown.deviceId}@${shown.reportedAt}"
    if (playing || dismissed == key) return

    val track = shown.track
    val label = if (shown.isPlaying) {
        stringResource(R.string.handoff_playing_on, shown.deviceName)
    } else {
        stringResource(R.string.handoff_paused_on, shown.deviceName, durationOf(shown.positionSeconds.toInt()))
    }

    Column(Modifier.padding(horizontal = 8.dp, vertical = 3.dp).musicSurface(palette)) {
        Row(
            Modifier.fillMaxWidth().padding(start = 12.dp, end = 4.dp, top = 8.dp, bottom = 8.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            Cover(trackCover(track), track.albumTitle ?: track.title, Modifier.size(40.dp))
            Column(Modifier.weight(1f)) {
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                    Icon(Lucide.MonitorSpeaker, null, tint = palette.faint, modifier = Modifier.size(13.dp))
                    Text(label, style = Type.tiny, color = palette.faint, maxLines = 1, overflow = TextOverflow.Ellipsis)
                }
                Text(
                    "${track.title} — ${artistsOf(track)}",
                    style = Type.small.copy(fontWeight = FontWeight.Medium),
                    color = palette.foreground,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
            }
            Text(
                stringResource(R.string.handoff_continue_here),
                style = Type.tiny.copy(fontWeight = FontWeight.SemiBold),
                color = palette.foreground,
                modifier = Modifier
                    .clip(CircleShape)
                    .background(palette.accent)
                    .clickable(enabled = !taking) {
                        taking = true
                        scope.launch {
                            runCatching { container.api.handoff(HandoffRequest(container.deviceId)) }
                                .onSuccess { container.player.takeOver(it) }
                            taking = false
                        }
                    }
                    .padding(horizontal = 12.dp, vertical = 14.dp),
            )
            Icon(
                Lucide.X,
                stringResource(R.string.handoff_dismiss),
                tint = palette.muted,
                modifier = Modifier.clip(CircleShape).clickable { dismissed = key }.padding(16.dp).size(16.dp),
            )
        }
    }
}
