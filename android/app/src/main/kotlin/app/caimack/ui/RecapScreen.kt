// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Bulat Ruslanovich

package app.caimack.ui

import androidx.compose.runtime.collectAsState
import androidx.activity.compose.BackHandler
import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Icon
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalResources
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import app.caimack.R
import app.caimack.api.Recap
import app.caimack.api.Track
import java.time.LocalDate
import java.time.format.TextStyle
import java.util.Locale
import kotlin.math.roundToInt

private const val SLIDE_MS = 7000
private const val HOLD_MS = 250L
private class RecapSlide(val key: String, val art: String?, val content: @Composable () -> Unit)
@Composable
fun RecapBanner() {
    val palette = LocalPalette.current
    val container = LocalContainer.current
    var recap by remember { mutableStateOf(Remote.cache[RECAP] as Recap?) }
    var open by remember { mutableStateOf(false) }

    LaunchedEffect(Unit) {
        runCatching { withNetworkRetries { container.api.recap() } }.getOrNull()?.let { response ->
            if (!response.isSuccessful) return@let
            recap = response.body()?.takeIf { response.code() == 200 }
            if (recap != null) Remote.cache[RECAP] = recap!! else Remote.cache.remove(RECAP)
        }
    }

    val asked by container.openRecap.collectAsState()
    LaunchedEffect(asked, recap) {
        if (asked && recap != null) {
            open = true
            container.openRecap.value = false
        }
    }

    val shown = recap ?: return
    val covers = shown.topTracks.map { it.track }.filter { it.hasCover }.take(3)

    if (open) {
        Dialog(
            onDismissRequest = { open = false },
            properties = DialogProperties(usePlatformDefaultWidth = false, decorFitsSystemWindows = false),
        ) {
            RecapStory(shown, { tracks, index -> container.player.play(tracks, index, "recap") }) { open = false }
        }
    }

    Box(
        Modifier
            .padding(horizontal = 16.dp)
            .fillMaxWidth()
            .clip(Radius.panel)
            .background(palette.card)
            .clickable { open = true },
    ) {
        covers.firstOrNull()?.let { ArtBackdrop(trackCover(it, small = false), BackdropMode.Header, Modifier.matchParentSize()) }
        Row(
            Modifier.padding(16.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            if (covers.isNotEmpty()) {
                Box(Modifier.width((48 + 18 * (covers.size - 1)).dp).height(56.dp)) {
                    covers.forEachIndexed { index, track ->
                        Cover(
                            trackCover(track),
                            track.albumTitle ?: track.title,
                            Modifier
                                .padding(start = (18 * index).dp, top = 4.dp)
                                .size(48.dp)
                                .rotate((index - (covers.size - 1) / 2f) * 7f),
                        )
                    }
                }
            }
            Column(Modifier.weight(1f)) {
                Text(
                    stringResource(R.string.recap_banner, monthName(shown.year, shown.month)),
                    style = Type.section,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
                Text(
                    stringResource(R.string.recap_banner_note, listeningTime(shown.listenedSeconds)),
                    style = Type.small,
                    color = palette.muted,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
            }
            Icon(Lucide.ChevronRight, null, tint = palette.foreground, modifier = Modifier.size(18.dp))
        }
    }
}
private const val RECAP = "recap"
@Composable
private fun RecapStory(recap: Recap, play: (List<Track>, Int) -> Unit, onClose: () -> Unit) {
    val palette = LocalPalette.current
    var index by remember { mutableIntStateOf(0) }
    val slides = recapSlides(recap, play, onClose) { index = 0 }
    val last = slides.lastIndex
    val slide = slides[index.coerceAtMost(last)]

    var paused by remember { mutableStateOf(false) }
    var held by remember { mutableStateOf(false) }
    val progress = remember { Animatable(0f) }

    val go: (Int) -> Unit = { step -> index = (index + step).coerceIn(0, last) }

    LaunchedEffect(index) { progress.snapTo(0f) }
    LaunchedEffect(index, paused, held) {
        if (paused || held) return@LaunchedEffect
        val left = ((1f - progress.value) * SLIDE_MS).roundToInt()
        progress.animateTo(1f, tween(left, easing = LinearEasing))
        if (index < last) index++
    }

    BackHandler(onBack = onClose)

    Surface(Modifier.fillMaxSize(), color = palette.background) {
        Box(Modifier.fillMaxSize()) {
            ArtBackdrop(slide.art, BackdropMode.Stage, Modifier.matchParentSize())
            Column(Modifier.safeDrawingPadding().padding(horizontal = 20.dp, vertical = 12.dp)) {
                Row(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                    slides.indices.forEach { position ->
                        Box(Modifier.weight(1f).height(3.dp).clip(CircleShape).background(palette.foreground.copy(alpha = 0.2f))) {
                            val fill = when {
                                position < index -> 1f
                                position == index -> progress.value
                                else -> 0f
                            }
                            Box(Modifier.fillMaxWidth(fill).fillMaxHeight().background(palette.foreground))
                        }
                    }
                }
                Row(Modifier.fillMaxWidth().padding(top = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                    Text(stringResource(R.string.recap_title), style = Type.small, color = palette.muted, modifier = Modifier.weight(1f))
                    Icon(
                        if (paused) Lucide.Play else Lucide.Pause,
                        stringResource(if (paused) R.string.recap_resume else R.string.recap_pause),
                        tint = palette.foreground,
                        modifier = Modifier.clip(CircleShape).clickable { paused = !paused }.padding(10.dp).size(20.dp),
                    )
                    Icon(
                        Lucide.X,
                        stringResource(R.string.recap_close),
                        tint = palette.foreground,
                        modifier = Modifier.clip(CircleShape).clickable(onClick = onClose).padding(10.dp).size(22.dp),
                    )
                }

                BoxWithConstraints(
                    Modifier
                        .weight(1f)
                        .fillMaxWidth()
                        .pointerInput(last) {
                            var downAt = 0L
                            detectTapGestures(
                                onPress = {
                                    downAt = System.currentTimeMillis()
                                    held = true
                                    tryAwaitRelease()
                                    held = false
                                },
                                onTap = { offset ->
                                    if (System.currentTimeMillis() - downAt < HOLD_MS) go(if (offset.x < size.width / 3f) -1 else 1)
                                },
                            )
                        },
                ) {
                    AnimatedContent(
                        targetState = index.coerceAtMost(last),
                        transitionSpec = { (fadeIn(tween(400)) + slideInVertically(tween(400)) { it / 12 }) togetherWith fadeOut(tween(150)) },
                        label = "recap slide",
                    ) { shown ->
                        Column(
                            Modifier.fillMaxSize().verticalScroll(rememberScrollState()),
                            verticalArrangement = Arrangement.spacedBy(18.dp, Alignment.CenterVertically),
                        ) {
                            slides[shown].content()
                        }
                    }
                }
            }
        }
    }
}
@Composable
private fun recapSlides(recap: Recap, play: (List<Track>, Int) -> Unit, onClose: () -> Unit, onRestart: () -> Unit): List<RecapSlide> {
    val media = LocalContainer.current.media
    val artist = recap.topArtists.firstOrNull()?.artist
    val track = recap.topTracks.firstOrNull()?.track
    val artistArt = artist?.let { media.artistImage(it.id, it.hasImage, small = false) }
    val coverOf = @Composable { item: Track? -> item?.takeIf { it.hasCover }?.let { trackCover(it, small = false) } }
    val fallback = artistArt ?: coverOf(track)
    val trackArt = coverOf(track) ?: fallback
    val soundArt = coverOf(recap.soundOfMonth) ?: fallback

    return buildList {
        add(RecapSlide("intro", trackArt) { Intro(recap) })
        add(RecapSlide("time", fallback) { TimeSlide(recap) })
        if (artist != null) add(RecapSlide("artist", artistArt ?: fallback) { ArtistSlide(recap) })
        if (track != null) add(RecapSlide("track", trackArt) { TrackSlide(recap, play) })
        if (recap.daySeconds.any { it > 0 }) add(RecapSlide("day", fallback) { DaySlide(recap) })
        if (dominantDaypart(recap.hourSeconds) != null) add(RecapSlide("hours", fallback) { HoursSlide(recap) })
        recap.moods.firstOrNull()?.let { lead -> add(RecapSlide("mood", fallback) { MoodSlide(recap, lead.key) }) }
        recap.soundOfMonth?.let { sound -> add(RecapSlide("sound", soundArt) { SoundSlide(sound, play) }) }
        recap.newArtists?.let { count -> add(RecapSlide("discoveries", fallback) { DiscoveriesSlide(recap, count) }) }
        add(RecapSlide("summary", fallback) { SummarySlide(recap, onClose, onRestart) })
    }
}
@Composable
internal fun currentLocale(): Locale = LocalResources.current.configuration.locales[0]
@Composable
internal fun monthName(year: Int, month: Int): String =
    LocalDate.of(year, month, 1).month.getDisplayName(TextStyle.FULL_STANDALONE, currentLocale()).lowercase(currentLocale())
