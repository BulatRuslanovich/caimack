// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Bulat Ruslanovich

package app.caimack.ui

import android.widget.Toast
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.colorspace.ColorSpaces
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import app.caimack.R
import app.caimack.api.Mood
import app.caimack.api.RadioRequest
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlin.math.cos
import kotlin.math.sin

private const val MOODS = "moods"

@Composable
fun moodLabel(key: String): String = when (key) {
    "workout" -> stringResource(R.string.mood_workout)
    "party" -> stringResource(R.string.mood_party)
    "chill" -> stringResource(R.string.mood_chill)
    "sleep" -> stringResource(R.string.mood_sleep)
    "happy" -> stringResource(R.string.mood_happy)
    "sad" -> stringResource(R.string.mood_sad)
    else -> key.replaceFirstChar { it.uppercase() }
}

fun moodIcon(key: String): ImageVector = when (key) {
    "workout" -> Lucide.Dumbbell
    "party" -> Lucide.PartyPopper
    "chill" -> Lucide.Coffee
    "sleep" -> Lucide.Moon
    "happy" -> Lucide.Sun
    "sad" -> Lucide.CloudRain
    else -> Lucide.Radio
}

private val HUES = mapOf(
    "workout" to 30f,
    "happy" to 90f,
    "chill" to 150f,
    "sad" to 230f,
    "sleep" to 298f,
    "party" to 350f,
)

internal fun moodHue(key: String): Float = HUES[key] ?: key.fold(7) { hash, char -> (hash * 31 + char.code) % 360 }.toFloat()

internal fun oklch(lightness: Float, chroma: Float, hue: Float): Color {
    val radians = Math.toRadians(hue.toDouble())
    return Color(lightness, (chroma * cos(radians)).toFloat(), (chroma * sin(radians)).toFloat(), 1f, ColorSpaces.Oklab)
        .convert(ColorSpaces.Srgb)
}

@Composable
private fun MoodTile(mood: Mood, active: Boolean, playing: Boolean, enabled: Boolean, dimmed: Boolean, onClick: () -> Unit) {
    val palette = LocalPalette.current
    val media = LocalContainer.current.media
    val covers = mood.albumIds.map { media.cover(it, null, true, small = true) }
    val tone = rememberVividToneColor(covers)
    val wash = tone.copy(alpha = tone.alpha * if (palette.dark) 0.3f else 0.4f)

    Box(
        Modifier
            .size(width = 144.dp, height = 112.dp)
            .alpha(if (dimmed) 0.5f else 1f)
            .then(if (active) Modifier.border(2.dp, palette.foreground, Radius.panel) else Modifier)
            .padding(if (active) 4.dp else 0.dp)
            .clip(Radius.panel)
            .background(palette.card)
            .drawBehind {
                drawRect(Brush.radialGradient(listOf(wash, Color.Transparent), center = Offset.Zero, radius = size.maxDimension * 1.1f))
            }
            .clickable(enabled = enabled, onClick = onClick),
    ) {
        Column(Modifier.fillMaxSize().padding(12.dp), verticalArrangement = Arrangement.SpaceBetween) {
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.Top) {
                Box(Modifier.size(width = 92.dp, height = 44.dp)) {
                    covers.forEachIndexed { index, url ->
                        Cover(
                            url,
                            moodLabel(mood.key),
                            Modifier
                                .offset(x = (index * 24).dp)
                                .size(44.dp)
                                .rotate((index - 1) * 5f)
                                .shadow(6.dp, Radius.cover),
                        )
                    }
                    if (covers.isEmpty()) {
                        Box(Modifier.size(44.dp).clip(Radius.cover).background(palette.accent), contentAlignment = Alignment.Center) {
                            Icon(moodIcon(mood.key), null, tint = palette.muted, modifier = Modifier.size(20.dp))
                        }
                    }
                }
                if (active && playing) {
                    Box(Modifier.weight(1f), contentAlignment = Alignment.CenterEnd) { NowPlayingBars(palette.foreground) }
                }
            }
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                Icon(moodIcon(mood.key), null, tint = palette.muted, modifier = Modifier.size(16.dp))
                Text(
                    moodLabel(mood.key),
                    style = Type.small.copy(fontWeight = FontWeight.SemiBold),
                    color = palette.foreground,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
            }
        }
    }
}

@Composable
fun MoodRadio() {
    val container = LocalContainer.current
    val context = LocalContext.current
    val activeMood by remember { container.radio.state.map { it.mood }.distinctUntilChanged() }
        .collectAsState(initial = null)
    @Suppress("UNCHECKED_CAST")
    val moods by produceState(Remote.cache[MOODS] as List<Mood>? ?: emptyList()) {
        if (value.isEmpty()) {
            runCatching { withNetworkRetries { container.api.moods() } }
                .onSuccess {
                    Remote.cache[MOODS] = it
                    value = it
                }
        }
    }
    var starting by remember { mutableStateOf<String?>(null) }
    val playing = container.player.state.collectAsState().value.playing

    if (moods.isEmpty()) return

    Column(verticalArrangement = Arrangement.spacedBy(16.dp)) {
        SectionHeader(stringResource(R.string.mood_title))
        LazyRow(contentPadding = PaddingValues(horizontal = 16.dp), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            items(moods, key = { it.key }) { item ->
                val mood = item.key
                MoodTile(
                    item,
                    active = activeMood == mood,
                    playing = playing,
                    enabled = starting == null,
                    dimmed = starting != null && starting != mood,
                ) {
                    starting = mood
                    container.scope.launch {
                        val batch = runCatching { container.radio(RadioRequest(null, emptyList(), mood)) }.getOrNull()
                        withContext(Dispatchers.Main) {
                            starting = null
                            if (batch == null || batch.tracks.isEmpty()) {
                                Toast.makeText(context, R.string.radio_failed, Toast.LENGTH_SHORT).show()
                            } else {
                                container.player.playMyRadio(batch, mood)
                            }
                        }
                    }
                }
            }
        }
    }
}
