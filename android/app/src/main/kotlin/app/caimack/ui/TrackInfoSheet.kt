// SPDX-License-Identifier: AGPL-3.0-only
package app.caimack.ui

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalResources
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import app.caimack.R
import app.caimack.api.Track
import app.caimack.api.TrackLookup
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.time.format.FormatStyle

@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun TrackInfoSheet(track: Track, onDismiss: () -> Unit) {
    val container = LocalContainer.current
    val details by produceState(track, track.id) {
        value = runCatching { container.api.lookupTracks(TrackLookup(listOf(track.id))).firstOrNull() }.getOrNull() ?: track
    }
    ModalBottomSheet(onDismissRequest = onDismiss,
        sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true),
        containerColor = LocalPalette.current.card) {
        TrackInfoContent(details)
    }
}

@Composable
internal fun TrackInfoContent(track: Track) {
    val palette = LocalPalette.current
    val locale = LocalResources.current.configuration.locales[0]
    val added = track.createdAt?.let { timestamp ->
        runCatching { DateTimeFormatter.ofLocalizedDateTime(FormatStyle.MEDIUM).withLocale(locale)
            .withZone(ZoneId.systemDefault()).format(Instant.parse(timestamp)) }.getOrDefault(timestamp)
    }
    Column(Modifier.fillMaxWidth().navigationBarsPadding().verticalScroll(rememberScrollState())
        .padding(horizontal = 20.dp, vertical = 12.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
        Text(stringResource(R.string.track_info_title), style = Type.section, modifier = Modifier.semantics { heading() })
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(16.dp)) {
            Cover(trackCover(track), track.title, Modifier.size(80.dp))
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                Text(track.title, style = Type.section)
                Text(artistsOf(track), style = Type.small, color = palette.muted)
                Text(durationOf(track.durationSeconds), style = Type.small, color = palette.muted)
            }
        }
        InfoSection(stringResource(R.string.track_info_release), listOf(
            stringResource(R.string.track_info_album) to track.albumTitle,
            stringResource(R.string.track_info_genre) to track.genreName,
            stringResource(R.string.track_info_year) to track.year?.toString(),
            stringResource(R.string.track_info_number) to track.trackNumber?.toString(),
            stringResource(R.string.track_info_disc) to track.discNumber?.toString(),
        ))
        InfoSection(stringResource(R.string.track_info_audio), listOf(
            stringResource(R.string.track_info_codec) to track.codec?.uppercase(locale),
            stringResource(R.string.track_info_bitrate) to track.bitrateKbps?.let { "$it kbps" },
            stringResource(R.string.track_info_sample_rate) to track.sampleRateHz?.let { "$it Hz" },
            stringResource(R.string.track_info_depth) to track.bitsPerSample?.let { "$it bit" },
            stringResource(R.string.track_info_tempo) to track.cues?.bpm?.let { String.format(locale, "%.1f BPM", it) },
            stringResource(R.string.track_info_key) to track.key?.let { "${it.name} / ${it.camelot}" },
            stringResource(R.string.track_info_loudness) to track.loudness?.let { String.format(locale, "%.1f LUFS", it.lufs) },
        ))
        InfoSection(stringResource(R.string.track_info_library), listOf(
            stringResource(R.string.track_info_file) to track.originalFileName,
            stringResource(R.string.track_info_added) to added,
            stringResource(R.string.track_info_lyrics) to track.hasLyrics?.let {
                stringResource(if (it) R.string.track_info_lyrics_present else R.string.track_info_lyrics_missing)
            },
        ))
    }
}

@Composable
private fun InfoSection(title: String, rows: List<Pair<String, String?>>) {
    val values = rows.filter { !it.second.isNullOrBlank() }
    if (values.isEmpty()) return
    val palette = LocalPalette.current
    Column(Modifier.fillMaxWidth().musicSurface(palette).padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Text(title, style = Type.small.copy(fontWeight = FontWeight.SemiBold), color = palette.muted,
            modifier = Modifier.semantics { heading() })
        SelectionContainer {
            Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                values.forEach { (label, value) ->
                    Column(verticalArrangement = Arrangement.spacedBy(3.dp)) {
                        Text(label, style = Type.tiny, color = palette.muted)
                        Text(value.orEmpty(), style = Type.small)
                    }
                }
            }
        }
    }
}
