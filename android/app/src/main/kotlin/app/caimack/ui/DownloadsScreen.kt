// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

package app.caimack.ui

import android.text.format.Formatter
import androidx.annotation.OptIn
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.media3.common.util.UnstableApi
import app.caimack.R
import app.caimack.api.Track

@OptIn(UnstableApi::class)
@Composable
fun DownloadsScreen(play: (List<Track>, Int) -> Unit) {
    val palette = LocalPalette.current
    val container = LocalContainer.current
    val context = LocalContext.current
    val offline by container.downloads.state.collectAsStateWithLifecycle()
    val synchronized by container.syncStore.status.collectAsStateWithLifecycle()
    val library = if(synchronized.enabled) container.syncStore.tracks() else emptyList()
    val entries = offline.values.filter { it.track != null }.sortedBy { it.track!!.title.lowercase() }
    val ready = entries.filter { it.done }.map { it.track!! }
    val pending = entries.count { !it.done }

    LazyColumn(Modifier.fillMaxSize(), contentPadding = playerContentPadding(bottom = 24.dp)) {
        item { PageTitle(stringResource(R.string.downloads_title)) }
        if(library.isNotEmpty()) {
            item { Text(stringResource(R.string.sync_progress,synchronized.completed,synchronized.total),Modifier.padding(16.dp),style=Type.small) }
            item { PlayActions(Modifier.padding(horizontal=16.dp,vertical=8.dp),onPlay={play(library,0)},onShuffle={play(library.shuffled(),0)}) }
            itemsIndexed(library,key={_,track -> "sync-${track.id}"}) { index,track -> TrackRow(track,{play(library,index)}) }
        }

        if (entries.isEmpty() && library.isEmpty()) {
            item { Empty(stringResource(R.string.downloads_empty_title), stringResource(R.string.downloads_empty_hint)) }
            return@LazyColumn
        }
        if(entries.isEmpty()) return@LazyColumn

        item {
            Row(Modifier.fillMaxWidth().padding(start = 16.dp, end = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                Row(Modifier.weight(1f), horizontalArrangement = Arrangement.spacedBy(20.dp)) {
                    Text(pluralStringResource(R.plurals.count_tracks, ready.size, ready.size), style = Type.small, color = palette.muted)
                    Text(
                        stringResource(R.string.downloads_size, Formatter.formatShortFileSize(context, entries.sumOf { it.download.bytesDownloaded })),
                        style = Type.small,
                        color = palette.muted,
                    )
                    if (pending > 0) Text(pluralStringResource(R.plurals.downloads_pending, pending, pending), style = Type.small, color = palette.muted)
                }
                TextButton(onClick = { container.downloads.remove(offline.keys) }) {
                    Text(stringResource(R.string.downloads_remove_all), color = palette.muted)
                }
            }
        }

        if (ready.isNotEmpty()) {
            item {
                PlayActions(Modifier.padding(horizontal = 16.dp, vertical = 8.dp), onPlay = { play(ready, 0) }, onShuffle = { play(ready.shuffled(), 0) })
            }
        }

        itemsIndexed(entries, key = { _, entry -> entry.download.request.id }) { _, entry ->
            val track = entry.track!!
            Row(verticalAlignment = Alignment.CenterVertically) {
                Box(Modifier.weight(1f)) {
                    TrackRow(track, { if (entry.done) play(ready, ready.indexOf(track)) })
                }
                Box(
                    Modifier.padding(end = 8.dp).size(48.dp).clip(Radius.row).clickable { container.downloads.remove(listOf(track.id)) },
                    contentAlignment = Alignment.Center,
                ) {
                    if (entry.done) {
                        Icon(Lucide.X, stringResource(R.string.downloads_remove), tint = palette.faint, modifier = Modifier.size(18.dp))
                    } else {
                        CircularProgressIndicator(
                            progress = { entry.percent / 100f },
                            modifier = Modifier.size(18.dp),
                            color = palette.primary,
                            trackColor = palette.raised,
                            strokeWidth = 2.dp,
                        )
                    }
                }
            }
        }
    }
}
