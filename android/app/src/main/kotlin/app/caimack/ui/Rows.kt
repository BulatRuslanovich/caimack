// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

package app.caimack.ui

import android.content.res.Resources
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalResources
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.em
import app.caimack.R
import app.caimack.api.RecommendationReason
import app.caimack.api.Track

@Composable
fun reasonLabel(reason: RecommendationReason): String? = reasonText(reason, LocalResources.current)
fun reasonText(reason: RecommendationReason, strings: Resources): String? {
    val subject = reason.subject.orEmpty()
    return when (reason.kind) {
        "becauseYouListened" -> strings.getString(R.string.reason_because_you_listened, subject)
        "popularWithSimilarTaste" -> strings.getString(R.string.reason_similar_taste)
        "newFromArtistYouPlay" -> strings.getString(R.string.reason_new_from_artist, subject)
        "fromGenreYouLike" -> strings.getString(R.string.reason_genre, subject)
        "trending" -> strings.getString(R.string.reason_trending)
        "freshInLibrary" -> strings.getString(R.string.reason_fresh)
        "soundsLike" -> strings.getString(R.string.reason_sounds_like, subject)
        "matchesYourTaste" -> strings.getString(R.string.reason_matches_your_taste)
        "discovery" -> strings.getString(R.string.reason_discovery)
        else -> null
    }
}
@Composable
fun SectionHeader(title: String, note: String? = null, onSeeAll: (() -> Unit)? = null, style: TextStyle = Type.heading) {
    val palette = LocalPalette.current
    Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp), verticalAlignment = Alignment.Bottom) {
        Column(Modifier.weight(1f)) {
            Text(title, style = style, maxLines = if (style == Type.section) 1 else 2, overflow = TextOverflow.Ellipsis)
            note?.let { Text(it, style = Type.small, color = palette.muted, maxLines = 1, overflow = TextOverflow.Ellipsis) }
        }
        onSeeAll?.let {
            Row(Modifier.heightIn(min = 48.dp).clickable(onClick = it).padding(start = 12.dp), verticalAlignment = Alignment.CenterVertically) {
                Text(stringResource(R.string.action_see_all), style = Type.small, color = palette.muted)
                Icon(Lucide.ChevronRight, null, tint = palette.muted, modifier = Modifier.size(16.dp))
            }
        }
    }
}
@Composable
fun Card(
    title: String,
    subtitle: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    round: Boolean = false,
    toneUrl: String? = null,
    cover: @Composable (Modifier) -> Unit,
) {
    val palette = LocalPalette.current
    val shape = if (round) CircleShape else Radius.cover
    Column(modifier.clickable(onClick = onClick)) {
        cover(
            Modifier
                .fillMaxWidth()
                .aspectRatio(1f)
                .shadow(6.dp, shape, clip = false, ambientColor = Color.Black.copy(alpha = 0.16f), spotColor = Color.Black.copy(alpha = 0.18f)),
        )
        Text(
            title,
            style = Type.small.copy(fontWeight = FontWeight.Medium),
            maxLines = 2,
            overflow = TextOverflow.Ellipsis,
            textAlign = if (round) TextAlign.Center else TextAlign.Start,
            modifier = Modifier.fillMaxWidth().padding(top = 10.dp, bottom = 3.dp),
        )
        Text(
            subtitle,
            style = Type.small,
            color = palette.muted,
            maxLines = 2,
            overflow = TextOverflow.Ellipsis,
            textAlign = if (round) TextAlign.Center else TextAlign.Start,
            modifier = Modifier.fillMaxWidth(),
        )
    }
}
@Composable
fun TrackRow(
    track: Track,
    onClick: () -> Unit,
    index: Int? = null,
    inset: Dp = 16.dp,
    onRemoveFromPlaylist: (() -> Unit)? = null,
) {
    val palette = LocalPalette.current
    val density = LocalLibraryDensity.current
    val container = LocalContainer.current
    val playback = container.player.state.collectAsState().value
    val downloads by container.downloads.state.collectAsState()
    val synchronization by container.syncStore.status.collectAsState()
    val librarySync = synchronization.enabled && container.syncStore.active
    val showDownloadBadge = !librarySync && downloads[track.id]?.done == true
    val available = !LocalOfflineLibrary.current || track.id in LocalAvailableTracks.current
    val current = playback.current?.id == track.id
    val playing = current && playback.playing
    var actions by remember { mutableStateOf(false) }

    if (actions) TrackSheet(track, onRemoveFromPlaylist) { actions = false }

    val tone = LocalNowPlayingTone.current
    val accent = palette.primary
    Row(
        Modifier
            .fillMaxWidth()
            .clip(Radius.row)
            .then(
                if (!current) Modifier
                else Modifier.drawBehind {
                    drawRect(palette.card)
                    drawRect(Brush.horizontalGradient(0f to tone.copy(alpha = tone.alpha * 0.22f), 0.45f to Color.Transparent))
                    drawRoundRect(
                        accent,
                        topLeft = Offset(0f, size.height * 0.28f),
                        size = Size(3.dp.toPx(), size.height * 0.44f),
                        cornerRadius = CornerRadius(2.dp.toPx()),
                    )
                },
            )
            .alpha(if (available) 1f else 0.38f)
            .combinedClickable(enabled = available, onLongClick = { actions = true }, onClick = onClick)
            .heightIn(min = 48.dp)
            .padding(start = inset, top = density.rowPadding, bottom = density.rowPadding, end = 4.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        index?.let {
            Box(Modifier.width(22.dp), contentAlignment = Alignment.CenterEnd) {
                if (playing) NowPlayingBars(palette.primary)
                else Text("$it", style = Type.small, color = if (current) palette.primary else palette.faint, textAlign = TextAlign.End)
            }
        }
        Box(Modifier.size(density.coverSize)) {
            Cover(trackCover(track), track.albumTitle ?: track.title, Modifier.fillMaxSize())
            if (playing && index == null) {
                Box(Modifier.fillMaxSize().clip(Radius.cover).background(Color.Black.copy(alpha = 0.55f)), contentAlignment = Alignment.Center) {
                    NowPlayingBars(Color.White)
                }
            }
        }
        Column(Modifier.weight(1f)) {
            Text(
                track.title,
                style = Type.small.copy(fontWeight = FontWeight.Medium),
                color = if (current) palette.primary else palette.foreground,
                maxLines = 2,
                overflow = TextOverflow.Ellipsis,
            )
            Text(artistsOf(track), style = Type.small, color = palette.muted, maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
        if (showDownloadBadge) {
            Icon(Lucide.CircleArrowDown, stringResource(R.string.downloads_available), tint = palette.primary, modifier = Modifier.size(14.dp))
        }
        Text(durationOf(track.durationSeconds), style = Type.tiny, color = palette.faint)
        Icon(
            Lucide.EllipsisVertical,
            stringResource(R.string.menu_more),
            tint = palette.faint,
            modifier = Modifier.clip(CircleShape).clickable(enabled = available) { actions = true }.padding(15.dp).size(18.dp),
        )
    }
}
@Composable
fun DetailHeader(
    kind: String,
    title: String,
    facts: List<String>,
    description: String? = null,
    round: Boolean = false,
    backdrop: String? = null,
    cover: @Composable (Modifier) -> Unit,
) {
    val palette = LocalPalette.current
    Box(Modifier.fillMaxWidth()) {
        ArtBackdrop(backdrop, BackdropMode.Header, Modifier.matchParentSize())
        Column(Modifier.fillMaxWidth().padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            cover(Modifier.size(176.dp).then(if (round) Modifier.clip(CircleShape) else Modifier))
            Text(title, style = displayStyle(title))
            description?.let { Text(it, style = Type.small, color = palette.muted) }
            FlowRow(horizontalArrangement = Arrangement.spacedBy(20.dp)) {
                (listOf(kind) + facts).forEach { Text(it, style = Type.small, color = palette.muted) }
            }
        }
    }
}
fun displayStyle(title: String): TextStyle {
    val length = title.trim().codePointCount(0, title.trim().length)
    return when {
        length <= 24 -> Type.display
        length <= 48 -> Type.title
        else -> Type.title.copy(fontFamily = Onest, fontWeight = FontWeight.SemiBold, letterSpacing = 0.em)
    }
}
