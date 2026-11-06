// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

package app.caimack.ui

import android.content.Context
import android.widget.Toast
import androidx.core.content.edit
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.gestures.detectTransformGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.Icon
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Text
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.withFrameNanos
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.repeatOnLifecycle
import kotlinx.coroutines.delay
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.clipToBounds
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
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.Role
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
import androidx.compose.ui.unit.Constraints
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
    if (!recommendationsEnabled()) return
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

    val genreLabel = genre?.let { chosen ->
        val members = points.filter { it.genre == chosen }
        if (members.isEmpty()) null
        else Spot(members.map { it.x }.sorted()[members.size / 2], members.map { it.y }.sorted()[members.size / 2])
    }
    val visibleLinks = if (MapLayer.Links.key in hiddenLayers) emptyList() else links
    val plates = listOfNotNull(genreLabel?.let {
        Plate(genre!!.replaceFirstChar { char -> char.uppercase() }, it, null, strong = true)
    })

    val current = playback.current?.id?.let { id -> points.firstOrNull { it.id == id } }
    val motion = MapLayer.Motion.key !in hiddenLayers && systemMotionEnabled()
    val route = remember(points, playback.queue, playback.index, playback.shuffle, playback.nextIndex) {
        playbackMapRoute(points, playback.queue, playback.index, playback.shuffle, playback.nextIndex)
    }.takeIf { MapLayer.Route.key !in hiddenLayers }
    val showCovers = MapLayer.Covers.key !in hiddenLayers
    var phase by remember { mutableFloatStateOf(0f) }
    val lifecycle = LocalLifecycleOwner.current.lifecycle
    LaunchedEffect(motion, playback.playing, current?.id, lifecycle) {
        phase = 0f
        if (!motion || !playback.playing || current == null) return@LaunchedEffect
        lifecycle.repeatOnLifecycle(Lifecycle.State.RESUMED) {
            var started = 0L
            while (true) {
                withFrameNanos { now ->
                    if (started == 0L) started = now
                    phase = ((now - started) % 2_400_000_000L) / 2_400_000_000f
                }
                delay(32)
            }
        }
    }
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

        Column(Modifier.padding(start = 16.dp, end = 16.dp, bottom = 12.dp)
            .weight(1f).fillMaxWidth().musicSurface(palette)) {
            Row(Modifier.fillMaxWidth().padding(start = 12.dp, end = 12.dp, top = 12.dp),
                horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                GenreMenu(genres, genre, Modifier.weight(1f)) { genre = it }
                MapLayersMenu(hiddenLayers, Modifier.weight(1f)) { layer ->
                    hiddenLayers = if (layer.key in hiddenLayers) hiddenLayers - layer.key else hiddenLayers + layer.key
                    layerPreferences.edit { putStringSet("hidden", hiddenLayers) }
                }
            }
            Row(Modifier.fillMaxWidth().padding(horizontal = 8.dp, vertical = 4.dp),
                verticalAlignment = Alignment.CenterVertically) {
                MapButton(Lucide.Minus, stringResource(R.string.map_zoom_out)) {
                    view?.let { view = zoomAt(it, 0.8f, Spot(size.width / 2, size.height / 2)) }
                }
                MapButton(Lucide.Plus, stringResource(R.string.map_zoom_in)) {
                    view?.let { view = zoomAt(it, 1.25f, Spot(size.width / 2, size.height / 2)) }
                }
                Spacer(Modifier.weight(1f))
                if (current != null) MapButton(Lucide.Crosshair, stringResource(R.string.map_locate)) {
                    view = centreOn(Spot(current.x, current.y), LOCATE_ZOOM, size.width, size.height)
                }
                MapButton(Lucide.Scan, stringResource(R.string.map_reset)) { reset() }
            }
            HorizontalDivider(color = palette.cabinetEdge)
            Box(
                Modifier
                    .weight(1f)
                    .fillMaxWidth()
                    .testTag("library-map-canvas")
                    .clipToBounds()
                    .background(Brush.radialGradient(listOf(lerpTowards(palette.cabinet, palette.primary, 0.025f), palette.cabinet)))
                    .onSizeChanged {
                        val next = Size(it.width.toFloat(), it.height.toFloat())
                        if (size != next || view == null) view = fitView(next.width, next.height, bounds)
                        size = next
                    },
            ) {
                Canvas(
                    Modifier
                        .fillMaxSize()
                        .graphicsLayer()
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
                        measurer, route, showCovers,
                    )
                }

                view?.takeIf { showCovers && it.k > 4f }?.let { shown ->
                    MapCoverTiles(points, shown, size, current?.id, picked?.id, motion)
                }

                if (motion && playback.playing && current != null) Canvas(Modifier.fillMaxSize()) {
                    val shown = view ?: return@Canvas
                    val base = min(size.width, size.height)
                    val at = toScreen(Spot(current.x, current.y), shown, base)
                    val dot = dotRadius(shown.k, this.density)
                    val marker = if (showCovers) dot + (16.dp.toPx() - dot) * ((shown.k - 4f) / 2f).coerceIn(0f, 1f) else dot
                    val pulse = (kotlin.math.sin(phase * 2f * kotlin.math.PI).toFloat() + 1f) / 2f
                    drawCircle(palette.primary.copy(alpha = 0.35f * (1f - pulse)), marker + (8f + 8f * pulse) * this.density,
                        Offset(at.x, at.y), style = Stroke(2.dp.toPx()))
                    route?.let { drawRouteProgress(it, shown, base, palette, phase) }
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
            HorizontalDivider(color = palette.cabinetEdge)
            Text(stringResource(R.string.map_hint), style = Type.micro, color = palette.muted,
                modifier = Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 10.dp),
                maxLines = 2)
        }
    }
}

private data class Plate(val text: String, val at: Spot, val hue: Float?, val strong: Boolean = false)

private fun lerpTowards(from: Color, to: Color, amount: Float) = androidx.compose.ui.graphics.lerp(from, to, amount)

private fun moodTint(hue: Float, dark: Boolean, alpha: Float) = oklch(if (dark) 0.72 else 0.58, 0.11, hue.toDouble(), alpha)

private fun dotRadius(k: Float, density: Float) = min(3.6f, 1.4f + 0.55f * (ln(k + 1) / ln(2f))) * density

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
    route: PlaybackMapRoute?,
    covers: Boolean,
) {
    val base = min(size.width, size.height)
    val radius = dotRadius(view.k, density)
    val marker = if (covers) radius + (16.dp.toPx() - radius) * ((view.k - 4f) / 2f).coerceIn(0f, 1f) else radius
    val screen = { point: MapPoint -> toScreen(Spot(point.x, point.y), view, base).let { Offset(it.x, it.y) } }

    val step = gridStep(view.k)
    val from = toMap(Spot(0f, 0f), view, base)
    val to = toMap(Spot(size.width, size.height), view, base)
    var gx = kotlin.math.floor(from.x / step) * step
    while (gx <= to.x) {
        var gy = kotlin.math.floor(from.y / step) * step
        while (gy <= to.y) {
            val spot = toScreen(Spot(gx, gy), view, base)
            drawCircle(palette.faint.copy(alpha = if (palette.dark) 0.14f else 0.18f), 0.5.dp.toPx(), Offset(spot.x, spot.y))
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
                listOf(moodTint(hue, palette.dark, if (palette.dark) 0.09f else 0.12f), moodTint(hue, palette.dark, 0f)),
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

    if (route != null) drawPlaybackRoute(route, view, base, palette)

    val emphasised: (MapPoint) -> Boolean? = { point -> genre?.let { point.genre == it } }

    points.forEach { point ->
        if (emphasised(point) == false) return@forEach
        val level = playsLevel(point.plays, maxPlays)
        if (level <= 0f) return@forEach
        val centre = screen(point)
        val reach = radius * (1.8f + 2f * level)
        drawCircle(
            Brush.radialGradient(
                0f to palette.primary.copy(alpha = if (palette.dark) 0.24f else 0.18f),
                0.4f to palette.primary.copy(alpha = if (palette.dark) 0.08f else 0.06f),
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
        drawCircle(palette.foreground, marker + 5f * density, centre, style = Stroke(2.dp.toPx()))
    }
    points.firstOrNull { it.id == pickedId }?.let { point ->
        drawCircle(palette.foreground, marker + 3f * density, screen(point), style = Stroke(2.dp.toPx()))
    }

    drawPlates(plates, view, base, palette, measurer)
}

private fun DrawScope.drawPlaybackRoute(route: PlaybackMapRoute, view: MapView, base: Float, palette: Palette) {
    fun at(point: MapPoint) = toScreen(Spot(point.x, point.y), view, base).let { Offset(it.x, it.y) }
    fun path(points: List<MapPoint>): Path = Path().apply {
        points.forEachIndexed { index, point -> val position = at(point)
            if (index == 0) moveTo(position.x, position.y) else lineTo(position.x, position.y)
        }
    }
    if (route.behind.isNotEmpty()) drawPath(path(route.behind + route.at), palette.foreground.copy(alpha = 0.25f),
        style = Stroke(2.dp.toPx()))
    val forward = listOf(route.at) + route.ahead
    if (route.ahead.isNotEmpty()) {
        drawPath(path(forward), palette.primary.copy(alpha = 0.8f), style = Stroke(2.dp.toPx(),
            pathEffect = PathEffect.dashPathEffect(floatArrayOf(7.dp.toPx(), 5.dp.toPx()))))
        route.ahead.forEach { drawCircle(palette.primary, 3.dp.toPx(), at(it)) }
    }
}

private fun DrawScope.drawRouteProgress(route: PlaybackMapRoute, view: MapView, base: Float, palette: Palette, phase: Float) {
    if (route.ahead.isEmpty()) return
    val points = listOf(route.at) + route.ahead
    val progress = phase * (points.size - 1)
    val index = progress.toInt().coerceAtMost(points.lastIndex - 1)
    fun at(point: MapPoint) = toScreen(Spot(point.x, point.y), view, base).let { Offset(it.x, it.y) }
    val start = at(points[index]); val end = at(points[index + 1])
    drawCircle(palette.primary, 4.dp.toPx(), start + (end - start) * (progress - index))
}

private fun DrawScope.drawPlates(plates: List<Plate>, view: MapView, base: Float, palette: Palette, measurer: TextMeasurer) {
    val placed = mutableListOf<androidx.compose.ui.geometry.Rect>()

    plates.sortedByDescending { it.strong }.forEach { plate ->
        val style = (if (plate.strong) Type.small else Type.tiny).copy(
            fontWeight = if (plate.strong) FontWeight.Bold else FontWeight.SemiBold,
            color = if (plate.strong) palette.onPrimary else palette.foreground,
        )
        val margin = 8.dp.toPx()
        val mark = if (plate.hue == null) 0f else 13.dp.toPx()
        val text = measurer.measure(plate.text, style, maxLines = 1, overflow = TextOverflow.Ellipsis,
            constraints = Constraints(maxWidth = (size.width - margin * 2 - 20.dp.toPx() - mark).toInt().coerceAtLeast(1)))
        val width = text.size.width + 20.dp.toPx() + mark
        val height = text.size.height + 10.dp.toPx()
        val spot = toScreen(plate.at, view, base)
        if (spot.x !in 0f..size.width || spot.y !in 0f..size.height || height > size.height - margin * 2) return@forEach
        val left = (spot.x - width / 2).coerceIn(margin, (size.width - width - margin).coerceAtLeast(margin))
        val box = listOf(0, 1, -1, 2, -2, 3, -3, 4, -4).firstNotNullOfOrNull { shift ->
            val top = (spot.y - height / 2 + shift * (height + 6.dp.toPx()))
                .coerceIn(margin, size.height - height - margin)
            val candidate = androidx.compose.ui.geometry.Rect(left, top, left + width, top + height)
            candidate.takeIf { placed.none { it.overlaps(candidate.inflate(3.dp.toPx())) } }
        } ?: return@forEach
        placed += box
        val top = box.top
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
private fun GenreMenu(genres: List<String>, selected: String?, modifier: Modifier, onSelect: (String?) -> Unit) {
    val palette = LocalPalette.current
    var expanded by remember { mutableStateOf(false) }
    val all = stringResource(R.string.map_all_genres)
    Box(modifier) {
        Row(Modifier.fillMaxWidth().heightIn(min = 48.dp).clip(CircleShape)
            .background(palette.primarySoft).border(1.dp, palette.cabinetEdge, CircleShape)
            .clickable(role = Role.Button) { expanded = true }.padding(horizontal = 12.dp),
            verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Text(selected?.replaceFirstChar { it.uppercase() } ?: all, style = Type.small,
                color = palette.foreground, maxLines = 1, overflow = TextOverflow.Ellipsis,
                modifier = Modifier.weight(1f))
            Icon(Lucide.ChevronDown, null, tint = palette.muted, modifier = Modifier.size(16.dp))
        }
        DropdownMenu(expanded, onDismissRequest = { expanded = false },
            shape = Radius.hero, containerColor = palette.popover) {
            (listOf<String?>(null) + genres).forEach { genre ->
                DropdownMenuItem(text = {
                    Text(genre?.replaceFirstChar { it.uppercase() } ?: all, style = Type.small,
                        color = if (genre == selected) palette.primary else palette.foreground)
                }, onClick = { onSelect(genre); expanded = false })
            }
        }
    }
}

@Composable
private fun MapButton(icon: androidx.compose.ui.graphics.vector.ImageVector, label: String, onClick: () -> Unit) {
    Box(Modifier.size(48.dp).clip(CircleShape).clickable(onClickLabel = label, onClick = onClick), contentAlignment = Alignment.Center) {
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

    Column(
        modifier.fillMaxWidth().testTag("map-picked-card").clip(Radius.hero).background(palette.popover)
            .border(1.dp, palette.cabinetEdge, Radius.hero).padding(10.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            Cover(media.cover(point.albumId, point.id, point.hasCover, small = true), point.title, Modifier.size(40.dp))
            Column(Modifier.weight(1f)) {
                Text(point.title, style = Type.small.copy(fontWeight = FontWeight.Medium), maxLines = 1, overflow = TextOverflow.Ellipsis)
                Text(point.artist, style = Type.tiny, color = palette.muted, maxLines = 1, overflow = TextOverflow.Ellipsis)
                Text(details, style = Type.tiny, color = palette.faint, maxLines = 1, overflow = TextOverflow.Ellipsis)
            }
            MapButton(Lucide.X, stringResource(R.string.action_close), onClose)
        }
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Row(Modifier.weight(1f).heightIn(min = 48.dp).clip(CircleShape).background(palette.action)
                .clickable(role = Role.Button, onClick = onPlay).padding(horizontal = 12.dp),
                verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp, Alignment.CenterHorizontally)) {
                Icon(Lucide.Play, null, tint = palette.onAction, modifier = Modifier.size(18.dp))
                Text(stringResource(R.string.radio_hero_start), style = Type.small, color = palette.onAction,
                    maxLines = 1, overflow = TextOverflow.Ellipsis)
            }
            Row(Modifier.weight(1f).heightIn(min = 48.dp).clip(CircleShape).background(palette.accent)
                .clickable(role = Role.Button, onClickLabel = stringResource(R.string.map_radio_from), onClick = onRadio)
                .padding(horizontal = 12.dp), verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(8.dp, Alignment.CenterHorizontally)) {
                Icon(Lucide.Radio, null, tint = palette.foreground, modifier = Modifier.size(18.dp))
                Text(stringResource(R.string.map_radio_short), style = Type.small, color = palette.foreground,
                    maxLines = 1, overflow = TextOverflow.Ellipsis)
            }
        }
    }
}
