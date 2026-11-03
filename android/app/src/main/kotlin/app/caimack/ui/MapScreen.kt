// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Bulat Ruslanovich

package app.caimack.ui

import android.content.Context
import android.widget.Toast
import androidx.core.content.edit
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.gestures.detectTransformGestures
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
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
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.BlendMode
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.TextMeasurer
import androidx.compose.ui.text.drawText
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.rememberTextMeasurer
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import app.caimack.R
import app.caimack.api.LibraryMap
import app.caimack.api.MapPoint
import app.caimack.api.RadioRequest
import app.caimack.api.TrackLookup
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlin.math.ln
import kotlin.math.min
import kotlin.math.round

private const val GENRE_CHOICES = 12
private const val LOCATE_ZOOM = 5f
private const val LEVELS = 8
private const val TERRITORY = 0.14f

@Composable
fun MapScreen() {
    val container = LocalContainer.current

    Load(
        key = "map",
        load = { container.api.libraryMap() },
        isEmpty = { it.points.isEmpty() },
        empty = { Empty(stringResource(R.string.map_preparing)) },
    ) { map -> MapExplorer(map) }
}

@Composable
private fun MapExplorer(map: LibraryMap) {
    val container = LocalContainer.current
    val context = LocalContext.current
    val palette = LocalPalette.current
    val playback = container.player.state.collectAsState().value
    val points = map.points
    val layerPreferences = remember(context) { context.getSharedPreferences("map_layers", Context.MODE_PRIVATE) }
    var hiddenLayers by remember(layerPreferences) {
        mutableStateOf(layerPreferences.getStringSet("hidden", emptySet()).orEmpty().toSet())
    }

    val spots = remember(points) { points.map { Spot(it.x, it.y) } }
    val bounds = remember(spots) { boundsOf(spots) }
    val links = remember(spots) { constellation(spots) }
    val maxPlays = remember(points) { points.maxOfOrNull { it.plays } ?: 0 }
    val genres = remember(points) {
        points.mapNotNull { it.genre }.groupingBy { it }.eachCount().entries
            .sortedByDescending { it.value }.take(GENRE_CHOICES).map { it.key }
    }

    var size by remember { mutableStateOf(Size.Zero) }
    var view by remember { mutableStateOf<MapView?>(null) }
    var genre by remember { mutableStateOf<String?>(null) }
    var picked by remember { mutableStateOf<MapPoint?>(null) }

    val moodNames = map.landmarks.associate { it.mood to moodLabel(it.mood) }
    val genreLabel = genre?.let { chosen ->
        val members = points.filter { it.genre == chosen }
        if (members.isEmpty()) null
        else Spot(members.map { it.x }.sorted()[members.size / 2], members.map { it.y }.sorted()[members.size / 2])
    }
    val visibleLinks = if (MapLayer.Links.key in hiddenLayers) emptyList() else links
    val moodPlates = if (MapLayer.Moods.key in hiddenLayers) emptyList() else map.landmarks.map {
        Plate(moodNames[it.mood] ?: it.mood, Spot(it.x, it.y), moodHue(it.mood))
    }
    val plates = moodPlates + listOfNotNull(genreLabel?.let {
        Plate(genre!!.replaceFirstChar { char -> char.uppercase() }, it, null, strong = true)
    })

    val current = playback.current?.id?.let { id -> points.firstOrNull { it.id == id } }
    val measurer = rememberTextMeasurer()
    val density = LocalDensity.current
    val hitRadius = with(density) { 22.dp.toPx() }
    val description = stringResource(R.string.map_region, points.size)

    fun reset() {
        view = fitView(size.width, size.height, bounds)
        picked = null
    }

    fun withTrack(point: MapPoint, action: suspend (app.caimack.api.Track) -> Unit) {
        container.scope.launch {
            val track = runCatching { container.api.lookupTracks(TrackLookup(listOf(point.id))).firstOrNull() }.getOrNull()
            withContext(Dispatchers.Main) {
                if (track == null) Toast.makeText(context, R.string.radio_failed, Toast.LENGTH_SHORT).show()
                else action(track)
            }
        }
    }

    Column(Modifier.fillMaxSize()) {
        PageTitle(stringResource(R.string.nav_map), if (points.size < map.totalTracks) stringResource(R.string.map_coverage, points.size, map.totalTracks) else null)

        Row(
            Modifier.fillMaxWidth().padding(start = 16.dp, end = 8.dp, bottom = 10.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Row(
                Modifier.weight(1f).padding(end = 8.dp).horizontalScroll(rememberScrollState()),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                Chip(stringResource(R.string.map_all_genres), genre == null) { genre = null }
                genres.forEach { name ->
                    Chip(name.replaceFirstChar { it.uppercase() }, genre == name) { genre = if (genre == name) null else name }
                }
            }
            MapLayersMenu(hiddenLayers) { layer ->
                hiddenLayers = if (layer.key in hiddenLayers) hiddenLayers - layer.key else hiddenLayers + layer.key
                layerPreferences.edit { putStringSet("hidden", hiddenLayers) }
            }
            if (current != null) {
                MapButton(Lucide.Crosshair, stringResource(R.string.map_locate)) {
                    view = centreOn(Spot(current.x, current.y), LOCATE_ZOOM, size.width, size.height)
                }
            }
            MapButton(Lucide.Scan, stringResource(R.string.map_reset)) { reset() }
        }

        Box(
            Modifier
                .weight(1f)
                .fillMaxWidth()
                .padding(start = 12.dp, end = 12.dp, bottom = 12.dp)
                .musicSurface(palette)
                .background(Brush.radialGradient(listOf(lerpTowards(palette.cabinet, palette.primary, 0.025f), palette.cabinet)))
                .onSizeChanged {
                    val next = Size(it.width.toFloat(), it.height.toFloat())
                    if (size == Size.Zero || view == null) view = fitView(next.width, next.height, bounds)
                    size = next
                },
        ) {
            Canvas(
                Modifier
                    .fillMaxSize()
                    .semantics { contentDescription = description }
                    .pointerInput(bounds) {
                        detectTransformGestures { centroid, pan, zoom, _ ->
                            val shown = view ?: return@detectTransformGestures
                            val zoomed = zoomAt(shown, zoom, Spot(centroid.x, centroid.y))
                            view = zoomed.copy(panX = zoomed.panX + pan.x, panY = zoomed.panY + pan.y)
                        }
                    }
                    .pointerInput(points) {
                        detectTapGestures(
                            onDoubleTap = { at -> view?.let { view = zoomAt(it, 2f, Spot(at.x, at.y)) } },
                            onTap = { at ->
                                val shown = view ?: return@detectTapGestures
                                val base = min(size.width, size.height)
                                picked = points.minByOrNull { point ->
                                    val spot = toScreen(Spot(point.x, point.y), shown, base)
                                    (spot.x - at.x) * (spot.x - at.x) + (spot.y - at.y) * (spot.y - at.y)
                                }?.takeIf { point ->
                                    val spot = toScreen(Spot(point.x, point.y), shown, base)
                                    (spot.x - at.x) * (spot.x - at.x) + (spot.y - at.y) * (spot.y - at.y) <= hitRadius * hitRadius
                                }
                            },
                        )
                    },
            ) {
                val shown = view ?: return@Canvas
                drawMap(
                    shown, points, visibleLinks, maxPlays, palette, genre, plates,
                    current?.id,
                    picked?.id,
                    measurer,
                )
            }

            picked?.let { point ->
                PickedCard(
                    point,
                    Modifier.align(Alignment.BottomCenter).padding(10.dp),
                    onPlay = { withTrack(point) { track -> container.player.play(listOf(track), 0, "map") } },
                    onRadio = {
                        withTrack(point) { track ->
                            val radio = withContext(Dispatchers.IO) { runCatching { container.radio(RadioRequest(track.id, emptyList())) }.getOrNull() }
                            if (radio == null) Toast.makeText(context, R.string.radio_failed, Toast.LENGTH_SHORT).show()
                            else container.player.startRadio(track, radio)
                        }
                    },
                    onClose = { picked = null },
                )
            }
        }
    }
}

private data class Plate(val text: String, val at: Spot, val hue: Float?, val strong: Boolean = false)

private fun lerpTowards(from: Color, to: Color, amount: Float) = androidx.compose.ui.graphics.lerp(from, to, amount)

private fun moodTint(hue: Float, dark: Boolean, alpha: Float) = oklch(if (dark) 0.72f else 0.58f, 0.11f, hue).copy(alpha = alpha)

private fun dotRadius(k: Float, density: Float) = min(6f, 2.2f + 0.9f * (ln(k + 1) / ln(2f))) * density

private fun DrawScope.drawMap(
    view: MapView,
    points: List<MapPoint>,
    links: List<Pair<Int, Int>>,
    maxPlays: Int,
    palette: Palette,
    genre: String?,
    plates: List<Plate>,
    currentId: String?,
    pickedId: String?,
    measurer: TextMeasurer,
) {
    val base = min(size.width, size.height)
    val radius = dotRadius(view.k, density)
    val screen = { point: MapPoint -> toScreen(Spot(point.x, point.y), view, base).let { Offset(it.x, it.y) } }

    val step = gridStep(view.k)
    val from = toMap(Spot(0f, 0f), view, base)
    val to = toMap(Spot(size.width, size.height), view, base)
    var gx = kotlin.math.floor(from.x / step) * step
    while (gx <= to.x) {
        var gy = kotlin.math.floor(from.y / step) * step
        while (gy <= to.y) {
            val spot = toScreen(Spot(gx, gy), view, base)
            drawCircle(palette.faint.copy(alpha = if (palette.dark) 0.2f else 0.3f), 1.dp.toPx(), Offset(spot.x, spot.y))
            gy += step
        }
        gx += step
    }

    plates.forEach { plate ->
        val hue = plate.hue ?: return@forEach
        val centre = toScreen(plate.at, view, base).let { Offset(it.x, it.y) }
        val reach = TERRITORY * base * view.k
        drawCircle(
            Brush.radialGradient(
                listOf(moodTint(hue, palette.dark, if (palette.dark) 0.16f else 0.2f), moodTint(hue, palette.dark, 0f)),
                center = centre,
                radius = reach,
            ),
            reach,
            centre,
        )
    }

    val path = Path()
    links.forEach { (a, b) ->
        val start = screen(points[a])
        val end = screen(points[b])
        path.moveTo(start.x, start.y)
        path.lineTo(end.x, end.y)
    }
    drawPath(path, palette.foreground.copy(alpha = if (palette.dark) 0.09f else 0.13f), style = Stroke(1.dp.toPx()))

    val emphasised: (MapPoint) -> Boolean? = { point -> genre?.let { point.genre == it } }

    points.forEach { point ->
        if (emphasised(point) == false) return@forEach
        val level = playsLevel(point.plays, maxPlays)
        if (level <= 0f) return@forEach
        val centre = screen(point)
        val reach = radius * (2f + 3.5f * level)
        drawCircle(
            Brush.radialGradient(
                0f to palette.primary.copy(alpha = if (palette.dark) 0.4f else 0.3f),
                0.4f to palette.primary.copy(alpha = if (palette.dark) 0.14f else 0.1f),
                1f to palette.primary.copy(alpha = 0f),
                center = centre,
                radius = reach,
            ),
            reach,
            centre,
            blendMode = if (palette.dark) BlendMode.Plus else BlendMode.Multiply,
        )
    }

    points.forEach { point ->
        val centre = screen(point)
        if (centre.x < -radius || centre.y < -radius || centre.x > size.width + radius || centre.y > size.height + radius) return@forEach
        when (emphasised(point)) {
            true -> drawCircle(palette.primary, radius + 0.5f * density, centre)
            false -> drawCircle(palette.faint.copy(alpha = 0.14f), radius, centre)
            null -> {
                val level = round(playsLevel(point.plays, maxPlays) * LEVELS) / LEVELS
                drawCircle(
                    if (level == 0f) palette.faint.copy(alpha = 0.42f) else palette.primary.copy(alpha = 0.3f + 0.7f * level),
                    radius,
                    centre,
                )
            }
        }
    }

    points.firstOrNull { it.id == currentId }?.let { point ->
        val centre = screen(point)
        drawCircle(palette.primary, radius + 1.5f * density, centre)
        drawCircle(palette.foreground, radius + 5f * density, centre, style = Stroke(2.dp.toPx()))
    }
    points.firstOrNull { it.id == pickedId }?.let { point ->
        drawCircle(palette.foreground, radius + 3f * density, screen(point), style = Stroke(2.dp.toPx()))
    }

    drawPlates(plates, view, base, palette, measurer)
}

private fun DrawScope.drawPlates(plates: List<Plate>, view: MapView, base: Float, palette: Palette, measurer: TextMeasurer) {
    val placed = mutableListOf<androidx.compose.ui.geometry.Rect>()

    plates.sortedByDescending { it.strong }.forEach { plate ->
        val style = (if (plate.strong) Type.small else Type.tiny).copy(
            fontWeight = if (plate.strong) FontWeight.Bold else FontWeight.SemiBold,
            color = if (plate.strong) palette.onPrimary else palette.foreground,
        )
        val text = measurer.measure(plate.text, style)
        val mark = if (plate.hue == null) 0f else 13.dp.toPx()
        val width = text.size.width + 20.dp.toPx() + mark
        val height = text.size.height + 10.dp.toPx()
        val spot = toScreen(plate.at, view, base)
        var top = spot.y - height / 2

        for (attempt in 0 until 6) {
            val box = androidx.compose.ui.geometry.Rect(spot.x - width / 2 - 4, top - 2, spot.x + width / 2 + 4, top + height + 2)
            val hit = placed.firstOrNull { it.overlaps(box) }
            if (hit == null) {
                placed += box
                break
            }
            top = hit.bottom + 2
        }

        val left = spot.x - width / 2
        val corner = CornerRadius(height / 2, height / 2)
        drawRoundRect(if (plate.strong) palette.primary else palette.card.copy(alpha = 0.86f), Offset(left, top), Size(width, height), corner)
        if (!plate.strong) {
            drawRoundRect(
                plate.hue?.let { moodTint(it, palette.dark, 0.55f) } ?: palette.foreground.copy(alpha = 0.16f),
                Offset(left, top),
                Size(width, height),
                corner,
                style = Stroke(1.dp.toPx()),
            )
        }
        plate.hue?.let { drawCircle(moodTint(it, palette.dark, 1f), 3.5f * density, Offset(left + 13.dp.toPx(), top + height / 2)) }
        drawText(text, topLeft = Offset(left + 10.dp.toPx() + mark, top + (height - text.size.height) / 2))
    }
}

@Composable
private fun MapButton(icon: androidx.compose.ui.graphics.vector.ImageVector, label: String, onClick: () -> Unit) {
    Box(Modifier.size(44.dp).clip(CircleShape).clickable(onClickLabel = label, onClick = onClick), contentAlignment = Alignment.Center) {
        Icon(icon, label, tint = LocalPalette.current.muted, modifier = Modifier.size(20.dp))
    }
}

@Composable
private fun PickedCard(point: MapPoint, modifier: Modifier, onPlay: () -> Unit, onRadio: () -> Unit, onClose: () -> Unit) {
    val palette = LocalPalette.current
    val media = LocalContainer.current.media
    val details = listOfNotNull(
        point.genre?.replaceFirstChar { it.uppercase() },
        if (point.plays > 0) pluralStringResource(R.plurals.map_plays, point.plays, point.plays) else stringResource(R.string.map_never_played),
    ).joinToString(" · ")

    Row(
        modifier.fillMaxWidth().clip(Radius.panel).background(palette.popover).padding(8.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Cover(media.cover(point.albumId, point.id, point.hasCover, small = true), point.title, Modifier.size(48.dp))
        Column(Modifier.weight(1f)) {
            Text(point.title, style = Type.small.copy(fontWeight = FontWeight.Medium), maxLines = 1, overflow = TextOverflow.Ellipsis)
            Text(point.artist, style = Type.tiny, color = palette.muted, maxLines = 1, overflow = TextOverflow.Ellipsis)
            Text(details, style = Type.tiny, color = palette.faint, maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
        MapButton(Lucide.Play, stringResource(R.string.action_play), onPlay)
        MapButton(Lucide.Radio, stringResource(R.string.map_radio_from), onRadio)
        MapButton(Lucide.X, stringResource(R.string.action_close), onClose)
    }
}
