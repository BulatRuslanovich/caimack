// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Bulat Ruslanovich

package app.caimack.ui

import android.widget.Toast
import android.provider.Settings
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.LinearEasing
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import app.caimack.R
import app.caimack.api.RadioRequest
import app.caimack.api.Track
import kotlinx.coroutines.launch

@Composable
internal fun RadioHero(candidates: List<Track>) {
    val container = LocalContainer.current
    val palette = LocalPalette.current
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val playback by container.player.state.collectAsStateWithLifecycle()
    val radio by container.radio.state.collectAsStateWithLifecycle()
    val active = radio.active && playback.current != null && radio.mood == null && radio.seedTrackId == null
    val playing = active && playback.playing
    var starting by remember { mutableStateOf(false) }
    val lead = (if (active) playback.current else null) ?: candidates.firstOrNull { it.hasCover } ?: candidates.firstOrNull()
    val sleeves = (if (active) playback.queue.drop(playback.index + 1) else candidates)
        .distinctBy { it.albumId ?: it.id }.filter { it.id != lead?.id }.take(2)
    val tone by animateColorAsState(rememberVividToneColor(listOfNotNull(lead?.let { trackCover(it) })), tween(1000), label = "radio-light")
    val action = stringResource(when {
        starting -> R.string.radio_tile_starting
        playing -> R.string.action_pause
        active -> R.string.radio_hero_resume
        else -> R.string.radio_hero_start
    })

    val actionLabel = "${stringResource(R.string.radio_mine)}: $action"
    Column(
        Modifier.padding(horizontal = 16.dp).fillMaxWidth().testTag("personal-radio").musicSurface(palette)
            .drawBehind {
                val light = tone.copy(alpha = tone.alpha * if (palette.dark) 0.22f else 0.16f)
                drawRect(Brush.radialGradient(listOf(light, Color.Transparent),
                    Offset(size.width * 0.85f, size.height * 0.25f), size.width * 0.85f))
            }.padding(20.dp),
        verticalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        Box(Modifier.fillMaxWidth().heightIn(min = 224.dp)) {
            Box(Modifier.align(Alignment.CenterEnd).offset(x = 52.dp).width(180.dp).height(216.dp)) {
                VinylFace(lead, spinning = playing && !playback.buffering,
                    Modifier.align(Alignment.TopEnd).size(180.dp))
                sleeves.reversed().forEachIndexed { index, track ->
                    Cover(trackCover(track, small = false), track.albumTitle ?: track.title,
                        Modifier.align(Alignment.BottomStart).offset(x = (24 + index * 16).dp, y = (-12 - index * 8).dp)
                            .size(88.dp).rotate(if (index == 0) -14f else 10f).shadow(12.dp, Radius.cover))
                }
            }
            Column(Modifier.fillMaxWidth(0.56f).align(Alignment.CenterStart),
                verticalArrangement = Arrangement.spacedBy(16.dp)) {
                Text(stringResource(R.string.radio_mine), style = Type.display)
                Text(stringResource(R.string.radio_hero_description), style = Type.small, color = palette.muted)
                Row(Modifier.heightIn(min = 48.dp).testTag("radio-toggle").semantics { contentDescription = actionLabel }.clip(CircleShape).background(palette.action)
                    .clickable(enabled = !starting, role = Role.Button) {
                        if (active) container.player.toggle()
                        else {
                            starting = true
                            scope.launch {
                                try {
                                    val batch = container.radio(RadioRequest(null, emptyList()))
                                    if (batch.tracks.isEmpty()) Toast.makeText(context, R.string.radio_failed, Toast.LENGTH_SHORT).show()
                                    else container.player.playMyRadio(batch)
                                } catch (cancelled: kotlinx.coroutines.CancellationException) {
                                    throw cancelled
                                } catch (_: Exception) {
                                    Toast.makeText(context, R.string.radio_failed, Toast.LENGTH_SHORT).show()
                                } finally { starting = false }
                            }
                        }
                    }.padding(horizontal = 14.dp, vertical = 8.dp),
                    verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Icon(if (playing) Lucide.Pause else Lucide.Play, null, tint = palette.onAction, modifier = Modifier.size(18.dp))
                    Text(action, style = Type.small, color = palette.onAction, maxLines = 1,
                        overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f, fill = false))
                }
            }
        }
        Box(Modifier.fillMaxWidth().height(1.dp).background(palette.cabinetEdge))
        Row(Modifier.fillMaxWidth().height(56.dp), verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            Icon(Lucide.Radio, null, tint = palette.primary, modifier = Modifier.size(20.dp))
            Column(Modifier.weight(1f)) {
                Text(if (active) playback.current!!.title else stringResource(R.string.radio_hero_ready),
                    style = Type.small, maxLines = 1, overflow = TextOverflow.Ellipsis)
                Text(if (active) artistsOf(playback.current!!) else stringResource(R.string.radio_hero_hint),
                    style = Type.tiny, color = palette.muted, maxLines = 1, overflow = TextOverflow.Ellipsis)
            }
            sleeves.firstOrNull()?.let { next ->
                Cover(trackCover(next), next.albumTitle ?: next.title, Modifier.size(36.dp))
            }
        }
    }
}

@Composable
private fun VinylFace(track: Track?, spinning: Boolean, modifier: Modifier) {
    val context = LocalContext.current
    val reduced = remember(context) {
        Settings.Global.getFloat(context.contentResolver, Settings.Global.ANIMATOR_DURATION_SCALE, 1f) == 0f
    }
    val angle = remember { Animatable(0f) }
    LaunchedEffect(spinning, reduced) {
        while (spinning && !reduced) {
            angle.animateTo(angle.value + 360f, tween(24_000, easing = LinearEasing))
            angle.snapTo(angle.value % 360f)
        }
    }
    Box(modifier.shadow(16.dp, CircleShape).graphicsLayer { rotationZ = angle.value }.clip(CircleShape).background(Color(0xFF111314))) {
        Canvas(Modifier.fillMaxSize()) {
            val radius = size.minDimension / 2
            var groove = radius * 0.43f
            while (groove < radius) {
                drawCircle(Color.White.copy(alpha = 0.055f), groove, style = Stroke(0.7.dp.toPx()))
                groove += 2.2.dp.toPx()
            }
            drawCircle(Brush.sweepGradient(listOf(Color.Transparent, Color.White.copy(alpha = 0.12f),
                Color.Transparent, Color.Transparent, Color.White.copy(alpha = 0.07f), Color.Transparent)),
                style = Stroke(radius * 0.55f))
        }
        if (track != null) Cover(trackCover(track), track.albumTitle ?: track.title,
            Modifier.align(Alignment.Center).fillMaxSize(0.4f), round = true)
    }
}
