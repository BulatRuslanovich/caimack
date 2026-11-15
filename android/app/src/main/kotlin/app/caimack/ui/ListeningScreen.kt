// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich
package app.caimack.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import app.caimack.R
import app.caimack.api.ListeningOverview
import app.caimack.api.ListeningWeek
import app.caimack.api.Track
import java.text.NumberFormat
import java.time.LocalDate
import java.time.format.DateTimeFormatter
import java.util.Locale

private val StatsRadius = RoundedCornerShape(8.dp)
internal val StatsBlue = Color(0xFF89CFF2)
internal val StatsGreen = Color(0xFF93DEAB)
internal val StatsPink = Color(0xFFF0BAC6)

internal fun listeningRange(week: ListeningWeek, locale: Locale): String {
    val start = LocalDate.parse(week.startDate)
    val end = LocalDate.parse(week.endDate)
    val pattern = if (start.year != end.year) "d MMM yyyy" else "d MMM"
    val formatter = DateTimeFormatter.ofPattern(pattern, locale)
    return "${start.format(formatter)} – ${end.format(formatter)}"
}

@Composable
fun ListeningScreen(weekStart: String, view: String, open: (String, String) -> Unit) {
    val container = LocalContainer.current
    val account = container.accountKey
    var data by remember(account) { mutableStateOf<ListeningOverview?>(null) }
    var failed by remember { mutableStateOf(false) }
    var revision by remember { mutableIntStateOf(0) }
    LaunchedEffect(account, revision) {
        failed = false
        runCatching {
            container.signals.send()
            withNetworkRetries { container.api.listeningStats() }
        }
            .onSuccess { data = it }
            .onFailure { failed = true }
    }
    val shown = data
    when {
        failed && shown == null -> Failure { revision++ }
        shown == null ->
            Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                RecordLoading(48.dp)
            }
        else ->
            Column {
                if (failed) Failure { revision++ }
                ListeningContent(shown, weekStart, view, open, { revision++ }) { tracks, index ->
                    val playable = container.playable(tracks)
                    val selected = tracks.getOrNull(index)?.id
                    if (playable.isNotEmpty())
                        container.player.play(
                            playable,
                            playable.indexOfFirst { it.id == selected }.coerceAtLeast(0),
                            "listening",
                        )
                }
            }
    }
}

@Composable
internal fun ListeningContent(
    data: ListeningOverview,
    weekStart: String = "",
    view: String = "overview",
    open: (String, String) -> Unit,
    refresh: () -> Unit,
    play: (List<Track>, Int) -> Unit,
) {
    val week =
        data.weeks.firstOrNull { it.startDate == weekStart } ?: data.weeks.firstOrNull() ?: return
    val palette = LocalPalette.current
    val locale = LocalConfiguration.current.locales[0]
    var archiveSize by rememberSaveable { mutableIntStateOf(4) }
    val range = listeningRange(week, locale)
    val minutes = NumberFormat.getIntegerInstance(locale).format(week.listenedSeconds / 60)
    val titleStyle =
        Type.body.copy(
            fontSize = 24.sp,
            lineHeight = 29.sp,
            fontWeight = FontWeight.Bold,
            letterSpacing = (-0.5).sp,
        )
    Column(
        Modifier.fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(bottom = 24.dp + LocalMiniPlayerInset.current),
        verticalArrangement = Arrangement.spacedBy(24.dp),
    ) {
        Column(
            Modifier.fillMaxWidth().padding(horizontal = 16.dp).padding(top = 20.dp),
            verticalArrangement = Arrangement.spacedBy(4.dp),
        ) {
            if (view == "overview")
                Text(
                    stringResource(
                        if (week.current) R.string.listening_this_week else R.string.listening_week
                    ),
                    style = titleStyle,
                )
            Text(range, style = Type.body.copy(fontSize = 17.sp), color = palette.foreground)
        }
        when (view) {
            "overview" -> {
                if (week.listenedSeconds == 0L) {
                    val hasHistory = data.weeks.any { it.listenedSeconds > 0 }
                    Empty(
                        stringResource(
                            if (hasHistory) R.string.listening_no_week else R.string.listening_empty
                        ),
                        stringResource(
                            if (hasHistory) R.string.listening_no_week_hint
                            else R.string.listening_empty_hint
                        ),
                    )
                } else {
                    StatsTiles(week, minutes) { open(week.startDate, it) }
                    Text(
                        stringResource(R.string.listening_insights),
                        style = titleStyle,
                        modifier = Modifier.padding(horizontal = 16.dp),
                    )
                    Row(
                        Modifier.horizontalScroll(rememberScrollState())
                            .padding(horizontal = 16.dp),
                        horizontalArrangement = Arrangement.spacedBy(16.dp),
                    ) {
                        val decade = week.decade
                        InsightCard(
                            week,
                            if (decade != null) "decade" else "variety",
                            Modifier.width(160.dp),
                        ) {
                            open(week.startDate, if (decade != null) "decade" else "variety")
                        }
                        if (week.topArtists.isNotEmpty())
                            InsightCard(week, "artistShare", Modifier.width(160.dp)) {
                                open(week.startDate, "artistShare")
                            }
                    }
                }
                val past =
                    data.weeks.filter {
                        !it.current && it.listenedSeconds > 0 && it.startDate != week.startDate
                    }
                if (past.isNotEmpty()) {
                    Text(
                        stringResource(R.string.listening_past_weeks),
                        style = titleStyle,
                        modifier = Modifier.padding(horizontal = 16.dp),
                    )
                    Column(
                        Modifier.padding(horizontal = 16.dp),
                        verticalArrangement = Arrangement.spacedBy(8.dp),
                    ) {
                        past.take(archiveSize).forEach { old ->
                            Row(
                                Modifier.fillMaxWidth()
                                    .clip(StatsRadius)
                                    .background(palette.card)
                                    .clickable { open(old.startDate, "overview") }
                                    .padding(10.dp),
                                verticalAlignment = Alignment.CenterVertically,
                                horizontalArrangement = Arrangement.spacedBy(12.dp),
                            ) {
                                old.topTracks.firstOrNull()?.track?.let {
                                    Cover(trackCover(it), it.title, Modifier.size(64.dp))
                                }
                                Column(
                                    Modifier.weight(1f),
                                    verticalArrangement = Arrangement.spacedBy(3.dp),
                                ) {
                                    Text(
                                        listeningRange(old, locale),
                                        style = Type.body.copy(fontWeight = FontWeight.SemiBold),
                                    )
                                    Text(
                                        old.topTracks.firstOrNull()?.track?.title
                                            ?: stringResource(R.string.listening_minutes),
                                        maxLines = 1,
                                        overflow = TextOverflow.Ellipsis,
                                        style = Type.small,
                                        color = palette.muted,
                                    )
                                    Text(
                                        stringResource(
                                            R.string.listening_you_minutes,
                                            NumberFormat.getIntegerInstance(locale)
                                                .format(old.listenedSeconds / 60),
                                        ),
                                        style = Type.tiny,
                                        color = palette.muted,
                                    )
                                }
                                Icon(Lucide.ChevronRight, null, tint = palette.muted)
                            }
                        }
                        if (past.size > archiveSize)
                            TextButton(onClick = { archiveSize += 4 }) {
                                Text(stringResource(R.string.listening_more))
                            }
                    }
                }
            }
            "artists",
            "songs" -> StatsRanking(week, view == "artists", play)
            "minutes" -> {
                StatsHero(
                    stringResource(R.string.listening_you_minutes, minutes),
                    minutes,
                    StatsBlue,
                )
                Column(
                    Modifier.padding(horizontal = 24.dp),
                    verticalArrangement = Arrangement.spacedBy(20.dp),
                ) {
                    Text(stringResource(R.string.listening_days), style = titleStyle)
                    ListeningDays(week, locale)
                    week.previousListenedSeconds?.let {
                        Text(
                            stringResource(
                                R.string.listening_previous,
                                NumberFormat.getIntegerInstance(locale).format(it / 60),
                            ),
                            style = Type.body,
                            color = palette.muted,
                        )
                    }
                    Text(stringResource(R.string.listening_plays, week.plays), style = Type.body)
                }
            }
            else ->
                Column(
                    Modifier.padding(horizontal = 16.dp),
                    verticalArrangement = Arrangement.spacedBy(24.dp),
                ) {
                    InsightCard(week, view, Modifier.fillMaxWidth(), expanded = true) {}
                    Text(
                        insightNote(week, view),
                        style = Type.body.copy(fontSize = 20.sp, lineHeight = 28.sp),
                    )
                    if (view == "artistShare")
                        week.topArtists.firstOrNull()?.artist?.let { artist ->
                            val navigate = LocalNavigate.current
                            TextButton(onClick = { navigate(ArtistRoute(artist.id)) }) {
                                Text(artist.name)
                                Icon(Lucide.ChevronRight, null)
                            }
                        }
                }
        }
        if (view == "overview" && week.current)
            TextButton(
                onClick = refresh,
                modifier = Modifier.padding(horizontal = 16.dp),
            ) {
                Text(stringResource(R.string.listening_refresh), color = palette.foreground)
            }
    }
}

@Composable
private fun StatsTiles(week: ListeningWeek, minutes: String, open: (String) -> Unit) {
    val container = LocalContainer.current
    val palette = LocalPalette.current
    val artist = week.topArtists.firstOrNull()?.artist
    val song = week.topTracks.firstOrNull()?.track
    Row(
        Modifier.fillMaxWidth().padding(horizontal = 16.dp),
        horizontalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(16.dp)) {
            StatsTile(stringResource(R.string.listening_minutes), { open("minutes") }) {
                Text(
                    minutes,
                    style =
                        Type.body.copy(
                            fontSize = 48.sp,
                            lineHeight = 58.sp,
                            fontWeight = FontWeight.ExtraBold,
                            letterSpacing = (-2).sp,
                        ),
                    modifier = Modifier.padding(vertical = 4.dp),
                )
            }
            if (artist != null)
                StatsTile(stringResource(R.string.listening_top_artist), { open("artists") }) {
                    Text(
                        artist.name,
                        style =
                            Type.body.copy(
                                fontSize = 20.sp,
                                lineHeight = 23.sp,
                                fontWeight = FontWeight.Bold,
                            ),
                        maxLines = 2,
                        overflow = TextOverflow.Ellipsis,
                    )
                    Cover(
                        container.media.artistImage(artist.id, artist.hasImage, false),
                        artist.name,
                        Modifier.fillMaxWidth().aspectRatio(1f).padding(top = 8.dp),
                        round = true,
                    )
                }
        }
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(16.dp)) {
            StatsTile(stringResource(R.string.listening_week), { open("songs") }) {
                Text(
                    stringResource(R.string.listening_songs_count, week.distinctTracks),
                    style = Type.body.copy(fontWeight = FontWeight.Bold),
                )
                Text(
                    stringResource(R.string.listening_artists_count, week.distinctArtists),
                    style = Type.small,
                    color = palette.muted,
                )
            }
            if (song != null)
                StatsTile(stringResource(R.string.listening_top_song), { open("songs") }) {
                    Text(
                        song.title,
                        style =
                            Type.body.copy(
                                fontSize = 20.sp,
                                lineHeight = 24.sp,
                                fontWeight = FontWeight.Bold,
                            ),
                        maxLines = 3,
                        overflow = TextOverflow.Ellipsis,
                    )
                    Cover(
                        trackCover(song, false),
                        song.title,
                        Modifier.fillMaxWidth().aspectRatio(1f).padding(top = 8.dp),
                    )
                }
        }
    }
}

@Composable
private fun StatsTile(
    label: String,
    click: () -> Unit,
    content: @Composable ColumnScope.() -> Unit,
) {
    val palette = LocalPalette.current
    Column(
        Modifier.fillMaxWidth()
            .clip(StatsRadius)
            .background(palette.card)
            .clickable(onClick = click)
            .padding(10.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Row(verticalAlignment = Alignment.Top) {
            Text(label, style = Type.small, color = palette.muted, modifier = Modifier.weight(1f))
            Icon(Lucide.ChevronRight, null, modifier = Modifier.size(18.dp), tint = palette.muted)
        }
        content()
    }
}

@Composable
private fun StatsHero(text: String, highlight: String, color: Color) {
    val highlightColor = if (LocalPalette.current.dark) color else Color(0xFF17658E)
    val at = text.indexOf(highlight)
    val label: AnnotatedString = buildAnnotatedString {
        if (at < 0) append(text)
        else {
            append(text.substring(0, at))
            withStyle(SpanStyle(color = highlightColor)) { append(highlight) }
            append(text.substring(at + highlight.length))
        }
    }
    Column(
        Modifier.padding(horizontal = 24.dp),
        verticalArrangement = Arrangement.spacedBy(28.dp),
    ) {
        Text(
            label,
            style =
                Type.body.copy(
                    fontSize = 34.sp,
                    lineHeight = 40.sp,
                    letterSpacing = (-1).sp,
                    fontWeight = FontWeight.Bold,
                ),
        )
        HorizontalDivider(color = LocalPalette.current.border)
    }
}

@Composable
private fun StatsRanking(week: ListeningWeek, artists: Boolean, play: (List<Track>, Int) -> Unit) {
    val palette = LocalPalette.current
    val container = LocalContainer.current
    val navigate = LocalNavigate.current
    val count = if (artists) week.distinctArtists else week.distinctTracks
    StatsHero(
        pluralStringResource(
            if (artists) R.plurals.listening_artists_week else R.plurals.listening_songs_week,
            count,
            count,
        ),
        count.toString(),
        StatsBlue,
    )
    Column(
        Modifier.padding(horizontal = 16.dp),
        verticalArrangement = Arrangement.spacedBy(20.dp),
    ) {
        val size = if (artists) week.topArtists.size else week.topTracks.size
        repeat(size) { index ->
            val artist = week.topArtists.getOrNull(index)
            val song = week.topTracks.getOrNull(index)
            val rank = index + 1
            val prior = if (artists) artist?.previousRank else song?.previousRank
            val topWeeks = if (artists) artist?.weeksInTop5 ?: 0 else song?.weeksInTop5 ?: 0
            val title = if (artists) artist!!.artist.name else song!!.track.title
            val url =
                if (artists)
                    artist!!.artist.let { container.media.artistImage(it.id, it.hasImage, false) }
                else trackCover(song!!.track)
            val rankDescription = stringResource(R.string.listening_rank, rank)
            Row(
                Modifier.fillMaxWidth()
                    .clip(StatsRadius)
                    .clickable {
                        if (artists) navigate(ArtistRoute(artist!!.artist.id))
                        else play(week.topTracks.map { it.track }, index)
                    }
                    .padding(vertical = 8.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                Column(
                    Modifier.width(22.dp).semantics { contentDescription = rankDescription },
                    horizontalAlignment = Alignment.CenterHorizontally,
                ) {
                    if (prior != null && prior != rank)
                        Icon(
                            if (prior > rank) Lucide.ChevronUp else Lucide.ChevronDown,
                            stringResource(
                                if (prior > rank) R.string.listening_moved_up
                                else R.string.listening_moved_down,
                                kotlin.math.abs(prior - rank),
                            ),
                            tint = if (prior > rank) palette.success else palette.destructive,
                            modifier = Modifier.size(18.dp),
                        )
                    Text(rank.toString(), style = Type.body.copy(fontWeight = FontWeight.Bold))
                }
                Cover(url, title, Modifier.size(84.dp), round = artists)
                Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    Text(
                        title,
                        style = Type.body.copy(fontSize = 16.sp, fontWeight = FontWeight.Medium),
                        maxLines = 2,
                        overflow = TextOverflow.Ellipsis,
                    )
                    if (!artists)
                        Text(
                            artistsOf(song!!.track),
                            style = Type.small,
                            color = palette.muted,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis,
                        )
                    Text(
                        if (artists)
                            stringResource(
                                R.string.listening_duration,
                                ((artist?.listenedSeconds ?: 0) / 60).toString(),
                            )
                        else stringResource(R.string.listening_plays, song!!.plays),
                        style = Type.small,
                        color = palette.muted,
                    )
                    if (topWeeks > 0)
                        Text(
                            pluralStringResource(R.plurals.listening_top_weeks, topWeeks, topWeeks),
                            style = Type.small,
                            color = palette.muted,
                        )
                }
                Icon(
                    Lucide.ChevronRight,
                    null,
                    tint = palette.muted,
                    modifier = Modifier.size(16.dp),
                )
            }
        }
    }
}

@Composable
private fun ListeningDays(week: ListeningWeek, locale: Locale) {
    val peak = week.daySeconds.maxOrNull()?.coerceAtLeast(1) ?: 1
    Row(
        Modifier.fillMaxWidth().height(160.dp),
        horizontalArrangement = Arrangement.spacedBy(10.dp),
        verticalAlignment = Alignment.Bottom,
    ) {
        week.daySeconds.forEachIndexed { index, seconds ->
            val day =
                LocalDate.parse(week.startDate)
                    .plusDays(index.toLong())
                    .dayOfWeek
                    .getDisplayName(java.time.format.TextStyle.SHORT, locale)
            Column(
                Modifier.weight(1f).fillMaxHeight(),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.Bottom,
            ) {
                Text(
                    (seconds / 60).toString(),
                    style = Type.tiny,
                    color = LocalPalette.current.muted,
                )
                Spacer(Modifier.height(6.dp))
                Box(
                    Modifier.fillMaxWidth()
                        .height((112f * seconds / peak).coerceAtLeast(3f).dp)
                        .clip(RoundedCornerShape(4.dp))
                        .background(StatsBlue)
                )
                Spacer(Modifier.height(8.dp))
                Text(day, style = Type.tiny, color = LocalPalette.current.muted)
            }
        }
    }
}

@Composable
private fun insightNote(week: ListeningWeek, kind: String): String =
    when (kind) {
        "decade" ->
            stringResource(R.string.listening_decade_note, week.decadeShare ?: 0, week.decade ?: 0)
        "artistShare" ->
            stringResource(
                R.string.listening_artist_note,
                week.topArtists.firstOrNull()?.artist?.name.orEmpty(),
                week.artistShare ?: 0,
            )
        else ->
            stringResource(
                R.string.listening_variety_note,
                week.distinctTracks,
                week.distinctArtists,
            )
    }

@Composable
private fun InsightCard(
    week: ListeningWeek,
    kind: String,
    modifier: Modifier,
    expanded: Boolean = false,
    click: () -> Unit,
) {
    val media = LocalContainer.current.media
    val artist = week.topArtists.firstOrNull()?.artist
    val color = if (kind == "artistShare") StatsPink else StatsGreen
    Column(
        modifier
            .clip(StatsRadius)
            .background(color)
            .then(if (expanded) Modifier else Modifier.clickable(onClick = click))
            .padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        if (kind == "artistShare" && artist != null)
            Cover(
                media.artistImage(artist.id, artist.hasImage, false),
                artist.name,
                Modifier.fillMaxWidth().aspectRatio(1f),
                round = true,
            )
        else
            Box(Modifier.fillMaxWidth().aspectRatio(1f), contentAlignment = Alignment.Center) {
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                    week.topTracks.take(3).forEach {
                        Cover(
                            trackCover(it.track),
                            it.track.title,
                            Modifier.weight(1f).aspectRatio(1f),
                        )
                    }
                }
            }
        Text(
            when (kind) {
                "decade" -> stringResource(R.string.listening_decade, week.decade ?: 0)
                "artistShare" ->
                    stringResource(R.string.listening_artist_share, week.artistShare ?: 0)
                else -> stringResource(R.string.listening_variety)
            },
            style =
                Type.body.copy(
                    fontSize = if (expanded) 36.sp else 24.sp,
                    lineHeight = if (expanded) 40.sp else 28.sp,
                    fontWeight = FontWeight.ExtraBold,
                    letterSpacing = (-0.7).sp,
                ),
            color = Color(0xFF15251B),
            textAlign = androidx.compose.ui.text.style.TextAlign.Center,
            modifier = Modifier.fillMaxWidth(),
        )
        if (expanded) Text(insightNote(week, kind), style = Type.small, color = Color(0xFF243B2C))
    }
}
