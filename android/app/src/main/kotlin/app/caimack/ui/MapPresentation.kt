// SPDX-License-Identifier: AGPL-3.0-only
package app.caimack.ui

import app.caimack.api.MapPoint
import app.caimack.api.Track
import kotlin.math.floor
import kotlin.math.min

internal data class PlaybackMapRoute(val at: MapPoint, val behind: List<MapPoint>, val ahead: List<MapPoint>)

internal fun playbackMapRoute(points: List<MapPoint>, queue: List<Track>, index: Int, shuffle: Boolean, nextIndex: Int): PlaybackMapRoute? {
    val byId = points.associateBy { it.id }
    val at = queue.getOrNull(index)?.id?.let(byId::get) ?: return null
    val behind = if (shuffle) emptyList() else queue.subList((index - 3).coerceAtLeast(0), index).mapNotNull { byId[it.id] }
    val ahead = if (shuffle) listOfNotNull(queue.getOrNull(nextIndex)?.id?.let(byId::get))
        else queue.drop(index + 1).take(6).mapNotNull { byId[it.id] }
    return PlaybackMapRoute(at, behind, ahead)
}

internal fun visibleMapCovers(points: List<MapPoint>, view: MapView, width: Float, height: Float, edge: Float,
    currentId: String?, pickedId: String?): List<MapPoint> {
    if (width <= 0 || height <= 0 || edge <= 0) return emptyList()
    val cells = HashSet<Pair<Int, Int>>()
    val prioritized = points.filter { it.id == pickedId || it.id == currentId } + points
    val ids = HashSet<String>()
    return prioritized.asSequence().filter { ids.add(it.id) }.filter { point ->
        val at = toScreen(Spot(point.x, point.y), view, min(width, height))
        at.x >= -edge && at.y >= -edge && at.x <= width + edge && at.y <= height + edge &&
            cells.add(floor(at.x / (edge * 1.2f)).toInt() to floor(at.y / (edge * 1.2f)).toInt())
    }.take(120).toList()
}
