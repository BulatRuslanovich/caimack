// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

package app.caimack.ui

import android.graphics.Bitmap
import android.widget.Toast
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import app.caimack.R
import app.caimack.api.Lyrics
import app.caimack.api.Track
import coil3.SingletonImageLoader
import coil3.request.ImageRequest
import coil3.request.SuccessResult
import coil3.request.allowHardware
import coil3.toBitmap
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

private class ShareSources(val cover: Bitmap?, val lyrics: Lyrics?, val peaks: List<Int>)

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ShareSheet(track: Track, positionMs: Long, onDismiss: () -> Unit) {
    val palette = LocalPalette.current
    val container = LocalContainer.current
    val context = LocalContext.current
    var format by remember { mutableStateOf(ShareFormat.Story) }
    var withLyric by remember { mutableStateOf(true) }
    val caption = stringResource(R.string.share_caption)
    val artist = artistsOf(track)

    val sources by produceState<ShareSources?>(null, track.id) {
        value = withContext(Dispatchers.IO) {
            val coverUrl = container.media.cover(track.albumId, track.id, track.hasCover, small = false)
            val cover = coverUrl?.let { url ->
                val request = ImageRequest.Builder(context).data(url).allowHardware(false).build()
                (SingletonImageLoader.get(context).execute(request) as? SuccessResult)?.image?.toBitmap()
            }
            val lyrics = runCatching { container.api.lyrics(track.id).body() }.getOrNull()
            val peaks = runCatching { container.api.waveform(track.id).body()?.peaks }.getOrNull().orEmpty()
            ShareSources(cover, lyrics, peaks)
        }
    }

    val lyric = sources?.lyrics?.lines?.let { lines ->
        (lines.lastOrNull { it.at <= positionMs } ?: lines.firstOrNull { it.text.isNotBlank() })?.text?.trim()?.ifEmpty { null }
    }

    val card by produceState<Bitmap?>(null, sources, format, withLyric, palette) {
        val loaded = sources ?: return@produceState
        value = withContext(Dispatchers.Default) {
            renderShareCard(
                context,
                ShareCardInput(
                    title = track.title,
                    artist = artist,
                    album = track.albumTitle,
                    cover = loaded.cover,
                    lyric = if (withLyric) lyric else null,
                    peaks = loaded.peaks,
                    progress = if (track.durationSeconds > 0) positionMs / 1000f / track.durationSeconds else 0f,
                    caption = caption,
                ),
                format,
                palette,
            )
        }
    }

    ModalBottomSheet(
        onDismissRequest = onDismiss,
        containerColor = palette.card,
        sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true),
    ) {
        Column(
            Modifier.navigationBarsPadding().padding(horizontal = 16.dp, vertical = 8.dp),
            verticalArrangement = Arrangement.spacedBy(14.dp),
        ) {
            Text(stringResource(R.string.share_title), style = Type.section)

            Tabs(contentPadding = PaddingValues(0.dp)) {
                Tab(stringResource(R.string.share_story), format == ShareFormat.Story) { format = ShareFormat.Story }
                Tab(stringResource(R.string.share_square), format == ShareFormat.Square) { format = ShareFormat.Square }
            }
            if (lyric != null && format == ShareFormat.Story) {
                Row(
                    Modifier.fillMaxWidth().clip(Radius.row).clickable { withLyric = !withLyric }.padding(vertical = 4.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text(stringResource(R.string.share_with_lyric), style = Type.body, modifier = Modifier.weight(1f))
                    Toggle(withLyric) { withLyric = it }
                }
            }

            Box(Modifier.fillMaxWidth().heightIn(max = 420.dp), contentAlignment = Alignment.Center) {
                val shown = card
                if (shown == null) {
                    Box(Modifier.height(240.dp), contentAlignment = Alignment.Center) { RecordLoading(44.dp) }
                } else {
                    Image(
                        shown.asImageBitmap(),
                        contentDescription = stringResource(R.string.share_preview),
                        modifier = Modifier.aspectRatio(shown.width.toFloat() / shown.height).clip(Radius.panel),
                    )
                }
            }

            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                SheetButton(stringResource(R.string.share_share), Lucide.Share2, primary = true, enabled = card != null, modifier = Modifier.weight(1f)) {
                    card?.let { shareCard(context, it, track.title, artist) }
                }
                SheetButton(stringResource(R.string.share_save), Lucide.Download, enabled = card != null, modifier = Modifier.weight(1f)) {
                    val saved = card?.let { saveCard(context, it, track.title, artist) } ?: false
                    Toast.makeText(context, if (saved) R.string.share_saved else R.string.share_failed, Toast.LENGTH_SHORT).show()
                }
            }
        }
    }
}

@Composable
private fun SheetButton(
    label: String,
    icon: ImageVector,
    modifier: Modifier = Modifier,
    primary: Boolean = false,
    enabled: Boolean = true,
    onClick: () -> Unit,
) {
    val palette = LocalPalette.current
    val ink = if (primary) palette.onAction else palette.foreground
    Row(
        modifier
            .height(48.dp)
            .clip(CircleShape)
            .background(if (primary) palette.action else palette.raised)
            .clickable(enabled = enabled, onClick = onClick),
        horizontalArrangement = Arrangement.Center,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(icon, null, tint = if (enabled) ink else ink.copy(alpha = 0.4f), modifier = Modifier.size(18.dp))
        Text(
            label,
            style = Type.small.copy(fontWeight = FontWeight.SemiBold),
            color = if (enabled) ink else ink.copy(alpha = 0.4f),
            modifier = Modifier.padding(start = 8.dp),
        )
    }
}
